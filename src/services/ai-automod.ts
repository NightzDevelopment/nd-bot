/**
 * AI AutoMod, batched Gemini classification for guild messages.
 */
import {
  ChannelType,
  type Client,
  type Message,
  type TextChannel,
  ThreadChannel,
} from 'discord.js'
import {
  aiAutomodBatchIntervalMs,
  aiAutomodBatchSize,
  aiAutomodCryptoScam,
  aiAutomodDoxxing,
  aiAutomodEnabled,
  aiAutomodHate,
  aiAutomodImpersonation,
  aiAutomodIncludeChannelSnippet,
  aiAutomodIncludeReplyContext,
  aiAutomodMaxCallsPerMinute,
  aiAutomodMinConfidence,
  aiAutomodNsfw,
  aiAutomodRaid,
  aiAutomodScam,
  aiAutomodSelfharm,
  aiAutomodSentiment,
  aiAutomodServerRules,
  aiAutomodSpamAd,
  aiAutomodToxicity,
  aiAutomodVisionEnabled,
  aiAutomodVisionMaxPerMinute,
  heatedSlowmodeCooldownMs,
  heatedSlowmodeSeconds,
  raidJoinThreshold,
  raidJoinWindowSec,
  raidNewAccountAlertEnabled,
  raidNewAccountDays,
} from '../config.ts'
import { generateRaw, generateRawWithImage } from './gemini.ts'
import { reportAiAutomod, reportNewAccountJoin, reportRaidAlert } from './logging.ts'
import { isModMessage } from '../utils/permissions.ts'
import { isIgnoredChannelOrCategory } from '../utils/channel-ignore.ts'
import { lockdownGuilds } from './lockdown.ts'
import { resolveAiAutomodAction } from '../utils/automod-actions.ts'
import {
  fetchAttachmentAsBase64,
  pickFirstImageAttachment,
} from '../utils/image-attachment.ts'

type Queued = {
  msg: Message
  queuedAt: number
  /** Prior channel lines (before current message was pushed to LRU) */
  channelSnippet?: string
}

const queue: Queued[] = []
const visionQueue: Queued[] = []
let processing = false
let interval: ReturnType<typeof setInterval> | null = null

const joinTimestamps = new Map<string, number[]>()
const lastHeatedSlowmode = new Map<string, number>()
let callsThisMinute = 0
let visionCallsThisMinute = 0
let minuteReset = Date.now()

async function applyHeatedSlowmode(channel: Message['channel']): Promise<void> {
  if (heatedSlowmodeSeconds <= 0) return
  if (!channel.isTextBased() || channel.isDMBased()) return
  const id = channel.id
  const now = Date.now()
  if (now - (lastHeatedSlowmode.get(id) ?? 0) < heatedSlowmodeCooldownMs) return
  try {
    await (channel as TextChannel | ThreadChannel).setRateLimitPerUser(
      heatedSlowmodeSeconds,
      'AI AutoMod: heated discussion',
    )
    lastHeatedSlowmode.set(id, now)
    console.log(`[ai-automod] slowmode ${heatedSlowmodeSeconds}s to channel ${id}`)
  } catch (e) {
    console.warn('[ai-automod] setRateLimitPerUser failed:', e)
  }
}

function resetMinute(): void {
  if (Date.now() - minuteReset >= 60_000) {
    callsThisMinute = 0
    visionCallsThisMinute = 0
    minuteReset = Date.now()
  }
}

