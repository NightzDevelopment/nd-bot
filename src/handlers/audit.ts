/**
 * Audit logging, message edits/deletes, member join/leave, bans, voice moves.
 */
import {
  ChannelType,
  type Client,
  EmbedBuilder,
  Events,
  type Guild,
  type GuildChannel,
  type GuildMember,
  type Message,
  type PartialMessage,
  type Role,
  type TextChannel,
  type User,
  type VoiceState,
} from 'discord.js'
import {
  AUDIT_LOG_CHANNEL_ID,
  auditLogProfileUpdates,
  CHANNEL_LOG_CHANNEL_ID,
  MEMBER_LOG_CHANNEL_ID,
  MESSAGE_LOG_CHANNEL_ID,
  ROLE_LOG_CHANNEL_ID,
} from '../config.ts'
import {
  type AuditLookupResult,
  formatAuditFooter,
  formatExecutorLine,
  lookupChannelCreateActor,
  lookupChannelDeleteActor,
  lookupMemberBanAdd,
  lookupMemberBanRemove,
  lookupMemberRemove,
  lookupMessageBulkDeleteActor,
  lookupMessageDeleteActor,
} from '../utils/audit-log-lookup.ts'
import { takeBotMessageDeleteAttribution } from '../utils/bot-delete-attribution.ts'
import {
  isIgnoredChannelOrCategory,
  isIgnoredChannelOrCategoryById,
  shouldIgnoreMessageAudit,
} from '../utils/channel-ignore.ts'

type AuditBucket = 'message' | 'member' | 'role' | 'channel' | 'audit'

let auditChannel: TextChannel | null = null
let messageLogChannel: TextChannel | null = null
let memberLogChannel: TextChannel | null = null
let roleLogChannel: TextChannel | null = null
let channelLogChannel: TextChannel | null = null

function channelTypeLabel(type: number): string {
  const labels: Record<number, string> = {
    [ChannelType.GuildText]: 'Text',
    [ChannelType.GuildVoice]: 'Voice',
    [ChannelType.GuildCategory]: 'Category',
    [ChannelType.GuildAnnouncement]: 'Announcement',
    [ChannelType.GuildStageVoice]: 'Stage',
    [ChannelType.GuildForum]: 'Forum',
    [ChannelType.PublicThread]: 'Public thread',
    [ChannelType.PrivateThread]: 'Private thread',
    [ChannelType.AnnouncementThread]: 'Announcement thread',
  }
  return labels[type] ?? `type_${type}`
}

function guildIdsField(guild: Guild, lines: string[]): { name: string; value: string } {
  const core = [`**Guild:** ${guild.name}`, `**Guild ID:** \`${guild.id}\``, ...lines]
  return {
    name: 'IDs',
    value: core.join('\n').slice(0, 1024),
  }
}

function resolveGuildFromMessage(msg: PartialMessage): Guild | null {
  if (msg.guild) return msg.guild
  const ch = msg.channel
  if (ch && ch.isTextBased() && !ch.isDMBased() && 'guild' in ch && ch.guild) {
    return ch.guild
  }
  return null
}

function messageDeleteActorLabel(
  lookup: AuditLookupResult,
  authorId: string | null,
  botAttribution?: { actor: string; reason: string } | null,
): string {
  if (botAttribution) {
    return `**Deleted by:** ${botAttribution.actor}\n**Reason:** ${botAttribution.reason}`.slice(
      0,
      1024,
    )
  }
  const line = formatExecutorLine(lookup)
  const actorId = lookup.executor?.id ?? lookup.executorId
  if (authorId && actorId === authorId) {
    return `**Self-delete** (${line})`
  }
  if (lookup.executor || lookup.executorId) {
    return `**Deleted by:** ${line}`
  }
  return `**Deleted by:** ${line}`
}

function auditTarget(bucket: AuditBucket): TextChannel | null {
  if (bucket === 'message') return messageLogChannel ?? auditChannel
  if (bucket === 'member') return memberLogChannel ?? auditChannel
  if (bucket === 'role') return roleLogChannel ?? auditChannel
  if (bucket === 'channel') return channelLogChannel ?? auditChannel
  return auditChannel
}

async function sendAudit(embed: EmbedBuilder, bucket: AuditBucket = 'audit'): Promise<void> {
  const target = auditTarget(bucket)
  if (!target) return
  try {
    await target.send({ embeds: [embed] })
  } catch (e) {
    console.error('[audit] send failed:', e)
  }
}

