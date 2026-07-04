/**
 * AI AutoMod, batched Gemini classification for guild messages.
 */
import {
  ChannelType,
  type Client,
  type Message,
  type TextChannel,
  type ThreadChannel,
} from 'discord.js'
import {
  aiAutomodBatchIntervalMs,
  aiAutomodBatchSize,
  aiAutomodCryptoScam,
  aiAutomodDoxxing,
  aiAutomodEnabled,
  aiAutomodEscalationBanAt,
  aiAutomodEscalationEnabled,
  aiAutomodEscalationKickAt,
  aiAutomodEscalationWarnAt,
  aiAutomodHate,
  aiAutomodImpersonation,
  aiAutomodIncludeChannelSnippet,
  aiAutomodIncludeReplyContext,
  aiAutomodMaxCallsPerMinute,
  aiAutomodMinConfidence,
  aiAutomodNsfw,
  aiAutomodRaid,
  aiAutomodScam,
  aiAutomodScamQuarantine,
  aiAutomodSelfharm,
  aiAutomodSentiment,
  aiAutomodServerRules,
  aiAutomodSpamAd,
  aiAutomodToxicity,
  aiAutomodVisionEnabled,
  aiAutomodVisionMaxPerMinute,
  heatedSlowmodeCooldownMs,
  heatedSlowmodeSeconds,
  raidAutolockDurationMs,
  raidAutolockEnabled,
  raidJoinThreshold,
  raidJoinWindowSec,
  raidNewAccountAlertEnabled,
  raidNewAccountDays,
  TICKET_CLOSED_CATEGORY_ID,
  TICKET_OPEN_CATEGORY_ID,
} from '../config.ts'
import { resolveAiAutomodAction } from '../utils/automod-actions.ts'
import { markBotMessageDelete } from '../utils/bot-delete-attribution.ts'
import { isIgnoredChannelOrCategory } from '../utils/channel-ignore.ts'
import { fetchAttachmentAsBase64, pickFirstImageAttachment } from '../utils/image-attachment.ts'
import { isModMessage } from '../utils/permissions.ts'
import { maybeAutomodEscalation } from './ai-automod-escalation.ts'
import { generateRaw, generateRawWithImage } from './gemini.ts'
import { quarantineMember } from './profile-scan.ts'
import { lockdownGuilds } from './lockdown.ts'
import { reportAiAutomod, reportNewAccountJoin, reportRaidAlert } from './logging.ts'

type Queued = {
  msg: Message
  queuedAt: number
  /** Prior channel lines (before current message was pushed to LRU) */
  channelSnippet?: string | undefined
}

