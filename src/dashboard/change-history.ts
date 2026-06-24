/**
 * Change history tracking for config snapshots and rollback capability.
 * Stores snapshots of the entire config state before and after changes.
 * Allows users to restore to a previous configuration point.
 */

import { randomBytes } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { writeFileAtomic } from '../services/data-store.ts'

export interface ConfigSnapshot {
  id: string
  timestamp: number
  userId: string
  userEmail: string
  action: 'manual_save' | 'auto_save' | 'api_change'
  changedKeys: string[] // which keys were modified in this change
  snapshot: Record<string, string> // full config state at this point
  diff: Array<{
    key: string
    oldValue: string | undefined
    newValue: string
  }>
  description?: string
}

const DATA_DIR = process.env.DATA_DIR || './data'
const HISTORY_FILE = join(DATA_DIR, 'config-history.jsonl') // newline-delimited JSON
const MAX_SNAPSHOTS = 1000 // keep last 1000 snapshots

/**
 * Record a configuration change
 */
export async function recordSnapshot(
  userId: string,
  userEmail: string,
  action: ConfigSnapshot['action'],
  currentConfig: Record<string, string>,
  changedKeys: string[],
  previousSnapshot?: Record<string, string>,
): Promise<ConfigSnapshot> {
  // Build diff
  const diff = changedKeys.map((key) => ({
    key,
    oldValue: previousSnapshot?.[key],
    newValue: currentConfig[key] ?? '',
  }))

  const snapshot: ConfigSnapshot = {
    id: randomBytes(8).toString('hex'),
    timestamp: Date.now(),
    userId,
    userEmail,
    action,
    changedKeys,
    snapshot: { ...currentConfig },
    diff,
  }

  // Append to history file
  try {
    await mkdir(dirname(HISTORY_FILE), { recursive: true })
    const fs = await import('node:fs/promises')
    const line = JSON.stringify(snapshot) + '\n'
    await fs.appendFile(HISTORY_FILE, line, 'utf8').catch(async (err) => {
      // If append fails, try atomic write
      const existing = await readFile(HISTORY_FILE, 'utf8').catch(() => '')
      await writeFileAtomic(HISTORY_FILE, existing + line)
    })
  } catch (err) {
    console.error('[change-history] failed to record snapshot:', err)
  }

  return snapshot
}

/**
 * Get recent snapshots (for timeline UI)
 */
export async function getRecentSnapshots(limit = 50): Promise<ConfigSnapshot[]> {
  try {
    await mkdir(dirname(HISTORY_FILE), { recursive: true })
    const content = await readFile(HISTORY_FILE, 'utf8').catch(() => '')
    const lines = content
      .trim()
      .split('\n')
      .filter((l) => l.length > 0)

    const snapshots = lines
      .map((line) => {
        try {
          return JSON.parse(line) as ConfigSnapshot
        } catch {
          return null
        }
      })
      .filter((s): s is ConfigSnapshot => s !== null)

    // Newest first
    return snapshots.reverse().slice(0, limit)
  } catch (err) {
    console.error('[change-history] failed to load snapshots:', err)
    return []
  }
}

/**
 * Get snapshot by ID
 */
export async function getSnapshot(id: string): Promise<ConfigSnapshot | null> {
  try {
    const content = await readFile(HISTORY_FILE, 'utf8').catch(() => '')
    const lines = content
      .trim()
      .split('\n')
      .filter((l) => l.length > 0)

    for (const line of lines) {
      try {
        const snapshot = JSON.parse(line) as ConfigSnapshot
        if (snapshot.id === id) return snapshot
      } catch {
        // skip malformed lines
      }
    }

    return null
  } catch {
    return null
  }
}

/**
 * Get snapshots within a time range
 */
export async function getSnapshotsInRange(
  fromTime: number,
  toTime: number,
  limit = 100,
): Promise<ConfigSnapshot[]> {
  try {
    const content = await readFile(HISTORY_FILE, 'utf8').catch(() => '')
    const lines = content
      .trim()
      .split('\n')
      .filter((l) => l.length > 0)

    const snapshots = lines
      .map((line) => {
        try {
          return JSON.parse(line) as ConfigSnapshot
        } catch {
          return null
        }
      })
      .filter((s): s is ConfigSnapshot => s !== null)
      .filter((s) => s.timestamp >= fromTime && s.timestamp <= toTime)

    // Newest first
    return snapshots.reverse().slice(0, limit)
  } catch {
    return []
  }
}

