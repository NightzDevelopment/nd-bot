/**
 * Local blacklist of known bad actors (scammers, leakers, raiders, alts).
 *
 * Persisted to data/blacklist.json and mirrored in an in-memory index for O(1)
 * lookups on the member-join hot path. Local to this server: entries are added
 * by staff or by an approved user report, and removed by staff or an approved
 * ban appeal.
 */
import { readJson, writeJson } from './data-store.ts'

export type BlacklistCategory = 'scammer' | 'leaker' | 'raider' | 'alt' | 'other'
export const BLACKLIST_CATEGORIES: readonly BlacklistCategory[] = [
  'scammer',
  'leaker',
  'raider',
  'alt',
  'other',
]

export interface BlacklistEntry {
  userId: string
  category: BlacklistCategory
  reason: string
  addedBy: string
  addedByTag: string
  addedAt: number
}

const FILE = 'blacklist.json'
let entries: BlacklistEntry[] | null = null
let index: Map<string, BlacklistEntry> | null = null

async function ensureLoaded(): Promise<void> {
  if (entries && index) return
  entries = await readJson<BlacklistEntry[]>(FILE, [])
  index = new Map(entries.map((e) => [e.userId, e]))
}

/** Warm the cache at startup so join screening is instant. */
export async function initBlacklist(): Promise<void> {
  await ensureLoaded()
}

export function normalizeCategory(s: string): BlacklistCategory {
  const c = s.trim().toLowerCase()
  return (BLACKLIST_CATEGORIES as readonly string[]).includes(c) ? (c as BlacklistCategory) : 'other'
}

export async function checkBlacklist(userId: string): Promise<BlacklistEntry | null> {
  await ensureLoaded()
  return index?.get(userId) ?? null
}

export async function addToBlacklist(entry: BlacklistEntry): Promise<boolean> {
  await ensureLoaded()
  if (index?.has(entry.userId)) return false
  entries?.push(entry)
  index?.set(entry.userId, entry)
  await writeJson(FILE, entries ?? [])
  return true
}

export async function removeFromBlacklist(userId: string): Promise<boolean> {
  await ensureLoaded()
  if (!index?.has(userId)) return false
  entries = (entries ?? []).filter((e) => e.userId !== userId)
  index?.delete(userId)
  await writeJson(FILE, entries)
  return true
}

export async function listBlacklist(): Promise<BlacklistEntry[]> {
  await ensureLoaded()
  return [...(entries ?? [])]
}
