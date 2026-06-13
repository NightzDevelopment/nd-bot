/**
 * Discord Audit Log fetcher: wraps guild.fetchAuditLogs() with action-type filtering,
 * normalised output, suspicious-activity detection, and a simple in-memory cache.
 */
import { AuditLogEvent, type Client, type Guild } from 'discord.js'

// ─── Types ─────────────────────────────────────────────────────────────────

export interface AuditEntry {
  id: string
  action: string
  actionCode: number
  category: string
  executor: { id: string; tag: string } | null
  target: { id: string; tag: string } | null
  reason: string | null
  createdAt: number
  changes: { key: string; old: string | null; new: string | null }[]
  extra: string | null
}

export interface AuditAlert {
  type:
    | 'mass_ban'
    | 'mass_kick'
    | 'mass_role_change'
    | 'bulk_delete'
    | 'permission_change'
    | 'mass_channel_delete'
  severity: 'high' | 'medium'
  message: string
  count: number
  windowMs: number
  executor: { id: string; tag: string } | null
  detectedAt: number
}

// ─── Action-type mapping ────────────────────────────────────────────────────

const ACTION_LABELS: Record<number, { label: string; category: string }> = {
  [AuditLogEvent.GuildUpdate]: { label: 'Server Updated', category: 'Server' },
  [AuditLogEvent.ChannelCreate]: { label: 'Channel Created', category: 'Channels' },
  [AuditLogEvent.ChannelUpdate]: { label: 'Channel Updated', category: 'Channels' },
  [AuditLogEvent.ChannelDelete]: { label: 'Channel Deleted', category: 'Channels' },
  [AuditLogEvent.ChannelOverwriteCreate]: {
    label: 'Permission Override Added',
    category: 'Permissions',
  },
  [AuditLogEvent.ChannelOverwriteUpdate]: {
    label: 'Permission Override Changed',
    category: 'Permissions',
  },
  [AuditLogEvent.ChannelOverwriteDelete]: {
    label: 'Permission Override Removed',
    category: 'Permissions',
  },
  [AuditLogEvent.MemberKick]: { label: 'Member Kicked', category: 'Moderation' },
  [AuditLogEvent.MemberPrune]: { label: 'Members Pruned', category: 'Moderation' },
  [AuditLogEvent.MemberBanAdd]: { label: 'Member Banned', category: 'Moderation' },
  [AuditLogEvent.MemberBanRemove]: { label: 'Member Unbanned', category: 'Moderation' },
  [AuditLogEvent.MemberUpdate]: { label: 'Member Updated', category: 'Members' },
  [AuditLogEvent.MemberRoleUpdate]: { label: 'Member Roles Changed', category: 'Members' },
  [AuditLogEvent.MemberMove]: { label: 'Member Moved (Voice)', category: 'Members' },
  [AuditLogEvent.MemberDisconnect]: { label: 'Member Disconnected (Voice)', category: 'Members' },
  [AuditLogEvent.BotAdd]: { label: 'Bot Added', category: 'Server' },
  [AuditLogEvent.RoleCreate]: { label: 'Role Created', category: 'Roles' },
  [AuditLogEvent.RoleUpdate]: { label: 'Role Updated', category: 'Roles' },
  [AuditLogEvent.RoleDelete]: { label: 'Role Deleted', category: 'Roles' },
  [AuditLogEvent.InviteCreate]: { label: 'Invite Created', category: 'Invites' },
  [AuditLogEvent.InviteUpdate]: { label: 'Invite Updated', category: 'Invites' },
  [AuditLogEvent.InviteDelete]: { label: 'Invite Deleted', category: 'Invites' },
  [AuditLogEvent.WebhookCreate]: { label: 'Webhook Created', category: 'Server' },
  [AuditLogEvent.WebhookUpdate]: { label: 'Webhook Updated', category: 'Server' },
  [AuditLogEvent.WebhookDelete]: { label: 'Webhook Deleted', category: 'Server' },
  [AuditLogEvent.EmojiCreate]: { label: 'Emoji Created', category: 'Server' },
  [AuditLogEvent.EmojiUpdate]: { label: 'Emoji Updated', category: 'Server' },
  [AuditLogEvent.EmojiDelete]: { label: 'Emoji Deleted', category: 'Server' },
  [AuditLogEvent.MessageDelete]: { label: 'Messages Deleted', category: 'Messages' },
  [AuditLogEvent.MessageBulkDelete]: { label: 'Bulk Messages Deleted', category: 'Messages' },
  [AuditLogEvent.MessagePin]: { label: 'Message Pinned', category: 'Messages' },
  [AuditLogEvent.MessageUnpin]: { label: 'Message Unpinned', category: 'Messages' },
  [AuditLogEvent.AutoModerationBlockMessage]: { label: 'AutoMod Blocked', category: 'AutoMod' },
  [AuditLogEvent.AutoModerationFlagToChannel]: { label: 'AutoMod Flagged', category: 'AutoMod' },
  [AuditLogEvent.AutoModerationUserCommunicationDisabled]: {
    label: 'AutoMod Timed Out',
    category: 'AutoMod',
  },
}

