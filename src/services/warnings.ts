/**
 * Warning Tracking System
 * Track user warnings with escalation logic
 */

import { broadcastActivity } from '../dashboard/websocket.ts'
import { readJson, writeJson } from './data-store.ts'

export interface Warning {
  at: number // timestamp
  moderatorId: string
  reason: string
  caseId?: string // link to mod case if exists
}

export interface UserWarnings {
  userId: string
  count: number
  warnings: Warning[]
  lastWarningAt?: number
}

export type WarningStore = Record<string, UserWarnings>

const FILE = 'warnings.json'
const DEFAULT_STORE: WarningStore = {}

async function load(): Promise<WarningStore> {
  return readJson<WarningStore>(FILE, DEFAULT_STORE)
}

async function save(store: WarningStore): Promise<void> {
  await writeJson(FILE, store)
}

/**
 * Escalation thresholds
 */
export const ESCALATION_THRESHOLDS = {
  WARN_THRESHOLD: 3, // 3 warnings = kick
  KICK_THRESHOLD: 5, // 5 warnings = ban
  BAN_THRESHOLD: 7, // 7+ warnings = permanent ban
}

/**
 * Add a warning to a user
 */
export async function addWarning(
  userId: string,
  moderatorId: string,
  reason: string,
  caseId?: string,
): Promise<{ record: UserWarnings; escalateAction?: 'kick' | 'ban' }> {
  const store = await load()
  if (!store[userId]) {
    store[userId] = {
      userId,
      count: 0,
      warnings: [],
    }
  }

  store[userId].warnings.push({
    at: Date.now(),
    moderatorId,
    reason,
    caseId,
  })
  store[userId].count += 1
  store[userId].lastWarningAt = Date.now()

  let escalateAction: 'kick' | 'ban' | undefined
  if (store[userId].count >= ESCALATION_THRESHOLDS.BAN_THRESHOLD) {
    escalateAction = 'ban'
  } else if (store[userId].count >= ESCALATION_THRESHOLDS.KICK_THRESHOLD) {
    escalateAction = 'kick'
  }

  await save(store)
  broadcastActivity('warning_issued', {
    userId,
    moderatorId,
    reason: reason.slice(0, 120),
    count: store[userId].count,
    escalateAction: escalateAction ?? null,
  })
  return { record: store[userId], escalateAction }
}

/**
 * Get a user's warnings
 */
export async function getWarnings(userId: string): Promise<UserWarnings | null> {
  const store = await load()
  return store[userId] ?? null
}

/**
 * Get all warnings for a user (with details)
 */
export async function getAllUserWarnings(userId: string): Promise<Warning[]> {
  const record = await getWarnings(userId)
  return record?.warnings ?? []
}

/**
 * Get warning count for escalation check
 */
export async function getWarningCount(userId: string): Promise<number> {
  const record = await getWarnings(userId)
  return record?.count ?? 0
}

/**
 * Check escalation action needed
 */
export async function checkEscalationAction(userId: string): Promise<'kick' | 'ban' | null> {
  const count = await getWarningCount(userId)
  if (count >= ESCALATION_THRESHOLDS.BAN_THRESHOLD) return 'ban'
  if (count >= ESCALATION_THRESHOLDS.KICK_THRESHOLD) return 'kick'
  return null
}

/**
 * Clear all warnings for a user (admin only)
 */
export async function clearWarnings(userId: string): Promise<boolean> {
  const store = await load()
  if (store[userId]) {
    delete store[userId]
    await save(store)
    return true
  }
  return false
}

/**
 * Reduce warning count (for appeals, pardon, etc.)
 */
export async function reduceWarnings(
  userId: string,
  amount: number = 1,
): Promise<UserWarnings | null> {
  const store = await load()
  if (!store[userId]) return null

  store[userId].count = Math.max(0, store[userId].count - amount)
  await save(store)
  return store[userId]
}

/**
 * Get recent warnings (for dashboard/review)
 */
export async function getRecentWarnings(limit: number = 50): Promise<
  Array<{
    userId: string
    count: number
    lastWarningAt?: number
    latestReason?: string
  }>
> {
  const store = await load()
  // Filter to records in the new schema only (the file may also contain
  // legacy `guildId:userId` array entries from services/moderation.ts).
  return Object.values(store)
    .filter(
      (r): r is UserWarnings =>
        r != null &&
        typeof r === 'object' &&
        !Array.isArray(r) &&
        typeof (r as any).userId === 'string' &&
        Array.isArray((r as any).warnings),
    )
    .sort((a, b) => (b.lastWarningAt ?? 0) - (a.lastWarningAt ?? 0))
    .slice(0, limit)
    .map((record) => ({
      userId: record.userId,
      count: record.count,
      lastWarningAt: record.lastWarningAt,
      latestReason: record.warnings[record.warnings.length - 1]?.reason,
    }))
}

/**
 * Get users needing moderation attention
 */
export async function getUsersNeedingAttention(): Promise<
  Array<{
    userId: string
    count: number
    action: 'watch' | 'warn' | 'kick' | 'ban'
    lastWarningAt?: number
  }>
> {
  const store = await load()
  return Object.values(store)
    .filter(
      (r): r is UserWarnings =>
        r != null &&
        typeof r === 'object' &&
        !Array.isArray(r) &&
        typeof (r as any).userId === 'string' &&
        typeof (r as any).count === 'number' &&
        (r as any).count > 0,
    )
    .map((record) => {
      let action: 'watch' | 'warn' | 'kick' | 'ban' = 'watch'
      if (record.count >= ESCALATION_THRESHOLDS.BAN_THRESHOLD) {
        action = 'ban'
      } else if (record.count >= ESCALATION_THRESHOLDS.KICK_THRESHOLD) {
        action = 'kick'
      } else if (record.count >= ESCALATION_THRESHOLDS.WARN_THRESHOLD) {
        action = 'warn'
      }
      return {
        userId: record.userId,
        count: record.count,
        action,
        lastWarningAt: record.lastWarningAt,
      }
    })
    .sort((a, b) => b.count - a.count)
}

/**
 * Get formatted warning summary for display
 */
export async function getWarningsSummary(userId: string): Promise<string> {
  const record = await getWarnings(userId)
  if (!record || record.count === 0) {
    return 'No warnings'
  }

  const lines: string[] = [`**${record.count} warning(s)**`]
  for (let i = 0; i < Math.min(3, record.warnings.length); i++) {
    const warning = record.warnings[record.warnings.length - 1 - i]
    const date = new Date(warning.at).toLocaleDateString()
    lines.push(`• ${warning.reason} (${date})`)
  }

  if (record.warnings.length > 3) {
    lines.push(`• ... and ${record.warnings.length - 3} more`)
  }

  return lines.join('\n')
}
