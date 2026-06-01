/**
 * Staff reporting + DM conversation logging.
 * - Profanity/abuse: sends alert to STAFF_LOG_CHANNEL_ID
 * - DM conversations: logs user messages + bot replies to DM_LOG_CHANNEL_ID
 */
import {
  type Client,
  EmbedBuilder,
  type GuildMember,
  type Message,
  type TextChannel,
} from 'discord.js'
import {
  AI_FEEDBACK_LOG_CHANNEL_ID,
  aiAutomodMinConfidence,
  aiAutomodReportMsgDedupeSec,
  aiAutomodStaffLogDedupeSec,
  DM_LOG_CHANNEL_ID,
  MODEL_ID,
  REPORT_CHANNEL_ID,
  raidNewAccountDays,
  STAFF_LOG_CHANNEL_ID,
} from '../config.ts'
import type { AiAutomodResolvedAction } from '../utils/automod-actions.ts'
import { resolveAiAutomodAction } from '../utils/automod-actions.ts'
import { ndEmbed } from '../utils/embed.ts'

let staffChannel: TextChannel | null = null
let reportChannel: TextChannel | null = null
let dmLogChannel: TextChannel | null = null
let feedbackLogChannel: TextChannel | null = null

/** Dedupe AI AutoMod staff posts: author + normalized body → last sent ms */
const aiAutomodStaffDedupe = new Map<string, number>()
/** Dedupe by message id when the same message is reported twice (e.g. duplicate queue entries). */
const aiAutomodReportByMessageId = new Map<string, number>()

function normalizeForAiAutomodDedupe(content: string): string {
  return content.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 240)
}

function aiAutomodMessageJumpUrl(msg: Message): string | null {
  const g = msg.guild
  if (!g || !msg.channel || msg.channel.isDMBased()) return null
  return `https://discord.com/channels/${g.id}/${msg.channel.id}/${msg.id}`
}

function formatAiAutomodActions(a: AiAutomodResolvedAction): string {
  const parts: string[] = []
  parts.push(a.report ? 'Staff log' : 'No staff log')
  parts.push(a.deleteMessage ? 'Delete message' : 'Do not delete')
  parts.push(a.timeoutMs > 0 ? `Timeout ${Math.round(a.timeoutMs / 60_000)} min` : 'No timeout')
  return parts.join(' · ')
}

function formatAiAutomodAttachments(msg: Message): string {
  if (msg.attachments.size === 0) return '—'
  const lines: string[] = []
  for (const a of msg.attachments.values()) {
    const line = `• **${a.name.replace(/\*/g, '')}** — ${(a.size / 1024).toFixed(1)} KiB`
    if (lines.join('\n').length + line.length > 950) {
      lines.push(`… +${msg.attachments.size - lines.length} more`)
      break
    }
    lines.push(line)
  }
  return lines.join('\n').slice(0, 1024)
}

function formatAiAutomodEmbedPreviews(msg: Message): string {
  if (msg.embeds.length === 0) return '—'
  const lines: string[] = []
  const n = Math.min(5, msg.embeds.length)
  for (let i = 0; i < n; i++) {
    const e = msg.embeds[i]!
    const bits = [e.title, e.url, e.description?.slice(0, 120)].filter((x): x is string =>
      Boolean(x && String(x).trim()),
    )
    lines.push(`${i + 1}. ${bits.join(' — ').slice(0, 240)}`)
  }
  if (msg.embeds.length > n) {
    lines.push(`… +${msg.embeds.length - n} more`)
  }
  return lines.join('\n').slice(0, 1024)
}

