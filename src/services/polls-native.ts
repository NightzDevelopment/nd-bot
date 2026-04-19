/**
 * Shared native Discord poll helpers for `/polls` and `nd!polls`.
 */
import {
  ChannelType,
  type EmbedBuilder,
  type Guild,
  type GuildMember,
  type GuildTextBasedChannel,
  type Message,
  type Poll,
  type PollData,
} from 'discord.js'
import { pollReminderChannelIds } from '../config.ts'
import { ndEmbed } from '../utils/embed.ts'

export const POLLS_FETCH_LIMIT = 100
export const POLLS_QUESTION_MAX = 300
export const POLLS_ANSWER_MAX = 55

export function pollsChannelsConfigured(): boolean {
  return pollReminderChannelIds.size > 0
}

function isActivePoll(poll: Poll | null): boolean {
  if (!poll) return false
  if (poll.resultsFinalized) return false
  if (poll.expiresTimestamp != null && Date.now() >= poll.expiresTimestamp) return false
  return true
}

async function ensureFullPoll(message: Message): Promise<Message> {
  if (message.partial) return message.fetch()
  if (message.poll?.partial) {
    await message.fetch()
  }
  return message
}

async function collectActivePolls(
  channel: GuildTextBasedChannel,
): Promise<Message[]> {
  const fetched = await channel.messages.fetch({ limit: POLLS_FETCH_LIMIT })
  const out: Message[] = []
  for (const m of fetched.values()) {
    if (!m.poll) continue
    const full = await ensureFullPoll(m).catch(() => null)
    if (!full?.poll) continue
    if (isActivePoll(full.poll)) out.push(full)
  }
  return out
}

/** Empty string = no polls; null = not configured */
export async function buildActivePollsEmbed(
  guild: Guild,
): Promise<'not_configured' | { empty: true } | { embed: EmbedBuilder }> {
  if (pollReminderChannelIds.size === 0) return 'not_configured'

  const rows: string[] = []
  for (const id of pollReminderChannelIds) {
    const raw = await guild.channels.fetch(id).catch(() => null)
    if (!raw?.isTextBased()) continue
    const ch = raw as GuildTextBasedChannel
    const active = await collectActivePolls(ch).catch(() => [])
    for (const m of active) {
      const q = m.poll?.question.text?.trim() || 'Poll'
      const shortQ = q.length > 120 ? `${q.slice(0, 117)}…` : q
      const url = m.url
      const exp = m.poll?.expiresTimestamp
      const when =
        exp != null ? ` · ends <t:${Math.floor(exp / 1000)}:R>` : ''
      rows.push(`• **${shortQ}**${when}\n  ${url} · ${ch}`)
    }
  }

  if (rows.length === 0) return { empty: true }

  const body = rows.join('\n\n').slice(0, 3800)
  return {
    embed: ndEmbed().setTitle('Active polls').setDescription(body),
  }
}

export type CreatePollInput = {
  question: string
  answers: string[]
  durationHours: number
  allowMultiselect: boolean
  /** Resolved text channel; caller validates against pollReminderChannelIds */
  target: GuildTextBasedChannel
}

export async function sendNativePoll(
  input: CreatePollInput,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const { question, answers, durationHours, allowMultiselect, target } = input
  const poll: PollData = {
    question: { text: question.slice(0, POLLS_QUESTION_MAX) },
    answers: answers.map((t) => ({ text: t.slice(0, POLLS_ANSWER_MAX) })),
    duration: durationHours,
    allowMultiselect,
  }
  try {
    const msg = await target.send({ poll })
    return { ok: true, url: msg.url }
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e)
    return { ok: false, error: err.slice(0, 500) }
  }
}

export async function resolvePollsTargetChannel(
  guild: Guild,
  channelId: string | null,
): Promise<
  | { ok: true; channel: GuildTextBasedChannel }
  | { ok: false; error: string }
> {
  if (channelId) {
    const raw = await guild.channels.fetch(channelId).catch(() => null)
    if (!raw?.isTextBased()) {
      return { ok: false, error: 'Invalid channel.' }
    }
    if (
      raw.type !== ChannelType.GuildText &&
      raw.type !== ChannelType.GuildAnnouncement
    ) {
      return { ok: false, error: 'Pick a text or announcement channel.' }
    }
    if (!pollReminderChannelIds.has(raw.id)) {
      return {
        ok: false,
        error: 'That channel is not listed in `POLL_REMINDER_CHANNEL_IDS`.',
      }
    }
    return { ok: true, channel: raw as GuildTextBasedChannel }
  }
  const firstId = [...pollReminderChannelIds][0]!
  const ch = await guild.channels.fetch(firstId).catch(() => null)
  if (!ch?.isTextBased()) {
    return { ok: false, error: 'Could not load the configured polls channel.' }
  }
  return { ok: true, channel: ch as GuildTextBasedChannel }
}

export function botCanPostPolls(
  me: GuildMember | null,
  target: GuildTextBasedChannel,
): string | null {
  if (!me) return 'Bot member not available.'
  const perms = target.permissionsFor(me)
  if (!perms?.has(['SendMessages', 'EmbedLinks'])) {
    return `Missing **Send Messages** (and **Embed Links**) in ${target}.`
  }
  return null
}

export async function endPollInPollChannels(
  guild: Guild,
  messageId: string,
): Promise<
  | { ok: true; channelId: string }
  | { ok: false; error: 'not_found' | 'other'; detail?: string }
> {
  let channel: GuildTextBasedChannel | null = null
  for (const cid of pollReminderChannelIds) {
    const raw = await guild.channels.fetch(cid).catch(() => null)
    if (!raw?.isTextBased()) continue
    const ch = raw as GuildTextBasedChannel
    const m = await ch.messages.fetch(messageId).catch(() => null)
    if (m?.poll) {
      channel = ch
      break
    }
  }
  if (!channel) return { ok: false, error: 'not_found' }
  try {
    await channel.messages.endPoll(messageId)
    return { ok: true, channelId: channel.id }
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e)
    return { ok: false, error: 'other', detail: err.slice(0, 500) }
  }
}
