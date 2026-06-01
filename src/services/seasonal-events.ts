/**
 * Seasonal events: a time-boxed XP/currency multiplier (e.g. "Double XP
 * Weekend"). The active event is cached in memory so the hot XP/earn paths can
 * read multipliers synchronously.
 */
import { readJson, writeJson } from './data-store.ts'

const FILE = 'seasonal-event.json'

export type SeasonalEvent = {
  name: string
  startsAt: number
  endsAt: number
  xpMultiplier: number
  currencyMultiplier: number
}

let current: SeasonalEvent | null = null
let loaded = false

export async function initSeasonalEvents(): Promise<void> {
  const data = await readJson<{ event: SeasonalEvent | null }>(FILE, { event: null })
  current = data.event ?? null
  loaded = true
}

/** Currently-active event (within its window), or null. */
export function getActiveSeasonalEvent(): SeasonalEvent | null {
  if (!loaded || !current) return null
  const now = Date.now()
  if (now < current.startsAt || now > current.endsAt) return null
  return current
}

/** Sync multipliers for the hot path. 1x when no event is active. */
export function currentSeasonalMultipliers(): { xp: number; currency: number } {
  const ev = getActiveSeasonalEvent()
  return { xp: ev?.xpMultiplier ?? 1, currency: ev?.currencyMultiplier ?? 1 }
}

export async function setSeasonalEvent(ev: SeasonalEvent | null): Promise<void> {
  current = ev
  loaded = true
  await writeJson(FILE, { event: ev })
}
