/**
 * Per-verdict AI AutoMod actions from env AI_AUTOMOD_ACTION_<VERDICT> and AI_AUTOMOD_TIMEOUT_MIN_<VERDICT>.
 * Tokens: none | log | delete | timeout (comma-separated). Example: log,delete,timeout
 *
 * Progressive **kick** / **ban** are not tokens here; they come from strike escalation:
 * AI_AUTOMOD_ESCALATION_ENABLED=1 plus AI_AUTOMOD_ESCALATION_WARN_AT / _KICK_AT / _BAN_AT.
 */

export type AiAutomodResolvedAction = {
  report: boolean
  deleteMessage: boolean
  timeoutMs: number
}

const MS_PER_MIN = 60_000

function parseTokens(s: string): {
  none: boolean
  log: boolean
  delete: boolean
  timeout: boolean
} {
  const parts = s
    .toLowerCase()
    .split(/[,\s]+/)
    .map((x) => x.trim())
    .filter(Boolean)
  return {
    none: parts.includes('none'),
    log: parts.includes('log') || parts.includes('report'),
    delete: parts.includes('delete'),
    timeout: parts.includes('timeout'),
  }
}

function timeoutMsForVerdict(verdict: string, fallbackMin: number): number {
  const key = `AI_AUTOMOD_TIMEOUT_MIN_${verdict.toUpperCase()}`
  const raw = process.env[key]?.trim()
  const n = raw ? parseInt(raw, 10) : NaN
  const min = Number.isFinite(n) && n >= 0 ? n : fallbackMin
  return min * MS_PER_MIN
}

/** Defaults match pre-plan behavior: severe = delete+10m timeout, soft = log only, self-harm = log only. */
const DEFAULTS: Record<string, { log: boolean; del: boolean; timeoutMin: number }> = {
  TOXICITY_LOW: { log: true, del: false, timeoutMin: 0 },
  TOXICITY_HIGH: { log: true, del: true, timeoutMin: 10 },
  SCAM: { log: true, del: true, timeoutMin: 10 },
  CRYPTO_SCAM: { log: true, del: true, timeoutMin: 10 },
  NSFW: { log: true, del: true, timeoutMin: 10 },
  EVASION: { log: true, del: true, timeoutMin: 10 },
  IMPERSONATION: { log: true, del: false, timeoutMin: 0 },
  HEATED: { log: true, del: false, timeoutMin: 0 },
  HATE: { log: true, del: true, timeoutMin: 10 },
  SELFHARM: { log: true, del: false, timeoutMin: 0 },
  DOXXING: { log: true, del: true, timeoutMin: 10 },
  SPAM_AD: { log: true, del: true, timeoutMin: 10 },
}

export function resolveAiAutomodAction(verdict: string): AiAutomodResolvedAction {
  const v = verdict.toUpperCase()
  const def = DEFAULTS[v] ?? { log: true, del: false, timeoutMin: 0 }
  const envKey = `AI_AUTOMOD_ACTION_${v}`
  const raw = process.env[envKey]?.trim()

  if (!raw) {
    return {
      report: def.log,
      deleteMessage: def.del,
      timeoutMs: def.timeoutMin > 0 ? def.timeoutMin * MS_PER_MIN : 0,
    }
  }

  const t = parseTokens(raw)
  if (t.none) {
    return { report: false, deleteMessage: false, timeoutMs: 0 }
  }

  const report = t.log || t.delete || t.timeout
  const deleteMessage = t.delete
  const wantTimeout = t.timeout
  const fallbackMin = DEFAULTS[v]?.timeoutMin ?? 10
  const timeoutMs = wantTimeout ? timeoutMsForVerdict(v, fallbackMin > 0 ? fallbackMin : 10) : 0

  return {
    report,
    deleteMessage,
    timeoutMs,
  }
}