export async function initLogChannels(client: Client): Promise<void> {
  if (STAFF_LOG_CHANNEL_ID) {
    try {
      const ch = await client.channels.fetch(STAFF_LOG_CHANNEL_ID)
      if (ch?.isTextBased() && !ch.isDMBased()) {
        staffChannel = ch as TextChannel
        console.log(`[logging] staff reports to #${staffChannel.name}`)
      } else {
        console.warn('[logging] STAFF_LOG_CHANNEL_ID is not a guild text channel')
      }
    } catch (e) {
      console.error('[logging] failed to fetch staff channel:', e)
    }
  }
  const reportId = REPORT_CHANNEL_ID || STAFF_LOG_CHANNEL_ID
  if (reportId && reportId !== STAFF_LOG_CHANNEL_ID) {
    try {
      const ch = await client.channels.fetch(reportId)
      if (ch?.isTextBased() && !ch.isDMBased()) {
        reportChannel = ch as TextChannel
        console.log(`[logging] user reports to #${reportChannel.name}`)
      }
    } catch (e) {
      console.error('[logging] failed to fetch report channel:', e)
    }
  } else {
    reportChannel = staffChannel
  }
  if (DM_LOG_CHANNEL_ID) {
    try {
      const ch = await client.channels.fetch(DM_LOG_CHANNEL_ID)
      if (ch?.isTextBased() && !ch.isDMBased()) {
        dmLogChannel = ch as TextChannel
        console.log(`[logging] DM logs to #${dmLogChannel.name}`)
      } else {
        console.warn('[logging] DM_LOG_CHANNEL_ID is not a guild text channel')
      }
    } catch (e) {
      console.error('[logging] failed to fetch DM log channel:', e)
    }
  }
  const feedbackId = AI_FEEDBACK_LOG_CHANNEL_ID || STAFF_LOG_CHANNEL_ID
  if (feedbackId) {
    try {
      const ch = await client.channels.fetch(feedbackId)
      if (ch?.isTextBased() && !ch.isDMBased()) {
        feedbackLogChannel = ch as TextChannel
        console.log(`[logging] AI feedback to #${feedbackLogChannel.name}`)
      }
    } catch (e) {
      console.error('[logging] failed to fetch AI feedback channel:', e)
    }
  }
}

/** Staff marked a bot AI reply as unhelpful (update FAQ / knowledge file). */
export async function reportAiFeedbackNegative(
  staffTag: string,
  staffId: string,
  botMessage: Message,
): Promise<void> {
  const ch = feedbackLogChannel ?? staffChannel
  if (!ch) return
  try {
    const url = botMessage.url
    const embed = new EmbedBuilder()
      .setColor(0xf0b232)
      .setTitle('AI reply flagged (negative)')
      .setDescription(
        `**Staff:** ${staffTag} (\`${staffId}\`)\n**Channel:** ${botMessage.channel.isDMBased() ? 'DM' : `<#${botMessage.channel.id}>`}\n**Jump:** ${url}`,
      )
      .addFields({
        name: 'Bot reply (truncated)',
        value: botMessage.content?.slice(0, 1800) || '(no text)',
      })
      .setTimestamp()
    await ch.send({ embeds: [embed] })
  } catch (e) {
    console.error('[logging] AI negative feedback failed:', e)
  }
}

/** Optional positive signal (lightweight). */
export async function reportAiFeedbackPositive(
  staffTag: string,
  staffId: string,
  botMessage: Message,
): Promise<void> {
  const ch = feedbackLogChannel ?? staffChannel
  if (!ch) return
  try {
    await ch.send({
      content: `AI feedback **+1** from ${staffTag} (\`${staffId}\`) ${botMessage.url}`,
    })
  } catch (e) {
    console.error('[logging] AI positive feedback failed:', e)
  }
}

/** Alert staff that a user sent a profane/abusive message */
export async function reportProfanity(msg: Message): Promise<void> {
  if (!staffChannel) return
  try {
    const embed = new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle('Profanity / Abuse Alert')
      .addFields(
        { name: 'User', value: `${msg.author.tag} (\`${msg.author.id}\`)`, inline: true },
        {
          name: 'Channel',
          value: msg.channel.isDMBased() ? 'DM' : `<#${msg.channel.id}>`,
          inline: true,
        },
        { name: 'Message', value: msg.content.slice(0, 1000) || '(empty)' },
      )
      .setTimestamp()
      .setFooter({ text: 'ND Bot, Profanity Filter' })
    await staffChannel.send({ embeds: [embed] })
  } catch (e) {
    console.error('[logging] profanity report failed:', e)
  }
}

/** Log a DM exchange (user message + bot reply) to the staff DM log channel */
export async function logDmExchange(msg: Message, botReply: string): Promise<void> {
  if (!dmLogChannel) return
  try {
    const userText = msg.content.slice(0, 900) || '(empty)'
    const replyText = botReply.slice(0, 900) || '(empty)'
    const embed = ndEmbed()
      .setTitle('DM Conversation Log')
      .addFields(
        { name: 'User', value: `${msg.author.tag} (\`${msg.author.id}\`)`, inline: true },
        {
          name: 'Timestamp',
          value: `<t:${Math.floor(msg.createdTimestamp / 1000)}:f>`,
          inline: true,
        },
        { name: 'User Message', value: userText },
        { name: 'Bot Reply', value: replyText },
      )
      .setTimestamp()
    await dmLogChannel.send({ embeds: [embed] })
  } catch (e) {
    console.error('[logging] DM log failed:', e)
  }
}