const PROFILE_AUDIT_BIO_NOTE = 'About Me / bio text is not exposed to bots by Discord’s API.'

function formatProfileAuditFooter(guild: Guild | null, userId: string): string {
  const core = guild ? `${guild.name} · ${guild.id}` : `User ${userId} (no mutual guild in cache)`
  return `${core} · ${PROFILE_AUDIT_BIO_NOTE}`.slice(0, 2048)
}

function collectGlobalUserChanges(
  oldU: User,
  newU: User,
): { lines: string[]; thumbUrl: string | null } {
  const lines: string[] = []
  let thumbUrl: string | null = null
  if (oldU.avatar !== newU.avatar) {
    lines.push(`**Avatar:** \`${oldU.avatar ?? 'none'}\` → \`${newU.avatar ?? 'none'}\``)
    thumbUrl = newU.displayAvatarURL({ size: 128 })
  }
  if (oldU.banner !== newU.banner) {
    lines.push(`**Profile banner:** \`${oldU.banner ?? 'none'}\` → \`${newU.banner ?? 'none'}\``)
  }
  const oldDec = JSON.stringify(oldU.avatarDecorationData)
  const newDec = JSON.stringify(newU.avatarDecorationData)
  if (oldDec !== newDec) {
    lines.push('**Avatar decoration:** changed')
  }
  if (oldU.username !== newU.username) {
    lines.push(`**Username:** ${oldU.username} → ${newU.username}`)
  }
  if (oldU.discriminator !== newU.discriminator) {
    lines.push(`**Discriminator:** ${oldU.discriminator} → ${newU.discriminator}`)
  }
  if (oldU.globalName !== newU.globalName) {
    lines.push(`**Display name:** ${oldU.globalName ?? '(none)'} → ${newU.globalName ?? '(none)'}`)
  }
  const oldAc = oldU.accentColor ?? null
  const newAc = newU.accentColor ?? null
  if (oldAc !== newAc) {
    lines.push(
      `**Accent color:** ${oldU.hexAccentColor ?? 'none'} → ${newU.hexAccentColor ?? 'none'}`,
    )
  }
  const oldPg = JSON.stringify(oldU.primaryGuild)
  const newPg = JSON.stringify(newU.primaryGuild)
  if (oldPg !== newPg) {
    const fmt = (u: User) => {
      const pg = u.primaryGuild
      if (!pg) return '(none)'
      return [pg.tag, pg.identityGuildId && `guild \`${pg.identityGuildId}\``]
        .filter(Boolean)
        .join(' · ')
    }
    lines.push(`**Server tag / primary guild:** ${fmt(oldU)} → ${fmt(newU)}`)
  }
  return { lines, thumbUrl }
}

function collectGuildMemberChanges(
  oldM: GuildMember,
  newM: GuildMember,
): { lines: string[]; thumbUrl: string | null } {
  const lines: string[] = []
  let thumbUrl: string | null = null
  const nick = (m: GuildMember) => m.nickname ?? '(no server nickname)'
  if (oldM.nickname !== newM.nickname) {
    lines.push(`**Server nickname:** ${nick(oldM)} → ${nick(newM)}`)
  }

  const oldRoleIds = new Set(oldM.roles.cache.keys())
  const newRoleIds = new Set(newM.roles.cache.keys())
  const everyoneId = newM.guild.id
  const added = [...newRoleIds].filter((id) => id !== everyoneId && !oldRoleIds.has(id))
  const removed = [...oldRoleIds].filter((id) => id !== everyoneId && !newRoleIds.has(id))
  if (added.length) {
    lines.push(`**Roles added:** ${added.map((id) => `<@&${id}>`).join(' ')}`)
  }
  if (removed.length) {
    lines.push(`**Roles removed:** ${removed.map((id) => `<@&${id}>`).join(' ')}`)
  }

  const oldUntil = oldM.communicationDisabledUntil?.getTime() ?? null
  const newUntil = newM.communicationDisabledUntil?.getTime() ?? null
  if (oldUntil !== newUntil) {
    const fmt = (t: number | null) => (t === null ? 'none' : `<t:${Math.floor(t / 1000)}:F>`)
    lines.push(`**Timeout until:** ${fmt(oldUntil)} → ${fmt(newUntil)}`)
  }

  if (oldM.pending !== newM.pending) {
    lines.push(`**Membership pending:** ${oldM.pending} → ${newM.pending}`)
  }

  const oldBoost = oldM.premiumSince?.getTime() ?? null
  const newBoost = newM.premiumSince?.getTime() ?? null
  if (oldBoost !== newBoost) {
    const fmt = (t: number | null) => (t === null ? 'none' : `<t:${Math.floor(t / 1000)}:F>`)
    lines.push(`**Boosting since:** ${fmt(oldBoost)} → ${fmt(newBoost)}`)
  }

  if (oldM.avatar !== newM.avatar) {
    lines.push(
      `**Server avatar override:** \`${oldM.avatar ?? 'none'}\` → \`${newM.avatar ?? 'none'}\``,
    )
    thumbUrl = newM.displayAvatarURL({ size: 128 })
  }
  if (oldM.banner !== newM.banner) {
    lines.push(
      `**Server profile banner:** \`${oldM.banner ?? 'none'}\` → \`${newM.banner ?? 'none'}\``,
    )
    if (!thumbUrl) thumbUrl = newM.displayAvatarURL({ size: 128 })
  }
  const oldMDec = JSON.stringify(oldM.avatarDecorationData)
  const newMDec = JSON.stringify(newM.avatarDecorationData)
  if (oldMDec !== newMDec) {
    lines.push('**Server avatar decoration:** changed')
  }

  return { lines, thumbUrl }
}

