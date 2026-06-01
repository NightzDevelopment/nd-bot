/**
 * Community events: post an event with RSVP buttons, track responses, and
 * remind attendees before it starts.
 *
 * Interaction customId: ndevent:rsvp:<eventId>:<yes|no|maybe>
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type Client,
  EmbedBuilder,
  type Interaction,
  MessageFlags,
  type TextChannel,
} from 'discord.js'
import { childLogger } from '../lib/logger.ts'
import {
  createEvent,
  type EventRecord,
  getEvent,
  type RsvpChoice,
  setRsvp,
  updateEvent,
} from './events-store.ts'
import { scheduleAction } from './scheduled-actions-store.ts'

const log = childLogger('events')
const PREFIX = 'ndevent'

/** Minutes before start to send the reminder. */
const REMINDER_LEAD_MS = 15 * 60 * 1000

function buildEmbed(ev: EventRecord): EmbedBuilder {
  const when = Math.floor(ev.startsAt / 1000)
  return new EmbedBuilder()
    .setColor(ev.cancelled ? 0xef4444 : 0x60a5fa)
    .setTitle(ev.cancelled ? `[CANCELLED] ${ev.title}` : ev.title)
    .setDescription(ev.description || '*(no description)*')
    .addFields(
      { name: 'When', value: `<t:${when}:F> (<t:${when}:R>)`, inline: false },
      { name: `Going (${ev.rsvps.yes.length})`, value: ev.rsvps.yes.length ? ev.rsvps.yes.map((u) => `<@${u}>`).join(' ').slice(0, 1024) : '—', inline: false },
      { name: `Maybe (${ev.rsvps.maybe.length})`, value: ev.rsvps.maybe.length ? ev.rsvps.maybe.map((u) => `<@${u}>`).join(' ').slice(0, 1024) : '—', inline: true },
      { name: `Can't (${ev.rsvps.no.length})`, value: String(ev.rsvps.no.length), inline: true },
    )
    .setFooter({ text: `Event ID: ${ev.id}` })
}

function buildButtons(ev: EventRecord): ActionRowBuilder<ButtonBuilder>[] {
  if (ev.cancelled) return []
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`${PREFIX}:rsvp:${ev.id}:yes`).setLabel('Going').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`${PREFIX}:rsvp:${ev.id}:maybe`).setLabel('Maybe').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${PREFIX}:rsvp:${ev.id}:no`).setLabel("Can't").setStyle(ButtonStyle.Danger),
    ),
  ]
}

/** Create an event, post it with RSVP buttons, and schedule a reminder. */
export async function createAndPostEvent(args: {
  guildId: string
  channel: TextChannel
  title: string
  description: string
  startsAt: number
  createdBy: string
}): Promise<EventRecord> {
  const ev = await createEvent({
    guildId: args.guildId,
    channelId: args.channel.id,
    title: args.title,
    description: args.description,
    startsAt: args.startsAt,
    createdBy: args.createdBy,
  })
  const sent = await args.channel.send({ embeds: [buildEmbed(ev)], components: buildButtons(ev) })
  await updateEvent(ev.id, { messageId: sent.id })

  const remindAt = args.startsAt - REMINDER_LEAD_MS
  if (remindAt > Date.now()) {
    await scheduleAction({
      type: 'event_reminder',
      guildId: args.guildId,
      userId: 'system',
      dueAt: remindAt,
      meta: { eventId: ev.id },
    })
  }
  return ev
}

async function refreshEventMessage(client: Client, ev: EventRecord): Promise<void> {
  if (!ev.messageId) return
  const ch = await client.channels.fetch(ev.channelId).catch(() => null)
  if (!ch?.isTextBased() || !('messages' in ch)) return
  const msg = await ch.messages.fetch(ev.messageId).catch(() => null)
  if (msg) await msg.edit({ embeds: [buildEmbed(ev)], components: buildButtons(ev) }).catch(() => {})
}

/** Post a reminder pinging attendees. Called from the scheduled-actions loop. */
export async function remindEvent(client: Client, eventId: string): Promise<void> {
  const ev = await getEvent(eventId)
  if (!ev || ev.cancelled) return
  const ch = await client.channels.fetch(ev.channelId).catch(() => null)
  if (!ch?.isTextBased() || !('send' in ch)) return
  const going = ev.rsvps.yes.map((u) => `<@${u}>`).join(' ')
  const when = Math.floor(ev.startsAt / 1000)
  await (ch as TextChannel)
    .send({
      content: `Reminder: **${ev.title}** starts <t:${when}:R>. ${going}`.slice(0, 1900),
      allowedMentions: { users: ev.rsvps.yes.slice(0, 50) },
    })
    .catch(() => {})
  log.info({ eventId }, 'event reminder posted')
}

export async function tryHandleEventInteraction(interaction: Interaction): Promise<boolean> {
  if (!interaction.isButton()) return false
  const id = interaction.customId
  if (!id.startsWith(`${PREFIX}:rsvp:`)) return false
  const [, , eventId, choice] = id.split(':')
  const ev = await setRsvp(eventId ?? '', interaction.user.id, (choice ?? 'yes') as RsvpChoice)
  if (!ev) {
    await interaction.reply({ content: 'This event no longer exists.', flags: MessageFlags.Ephemeral })
    return true
  }
  await interaction.update({ embeds: [buildEmbed(ev)], components: buildButtons(ev) }).catch(async () => {
    await interaction.reply({ content: `RSVP saved: ${choice}.`, flags: MessageFlags.Ephemeral }).catch(() => {})
  })
  return true
}

export { refreshEventMessage }