/** Log just a user DM that was blocked (profanity) */
export async function logDmBlocked(msg: Message): Promise<void> {
  if (!dmLogChannel) return
  try {
    const embed = new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle('DM Blocked (Profanity)')
      .addFields(
        { name: 'User', value: `${msg.author.tag} (\`${msg.author.id}\`)`, inline: true },
        { name: 'Message', value: msg.content.slice(0, 1000) || '(empty)' },
      )
      .setTimestamp()
      .setFooter({ text: 'ND Bot, Profanity Filter' })
    await dmLogChannel.send({ embeds: [embed] })
  } catch (e) {
    console.error('[logging] DM blocked log failed:', e)
  }
}

export async function reportAutomod(msg: Message, rule: string, action: string): Promise<void> {
  if (!staffChannel) return
  try {
    const embed = new EmbedBuilder()
      .setColor(0xfee75c)
      .setTitle('AutoMod')
      .addFields(
        { name: 'Rule', value: rule.slice(0, 500), inline: true },
        { name: 'Action', value: action.slice(0, 200), inline: true },
        {
          name: 'User',
          value: `${msg.author.tag} (\`${msg.author.id}\`)`,
          inline: true,
        },
        {
          name: 'Channel',
          value: msg.channel.isDMBased() ? 'DM' : `<#${msg.channel.id}>`,
          inline: true,
        },
        { name: 'Message', value: msg.content.slice(0, 900) || '(empty)' },
      )
      .setTimestamp()
      .setFooter({ text: 'ND Bot, Rule AutoMod' })
    await staffChannel.send({ embeds: [embed] })
  } catch (e) {
    console.error('[logging] automod report failed:', e)
  }
}

export async function reportRaidAlert(
  guildName: string,
  guildId: string,
  joins: number,
  windowSec: number,
): Promise<void> {
  if (!staffChannel) return
  try {
    const embed = new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle('Possible raid detected')
      .setDescription(
        `**${joins}** joins in **${windowSec}s** in **${guildName}** (\`${guildId}\`).\nConsider \`nd!lockdown\` if needed.`,
      )
      .setTimestamp()
    await staffChannel.send({ embeds: [embed] })
  } catch (e) {
    console.error('[logging] raid alert failed:', e)
  }
}

/** Profile / avatar scan hit (username, display name, nickname, or avatar image). */
export async function reportProfileFlag(
  member: GuildMember,
  kind: 'text' | 'avatar',
  summary: string,
  extraFields?: { name: string; value: string }[],
): Promise<void> {
  if (!staffChannel) return
  try {
    const embed = new EmbedBuilder()
      .setColor(kind === 'avatar' ? 0xe67e22 : 0xed4245)
      .setTitle(
        kind === 'avatar' ? 'Profile scan · Avatar flagged' : 'Profile scan · Name/text flagged',
      )
      .setDescription(
        `**${member.user.tag}** · <@${member.user.id}>\n**Guild:** ${member.guild.name} (\`${member.guild.id}\`)\n\n${summary.slice(0, 1800)}`,
      )
      .setThumbnail(member.user.displayAvatarURL({ size: 128 }))
      .setTimestamp()
      .setFooter({
        text: 'ND Bot · Scans names/nicknames and optional custom status if enabled. Discord “About Me” bio is not available to bots.',
      })
    if (extraFields?.length) {
      embed.addFields(
        ...extraFields.map((f) => ({
          name: f.name.slice(0, 256),
          value: f.value.slice(0, 1024),
          inline: false,
        })),
      )
    }
    await staffChannel.send({ embeds: [embed] })
  } catch (e) {
    console.error('[logging] profile flag report failed:', e)
  }
}