export function registerRaidTracking(client: Client): void {
  if (!aiAutomodRaid) return
  client.on('guildMemberAdd', (member) => {
    const gid = member.guild.id
    const now = Date.now()
    const windowMs = raidJoinWindowSec * 1000
    let arr = joinTimestamps.get(gid) ?? []
    arr = arr.filter((t) => now - t < windowMs)
    arr.push(now)
    joinTimestamps.set(gid, arr)
    if (arr.length >= raidJoinThreshold) {
      void reportRaidAlert(
        member.guild.name,
        member.guild.id,
        arr.length,
        raidJoinWindowSec,
      )
      lockdownGuilds.add(gid)
      console.warn(`[ai-automod] raid mode: lockdown enabled for guild ${gid}`)
    }

    if (raidNewAccountAlertEnabled && member.user.createdAt) {
      const ageDays =
        (Date.now() - member.user.createdTimestamp) / (24 * 60 * 60 * 1000)
      if (ageDays < raidNewAccountDays) {
        void reportNewAccountJoin(member, ageDays)
      }
    }
  })
}

const VERDICT_LIST = [
  'SAFE',
  'TOXICITY_LOW',
  'TOXICITY_HIGH',
  'SCAM',
  'CRYPTO_SCAM',
  'NSFW',
  'EVASION',
  'IMPERSONATION',
  'HEATED',
  'HATE',
  'SELFHARM',
  'DOXXING',
  'SPAM_AD',
] as const

function verdictCategoryEnabled(verdict: string): boolean {
  const v = verdict.toUpperCase()
  switch (v) {
    case 'TOXICITY_LOW':
    case 'TOXICITY_HIGH':
      return aiAutomodToxicity
    case 'SCAM':
      return aiAutomodScam
    case 'CRYPTO_SCAM':
      return aiAutomodCryptoScam
    case 'NSFW':
      return aiAutomodNsfw
    case 'EVASION':
      return true
    case 'IMPERSONATION':
      return aiAutomodImpersonation
    case 'HEATED':
      return aiAutomodSentiment
    case 'HATE':
      return aiAutomodHate
    case 'SELFHARM':
      return aiAutomodSelfharm
    case 'DOXXING':
      return aiAutomodDoxxing
    case 'SPAM_AD':
      return aiAutomodSpamAd
    default:
      return true
  }
}

function buildAutomodPrompt(
  items: { id: string; content: string; author: string }[],
): string {
  const flags: string[] = []
  if (aiAutomodToxicity) flags.push('toxicity/threats/harassment')
  if (aiAutomodHate) flags.push('hate/harassment toward protected groups')
  if (aiAutomodScam) flags.push('scams/phishing/fake nitro')
  if (aiAutomodCryptoScam) flags.push('crypto recovery scams / wallet drain patterns')
  if (aiAutomodNsfw) flags.push('NSFW/sexual/grooming')
  if (aiAutomodSelfharm) flags.push('self-harm or suicide content (flag for staff, be careful)')
  if (aiAutomodDoxxing) flags.push('doxxing / sharing private info (addresses, IPs to harass)')
  if (aiAutomodSpamAd) flags.push('spam ads / unsolicited promotion')
  if (aiAutomodImpersonation) flags.push('impersonating staff/mod')
  if (aiAutomodSentiment) flags.push('heated tone / pile-on')

  const verdictEnum = VERDICT_LIST.join('|')
  const rulesExtra = aiAutomodServerRules
    ? `\n\nServer-specific rules:\n${aiAutomodServerRules.slice(0, 2000)}`
    : ''

  return `You are a Discord automoderation classifier. Analyze each message and return ONLY valid JSON array, no markdown.

Categories to consider: ${flags.join(', ') || 'general safety'}.${rulesExtra}

For each message output one object:
{"messageId":"...","verdict":"${verdictEnum}","confidence":0.0-1.0,"reason":"brief"}

Verdict meanings:
- SAFE: ok to leave
- TOXICITY_LOW: mild insults; staff review usually
- TOXICITY_HIGH: threats, credible harassment; strong action
- SCAM: generic phishing/scams
- CRYPTO_SCAM: crypto recovery / wallet scams
- NSFW: sexual content not allowed in server
- EVASION: trying to bypass filters (l33t, split words)
- IMPERSONATION: pretending to be mod/staff
- HEATED: angry pile-on / flame (not necessarily rule-breaking)
- HATE: hate toward protected characteristics
- SELFHARM: self-harm discussion; prefer staff awareness
- DOXXING: posting others' private info
- SPAM_AD: repeated ads / shilling

Rules:
- verdict SAFE unless clearly harmful; confidence must be >= ${aiAutomodMinConfidence} to flag non-SAFE.
- When unsure, use SAFE.
- TOXICITY_HIGH for credible threats.

Messages:
${items
  .map(
    (m) =>
      `ID:${m.id} AUTHOR:${m.author} CONTENT:${JSON.stringify(m.content.slice(0, 500))}`,
  )
  .join('\n')}

Return a JSON array only.`
}

