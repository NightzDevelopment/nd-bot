/**
 * Daily XP snapshots so we can compute weekly/monthly leaderboards (deltas).
 * All-time boards use live data; windowed boards subtract the snapshot from
 * ~N days ago. History only goes back as far as snapshots exist, so windowed
 * boards become accurate after the bot has run for a week or two.
 */
import type { Client } from 'discord.js'
import { childLogger } from '../lib/logger.ts'
import { readJson, writeJson } from './data-store.ts'
import { getDb } from './nd-db.ts'

const log = childLogger('lb-snapshots')

const FILE = 'leaderboard-snapshots.json'
const MAX_DAYS = 40

// date -> guildId -> userId -> xp
type Store = { snapshots: Record<string, Record<string, Record<string, number>>>; lastDate?: string }
let cache: Store | null = null

async function load(): Promise<Store> {
  if (cache) return cache
  const data = await readJson<Store>(FILE, { snapshots: {} })
  if (!data.snapshots) data.snapshots = {}
  cache = data
  return data
}

async function save(data: Store): Promise<void> {
  cache = data
  await writeJson(FILE, data)
}

function dateKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10) // YYYY-MM-DD (UTC)
}

async function recordSnapshot(): Promise<void> {
  const db = getDb()
  const rows = db.prepare('SELECT guildId, userId, xp FROM users_levels').all() as {
    guildId: string
    userId: string
    xp: number
  }[]
  const today = dateKey(Date.now())
  const data = await load()
  const byGuild: Record<string, Record<string, number>> = {}
  for (const r of rows) {
    ;(byGuild[r.guildId] ??= {})[r.userId] = r.xp
  }
  data.snapshots[today] = byGuild
  data.lastDate = today

  // Trim to the most recent MAX_DAYS snapshots.
  const dates = Object.keys(data.snapshots).sort()
  while (dates.length > MAX_DAYS) {
    const oldest = dates.shift()
    if (oldest) delete data.snapshots[oldest]
  }
  await save(data)
  log.info({ date: today, guilds: Object.keys(byGuild).length }, 'xp snapshot recorded')
}

export function startLeaderboardSnapshotLoop(_client: Client): void {
  const tick = async (): Promise<void> => {
    try {
      const data = await load()
      const today = dateKey(Date.now())
      if (data.lastDate !== today) await recordSnapshot()
    } catch (e) {
      log.warn({ err: e }, 'snapshot tick failed')
    }
  }
  // Check a few times a day; records at most once per UTC day.
  setInterval(() => void tick(), 6 * 60 * 60 * 1000).unref()
  void tick()
}

/**
 * XP gained in the last `windowDays`, per user, for a guild. Falls back to the
 * oldest available snapshot if not enough history exists yet.
 */
export async function getXpWindowLeaderboard(
  guildId: string,
  windowDays: number,
  limit = 10,
): Promise<{ userId: string; gained: number }[]> {
  const data = await load()
  const dates = Object.keys(data.snapshots).sort() // ascending
  if (dates.length === 0) return []

  const targetKey = dateKey(Date.now() - windowDays * 24 * 60 * 60 * 1000)
  // Latest snapshot at or before the target date; else the oldest we have.
  let baseDate = dates[0]!
  for (const d of dates) {
    if (d <= targetKey) baseDate = d
    else break
  }
  const baseline = data.snapshots[baseDate]?.[guildId] ?? {}

  const db = getDb()
  const rows = db
    .prepare('SELECT userId, xp FROM users_levels WHERE guildId = ?')
    .all(guildId) as { userId: string; xp: number }[]

  const result = rows
    .map((r) => ({ userId: r.userId, gained: r.xp - (baseline[r.userId] ?? 0) }))
    .filter((r) => r.gained > 0)
    .sort((a, b) => b.gained - a.gained)
    .slice(0, limit)
  return result
}