export async function reportNewAccountJoin(member: GuildMember, ageDays: number): Promise<void> {
  if (!staffChannel) return
  try {
    const embed = new EmbedBuilder()
      .setColor(0xfee75c)
      .setTitle('New Discord account joined')
      .setDescription(
        `**${member.user.tag}** (\`${member.user.id}\`) joined **${member.guild.name}**\nAccount age: **${ageDays.toFixed(1)}** d (threshold **${raidNewAccountDays}** d).`,
      )
      .setTimestamp()
    await staffChannel.send({ embeds: [embed] })
  } catch (e) {
    console.error('[logging] new account join alert failed:', e)
  }
}

export async function reportUserReport(
  reporter: { tag: string; id: string },
  category: string,
  body: string,
  guildName: string,
  guildId: string,
  jumpUrl?: string,
): Promise<void> {
  const ch = reportChannel ?? staffChannel
  if (!ch) return
  try {
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('User report')
      .addFields(
        { name: 'Category', value: category.slice(0, 200), inline: true },
        { name: 'Reporter', value: `${reporter.tag} (\`${reporter.id}\`)`, inline: true },
        { name: 'Server', value: `${guildName} (\`${guildId}\`)`, inline: false },
        { name: 'Details', value: body.slice(0, 3500) || '(empty)' },
      )
      .setTimestamp()
    if (jumpUrl) embed.setDescription(`[Context](${jumpUrl})`)
    await ch.send({ embeds: [embed] })
  } catch (e) {
    console.error('[logging] user report failed:', e)
  }
}

export async function reportTicketIntake(
  userTag: string,
  userId: string,
  channelLabel: string,
  channelId: string,
  guildId: string,
  snippet: string,
  threadUrl?: string,
): Promise<void> {
  const ch = staffChannel
  if (!ch) return
  try {
    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle('Support ticket request')
      .addFields(
        { name: 'User', value: `${userTag} (\`${userId}\`)`, inline: true },
        {
          name: 'Channel',
          value: `<#${channelId}> (${channelLabel})`,
          inline: true,
        },
        { name: 'Snippet', value: snippet.slice(0, 3500) || '(empty)' },
      )
      .setTimestamp()
    if (threadUrl) {
      embed.setDescription(`[Thread](${threadUrl})`)
    }
    await ch.send({ embeds: [embed] })
  } catch (e) {
    console.error('[logging] ticket intake failed:', e)
  }
}

/** Optional: staff copy-paste draft when bot answers in configured support channels */
export async function reportStaffDraftReply(msg: Message, draftReply: string): Promise<void> {
  if (!staffChannel || !msg.guild) return
  try {
    const url = `https://discord.com/channels/${msg.guild.id}/${msg.channel.id}/${msg.id}`
    const embed = ndEmbed()
      .setTitle('Staff draft reply')
      .setDescription(`[Jump to user message](${url})`)
      .addFields(
        {
          name: 'User message',
          value: (msg.content || '(empty or attachment-only)').slice(0, 900),
        },
        { name: 'Bot reply (copy/edit)', value: draftReply.slice(0, 3500) },
      )
      .setFooter({ text: 'Not auto-sent, for staff use only' })
      .setTimestamp()
    await staffChannel.send({ embeds: [embed] })
  } catch (e) {
    console.error('[logging] staff draft failed:', e)
  }
}

/** Auto warn / kick / ban after repeated AI AutoMod strikes */
export async function reportAutomodEscalation(
  msg: Message,
  level: 'warn' | 'kick' | 'ban',
  strikes: number,
  lastVerdict: string,
): Promise<void> {
  if (!staffChannel) return
  try {
    const titles = {
      warn: 'AI AutoMod escalation · auto-warn',
      kick: 'AI AutoMod escalation · auto-kick',
      ban: 'AI AutoMod escalation · auto-ban',
    }
    const embed = new EmbedBuilder()
      .setColor(level === 'ban' ? 0x992d22 : level === 'kick' ? 0xe67e22 : 0xfee75c)
      .setTitle(titles[level])
      .setDescription(
        `**${msg.author.tag}** · <@${msg.author.id}>\n**Guild:** ${msg.guild?.name ?? '?'} (\`${msg.guild?.id ?? '?'}\`)\n**Strikes:** ${strikes}\n**Last verdict:** ${lastVerdict}`,
      )
      .addFields({
        name: 'Source message (truncated)',
        value: (msg.content ?? '').slice(0, 500) || '(empty)',
      })
      .setTimestamp()
      .setFooter({ text: 'ND Bot · AI AutoMod escalation' })
    await staffChannel.send({ embeds: [embed] })
  } catch (e) {
    console.error('[logging] automod escalation report failed:', e)
  }
}