const queue: Queued[] = []
const visionQueue: Queued[] = []
/** Same message queued only once until a batch/vision run finishes (stops duplicate strikes/logs). */
const pendingAiAutomodMessageIds = new Set<string>()
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
      void reportRaidAlert(member.guild.name, member.guild.id, arr.length, raidJoinWindowSec)
      if (raidAutolockEnabled && !lockdownGuilds.has(gid)) {
        void import('./lockdown.ts').then(({ setLockdown }) => setLockdown(gid, true))
        console.warn(`[ai-automod] raid mode: lockdown enabled for guild ${gid}`)
        if (raidAutolockDurationMs > 0) {
          void import('./scheduled-actions-store.ts').then(({ scheduleAction }) =>
            scheduleAction({
              type: 'raid_unlock',
              guildId: gid,
              userId: 'system',
              dueAt: Date.now() + raidAutolockDurationMs,
              reason: 'Raid auto-lock expired',
            }),
          )
        }
      }
    }

    if (raidNewAccountAlertEnabled && member.user.createdAt) {
      const ageDays = (Date.now() - member.user.createdTimestamp) / (24 * 60 * 60 * 1000)
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

function buildAutomodPrompt(items: { id: string; content: string; author: string }[]): string {
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

**Confidence (required, use varied scores, do not default to 0.9):**
- Output a number between **0.0** and **1.0** with **two decimal places** when helpful (e.g. \`0.73\`, \`0.81\`, \`0.66\`).
- **Do not** output the same confidence for every flagged message. Match strength to evidence.
- Guideline scale (non-SAFE verdicts):
  - **~0.55 to 0.69**: weak / ambiguous / could be joke or missing context; borderline, use only when you still believe a rule is broken.
  - **~0.70 to 0.79**: plausible violation, some doubt or soft wording.
  - **~0.80 to 0.88**: likely violation, clear enough for moderation.
  - **~0.89 to 0.95**: strong / explicit evidence.
  - **~0.96 to 1.0**: unambiguous (obvious slur, clear scam URL pattern, blatant NSFW).
- If you would have picked **0.90** out of habit, choose **0.74**, **0.82**, or **0.87** instead when the case is weaker or stronger.

Verdict meanings:
- SAFE: ok to leave
- TOXICITY_LOW: mild insults; staff review usually
- TOXICITY_HIGH: threats, credible harassment; strong action
- SCAM: generic phishing/scams, fake giveaways, "free money" bait
- CRYPTO_SCAM: crypto recovery / wallet scams, and fake celebrity/brand crypto giveaways or casino promo-code "bonus" scams
- NSFW: sexual content not allowed in server
- EVASION: trying to bypass filters (l33t, split words)
- IMPERSONATION: pretending to be mod/staff
- HEATED: angry pile-on / flame (not necessarily rule-breaking)
- HATE: hate toward protected characteristics
- SELFHARM: self-harm discussion; prefer staff awareness
- DOXXING: posting others' private info
- SPAM_AD: repeated ads / shilling

Rules:
- verdict SAFE unless clearly harmful; for non-SAFE verdicts, **confidence** must be **>= ${aiAutomodMinConfidence}** or the bot ignores the flag (treat as SAFE for automation). More ambiguous cases should use **lower** confidences in the 0.65 to 0.82 range when still above the threshold.
- When unsure, use SAFE.
- TOXICITY_HIGH for credible threats.
- **Leetspeak / obfuscation:** Treat character substitutions as the underlying word (e.g. 0→o, 3→e, 1→i, @→a). Flag NSFW/scam meaning even if spelling is distorted.
- **EVASION:** Use for deliberate filter bypass (leetspeak of sexual/scam terms, zalgo, zero-width chars, split words). Pair with the underlying category (often NSFW or SCAM) in reason.
- **Bio / profile / link solicitation:** Messages telling people to "check my bio", "link in profile", off-server adult content, or similar → **NSFW** or **SCAM** as appropriate; say so in \`reason\`.
- **Fake giveaways / casino promo scams (always flag):** Any message OR image claiming a celebrity, streamer, or brand (MrBeast, Elon, etc.) is giving away money or crypto, "register and use promo code X to withdraw a bonus", "claim your reward", instructions to enter a code to receive USDT/USD, screenshots of a "withdrawal success" or a wallet suddenly receiving funds, urgency hooks ("post deleted in an hour", "only the fastest"), or links to unknown casino/betting/crypto domains → **CRYPTO_SCAM** (or **SCAM** if no crypto), confidence **0.9 or higher**. These are scams no matter how polished or "official" the screenshot looks; a real giveaway never requires a promo code to withdraw. Treat pasted tweet text or forwarded screenshots the same as an original message.
- **Extremist / Nazi:** Glorification of fascism, Hitler/Nazi memes, Holocaust denial or trivialization, swastika-adjacent shock content, white-supremacist framing → **HATE** (not SAFE). High confidence when symbols or slogans are clear.
- **NSFW shock memes:** Sexual or explicit **Minecraft/block-game** memes, "gooner" / sexual filename innuendo, or edgy shock GIFs that are primarily sexual or bigoted → **NSFW** or **HATE** as appropriate; name the theme in \`reason\`.

Messages:
${items
  .map((m) => `ID:${m.id} AUTHOR:${m.author} CONTENT:${JSON.stringify(m.content.slice(0, 500))}`)
  .join('\n')}

Return a JSON array only.`
}

type Verdict = {
  messageId?: string
  verdict?: string
  confidence?: number
  reason?: string
}

function parseConfidence(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'string') {
    const n = parseFloat(raw.trim())
    return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0
  }
  return 0
}

function parseJsonArray(text: string): Verdict[] {
  const t = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
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

/** If the model returns duplicate messageIds in one response, keep the highest-confidence row. */
function mergeVerdictsForBatch(verdicts: Verdict[], batchIds: Set<string>): Verdict[] {
  const merged = new Map<string, Verdict>()
  for (const v of verdicts) {
    const mid = v.messageId
    if (!mid || !batchIds.has(mid)) continue
    const verdict = (v.verdict ?? 'SAFE').toUpperCase()
    const conf = parseConfidence(v.confidence)
    if (verdict === 'SAFE' || conf < aiAutomodMinConfidence) continue
    const prev = merged.get(mid)
    if (!prev || conf > parseConfidence(prev.confidence)) {
      merged.set(mid, v)
    }
  }
  return [...merged.values()]
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
  let reported = false
  let deletedMessage = false
  let timedOut = false

  // Broadcast automod flag to dashboard activity feed
  try {
    const { broadcastActivity } = await import('../dashboard/websocket.ts')
    broadcastActivity('automod_flag', {
      userId: msg.author.id,
      username: msg.author.username,
      displayName: msg.member?.displayName || msg.author.username,
      verdict,
      reason: reason.slice(0, 120),
      confidence: conf,
      channelName: 'name' in msg.channel ? (msg.channel as any).name : undefined,
    })
  } catch {
    /* ignore */
  }

  const runEscalation = async () => {
    await maybeAutomodEscalation(msg, verdict, {
      reported,
      deletedMessage,
      timedOut,
    })
  }

  if (verdict === 'HEATED') {
    if (actions.report) {
      try {
        await reportAiAutomod(msg, verdict, reason, conf)
        reported = true
      } catch (e) {
        console.warn('[ai-automod] staff report failed:', e)
      }
    }
    void applyHeatedSlowmode(msg.channel)
    await runEscalation()
    return
  }

  if (verdict === 'TOXICITY_LOW' || verdict === 'IMPERSONATION') {
    if (actions.report) {
      try {
        await reportAiAutomod(msg, verdict, reason, conf)
        reported = true
      } catch (e) {
        console.warn('[ai-automod] staff report failed:', e)
      }
    }
    await runEscalation()
    return
  }

  // Delete before staff log so a failing report embed cannot leave harmful messages up.
  if (actions.deleteMessage) {
    try {
      markBotMessageDelete({
        guildId: msg.guild?.id,
        channelId: msg.channel.id,
        messageId: msg.id,
        actor: 'ND Bot · AI AutoMod',
        reason: `AI verdict ${verdict}`,
      })
      await msg.delete()
      deletedMessage = true
    } catch (e) {
      console.warn(
        '[ai-automod] message delete failed: grant bot **Manage Messages** in this channel (and check hierarchy):',
        msg.channel.id,
        e,
      )
    }
  }

  if (actions.report) {
    try {
      await reportAiAutomod(msg, verdict, reason, conf)
      reported = true
    } catch (e) {
      console.warn('[ai-automod] staff report failed:', e)
    }
  }

  if (actions.timeoutMs > 0 && msg.member) {
    try {
      await msg.member.timeout(actions.timeoutMs, `AI AutoMod: ${verdict}`)
      timedOut = true
    } catch (e) {
      console.warn(
        '[ai-automod] member timeout failed: need **Moderate Members** and role below bot:',
        msg.author.id,
        e,
      )
    }
  }

  // Scam and crypto-scam accounts are almost always compromised or throwaway, so
  // isolate them immediately (quarantine role, member role stripped) instead of
  // waiting for strike escalation.
  if (aiAutomodScamQuarantine && (verdict === 'SCAM' || verdict === 'CRYPTO_SCAM')) {
    const member =
      msg.member ??
      (msg.guild ? await msg.guild.members.fetch(msg.author.id).catch(() => null) : null)
    if (member) {
      const status = await quarantineMember(member, `AI AutoMod: ${verdict}`)
      console.log(`[ai-automod] scam quarantine for ${msg.author.id}: ${status}`)
    }
  }

  await runEscalation()
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

  const batchIds = new Set(batch.map((b) => b.msg.id))
  try {
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
    const verdicts = mergeVerdictsForBatch(parseJsonArray(text), batchIds)

    for (const v of verdicts) {
      const id = v.messageId
      if (!id) continue
      const q = batch.find((b) => b.msg.id === id)
      if (!q) continue
      const verdict = (v.verdict ?? 'SAFE').toUpperCase()
      const conf = parseConfidence(v.confidence)
      const reason = v.reason ?? ''

      if (verdict === 'SAFE' || conf < aiAutomodMinConfidence) continue

      await applyVerdictActions(q.msg, verdict, reason, conf)
    }
    return 'done'
  } catch (e) {
    console.error('[ai-automod] processTextQueue error:', e)
    return 'done'
  } finally {
    for (const q of batch) {
      pendingAiAutomodMessageIds.delete(q.msg.id)
    }
  }
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

  const batchIds = new Set([q.msg.id])
  try {
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
    ])}\n\nNote: This message includes an image, classify text+image together (NSFW/gore/hate/scams). A screenshot IS the message: a fake celebrity/brand crypto giveaway, a casino "promo code to withdraw a bonus" offer, or a staged "withdrawal success" / "you received USDT" screenshot is **CRYPTO_SCAM** (or SCAM) even if the text is harmless. **Vary confidence** per the scale above; do not always use 0.9.`

    const raw = await generateRawWithImage(prompt, image)
    const verdicts = mergeVerdictsForBatch(parseJsonArray(raw), batchIds)
    for (const v of verdicts) {
      if (v.messageId !== q.msg.id) continue
      const verdict = (v.verdict ?? 'SAFE').toUpperCase()
      const conf = parseConfidence(v.confidence)
      const reason = v.reason ?? ''
      if (verdict === 'SAFE' || conf < aiAutomodMinConfidence) continue
      await applyVerdictActions(q.msg, verdict, reason, conf)
    }
    return 'done'
  } catch (e) {
    console.error('[ai-automod] processVisionQueue error:', e)
    return 'done'
  } finally {
    pendingAiAutomodMessageIds.delete(q.msg.id)
  }
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
      (visionDrain === 'rate_limited' || visionCallsThisMinute >= aiAutomodVisionMaxPerMinute)
    const delay = textStuck || visionStuck ? RATE_LIMIT_RETRY_MS : 0
    setTimeout(() => void processQueue(), delay)
  }
}

export function enqueueAiAutomod(msg: Message, channelSnippet?: string): void {
  if (!aiAutomodEnabled) return
  if (msg.channel.type === ChannelType.DM) return
  if (msg.author.bot) return
  if (isModMessage(msg)) return
  if (isIgnoredChannelOrCategory(msg.channel)) return
  // Skip AI automod in ticket channels (all content allowed)
  if ('parentId' in msg.channel) {
    const parentId = (msg.channel as { parentId?: string | null }).parentId
    if (
      (TICKET_OPEN_CATEGORY_ID && parentId === TICKET_OPEN_CATEGORY_ID) ||
      (TICKET_CLOSED_CATEGORY_ID && parentId === TICKET_CLOSED_CATEGORY_ID)
    ) {
      return
    }
  }
  const c = msg.content?.trim() ?? ''
  if (c.length < 5 && msg.attachments.size === 0) return

  if (pendingAiAutomodMessageIds.has(msg.id)) return
  pendingAiAutomodMessageIds.add(msg.id)

  const img = pickFirstImageAttachment(msg.attachments)
  if (aiAutomodVisionEnabled && img) {
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
  if (!aiAutomodEscalationEnabled) {
    console.info(
      '[ai-automod] Strike escalation is off (no auto warn/kick/ban). Set AI_AUTOMOD_ESCALATION_ENABLED=1. Per-verdict actions only support log/delete/timeout; kick and ban use strike thresholds.',
    )
  } else {
    console.info(
      `[ai-automod] Escalation on: warn@${aiAutomodEscalationWarnAt} kick@${aiAutomodEscalationKickAt} ban@${aiAutomodEscalationBanAt} strikes (per qualifying flag)`,
    )
  }
  interval = setInterval(() => {
    void processQueue()
  }, aiAutomodBatchIntervalMs)
  interval.unref?.()
}
