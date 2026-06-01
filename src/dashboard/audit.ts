/**
 * Audit logging system for dashboard v2.
 * Immutable append-only log of all config changes, user actions, restarts, etc.
 * Used for compliance, debugging, and change history.
 */

import { randomBytes } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { writeFileAtomic } from '../services/data-store.ts'

export type AuditAction =
  | 'config_changed'
  | 'config_restored'
  | 'data_file_updated'
  | 'bot_restarted'
  | 'bot_paused'
  | 'bot_resumed'
  | 'user_created'
  | 'user_updated'
  | 'user_deleted'
  | 'user_role_changed'
  | 'login'
  | 'logout'
  | 'oauth_login'
  // Moderation
  | 'user_banned'
  | 'user_unbanned'
  | 'user_kicked'
  | 'mod_note_added'
  // Tickets
  | 'ticket_claimed'
  | 'ticket_closed'
  | 'ticket_replied'
  | 'ticket_priority'
  // Scheduling
  | 'schedule_created'
  | 'schedule_deleted'
  // Counters
  | 'counter_added'
  | 'counter_updated'
  | 'counter_deleted'
  // Giveaways
  | 'giveaway_created'
  | 'giveaway_ended'
  | 'giveaway_rerolled'
  // Economy / DB / misc admin
  | 'economy_config_changed'
  | 'db_row_updated'
  | 'db_row_deleted'
  | 'announcement_sent'
  | 'rag_rebuild_triggered'

export interface AuditEntry {
  id: string
  timestamp: number
  userId: string
  userEmail: string
  action: AuditAction
  resource: string // e.g., 'DISCORD_BOT_TOKEN', 'user:abc123', 'bot:restart'
  details: {
    oldValue?: string
    newValue?: string
    serverId?: string
    userRole?: string
    reason?: string
    [key: string]: unknown
  }
  ipAddress: string
  userAgent: string
}

const DATA_DIR = process.env.DATA_DIR || './data'
const AUDIT_FILE = join(DATA_DIR, 'audit-log.jsonl') // newline-delimited JSON
const MAX_AUDIT_FILE_SIZE = 100 * 1024 * 1024 // 100 MB, then rotate

// In-memory buffer to batch writes
let auditBuffer: AuditEntry[] = []
let auditBufferTime = 0
const BUFFER_FLUSH_INTERVAL = 5000 // flush every 5 seconds or on 100 entries
const BUFFER_MAX_SIZE = 100

/**
 * Log an audit entry
 */
export async function logAudit(
  userId: string,
  userEmail: string,
  action: AuditAction,
  resource: string,
  details: AuditEntry['details'] = {},
  ipAddress = 'unknown',
  userAgent = 'unknown',
): Promise<AuditEntry> {
  const entry: AuditEntry = {
    id: randomBytes(8).toString('hex'),
    timestamp: Date.now(),
    userId,
    userEmail,
    action,
    resource,
    details,
    ipAddress,
    userAgent,
  }

  // Add to buffer
  auditBuffer.push(entry)

  // Flush if buffer is full
  if (auditBuffer.length >= BUFFER_MAX_SIZE) {
    await flushAuditBuffer()
  }

  return entry
}

/**
 * Flush buffered audit entries to disk
 */
export async function flushAuditBuffer(): Promise<void> {
  if (auditBuffer.length === 0) return

  try {
    await mkdir(dirname(AUDIT_FILE), { recursive: true })

    // Append all entries as newline-delimited JSON
    const lines = auditBuffer.map((e) => JSON.stringify(e)).join('\n') + '\n'

    // Append to file (not atomic, but safe for newline-delimited format)
    const fs = await import('node:fs/promises')
    try {
      await fs.appendFile(AUDIT_FILE, lines, 'utf8')
    } catch (err) {
      // If append fails, try atomic write with existing content
      const existing = await readFile(AUDIT_FILE, 'utf8').catch(() => '')
      await writeFileAtomic(AUDIT_FILE, existing + lines)
    }

    auditBuffer = []
    auditBufferTime = Date.now()
  } catch (err) {
    console.error('[audit] failed to flush buffer:', err)
    // Keep in buffer to retry next time
  }
}

