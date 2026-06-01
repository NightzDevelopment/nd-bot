/**
 * Reputation System
 * Award reputation points for helpful contributions and community engagement
 */

import { readJson, writeJson } from './data-store.ts'

export interface ReputationRecord {
  points: number
  history: Array<{
    at: number // timestamp
    from: string // userId who gave rep
    reason: string
  }>
}

export type ReputationStore = Record<string, ReputationRecord>

const FILE = 'reputation.json'
const DEFAULT_STORE: ReputationStore = {}

async function load(): Promise<ReputationStore> {
  return readJson<ReputationStore>(FILE, DEFAULT_STORE)
}

async function save(store: ReputationStore): Promise<void> {
  await writeJson(FILE, store)
}

/**
 * Award reputation points to a user
 */
export async function awardReputation(
  userId: string,
  points: number,
  fromUserId: string,
  reason: string,
): Promise<ReputationRecord> {
  const store = await load()
  if (!store[userId]) {
    store[userId] = { points: 0, history: [] }
  }
  store[userId].points += Math.max(0, points)
  store[userId].history.push({
    at: Date.now(),
    from: fromUserId,
    reason,
  })
  await save(store)
  return store[userId]
}

/**
 * Get a user's reputation record
 */
export async function getReputation(userId: string): Promise<ReputationRecord | null> {
  const store = await load()
  return store[userId] ?? null
}

/**
 * Get top users by reputation
 */
export async function getTopByReputation(
  limit: number = 10,
): Promise<Array<{ userId: string; points: number }>> {
  const store = await load()
  return Object.entries(store)
    .map(([userId, record]) => ({ userId, points: record.points }))
    .sort((a, b) => b.points - a.points)
    .slice(0, limit)
}

/**
 * Get all reputation records
 */
export async function getAllReputation(): Promise<ReputationStore> {
  return load()
}

/**
 * Check if user has reputation
 */
export async function hasReputation(userId: string): Promise<boolean> {
  const rep = await getReputation(userId)
  return rep !== null && rep.points > 0
}
