/**
 * Optional buttons after AI suggests opening a ticket (section 9).
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  type ButtonInteraction,
  type Client,
  type Message,
} from 'discord.js'
import {
  TICKET_OPEN_CATEGORY_ID,
  ticketAutoCreate,
  ticketAutoCreateChannelIds,
  ticketForumChannelId,
  ticketOfferCooldownMs,
  ticketOfferEnabled,
  ticketStaffIntakeOnly,
  ticketSystemEnabled,
  WELCOME_TICKET_CHANNEL_ID,
} from '../config.ts'
import { createTicketChannel } from './ticket-system.ts'
import { isTicketCueBotReply } from './analytics-store.ts'
import { reportTicketIntake } from './logging.ts'

const PREFIX = 'ndtkt'
const lastOfferByUser = new Map<string, number>()

const HOW_TICKET_RE =
  /\b(how\s+(do|can)\s+i\s+open|how\s+to\s+open\s+a?\s*ticket|create\s+a?\s*ticket|open\s+a?\s*ticket)\b/i

function canOffer(userId: string): boolean {
  const now = Date.now()
  const last = lastOfferByUser.get(userId) ?? 0
  if (now - last < ticketOfferCooldownMs) return false
  lastOfferByUser.set(userId, now)
  return true
}

export function shouldOfferTicketFromUserMessage(content: string): boolean {
  if (!ticketOfferEnabled) return false
  return HOW_TICKET_RE.test(content)
}

export function shouldOfferTicketFromBotReply(botReply: string): boolean {
  if (!ticketOfferEnabled) return false
  return isTicketCueBotReply(botReply)
}

export async function maybeSendTicketOffer(
  msg: Message,
  botReplyFullText: string,
): Promise<void> {
  if (!ticketOfferEnabled || !msg.guild) return
  if (!shouldOfferTicketFromBotReply(botReplyFullText)) return
  if (!canOffer(msg.author.id)) return

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(
        `${PREFIX}:open:${msg.channel.id}:${msg.id}:${msg.author.id}`,
      )
      .setLabel('Open support ticket')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`${PREFIX}:dismiss:${msg.channel.id}:${msg.author.id}`)
      .setLabel('No thanks')
      .setStyle(ButtonStyle.Secondary),
  )

  await msg.channel.send({
    content:
      'Need human help? Use the button below (or visit the ticket channel in the server list).',
    components: [row],
  })
}

export async function maybeAutoCreateTicket(
  msg: Message,
  botReplyFullText: string,
): Promise<void> {
  if (
    !ticketAutoCreate ||
    !msg.guild ||
    !ticketAutoCreateChannelIds.has(msg.channel.id)
  ) {
    return
  }
  if (!shouldOfferTicketFromBotReply(botReplyFullText)) return
  if (!canOffer(msg.author.id)) return
  await openTicketFlow(msg)
}

export async function maybeOfferTicketFromHowQuestion(msg: Message): Promise<void> {
  if (!msg.guild || !msg.content) return
  if (!shouldOfferTicketFromUserMessage(msg.content)) return
  if (!canOffer(msg.author.id)) return

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(
        `${PREFIX}:open:${msg.channel.id}:${msg.id}:${msg.author.id}`,
      )
      .setLabel('Open support ticket')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`${PREFIX}:dismiss:${msg.channel.id}:${msg.author.id}`)
      .setLabel('No thanks')
      .setStyle(ButtonStyle.Secondary),
  )

  await msg.reply({
    content: 'I can help you get to the right place:',
    components: [row],
  })
}

export async function tryHandleTicketButton(
  interaction: ButtonInteraction,
): Promise<boolean> {
  const id = interaction.customId
  if (!id.startsWith(`${PREFIX}:`)) return false

  const parts = id.split(':')
  if (parts[1] === 'dismiss') {
    const userId = parts[3]
    if (!userId || interaction.user.id !== userId) {
      await interaction.reply({
        content: 'These buttons are for the person who asked.',
        ephemeral: true,
      })
      return true
    }
    await interaction.update({ components: [] }).catch(() => {})
    return true
  }

  if (parts[1] === 'open') {
    const channelId = parts[2]
    const messageId = parts[3]
    const userId = parts[4]
    if (!userId || interaction.user.id !== userId) {
      await interaction.reply({
        content: 'Only the person who asked can use this button.',
        ephemeral: true,
      })
      return true
    }
    await interaction.deferUpdate()
    try {
      const ch = await interaction.client.channels.fetch(channelId)
      if (!ch?.isTextBased()) {
        await interaction.followUp({
          content: 'Could not load channel.',
          ephemeral: true,
        })
        return true
      }
      const orig = await ch.messages.fetch(messageId)
      await openTicketFlow(orig as Message)
      await interaction.message.edit({ components: [] }).catch(() => {})
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e)
      await interaction.followUp({
        content: `Error: ${err.slice(0, 200)}`,
        ephemeral: true,
      }).catch(() => {})
    }
    return true
  }

  return false
}

export function registerTicketClient(client: Client): void {
  client.on('interactionCreate', (i) => {
    if (i.isButton()) void tryHandleTicketButton(i)
  })
}

async function openTicketFlow(triggerMsg: Message): Promise<void> {
  const guild = triggerMsg.guild
  if (!guild) return

  const userId = triggerMsg.author.id
  const tag = triggerMsg.author.tag
  const snippet = triggerMsg.content?.slice(0, 1500) || '(no text)'
  const jump = `https://discord.com/channels/${guild.id}/${triggerMsg.channel.id}/${triggerMsg.id}`
  const chName =
    'name' in triggerMsg.channel && triggerMsg.channel.name
      ? triggerMsg.channel.name
      : 'channel'

  if (ticketSystemEnabled && TICKET_OPEN_CATEGORY_ID) {
    try {
      const member =
        triggerMsg.member ?? (await guild.members.fetch(userId))
      const ch = await createTicketChannel(guild, member, 'Support (from chat)', {
        contextSnippet: snippet,
        contextJumpUrl: jump,
      })
      await triggerMsg.reply({
        content: `Created your ticket: ${ch}`,
      })
      return
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e)
      await triggerMsg.reply({
        content: `Could not create a ticket channel: ${err.slice(0, 300)}. Staff were notified instead.`,
      })
      await reportTicketIntake(
        tag,
        userId,
        chName,
        triggerMsg.channel.id,
        guild.id,
        snippet,
        jump,
      )
      return
    }
  }

  if (ticketStaffIntakeOnly || !ticketForumChannelId) {
    await reportTicketIntake(tag, userId, chName, triggerMsg.channel.id, guild.id, snippet, jump)
    await triggerMsg.reply({
      content:
        `Thanks, **staff have been notified** with a link to this message.` +
        (WELCOME_TICKET_CHANNEL_ID
          ? ` You can also use <#${WELCOME_TICKET_CHANNEL_ID}> if your server has a ticket panel.`
          : ''),
    })
    return
  }

  const parent = await guild.channels.fetch(ticketForumChannelId).catch(() => null)
  if (!parent || parent.type !== ChannelType.GuildForum) {
    await reportTicketIntake(tag, userId, chName, triggerMsg.channel.id, guild.id, snippet, jump)
    await triggerMsg.reply({
      content:
        'Ticket forum is not configured correctly; staff were notified instead.',
    })
    return
  }

  const embed = new EmbedBuilder()
    .setTitle('Support ticket')
    .setDescription(snippet.slice(0, 4000))
    .addFields({ name: 'Original message', value: `[Jump](${jump})` })

  const thread = await parent.threads.create({
    name: `support-${tag}`.replace(/[^a-z0-9-_]/gi, '-').slice(0, 100),
    message: {
      content: `<@${userId}>`,
      embeds: [embed],
    },
  })

  const threadUrl = thread.url
  await reportTicketIntake(
    tag,
    userId,
    chName,
    triggerMsg.channel.id,
    guild.id,
    snippet,
    threadUrl,
  )

  await triggerMsg.reply({
    content: `Created your ticket: ${thread}${threadUrl ? ` (${threadUrl})` : ''}`,
  })
}