type Verdict = {
  messageId?: string
  verdict?: string
  confidence?: number
  reason?: string
}

function parseJsonArray(text: string): Verdict[] {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  try {
    const parsed = JSON.parse(t)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    const start = t.indexOf('[')
    const end = t.lastIndexOf(']')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(t.slice(start, end + 1)) as Verdict[]
      } catch {
        return []
      }
    }
    return []
  }
}

async function buildContentForClassifier(msg: Message, channelSnippet?: string): Promise<string> {
  let content = msg.content ?? ''
  if (channelSnippet) {
    content = `${channelSnippet}\n${content}`
  }
  if (aiAutomodIncludeReplyContext && msg.reference?.messageId) {
    try {
      const ref = await msg.channel.messages.fetch(msg.reference.messageId)
      const prev = ref.content?.trim().slice(0, 280) ?? ''
      if (prev) {
        content = `replying_to:${JSON.stringify(prev)}\n${content}`
      }
    } catch {
      /* ignore */
    }
  }
  return content.slice(0, 900)
}

async function applyVerdictActions(
  msg: Message,
  verdict: string,
  reason: string,
  conf: number,
): Promise<void> {
  if (!verdictCategoryEnabled(verdict)) return

  const actions = resolveAiAutomodAction(verdict)

  if (verdict === 'HEATED') {
    if (actions.report) await reportAiAutomod(msg, verdict, reason, conf)
    void applyHeatedSlowmode(msg.channel)
    return
  }

  if (verdict === 'TOXICITY_LOW' || verdict === 'IMPERSONATION') {
    if (actions.report) await reportAiAutomod(msg, verdict, reason, conf)
    return
  }

  if (actions.report) {
    await reportAiAutomod(msg, verdict, reason, conf)
  }

  if (actions.deleteMessage) {
    try {
      await msg.delete()
    } catch {
      /* ignore */
    }
  }
  if (actions.timeoutMs > 0 && msg.member) {
    try {
      await msg.member.timeout(actions.timeoutMs, `AI AutoMod: ${verdict}`)
    } catch {
      /* ignore */
    }
  }
}

type QueueDrain = 'empty' | 'rate_limited' | 'done'

async function processTextQueue(): Promise<QueueDrain> {
  resetMinute()
  if (queue.length === 0) return 'empty'
  if (callsThisMinute >= aiAutomodMaxCallsPerMinute) return 'rate_limited'

  const batch: Queued[] = []
  while (batch.length < aiAutomodBatchSize && queue.length > 0) {
    const q = queue.shift()
    if (q) batch.push(q)
  }
  if (batch.length === 0) return 'empty'

  const items = await Promise.all(
    batch.map(async (q) => ({
      id: q.msg.id,
      content: await buildContentForClassifier(q.msg, q.channelSnippet),
      author: q.msg.author.tag,
    })),
  )

  callsThisMinute++
  const promptStr = buildAutomodPrompt(items)
  const text = await generateRaw(promptStr)
  const verdicts = parseJsonArray(text)

  for (const v of verdicts) {
    const id = v.messageId
    if (!id) continue
    const q = batch.find((b) => b.msg.id === id)
    if (!q) continue
    const verdict = (v.verdict ?? 'SAFE').toUpperCase()
    const conf = typeof v.confidence === 'number' ? v.confidence : 0
    const reason = v.reason ?? ''

    if (verdict === 'SAFE' || conf < aiAutomodMinConfidence) continue

    await applyVerdictActions(q.msg, verdict, reason, conf)
  }
  return 'done'
}