export async function reportAiAutomod(
  msg: Message,
  verdict: string,
  reason: string,
  confidence: number,
): Promise<void> {
  if (!staffChannel) return
  const now = Date.now()
  if (aiAutomodReportMsgDedupeSec > 0) {
    const windowMs = aiAutomodReportMsgDedupeSec * 1000
    const prevMsg = aiAutomodReportByMessageId.get(msg.id) ?? 0
    if (now - prevMsg < windowMs) return
  }
  if (aiAutomodStaffLogDedupeSec > 0) {
    const raw = msg.content ?? ''
    const key = `${msg.author.id}:${normalizeForAiAutomodDedupe(raw)}`
    const windowMs = aiAutomodStaffLogDedupeSec * 1000
    const prev = aiAutomodStaffDedupe.get(key) ?? 0
    if (now - prev < windowMs) return
    aiAutomodStaffDedupe.set(key, now)
    if (aiAutomodStaffDedupe.size > 800) {
      const cutoff = now - windowMs * 2
      for (const [k, t] of aiAutomodStaffDedupe) {
        if (t < cutoff) aiAutomodStaffDedupe.delete(k)
      }
    }
  }
  try {
    const actions = resolveAiAutomodAction(verdict)
    const jump = aiAutomodMessageJumpUrl(msg)
    const confPct = `${(Math.min(1, Math.max(0, confidence)) * 100).toFixed(1)}%`
    const embed = new EmbedBuilder()
      .setColor(0xeb459e)
      .setTitle('AI AutoMod')
      .setDescription(
        `Classifier flagged this message. **Verdict:** \`${verdict}\` · **Score:** ${confidence.toFixed(3)} (${confPct}) · must be ≥ **${aiAutomodMinConfidence}** to act`.slice(
          0,
          4096,
        ),
      )
      .addFields(
        { name: 'Reason (model)', value: reason.slice(0, 1024) || '—' },
        {
          name: 'Follow-up actions (from config)',
          value: formatAiAutomodActions(actions).slice(0, 1024),
        },
        ...(msg.guild
          ? [
              {
                name: 'Guild',
                value: `${msg.guild.name} · \`${msg.guild.id}\``.slice(0, 1024),
              } as const,
            ]
          : []),
        {
          name: 'User',
          value: `${msg.author.tag} · \`${msg.author.id}\``.slice(0, 1024),
          inline: true,
        },
        {
          name: 'Channel',
          value: msg.channel.isDMBased()
            ? 'DM'
            : `<#${msg.channel.id}> · \`${msg.channel.id}\``.slice(0, 1024),
          inline: true,
        },
        {
          name: 'Message',
          value: [`ID \`${msg.id}\``, jump ? `[Jump to message](${jump})` : null]
            .filter(Boolean)
            .join(' · ')
            .slice(0, 1024),
          inline: false,
        },
        {
          name: 'Message text',
          value: (msg.content ?? '').slice(0, 900) || '(empty)',
        },
        ...(msg.attachments.size > 0
          ? [
              {
                name: `Attachments (${msg.attachments.size})`,
                value: formatAiAutomodAttachments(msg),
              } as const,
            ]
          : []),
        ...(msg.embeds.length > 0
          ? [
              {
                name: `Unfurled link previews (${msg.embeds.length})`,
                value: formatAiAutomodEmbedPreviews(msg),
              } as const,
            ]
          : []),
      )
      .setTimestamp()
      .setFooter({
        text: `ND Bot · AI AutoMod · model ${MODEL_ID}`,
      })
    await staffChannel.send({ embeds: [embed] })
    if (aiAutomodReportMsgDedupeSec > 0) {
      const t = Date.now()
      aiAutomodReportByMessageId.set(msg.id, t)
      if (aiAutomodReportByMessageId.size > 800) {
        const cutoff = t - aiAutomodReportMsgDedupeSec * 2000
        for (const [k, tt] of aiAutomodReportByMessageId) {
          if (tt < cutoff) aiAutomodReportByMessageId.delete(k)
        }
      }
    }
  } catch (e) {
    console.error('[logging] AI automod report failed:', e)
  }
}