export async function initAuditChannel(client: Client): Promise<void> {
  async function resolve(id: string | undefined, label: string): Promise<TextChannel | null> {
    if (!id) return null
    try {
      const ch = await client.channels.fetch(id)
      if (ch?.isTextBased() && !ch.isDMBased()) {
        const text = ch as TextChannel
        console.log(`[audit] ${label} to #${text.name}`)
        return text
      }
    } catch (e) {
      console.error(`[audit] failed to fetch ${label}:`, e)
    }
    return null
  }

  auditChannel = await resolve(AUDIT_LOG_CHANNEL_ID, 'default logging')
  messageLogChannel = await resolve(MESSAGE_LOG_CHANNEL_ID, 'message logs')
  memberLogChannel = await resolve(MEMBER_LOG_CHANNEL_ID, 'member logs')
  roleLogChannel = await resolve(ROLE_LOG_CHANNEL_ID, 'role logs')
  channelLogChannel = await resolve(CHANNEL_LOG_CHANNEL_ID, 'channel logs')
}

function hasAnyAuditTarget(bucket: AuditBucket): boolean {
  return auditTarget(bucket) !== null
}

function collectChannelChanges(oldCh: GuildChannel, newCh: GuildChannel): string[] {
  const lines: string[] = []
  if (oldCh.name !== newCh.name) lines.push(`**Name:** ${oldCh.name} → ${newCh.name}`)
  if (oldCh.parentId !== newCh.parentId) {
    lines.push(
      `**Parent/category:** \`${oldCh.parentId ?? 'none'}\` → \`${newCh.parentId ?? 'none'}\``,
    )
  }
  if ('topic' in oldCh && 'topic' in newCh && oldCh.topic !== newCh.topic) {
    const oldTopic = (oldCh as { topic?: string | null }).topic ?? '(none)'
    const newTopic = (newCh as { topic?: string | null }).topic ?? '(none)'
    lines.push(`**Topic:** ${oldTopic.slice(0, 250)} → ${newTopic.slice(0, 250)}`)
  }
  if (
    'rateLimitPerUser' in oldCh &&
    'rateLimitPerUser' in newCh &&
    oldCh.rateLimitPerUser !== newCh.rateLimitPerUser
  ) {
    lines.push(`**Slowmode:** ${oldCh.rateLimitPerUser}s → ${newCh.rateLimitPerUser}s`)
  }
  if ('nsfw' in oldCh && 'nsfw' in newCh && oldCh.nsfw !== newCh.nsfw) {
    lines.push(`**NSFW:** ${oldCh.nsfw} → ${newCh.nsfw}`)
  }
  if (oldCh.permissionOverwrites.cache.size !== newCh.permissionOverwrites.cache.size) {
    lines.push(
      `**Permission overwrites:** ${oldCh.permissionOverwrites.cache.size} → ${newCh.permissionOverwrites.cache.size}`,
    )
  }
  return lines
}