function normalise(entry: any): AuditEntry {
  const code = entry.action as number
  const info = ACTION_LABELS[code] ?? { label: `Action ${code}`, category: 'Other' }

  const changes = (entry.changes ?? []).map((c: any) => ({
    key: c.key ?? '',
    old: c.old != null ? String(c.old) : null,
    new: c.new != null ? String(c.new) : null,
  }))

  let extra: string | null = null
  if (entry.extra) {
    if ('count' in entry.extra) extra = `Count: ${entry.extra.count}`
    else if ('channel' in entry.extra)
      extra = `Channel: #${(entry.extra.channel as any)?.name ?? '?'}`
    else if ('roleName' in entry.extra) extra = `Role: ${entry.extra.roleName}`
    else extra = JSON.stringify(entry.extra)
  }

  return {
    id: entry.id,
    action: info.label,
    actionCode: code,
    category: info.category,
    executor: entry.executor
      ? {
          id: entry.executor.id,
          tag: entry.executor.tag ?? entry.executor.username ?? entry.executor.id,
        }
      : null,
    target: entry.target
      ? {
          id: (entry.target as any).id ?? '?',
          tag:
            (entry.target as any).tag ??
            (entry.target as any).username ??
            (entry.target as any).name ??
            '?',
        }
      : null,
    reason: entry.reason ?? null,
    createdAt: entry.createdTimestamp,
    changes,
    extra,
  }
}

// ─── Cache ──────────────────────────────────────────────────────────────────

interface CacheSlot {
  entries: AuditEntry[]
  fetchedAt: number
}
const _cache = new Map<string, CacheSlot>()
const CACHE_TTL_MS = 15_000

// ─── Fetch ──────────────────────────────────────────────────────────────────

export async function fetchDiscordAuditLogs(
  client: Client,
  opts: {
    guildId?: string | undefined
    limit?: number | undefined
    actionCode?: number | undefined
    userId?: string | undefined
    before?: string | undefined
    bust?: boolean | undefined
  } = {},
): Promise<AuditEntry[]> {
  const { limit = 50, actionCode, userId, before, bust = false } = opts

  // Use the first available guild if guildId not specified
  const guild: Guild | null = opts.guildId
    ? (client.guilds.cache.get(opts.guildId) ?? null)
    : (client.guilds.cache.first() ?? null)
  if (!guild) return []

  const cacheKey = `${guild.id}:${actionCode ?? 'all'}:${userId ?? 'all'}:${before ?? ''}`
  if (!bust) {
    const cached = _cache.get(cacheKey)
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.entries
  }

  try {
    const fetchOpts: Record<string, any> = { limit: Math.min(limit, 100) }
    if (actionCode != null) fetchOpts.type = actionCode
    if (userId) fetchOpts.user = userId
    if (before) fetchOpts.before = before

    const logs = await guild.fetchAuditLogs(fetchOpts)
    const entries = [...logs.entries.values()].map(normalise)
    _cache.set(cacheKey, { entries, fetchedAt: Date.now() })
    return entries
  } catch (e) {
    console.warn('[discord-audit] fetchAuditLogs failed:', e)
    return []
  }
}

// ─── Filtered views ─────────────────────────────────────────────────────────

const MOD_ACTION_CODES = new Set([
  AuditLogEvent.MemberKick,
  AuditLogEvent.MemberBanAdd,
  AuditLogEvent.MemberBanRemove,
  AuditLogEvent.MemberUpdate,
  AuditLogEvent.MemberRoleUpdate,
  AuditLogEvent.MessageDelete,
  AuditLogEvent.MessageBulkDelete,
  AuditLogEvent.ChannelOverwriteCreate,
  AuditLogEvent.ChannelOverwriteUpdate,
  AuditLogEvent.ChannelOverwriteDelete,
  AuditLogEvent.AutoModerationBlockMessage,
  AuditLogEvent.AutoModerationFlagToChannel,
  AuditLogEvent.AutoModerationUserCommunicationDisabled,
])

export async function fetchModActions(
  client: Client,
  limit = 50,
  guildId?: string,
): Promise<AuditEntry[]> {
  const all = await fetchDiscordAuditLogs(client, { limit: 100, guildId })
  return all.filter((e) => MOD_ACTION_CODES.has(e.actionCode)).slice(0, limit)
}

