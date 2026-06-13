/**
 * Guild audit log lookups to resolve moderators / actors for audit channel embeds.
 * Requires the bot to have View Audit Log in the guild.
 */
import {
  AuditLogEvent,
  type Guild,
  type GuildAuditLogsEntry,
  type PartialUser,
  type User,
} from 'discord.js'

export const AUDIT_LOOKUP_DELAY_MS = 200
export const AUDIT_RECENT_WINDOW_MS = 10_000

export type AuditLookupError = 'missing_permission' | 'api_error' | null

export type AuditLookupResult = {
  /** Resolved executor when present (may be partial). */
  executor: User | PartialUser | null
  executorTag: string | null
  executorId: string | null
  reason: string | null
  auditEntryId: string | null
  error: AuditLookupError
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function isRecentEntry(ts: number): boolean {
  return Date.now() - ts <= AUDIT_RECENT_WINDOW_MS
}

function parseAuditError(e: unknown): AuditLookupError {
  const code =
    typeof e === 'object' &&
    e !== null &&
    'code' in e &&
    typeof (e as { code: unknown }).code === 'number'
      ? (e as { code: number }).code
      : null
  if (code === 50013) return 'missing_permission'
  return 'api_error'
}

function entryToResult(e: GuildAuditLogsEntry, error: AuditLookupError = null): AuditLookupResult {
  const ex = e.executor
  return {
    executor: ex ?? null,
    executorTag:
      ex && 'tag' in ex && ex.tag
        ? ex.tag
        : ex && 'username' in ex && ex.username
          ? `${ex.username}`
          : null,
    executorId: e.executorId ?? (ex && 'id' in ex ? ex.id : null),
    reason: e.reason,
    auditEntryId: e.id,
    error,
  }
}

function emptyResult(error: AuditLookupError): AuditLookupResult {
  return {
    executor: null,
    executorTag: null,
    executorId: null,
    reason: null,
    auditEntryId: null,
    error,
  }
}

async function fetchAuditEntries(
  guild: Guild,
  type: AuditLogEvent,
  limit = 15,
): Promise<{ entries: GuildAuditLogsEntry[]; error: AuditLookupError }> {
  await sleep(AUDIT_LOOKUP_DELAY_MS)
  try {
    const logs = await guild.fetchAuditLogs({ type, limit })
    return { entries: [...logs.entries.values()], error: null }
  } catch (e) {
    console.warn('[audit] fetchAuditLogs failed:', e)
    return { entries: [], error: parseAuditError(e) }
  }
}

function channelIdFromAuditExtra(extra: { channel?: { id: string } } | null): string | null {
  const ch = extra?.channel
  if (ch && typeof ch === 'object' && 'id' in ch) return ch.id
  return null
}

/** Single message delete: target is the message author; extra has channel + count. */
export async function lookupMessageDeleteActor(
  guild: Guild,
  channelId: string,
  authorId: string | null,
): Promise<AuditLookupResult> {
  const { entries, error } = await fetchAuditEntries(guild, AuditLogEvent.MessageDelete, 15)
  if (error) return emptyResult(error)
  if (!entries.length) return emptyResult(null)

  const sorted = entries
    .filter((e) => isRecentEntry(e.createdTimestamp))
    .sort((a, b) => b.createdTimestamp - a.createdTimestamp)

  for (const e of sorted) {
    const ex = e.extra as { channel?: { id: string }; count?: number } | null
    if (!ex || ex.count !== 1) continue
    const chId = channelIdFromAuditExtra(ex)
    if (chId !== channelId) continue
    if (authorId && e.targetId !== authorId) continue
    return entryToResult(e)
  }

  // Fallback: channel + count=1 + recent, no author match
  for (const e of sorted) {
    const ex = e.extra as { channel?: { id: string }; count?: number } | null
    if (!ex || ex.count !== 1) continue
    const chId = channelIdFromAuditExtra(ex)
    if (chId === channelId) return entryToResult(e)
  }

  return emptyResult(null)
}

export async function lookupChannelCreateActor(
  guild: Guild,
  channelId: string,
): Promise<AuditLookupResult> {
  const { entries, error } = await fetchAuditEntries(guild, AuditLogEvent.ChannelCreate, 15)
  if (error) return emptyResult(error)
  for (const e of entries) {
    if (!isRecentEntry(e.createdTimestamp)) continue
    if (e.targetId === channelId) return entryToResult(e)
  }
  return emptyResult(null)
}

export async function lookupChannelDeleteActor(
  guild: Guild,
  channelId: string,
): Promise<AuditLookupResult> {
  const { entries, error } = await fetchAuditEntries(guild, AuditLogEvent.ChannelDelete, 15)
  if (error) return emptyResult(error)
  for (const e of entries) {
    if (!isRecentEntry(e.createdTimestamp)) continue
    if (e.targetId === channelId) return entryToResult(e)
  }
  return emptyResult(null)
}

export type MemberRemoveKind = 'kick' | 'ban' | 'leave'

export type MemberRemoveLookup = {
  kind: MemberRemoveKind
  result: AuditLookupResult
}

/** If removal was due to a ban, prefer skipping a separate "Member left" log (ban log covers it). */
export async function lookupMemberRemove(
  guild: Guild,
  userId: string,
): Promise<MemberRemoveLookup> {
  const kick = await fetchAuditEntries(guild, AuditLogEvent.MemberKick, 15)
  if (kick.error) {
    return { kind: 'leave', result: emptyResult(kick.error) }
  }
  for (const e of kick.entries) {
    if (!isRecentEntry(e.createdTimestamp)) continue
    if (e.targetId === userId) {
      return { kind: 'kick', result: entryToResult(e) }
    }
  }

  const ban = await fetchAuditEntries(guild, AuditLogEvent.MemberBanAdd, 15)
  if (ban.error) {
    return { kind: 'leave', result: emptyResult(ban.error) }
  }
  for (const e of ban.entries) {
    if (!isRecentEntry(e.createdTimestamp)) continue
    if (e.targetId === userId) {
      return { kind: 'ban', result: entryToResult(e) }
    }
  }

  return { kind: 'leave', result: emptyResult(null) }
}

export async function lookupMemberBanAdd(guild: Guild, userId: string): Promise<AuditLookupResult> {
  const { entries, error } = await fetchAuditEntries(guild, AuditLogEvent.MemberBanAdd, 15)
  if (error) return emptyResult(error)
  for (const e of entries) {
    if (!isRecentEntry(e.createdTimestamp)) continue
    if (e.targetId === userId) return entryToResult(e)
  }
  return emptyResult(null)
}

export async function lookupMemberBanRemove(
  guild: Guild,
  userId: string,
): Promise<AuditLookupResult> {
  const { entries, error } = await fetchAuditEntries(guild, AuditLogEvent.MemberBanRemove, 15)
  if (error) return emptyResult(error)
  for (const e of entries) {
    if (!isRecentEntry(e.createdTimestamp)) continue
    if (e.targetId === userId) return entryToResult(e)
  }
  return emptyResult(null)
}

export async function lookupMessageBulkDeleteActor(
  guild: Guild,
  channelId: string,
  count: number,
): Promise<AuditLookupResult> {
  const { entries, error } = await fetchAuditEntries(guild, AuditLogEvent.MessageBulkDelete, 15)
  if (error) return emptyResult(error)
  const sorted = entries
    .filter((e) => isRecentEntry(e.createdTimestamp))
    .sort((a, b) => b.createdTimestamp - a.createdTimestamp)

  for (const e of sorted) {
    const ex = e.extra as { count?: number } | null
    if (!ex || ex.count !== count) continue
    if (e.targetId !== channelId) continue
    return entryToResult(e)
  }

  for (const e of sorted) {
    const ex = e.extra as { count?: number } | null
    if (!ex || ex.count !== count) continue
    return entryToResult(e)
  }

  return emptyResult(null)
}

export function formatExecutorLine(r: AuditLookupResult): string {
  if (r.error === 'missing_permission') {
    return 'Unknown (missing **View Audit Log** permission for the bot)'
  }
  if (r.error === 'api_error') {
    return 'Unknown (audit log request failed)'
  }
  if (r.executor) {
    const tag =
      'tag' in r.executor && r.executor.tag
        ? r.executor.tag
        : 'username' in r.executor && r.executor.username
          ? r.executor.username
          : r.executor.id
    return `${tag} · \`${r.executor.id}\``
  }
  if (r.executorId) {
    return `\`${r.executorId}\` (partial user)`
  }
  return 'Unknown (no matching audit entry yet, try again if Discord was slow)'
}

export function formatAuditFooter(guild: Guild, lookup: AuditLookupResult): string {
  const base = `${guild.name} · ${guild.id}`
  if (lookup.error === 'missing_permission') {
    return `${base} · Grant bot: View Audit Log`
  }
  if (lookup.error === 'api_error') {
    return `${base} · Audit lookup error`
  }
  return base
}