/**
 * Start automatic flush interval
 */
export function startAuditFlush(): void {
  setInterval(() => {
    void flushAuditBuffer()
  }, BUFFER_FLUSH_INTERVAL)
}

/**
 * Query audit log with filtering
 */
export async function queryAudit(filters: {
  fromTime?: number | undefined
  toTime?: number | undefined
  userId?: string | undefined
  action?: AuditAction | undefined
  resource?: string | undefined // partial match
  limit?: number | undefined
  offset?: number | undefined
}): Promise<AuditEntry[]> {
  const {
    fromTime = 0,
    toTime = Date.now(),
    userId,
    action,
    resource,
    limit = 100,
    offset = 0,
  } = filters

  try {
    await mkdir(dirname(AUDIT_FILE), { recursive: true })
    const content = await readFile(AUDIT_FILE, 'utf8').catch(() => '')
    const lines = content
      .trim()
      .split('\n')
      .filter((l) => l.length > 0)

    let entries = lines
      .map((line) => {
        try {
          return JSON.parse(line) as AuditEntry
        } catch {
          return null
        }
      })
      .filter((e): e is AuditEntry => e !== null)

    // Apply filters
    entries = entries.filter((e) => {
      if (e.timestamp < fromTime || e.timestamp > toTime) return false
      if (userId && e.userId !== userId) return false
      if (action && e.action !== action) return false
      if (resource && !e.resource.includes(resource)) return false
      return true
    })

    // Newest first
    entries.reverse()

    // Paginate
    const paginated = entries.slice(offset, offset + limit)

    return paginated
  } catch (err) {
    console.error('[audit] query failed:', err)
    return []
  }
}

/**
 * Get a single audit entry by ID
 */
export async function getAuditEntry(id: string): Promise<AuditEntry | null> {
  try {
    const content = await readFile(AUDIT_FILE, 'utf8').catch(() => '')
    const lines = content
      .trim()
      .split('\n')
      .filter((l) => l.length > 0)

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as AuditEntry
        if (entry.id === id) return entry
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
 * Export audit log to CSV
 */
export async function exportAuditAsCSV(filters: Parameters<typeof queryAudit>[0]): Promise<string> {
  const entries = await queryAudit(filters)

  // CSV headers
  const headers = [
    'Timestamp',
    'User Email',
    'Action',
    'Resource',
    'Old Value',
    'New Value',
    'IP Address',
  ]

  const rows = entries.map((e) => [
    new Date(e.timestamp).toISOString(),
    e.userEmail,
    e.action,
    e.resource,
    e.details.oldValue || '',
    e.details.newValue || '',
    e.ipAddress,
  ])

  // Escape CSV fields (quote if contains comma or quote)
  const escapedRows = rows.map((row) =>
    row
      .map((field) => {
        if (!field) return '""'
        if (field.includes(',') || field.includes('"') || field.includes('\n')) {
          return `"${field.replace(/"/g, '""')}"`
        }
        return field
      })
      .join(','),
  )

  return [headers.join(','), ...escapedRows].join('\n')
}

/**
 * Get audit statistics (for dashboard health check)
 */
export async function getAuditStats(): Promise<{
  totalEntries: number
  recentEntries: number // last 24 hours
  uniqueUsers: number
  topActions: Array<{ action: AuditAction; count: number }>
}> {
  const now = Date.now()
  const day = 24 * 60 * 60 * 1000

  const allEntries = await queryAudit({ limit: 100000 })
  const recentEntries = allEntries.filter((e) => e.timestamp > now - day)
  const uniqueUsers = new Set(allEntries.map((e) => e.userId)).size

  const actionCounts = new Map<AuditAction, number>()
  recentEntries.forEach((e) => {
    actionCounts.set(e.action, (actionCounts.get(e.action) || 0) + 1)
  })

  const topActions = Array.from(actionCounts.entries())
    .map(([action, count]) => ({ action, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)

  return {
    totalEntries: allEntries.length,
    recentEntries: recentEntries.length,
    uniqueUsers,
    topActions,
  }
}