async function processVisionQueue(): Promise<QueueDrain> {
  if (!aiAutomodVisionEnabled) return 'empty'
  if (visionQueue.length === 0) return 'empty'
  resetMinute()
  if (visionCallsThisMinute >= aiAutomodVisionMaxPerMinute) {
    return 'rate_limited'
  }

  const q = visionQueue.shift()
  if (!q) return 'empty'

  const att = pickFirstImageAttachment(q.msg.attachments)
  if (!att) return 'done'

  visionCallsThisMinute++
  const image = await fetchAttachmentAsBase64(att)
  const content = await buildContentForClassifier(q.msg, q.channelSnippet)
  const prompt = `${buildAutomodPrompt([
    {
      id: q.msg.id,
      content: `[image attachment: ${att.name}] ${content}`,
      author: q.msg.author.tag,
    },
  ])}\n\nNote: First message includes an image; classify text+image for NSFW/gore/scams.`

  const raw = await generateRawWithImage(prompt, image)
  const verdicts = parseJsonArray(raw)
  for (const v of verdicts) {
    if (v.messageId !== q.msg.id) continue
    const verdict = (v.verdict ?? 'SAFE').toUpperCase()
    const conf = typeof v.confidence === 'number' ? v.confidence : 0
    const reason = v.reason ?? ''
    if (verdict === 'SAFE' || conf < aiAutomodMinConfidence) continue
    await applyVerdictActions(q.msg, verdict, reason, conf)
  }
  return 'done'
}

const RATE_LIMIT_RETRY_MS = 5000

async function processQueue(): Promise<void> {
  if (processing) return
  processing = true
  let textDrain: QueueDrain = 'empty'
  let visionDrain: QueueDrain = 'empty'
  try {
    try {
      textDrain = await processTextQueue()
    } catch (e) {
      console.error('[ai-automod] batch error:', e)
    }
    try {
      visionDrain = await processVisionQueue()
    } catch (e) {
      console.error('[ai-automod] vision batch error:', e)
    }
  } finally {
    processing = false
    const backlog = queue.length > 0 || visionQueue.length > 0
    if (!backlog) return
    const textStuck =
      queue.length > 0 &&
      (textDrain === 'rate_limited' || callsThisMinute >= aiAutomodMaxCallsPerMinute)
    const visionStuck =
      visionQueue.length > 0 &&
      (visionDrain === 'rate_limited' ||
        visionCallsThisMinute >= aiAutomodVisionMaxPerMinute)
    const delay = textStuck || visionStuck ? RATE_LIMIT_RETRY_MS : 0
    setTimeout(() => void processQueue(), delay)
  }
}

export function enqueueAiAutomod(
  msg: Message,
  channelSnippet?: string,
): void {
  if (!aiAutomodEnabled) return
  if (msg.channel.type === ChannelType.DM) return
  if (msg.author.bot) return
  if (isModMessage(msg)) return
  if (isIgnoredChannelOrCategory(msg.channel)) return
  const c = msg.content?.trim() ?? ''
  if (c.length < 5 && msg.attachments.size === 0) return

  const img = pickFirstImageAttachment(msg.attachments)
  if (aiAutomodVisionEnabled && img && c.length < 5) {
    visionQueue.push({ msg, queuedAt: Date.now(), channelSnippet })
    void processQueue()
    return
  }

  queue.push({ msg, queuedAt: Date.now(), channelSnippet })
  void processQueue()
}

export function startAiAutomodProcessor(_client: Client): void {
  if (!aiAutomodEnabled) return
  if (interval) return
  interval = setInterval(() => {
    void processQueue()
  }, aiAutomodBatchIntervalMs)
  interval.unref?.()
}