function collectRoleChanges(oldRole: Role, newRole: Role): string[] {
  const lines: string[] = []
  if (oldRole.name !== newRole.name) lines.push(`**Name:** ${oldRole.name} → ${newRole.name}`)
  if (oldRole.color !== newRole.color) {
    lines.push(`**Color:** \`${oldRole.hexColor}\` → \`${newRole.hexColor}\``)
  }
  if (oldRole.hoist !== newRole.hoist)
    lines.push(`**Hoisted:** ${oldRole.hoist} → ${newRole.hoist}`)
  if (oldRole.mentionable !== newRole.mentionable) {
    lines.push(`**Mentionable:** ${oldRole.mentionable} → ${newRole.mentionable}`)
  }
  if (oldRole.permissions.bitfield !== newRole.permissions.bitfield) {
    lines.push('**Permissions:** changed')
  }
  return lines
}

export function registerAuditHandler(client: Client): void {
  client.on(Events.MessageUpdate, async (oldM, newM) => {
    if (!hasAnyAuditTarget('message') || newM.author?.bot) return
    if (isIgnoredChannelOrCategory(newM.channel)) return
    if (oldM.content === newM.content) return
    const guild = newM.guild
    if (!guild) return

    const jump = `https://discord.com/channels/${guild.id}/${newM.channel.id}/${newM.id}`
    const embed = new EmbedBuilder()
      .setColor(0xfee75c)
      .setTitle('Message edited')
      .setDescription(`**Author:** ${newM.author?.tag ?? '?'} · **Channel:** <#${newM.channel.id}>`)
      .addFields(
        guildIdsField(guild, [
          `**Message ID:** \`${newM.id}\``,
          `**Channel ID:** \`${newM.channel.id}\``,
          `**Author ID:** \`${newM.author?.id ?? '?'}\``,
          `**Jump:** [Open message](${jump})`,
        ]),
        {
          name: 'Before',
          value: (oldM.content ?? '(unknown)').slice(0, 900),
        },
        { name: 'After', value: (newM.content ?? '').slice(0, 900) },
      )
      .setFooter({ text: `${guild.name} · ${guild.id}` })
      .setTimestamp()
    await sendAudit(embed, 'message')
  })

  client.on(Events.MessageDelete, async (rawMsg: Message | PartialMessage) => {
    const msg = rawMsg as PartialMessage
    if (!hasAnyAuditTarget('message') || msg.author?.bot) return
    if (shouldIgnoreMessageAudit(msg)) return

    const guild = resolveGuildFromMessage(msg)
    if (!guild) return

    const channelId = msg.channel?.id ?? msg.channelId
    if (!channelId) return

    const authorId = msg.author?.id ?? null
    const botAttribution = msg.id
      ? takeBotMessageDeleteAttribution({
          guildId: guild.id,
          channelId,
          messageId: msg.id,
        })
      : null
    const lookup = botAttribution
      ? ({ executor: null, executorId: null, reason: null } as AuditLookupResult)
      : await lookupMessageDeleteActor(guild, channelId, authorId)

    const embed = new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle('Message deleted')
      .setDescription(
        `**Author:** ${msg.author ? msg.author.tag : 'Unknown'} · **Channel:** ${msg.channel ? `<#${msg.channel.id}>` : `\`${channelId}\``}`,
      )
      .addFields(
        guildIdsField(guild, [
          `**Message ID:** \`${msg.id ?? '?'}\``,
          `**Channel ID:** \`${channelId}\``,
          `**Author ID:** \`${authorId ?? '?'}\``,
          ...(msg.id && channelId
            ? [
                `**Jump (may be invalid):** [Link](https://discord.com/channels/${guild.id}/${channelId}/${msg.id})`,
              ]
            : []),
        ]),
        {
          name: 'Deletion',
          value: messageDeleteActorLabel(lookup, authorId, botAttribution).slice(0, 1024),
          inline: false,
        },
        {
          name: 'Content',
          value: (msg.content ?? '(unknown - uncached or embed-only)').slice(0, 900),
        },
      )
      .setFooter({ text: formatAuditFooter(guild, lookup) })
      .setTimestamp()
    await sendAudit(embed, 'message')
  })

  client.on(Events.GuildMemberAdd, async (member) => {
    if (!hasAnyAuditTarget('member')) return
    const guild = member.guild
    const created = Math.floor(member.user.createdTimestamp / 1000)
    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle('Member joined')
      .setDescription(`**${member.user.tag}** · <@${member.user.id}>`)
      .addFields(
        guildIdsField(guild, [
          `**User ID:** \`${member.user.id}\``,
          `**Account created:** <t:${created}:F> (<t:${created}:R>)`,
          `**Approx. member count:** ${member.guild.memberCount}`,
        ]),
      )
      .setThumbnail(member.user.displayAvatarURL({ size: 128 }))
      .setFooter({ text: `${guild.name} · ${guild.id}` })
      .setTimestamp()
    await sendAudit(embed, 'member')
  })

  client.on(Events.GuildMemberRemove, async (member) => {
    if (!hasAnyAuditTarget('member')) return
    const guild = member.guild
    const { kind, result } = await lookupMemberRemove(guild, member.id)
    if (kind === 'ban') {
      return
    }

    const removal =
      kind === 'kick'
        ? `**Kicked** - moderator: ${formatExecutorLine(result)}`
        : '**Voluntary leave** (no recent kick/ban audit entry)'

    const embed = new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle('Member left')
      .setDescription(`**${member.user.tag}** · <@${member.user.id}>`)
      .addFields(guildIdsField(guild, [`**User ID:** \`${member.user.id}\``]), {
        name: 'Removal',
        value:
          `${removal}${result.reason ? `\n**Audit reason:** ${result.reason.slice(0, 800)}` : ''}`.slice(
            0,
            1024,
          ),
        inline: false,
      })
      .setFooter({ text: formatAuditFooter(guild, result) })
      .setTimestamp()
    await sendAudit(embed, 'member')
  })

  client.on(Events.GuildBanAdd, async (ban) => {
    if (!hasAnyAuditTarget('member')) return
    const guild = ban.guild
    const lookup = await lookupMemberBanAdd(guild, ban.user.id)
    const embed = new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle('Member banned')
      .setDescription(`**${ban.user.tag}** · <@${ban.user.id}>`)
      .addFields(guildIdsField(guild, [`**User ID:** \`${ban.user.id}\``]), {
        name: 'Ban',
        value: [
          `**Moderator (audit):** ${formatExecutorLine(lookup)}`,
          `**Reason (Discord ban object):** ${ban.reason ?? '(none)'}`,
          lookup.reason ? `**Reason (audit log):** ${lookup.reason.slice(0, 800)}` : null,
        ]
          .filter(Boolean)
          .join('\n')
          .slice(0, 1024),
        inline: false,
      })
      .setFooter({ text: formatAuditFooter(guild, lookup) })
      .setTimestamp()
    await sendAudit(embed, 'member')
  })

  client.on(Events.GuildBanRemove, async (ban) => {
    if (!hasAnyAuditTarget('member')) return
    const guild = ban.guild
    const lookup = await lookupMemberBanRemove(guild, ban.user.id)
    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle('Member unbanned')
      .setDescription(`**${ban.user.tag}** · <@${ban.user.id}>`)
      .addFields(guildIdsField(guild, [`**User ID:** \`${ban.user.id}\``]), {
        name: 'Unban',
        value: `**Moderator (audit):** ${formatExecutorLine(lookup)}`.slice(0, 1024),
        inline: false,
      })
      .setFooter({ text: formatAuditFooter(guild, lookup) })
      .setTimestamp()
    await sendAudit(embed, 'member')
  })

  client.on(Events.ChannelCreate, async (ch) => {
    if (!hasAnyAuditTarget('channel') || ch.isDMBased()) return
    const gch = ch as GuildChannel
    const guild = gch.guild
    const lookup = await lookupChannelCreateActor(guild, gch.id)
    const parent = gch.parent
    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle('Channel created')
      .setDescription(`<#${gch.id}> · **${gch.name}**`)
      .addFields(
        guildIdsField(guild, [
          `**Channel ID:** \`${gch.id}\``,
          `**Type:** ${channelTypeLabel(gch.type)}`,
          parent ? `**Category:** ${parent.name} (\`${parent.id}\`)` : `**Category:** -`,
        ]),
        {
          name: 'Created by (audit)',
          value: formatExecutorLine(lookup).slice(0, 1024),
          inline: false,
        },
      )
      .setFooter({ text: formatAuditFooter(guild, lookup) })
      .setTimestamp()
    await sendAudit(embed, 'channel')
  })

  client.on(Events.ChannelDelete, async (ch) => {
    if (!hasAnyAuditTarget('channel') || ch.isDMBased()) return
    const gch = ch as GuildChannel
    const guild = gch.guild
    const lookup = await lookupChannelDeleteActor(guild, gch.id)
    const embed = new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle('Channel deleted')
      .setDescription(`**${gch.name}**`)
      .addFields(
        guildIdsField(guild, [
          `**Channel ID:** \`${gch.id}\``,
          `**Type:** ${channelTypeLabel(gch.type)}`,
          gch.parentId ? `**Parent/category ID:** \`${gch.parentId}\`` : `**Parent:** -`,
        ]),
        {
          name: 'Deleted by (audit)',
          value: formatExecutorLine(lookup).slice(0, 1024),
          inline: false,
        },
      )
      .setFooter({ text: formatAuditFooter(guild, lookup) })
      .setTimestamp()
    await sendAudit(embed, 'channel')
  })

  client.on(Events.MessageBulkDelete, async (messages, channel) => {
    if (!hasAnyAuditTarget('message')) return
    if (isIgnoredChannelOrCategory(channel)) return
    const guild = channel.guild
    const count = messages.size
    const sampleIds = [...messages.keys()].slice(0, 8)
    const lookup = await lookupMessageBulkDeleteActor(guild, channel.id, count)
    const embed = new EmbedBuilder()
      .setColor(0xe67e22)
      .setTitle('Messages bulk deleted')
      .setDescription(`**Channel:** <#${channel.id}> · **Count:** ${count}`)
      .addFields(
        guildIdsField(guild, [
          `**Channel ID:** \`${channel.id}\``,
          `**Deleted messages:** ${count}`,
          `**Sample message IDs:**\n${sampleIds.map((id) => `\`${id}\``).join('\n') || '-'}`,
        ]),
        {
          name: 'Bulk delete (audit)',
          value: formatExecutorLine(lookup).slice(0, 1024),
          inline: false,
        },
      )
      .setFooter({ text: formatAuditFooter(guild, lookup) })
      .setTimestamp()
    await sendAudit(embed, 'message')
  })

  client.on(Events.UserUpdate, async (oldUser, newUser) => {
    if (!hasAnyAuditTarget('member') || !auditLogProfileUpdates) return
    if (newUser.bot) return
    let oldU: User = oldUser as User
    if (oldUser.partial) {
      try {
        oldU = await oldUser.fetch()
      } catch {
        return
      }
    }
    const { lines, thumbUrl } = collectGlobalUserChanges(oldU, newUser)
    if (lines.length === 0) return
    const guild = client.guilds.cache.find((g) => g.members.cache.has(newUser.id)) ?? null
    const embed = new EmbedBuilder()
      .setColor(0x9b59b6)
      .setTitle('Global Profile Updated')
      .setDescription(`**${newUser.tag}** · <@${newUser.id}>`)
      .addFields(
        guild
          ? guildIdsField(guild, [`**User ID:** \`${newUser.id}\``])
          : {
              name: 'IDs',
              value: `**User ID:** \`${newUser.id}\``.slice(0, 1024),
            },
        {
          name: 'Changes',
          value: lines.join('\n').slice(0, 1024),
          inline: false,
        },
      )
      .setFooter({ text: formatProfileAuditFooter(guild, newUser.id) })
      .setTimestamp()
    if (thumbUrl) embed.setThumbnail(thumbUrl)
    await sendAudit(embed, 'member')
  })

  client.on(Events.GuildMemberUpdate, async (oldM, newM) => {
    if (!hasAnyAuditTarget('member') || !auditLogProfileUpdates) return
    if (newM.user.bot) return
    const { lines, thumbUrl } = collectGuildMemberChanges(oldM as GuildMember, newM)
    if (lines.length === 0) return
    const guild = newM.guild
    const embed = new EmbedBuilder()
      .setColor(0x1abc9c)
      .setTitle('Server Profile Updated')
      .setDescription(`**${newM.user.tag}** · <@${newM.user.id}>`)
      .addFields(guildIdsField(guild, [`**User ID:** \`${newM.user.id}\``]), {
        name: 'Changes',
        value: lines.join('\n').slice(0, 1024),
        inline: false,
      })
      .setFooter({ text: formatProfileAuditFooter(guild, newM.user.id) })
      .setTimestamp()
    if (thumbUrl) embed.setThumbnail(thumbUrl)
    await sendAudit(embed, 'member')
  })

  client.on(Events.VoiceStateUpdate, async (oldS: VoiceState, newS: VoiceState) => {
    if (!hasAnyAuditTarget('member')) return
    const m = newS.member ?? oldS.member
    if (!m || m.user.bot) return
    if (oldS.channelId === newS.channelId) return
    const guild = newS.guild ?? oldS.guild
    if (guild) {
      const fromIgn = oldS.channelId ? isIgnoredChannelOrCategoryById(guild, oldS.channelId) : false
      const toIgn = newS.channelId ? isIgnoredChannelOrCategoryById(guild, newS.channelId) : false
      if (fromIgn || toIgn) return
    }
    if (!guild) return
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('Voice move')
      .setDescription(`**${m.user.tag}**`)
      .addFields(
        guildIdsField(guild, [
          `**User ID:** \`${m.user.id}\``,
          `**From channel ID:** \`${oldS.channelId ?? 'none'}\``,
          `**To channel ID:** \`${newS.channelId ?? 'none'}\``,
        ]),
        {
          name: 'Channels',
          value: [
            `**From:** ${oldS.channelId ? `<#${oldS.channelId}>` : '(none)'}`,
            `**To:** ${newS.channelId ? `<#${newS.channelId}>` : '(disconnected)'}`,
          ].join('\n'),
          inline: false,
        },
      )
      .setFooter({ text: `${guild.name} · ${guild.id}` })
      .setTimestamp()
    await sendAudit(embed, 'member')
  })

  client.on(Events.ChannelUpdate, async (oldCh, newCh) => {
    if (!hasAnyAuditTarget('channel')) return
    if (newCh.type === ChannelType.DM) return
    const oldGuildCh = oldCh as GuildChannel
    const newGuildCh = newCh as GuildChannel
    const guild = newGuildCh.guild
    const lines = collectChannelChanges(oldGuildCh, newGuildCh)
    if (lines.length === 0) return
    const embed = new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle('Channel updated')
      .setDescription(`<#${newGuildCh.id}> · **${newGuildCh.name}**`)
      .addFields(
        guildIdsField(guild, [
          `**Channel ID:** \`${newGuildCh.id}\``,
          `**Type:** ${channelTypeLabel(newGuildCh.type)}`,
        ]),
        {
          name: 'Changes',
          value: lines.join('\n').slice(0, 1024),
          inline: false,
        },
      )
      .setFooter({ text: `${guild.name} · ${guild.id}` })
      .setTimestamp()
    await sendAudit(embed, 'channel')
  })

  client.on(Events.GuildRoleCreate, async (role) => {
    if (!hasAnyAuditTarget('role')) return
    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle('Role created')
      .setDescription(`<@&${role.id}> · **${role.name}**`)
      .addFields(
        guildIdsField(role.guild, [
          `**Role ID:** \`${role.id}\``,
          `**Color:** \`${role.hexColor}\``,
          `**Mentionable:** ${role.mentionable}`,
          `**Hoisted:** ${role.hoist}`,
        ]),
      )
      .setFooter({ text: `${role.guild.name} · ${role.guild.id}` })
      .setTimestamp()
    await sendAudit(embed, 'role')
  })

  client.on(Events.GuildRoleUpdate, async (oldRole, newRole) => {
    if (!hasAnyAuditTarget('role')) return
    const lines = collectRoleChanges(oldRole, newRole)
    if (lines.length === 0) return
    const embed = new EmbedBuilder()
      .setColor(0xfee75c)
      .setTitle('Role updated')
      .setDescription(`<@&${newRole.id}> · **${newRole.name}**`)
      .addFields(guildIdsField(newRole.guild, [`**Role ID:** \`${newRole.id}\``]), {
        name: 'Changes',
        value: lines.join('\n').slice(0, 1024),
        inline: false,
      })
      .setFooter({ text: `${newRole.guild.name} · ${newRole.guild.id}` })
      .setTimestamp()
    await sendAudit(embed, 'role')
  })

  client.on(Events.GuildRoleDelete, async (role) => {
    if (!hasAnyAuditTarget('role')) return
    const embed = new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle('Role deleted')
      .setDescription(`**${role.name}**`)
      .addFields(
        guildIdsField(role.guild, [
          `**Role ID:** \`${role.id}\``,
          `**Color:** \`${role.hexColor}\``,
          `**Mentionable:** ${role.mentionable}`,
          `**Hoisted:** ${role.hoist}`,
        ]),
      )
      .setFooter({ text: `${role.guild.name} · ${role.guild.id}` })
      .setTimestamp()
    await sendAudit(embed, 'role')
  })
}