// ─── Alert detection ─────────────────────────────────────────────────────────

const ALERT_WINDOW_MS = 10 * 60 * 1000 // 10 minutes

export async function detectAlerts(client: Client, guildId?: string): Promise<AuditAlert[]> {
  const entries = await fetchDiscordAuditLogs(client, { limit: 100, guildId, bust: true })
  const now = Date.now()
  const recent = entries.filter((e) => now - e.createdAt < ALERT_WINDOW_MS)

  const alerts: AuditAlert[] = []

  // Helper: group by executor
  function groupByExecutor(codes: number[]) {
    const map = new Map<string, { executor: AuditEntry['executor']; count: number }>()
    for (const e of recent) {
      if (!codes.includes(e.actionCode)) continue
      const key = e.executor?.id ?? 'unknown'
      const cur = map.get(key) ?? { executor: e.executor, count: 0 }
      cur.count++
      map.set(key, cur)
    }
    return map
  }

  // Mass ban (3+ in 10 min)
  for (const [, { executor, count }] of groupByExecutor([AuditLogEvent.MemberBanAdd])) {
    if (count >= 3)
      alerts.push({
        type: 'mass_ban',
        severity: 'high',
        message: `${count} bans in the last 10 minutes`,
        count,
        windowMs: ALERT_WINDOW_MS,
        executor,
        detectedAt: now,
      })
  }

  // Mass kick (3+ in 10 min)
  for (const [, { executor, count }] of groupByExecutor([AuditLogEvent.MemberKick])) {
    if (count >= 3)
      alerts.push({
        type: 'mass_kick',
        severity: 'high',
        message: `${count} kicks in the last 10 minutes`,
        count,
        windowMs: ALERT_WINDOW_MS,
        executor,
        detectedAt: now,
      })
  }

  // Mass role changes (10+ in 10 min)
  for (const [, { executor, count }] of groupByExecutor([AuditLogEvent.MemberRoleUpdate])) {
    if (count >= 10)
      alerts.push({
        type: 'mass_role_change',
        severity: 'medium',
        message: `${count} role changes in the last 10 minutes`,
        count,
        windowMs: ALERT_WINDOW_MS,
        executor,
        detectedAt: now,
      })
  }

  // Bulk deletes
  const bulkDeletes = recent.filter((e) => e.actionCode === AuditLogEvent.MessageBulkDelete)
  if (bulkDeletes.length >= 2)
    alerts.push({
      type: 'bulk_delete',
      severity: 'medium',
      message: `${bulkDeletes.length} bulk message deletions in the last 10 minutes`,
      count: bulkDeletes.length,
      windowMs: ALERT_WINDOW_MS,
      executor: bulkDeletes[0]?.executor ?? null,
      detectedAt: now,
    })

  // Permission escalations (any channel perm overwrite)
  const permChanges = recent.filter((e) =>
    [AuditLogEvent.ChannelOverwriteCreate, AuditLogEvent.ChannelOverwriteUpdate].includes(
      e.actionCode,
    ),
  )
  if (permChanges.length >= 5)
    alerts.push({
      type: 'permission_change',
      severity: 'medium',
      message: `${permChanges.length} permission changes in the last 10 minutes`,
      count: permChanges.length,
      windowMs: ALERT_WINDOW_MS,
      executor: permChanges[0]?.executor ?? null,
      detectedAt: now,
    })

  // Mass channel deletes
  const chanDeletes = recent.filter((e) => e.actionCode === AuditLogEvent.ChannelDelete)
  if (chanDeletes.length >= 3)
    alerts.push({
      type: 'mass_channel_delete',
      severity: 'high',
      message: `${chanDeletes.length} channels deleted in the last 10 minutes`,
      count: chanDeletes.length,
      windowMs: ALERT_WINDOW_MS,
      executor: chanDeletes[0]?.executor ?? null,
      detectedAt: now,
    })

  return alerts
}

export function exportAuditAsCsv(entries: AuditEntry[]): string {
  const rows = [
    ['ID', 'Action', 'Category', 'Executor', 'Target', 'Reason', 'Timestamp', 'Changes'],
  ]
  for (const e of entries) {
    rows.push([
      e.id,
      e.action,
      e.category,
      e.executor ? `${e.executor.tag} (${e.executor.id})` : '',
      e.target ? `${e.target.tag} (${e.target.id})` : '',
      e.reason ?? '',
      new Date(e.createdAt).toISOString(),
      e.changes.map((c) => `${c.key}: ${c.old ?? '-'} → ${c.new ?? '-'}`).join('; '),
    ])
  }
  return rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
}
