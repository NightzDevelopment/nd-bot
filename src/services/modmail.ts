/**
 * Modmail: relay a user's DMs to a private per-user staff channel and relay
 * staff replies back to the user's DMs. Opt-in via `nd!modmail` so it does not
 * interfere with the existing AI DM support. While a session is open, the
 * user's DMs are relayed (AI is skipped) until staff close it.
 *
 * Interaction customId: ndmodmail:close:<userId>
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  type Client,
  EmbedBuilder,
  type GuildMember,
  type Interaction,
  type Message,
  MessageFlags,
  PermissionFlagsBits,
  type User,
} from 'discord.js'
import { modmailCategoryId, modmailEnabled, modmailStaffRoleIds, modRoleIds } from '../config.ts'
import { childLogger } from '../lib/logger.ts'
import { isGuildMod } from '../utils/permissions.ts'
import {
  closeSession,
  getSessionByChannel,
  getSessionByUser,
  openSession,
} from './modmail-store.ts'

const log = childLogger('modmail')
const PREFIX = 'ndmodmail'

function staffRoleIds(): string[] {
  return [...new Set([...modRoleIds, ...modmailStaffRoleIds])]
}

/** Open (or report an existing) modmail session for a user DMing the bot. */
export async function startModmail(
  client: Client,
  user: User,
  firstMessage: string,
): Promise<{ ok: boolean; msg: string }> {
  if (!modmailEnabled) return { ok: false, msg: 'Modmail is not enabled on this bot.' }
  if (!modmailCategoryId) return { ok: false, msg: 'Modmail is not configured (no category).' }
  if (await getSessionByUser(user.id)) {
    return { ok: true, msg: 'You already have an open modmail. Just keep typing here and staff will see it.' }
  }

  const category = await client.channels.fetch(modmailCategoryId).catch(() => null)
  if (!category || category.type !== ChannelType.GuildCategory) {
    return { ok: false, msg: 'Modmail category is misconfigured. Please contact an admin.' }
  }
  const guild = category.guild

  const overwrites: { id: string; allow?: bigint; deny?: bigint }[] = [
    { id: guild.roles.everyone.id, deny: PermissionFlagsBits.ViewChannel },
    {
      id: client.user?.id ?? guild.client.user.id,
      allow:
        PermissionFlagsBits.ViewChannel |
        PermissionFlagsBits.SendMessages |
        PermissionFlagsBits.ReadMessageHistory |
        PermissionFlagsBits.ManageChannels,
    },
  ]
  for (const rid of staffRoleIds()) {
    if (guild.roles.cache.has(rid)) {
      overwrites.push({
        id: rid,
        allow:
          PermissionFlagsBits.ViewChannel |
          PermissionFlagsBits.SendMessages |
          PermissionFlagsBits.ReadMessageHistory,
      })
    }
  }

  let channel
  try {
    channel = await guild.channels.create({
      name: `modmail-${user.username}`.slice(0, 90),
      type: ChannelType.GuildText,
      parent: category.id,
      permissionOverwrites: overwrites,
    })
  } catch (e) {
    log.warn({ err: e }, 'failed to create modmail channel')
    return { ok: false, msg: 'Could not open modmail right now. Please try again later.' }
  }

  await openSession({
    userId: user.id,
    userTag: user.tag,
    channelId: channel.id,
    guildId: guild.id,
    openedAt: Date.now(),
  })

  const header = new EmbedBuilder()
    .setColor(0x60a5fa)
    .setTitle(`Modmail — ${user.tag}`)
    .setDescription(
      `<@${user.id}> · \`${user.id}\`\nReply in this channel to message the user. Messages here are sent to their DMs. Use the button to close.`,
    )
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${PREFIX}:close:${user.id}`)
      .setLabel('Close modmail')
      .setStyle(ButtonStyle.Danger),
  )
  const ping = staffRoleIds().map((r) => `<@&${r}>`).join(' ')
  await channel.send({
    ...(ping ? { content: ping } : {}),
    embeds: [header],
    components: [row],
    allowedMentions: { roles: staffRoleIds() },
  })
  if (firstMessage.trim()) {
    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0x94a3b8)
          .setAuthor({ name: user.tag })
          .setDescription(firstMessage.slice(0, 4000)),
      ],
    })
  }
  return { ok: true, msg: 'Staff have been notified. Keep replying here and they will respond in your DMs.' }
}

/** Relay a user's DM into their open modmail channel. Returns true if handled. */
export async function relayUserDm(client: Client, msg: Message): Promise<boolean> {
  const session = await getSessionByUser(msg.author.id)
  if (!session) return false
  const ch = await client.channels.fetch(session.channelId).catch(() => null)
  if (!ch || !ch.isTextBased() || !('send' in ch)) {
    await closeSession(msg.author.id)
    return false
  }
  const files = [...msg.attachments.values()].map((a) => a.url).slice(0, 5)
  await ch.send({
    embeds: [
      new EmbedBuilder()
        .setColor(0x94a3b8)
        .setAuthor({ name: msg.author.tag })
        .setDescription(msg.content?.slice(0, 4000) || '*(no text)*'),
    ],
    ...(files.length ? { content: files.join('\n') } : {}),
  })
  await msg.react('\u{1F4E8}').catch(() => {})
  return true
}

/** Relay a staff message in a modmail channel back to the user. Returns true if handled. */
export async function relayStaffMessage(msg: Message): Promise<boolean> {
  if (!msg.guild || msg.author.bot) return false
  const session = await getSessionByChannel(msg.channel.id)
  if (!session) return false
  const content = msg.content ?? ''
  // Let prefix/custom commands run normally instead of relaying them.
  if (content.startsWith('nd!') || content.startsWith('!')) return false
  try {
    const user = await msg.client.users.fetch(session.userId)
    const files = [...msg.attachments.values()].map((a) => a.url).slice(0, 5)
    await user.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0x60a5fa)
          .setAuthor({ name: `Staff · ${msg.author.tag}` })
          .setDescription(content.slice(0, 4000) || '*(no text)*'),
      ],
      ...(files.length ? { content: files.join('\n') } : {}),
    })
    await msg.react('✅').catch(() => {})
  } catch {
    await msg.reply('Could not deliver to the user (their DMs may be closed).').catch(() => {})
  }
  return true
}

export async function tryHandleModmailInteraction(interaction: Interaction): Promise<boolean> {
  if (!interaction.isButton()) return false
  const id = interaction.customId
  if (!id.startsWith(`${PREFIX}:`)) return false
  const [, action, userId] = id.split(':')
  if (action === 'close') {
    const member = interaction.member as GuildMember | null
    if (!member || !isGuildMod(member)) {
      await interaction.reply({
        content: 'Only staff can close modmail.',
        flags: MessageFlags.Ephemeral,
      })
      return true
    }
    const session = await closeSession(userId ?? '')
    await interaction.update({ components: [] }).catch(() => {})
    if (session) {
      try {
        const user = await interaction.client.users.fetch(session.userId)
        await user.send(
          'Your conversation with staff has been closed. DM `nd!modmail <message>` again if you need more help.',
        )
      } catch {
        /* DMs closed */
      }
      const ch = await interaction.client.channels.fetch(session.channelId).catch(() => null)
      if (ch && 'delete' in ch) await ch.delete('Modmail closed').catch(() => {})
    }
    return true
  }
  return false
}
