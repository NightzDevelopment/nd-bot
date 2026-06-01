/**
 * Tiny runtime-state singleton, exposed to the dashboard `/api/health` and
 * `/api/config` so the operator can see Discord/PM2/override status without
 * tailing logs.
 *
 * Anything that wants to surface a state change calls one of the setters; the
 * dashboard reads via the getters. Module-local so tests can reset by
 * re-importing.
 */
export type DiscordStatus = 'starting' | 'connecting' | 'ready' | 'login_failed' | 'disconnected'

let discordStatus: DiscordStatus = 'starting'
let discordError: string | null = null
let discordTag: string | null = null
let discordReadyAt: number | null = null
/** Guild count when connected; refreshed from ClientReady / interval */
let discordGuildCount = 0
/** Last observed gateway ping (ms) from WebSocketShard, or null if unknown */
let discordWsPingMs: number | null = null

const startedAt = Date.now()

export function setDiscordStatus(s: DiscordStatus, err?: unknown): void {
  discordStatus = s
  if (err !== undefined && err !== null) {
    discordError = String((err as Error)?.message ?? err).slice(0, 240)
  } else if (s !== 'login_failed' && s !== 'disconnected') {
    discordError = null
  }
}

export function setDiscordReady(tag: string): void {
  discordStatus = 'ready'
  discordError = null
  discordTag = tag
  discordReadyAt = Date.now()
}

/** Called from bot ready + periodic tick for dashboard `/api/health`. */
export function setDiscordPresenceStats(patch: {
  guildCount?: number
  wsPingMs?: number | null
}): void {
  if (patch.guildCount !== undefined) discordGuildCount = patch.guildCount
  if ('wsPingMs' in patch) discordWsPingMs = patch.wsPingMs ?? null
}

export function getDiscordStatus(): {
  status: DiscordStatus
  error: string | null
  tag: string | null
  readyAt: number | null
  guildCount: number
  wsPingMs: number | null
} {
  return {
    status: discordStatus,
    error: discordError,
    tag: discordTag,
    readyAt: discordReadyAt,
    guildCount: discordGuildCount,
    wsPingMs: discordWsPingMs,
  }
}

export function getStartedAt(): number {
  return startedAt
}

// ── Bot pause / Discord client registry ──────────────────────────────────────
let botPaused = false
let pausedAt: number | null = null
let pausedBy: string | null = null

export function pauseBot(by: string = 'dashboard'): void {
  botPaused = true
  pausedAt = Date.now()
  pausedBy = by
}

export function resumeBot(): void {
  botPaused = false
  pausedAt = null
  pausedBy = null
}

export function isBotPaused(): boolean {
  return botPaused
}

export function getBotLifecycleState(): {
  paused: boolean
  pausedAt: number | null
  pausedBy: string | null
} {
  return { paused: botPaused, pausedAt, pausedBy }
}

// Discord.js Client kept here so the dashboard server can act on it
// (post messages, modify channels) without circular imports through bot.ts.
let discordClient: unknown = null
export function setDiscordClient(c: unknown): void {
  discordClient = c
}
export function getDiscordClient<T = unknown>(): T | null {
  return (discordClient as T) ?? null
}