/**
 * Restore config to a previous snapshot point
 * Returns the config state to restore, doesn't apply it
 */
export async function getSnapshotConfig(id: string): Promise<Record<string, string> | null> {
  const snapshot = await getSnapshot(id)
  return snapshot ? snapshot.snapshot : null
}

/**
 * Compare two config states
 */
export interface ConfigDiff {
  added: Record<string, string>
  removed: string[]
  modified: Array<{ key: string; oldValue: string; newValue: string }>
}

export function compareConfigs(
  oldConfig: Record<string, string>,
  newConfig: Record<string, string>,
): ConfigDiff {
  const added: Record<string, string> = {}
  const removed: string[] = []
  const modified: ConfigDiff['modified'] = []

  const allKeys = new Set([...Object.keys(oldConfig), ...Object.keys(newConfig)])

  for (const key of allKeys) {
    const oldVal = oldConfig[key]
    const newVal = newConfig[key]

    if (oldVal === undefined && newVal !== undefined) {
      added[key] = newVal
    } else if (oldVal !== undefined && newVal === undefined) {
      removed.push(key)
    } else if (oldVal !== newVal) {
      modified.push({ key, oldValue: oldVal!, newValue: newVal! })
    }
  }

  return { added, removed, modified }
}

/**
 * Clean up old snapshots (keep only last N)
 */
export async function cleanupOldSnapshots(maxSnapshots = MAX_SNAPSHOTS): Promise<void> {
  try {
    const content = await readFile(HISTORY_FILE, 'utf8').catch(() => '')
    const lines = content
      .trim()
      .split('\n')
      .filter((l) => l.length > 0)

    if (lines.length <= maxSnapshots) return

    // Keep only the last N snapshots
    const kept = lines.slice(-maxSnapshots).join('\n') + '\n'
    await writeFileAtomic(HISTORY_FILE, kept)
  } catch (err) {
    console.error('[change-history] cleanup failed:', err)
  }
}

/**
 * Periodically clean up old snapshots
 */
export function startCleanupTask(): void {
  // Run daily
  setInterval(
    () => {
      void cleanupOldSnapshots()
    },
    24 * 60 * 60 * 1000,
  )
}

/**
 * Get a summary of changes for a specific user
 */
export async function getUserChanges(
  userId: string,
  limit = 50,
): Promise<Array<{ timestamp: number; action: string; changedKeys: string[] }>> {
  try {
    const snapshots = await getRecentSnapshots(limit * 2)
    return snapshots
      .filter((s) => s.userId === userId)
      .slice(0, limit)
      .map((s) => ({
        timestamp: s.timestamp,
        action: s.action,
        changedKeys: s.changedKeys,
      }))
  } catch {
    return []
  }
}

/**
 * Get change statistics
 */
export async function getChangeStats(): Promise<{
  totalSnapshots: number
  snapshotsByAction: Record<string, number>
  topModifiedKeys: Array<{ key: string; modCount: number }>
}> {
  try {
    const content = await readFile(HISTORY_FILE, 'utf8').catch(() => '')
    const lines = content
      .trim()
      .split('\n')
      .filter((l) => l.length > 0)

    const snapshots = lines
      .map((line) => {
        try {
          return JSON.parse(line) as ConfigSnapshot
        } catch {
          return null
        }
      })
      .filter((s): s is ConfigSnapshot => s !== null)

    const snapshotsByAction: Record<string, number> = {}
    const keyModCounts = new Map<string, number>()

    snapshots.forEach((s) => {
      snapshotsByAction[s.action] = (snapshotsByAction[s.action] || 0) + 1
      s.changedKeys.forEach((key) => {
        keyModCounts.set(key, (keyModCounts.get(key) || 0) + 1)
      })
    })

    const topModifiedKeys = Array.from(keyModCounts.entries())
      .map(([key, modCount]) => ({ key, modCount }))
      .sort((a, b) => b.modCount - a.modCount)
      .slice(0, 10)

    return {
      totalSnapshots: snapshots.length,
      snapshotsByAction,
      topModifiedKeys,
    }
  } catch {
    return {
      totalSnapshots: 0,
      snapshotsByAction: {},
      topModifiedKeys: [],
    }
  }
}
