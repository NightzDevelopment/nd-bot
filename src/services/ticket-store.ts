/**
 * JSON persistence for ND ticket system (open/closed/deleted tickets).
 */
import { readJson, writeJson } from './data-store.ts'

const FILE = 'tickets.json'

export type TicketStatus = 'open' | 'closed' | 'deleted'

/** Ticket priority — drives SLA targets, color coding, and staff pings. */
export type TicketPriority = 'low' | 'normal' | 'high' | 'critical'

export type TicketRecord = {
  id: number
  channelId: string
  guildId: string
  userId: string
  userTag: string
  reason: string
  /** Priority: defaults to 'normal'; auto-set from category or staff override. */
  priority?: TicketPriority
  /** Optional intake from open-ticket modal. */
  intakeProduct?: string
  intakeFramework?: string
  intakeDetails?: string
  /** Staff workflow label (see TICKET_WORKFLOW_STATUSES). */
  workflowStatus?: string
  claimedBy?: string
  claimedByTag?: string
  openedAt: number
  /** Most recent time this user opened a ticket in this guild (for per-user cooldown). */
  lastOpenedAt?: number
  /** Number of times this ticket was reopened after a close. */
  reopenCount?: number
  /** Short staff-visible note (set via /ticketnote). */
  staffNote?: string
  /** First time a moderator posted in the ticket (for SLA). */
  firstStaffReplyAt?: number
  /** Set when SLA breach was posted to staff log. */
  slaBreachedAt?: number
  /** Second SLA nudge posted to staff log (see TICKET_SLA_SECOND_NUDGE_MS). */
  slaSecondNudgeAt?: number
  closedAt?: number
  closedBy?: string
  closedByTag?: string
  closeReason?: string
  messageCount?: number
  status: TicketStatus
  logMessageId?: string
  welcomeMessageId?: string
  lastUserMessageAt?: number
  warnedAutoCloseAt?: number
  /** When true, a staff member claimed or posted; bot stops auto-triaging the opener (mention still works). */
  staffEngaged?: boolean
  /** Set when the partner-manager role was pinged for a partnership ticket (ping-once guard). */
  partnerPingedAt?: number
  /** Set when the category routing role was pinged on open (ping-once guard). */
  routePingedAt?: number
  /** Set when the "still need help?" awaiting-user nudge was sent (send-once guard). */
  awaitingUserNudgedAt?: number
  /** Satisfaction rating (1-5) submitted by the opener after close. */
  csatRating?: number
  /** When the CSAT rating was submitted. */
  csatAt?: number
  /** Freeform tags for filtering/search (staff- or AI-applied), lowercased. */
  tags?: string[]
}

type StoreFile = {
  nextId: number
  records: Record<string, TicketRecord>
  /** `${guildId}:${userId}` → channel IDs with status open (derived; rebuilt on load/save). */
  userOpenByUser?: Record<string, string[]>
}

const empty: StoreFile = { nextId: 1, records: {} }

function userOpenIndexKey(guildId: string, userId: string): string {
  return `${guildId}:${userId}`
}

export function rebuildOpenTicketUserIndex(data: StoreFile): void {
  const idx: Record<string, string[]> = {}
  for (const r of Object.values(data.records)) {
    if (r.status !== 'open') continue
    const k = userOpenIndexKey(r.guildId, r.userId)
    if (!idx[k]) idx[k] = []
    idx[k].push(r.channelId)
  }
  data.userOpenByUser = idx
}

async function load(): Promise<StoreFile> {
  const data = await readJson<StoreFile>(FILE, empty)
  if (!data.records) data.records = {}
  if (typeof data.nextId !== 'number' || data.nextId < 1) data.nextId = 1
  rebuildOpenTicketUserIndex(data)
  return data
}

async function save(data: StoreFile): Promise<void> {
  rebuildOpenTicketUserIndex(data)
  await writeJson(FILE, data)
}

export async function nextTicketNumericId(): Promise<number> {
  const data = await load()
  const id = data.nextId
  data.nextId = id + 1
  await save(data)
  return id
}

export async function saveTicket(rec: TicketRecord): Promise<void> {
  const data = await load()
  data.records[rec.channelId] = rec
  await save(data)
}

export async function getTicketByChannel(channelId: string): Promise<TicketRecord | undefined> {
  const data = await load()
  return data.records[channelId]
}

export async function listOpenTickets(guildId: string): Promise<TicketRecord[]> {
  const data = await load()
  return Object.values(data.records).filter((r) => r.guildId === guildId && r.status === 'open')
}

export async function listAllOpenTickets(): Promise<TicketRecord[]> {
  const data = await load()
  return Object.values(data.records).filter((r) => r.status === 'open')
}

export async function listOpenTicketsForUser(
  guildId: string,
  userId: string,
): Promise<TicketRecord[]> {
  const data = await load()
  const ids = data.userOpenByUser?.[userOpenIndexKey(guildId, userId)] ?? []
  const out: TicketRecord[] = []
  for (const channelId of ids) {
    const r = data.records[channelId]
    if (r && r.guildId === guildId && r.userId === userId && r.status === 'open') {
      out.push(r)
    }
  }
  if (out.length === 0) {
    return Object.values(data.records).filter(
      (r) => r.guildId === guildId && r.userId === userId && r.status === 'open',
    )
  }
  return out
}

/** Patch type that permits explicit `undefined` to clear an optional field. */
export type TicketPatch = { [K in keyof TicketRecord]?: TicketRecord[K] | undefined }

export async function updateTicketPartial(
  channelId: string,
  patch: TicketPatch,
): Promise<TicketRecord | undefined> {
  const data = await load()
  const cur = data.records[channelId]
  if (!cur) return undefined
  const next = { ...cur, ...patch }
  data.records[channelId] = next
  await save(data)
  return next
}

export async function deleteTicketRecord(channelId: string): Promise<void> {
  const data = await load()
  delete data.records[channelId]
  await save(data)
}

/** Normalize a freeform tag: lowercase, trim, spaces->hyphens, strip noise. */
export function normalizeTag(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._/-]/g, '')
    .slice(0, 40)
}

/** Add tags to a ticket (deduped, normalized). Returns the updated tag list. */
export async function addTicketTags(channelId: string, tags: string[]): Promise<string[]> {
  const data = await load()
  const cur = data.records[channelId]
  if (!cur) return []
  const set = new Set(cur.tags ?? [])
  for (const t of tags) {
    const n = normalizeTag(t)
    if (n) set.add(n)
  }
  const next = [...set].slice(0, 25)
  cur.tags = next
  await save(data)
  return next
}

/** Remove tags from a ticket. Returns the updated tag list. */
export async function removeTicketTags(channelId: string, tags: string[]): Promise<string[]> {
  const data = await load()
  const cur = data.records[channelId]
  if (!cur) return []
  const remove = new Set(tags.map(normalizeTag).filter(Boolean))
  const next = (cur.tags ?? []).filter((t) => !remove.has(t))
  cur.tags = next
  await save(data)
  return next
}

/**
 * Find tickets matching a tag query (substring match against any tag).
 * Defaults to closed tickets (resolved history) so the copilot can cite prior
 * resolutions. Most recently closed first.
 */
export async function searchTicketsByTag(
  query: string,
  opts: { guildId?: string; includeOpen?: boolean; limit?: number } = {},
): Promise<TicketRecord[]> {
  const data = await load()
  const q = normalizeTag(query)
  if (!q) return []
  const limit = opts.limit ?? 10
  const matches = Object.values(data.records).filter((r) => {
    if (opts.guildId && r.guildId !== opts.guildId) return false
    if (!opts.includeOpen && r.status !== 'closed') return false
    return (r.tags ?? []).some((t) => t.includes(q))
  })
  matches.sort((a, b) => (b.closedAt ?? b.openedAt) - (a.closedAt ?? a.openedAt))
  return matches.slice(0, limit)
}

export type TicketStats = {
  totalOpen: number
  totalClosed: number
  byReason: Record<string, number>
  avgResolutionMs: number | null
  /** Median open->close time (robust to outliers; null if no closed tickets). */
  medianResolutionMs: number | null
  /** Median ms from open to first staff message (closed tickets with firstStaffReplyAt only). */
  medianMsToFirstStaffReply: number | null
  /** Count of closed tickets with reopenCount > 0. */
  reopenedTickets: number
  /** reopenedTickets / totalClosed (0..1) or null if no closed tickets. */
  reopenRate: number | null
  /** Average CSAT rating (1-5) across rated tickets, or null if none rated. */
  avgCsat: number | null
  /** Number of tickets that received a CSAT rating. */
  csatCount: number
}

function medianSorted(nums: number[]): number | null {
  if (nums.length === 0) return null
  const s = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!
}

export async function getTicketStats(guildId: string): Promise<TicketStats> {
  const data = await load()
  const list = Object.values(data.records).filter((r) => r.guildId === guildId)
  let totalOpen = 0
  let totalClosed = 0
  let reopenedTickets = 0
  const byReason: Record<string, number> = {}
  const resolutions: number[] = []
  const firstStaffDeltas: number[] = []
  const csats: number[] = []
  for (const r of list) {
    if (r.status === 'open') totalOpen++
    if (r.status === 'closed' && r.closedAt) {
      totalClosed++
      const reason = r.reason || 'Unknown'
      byReason[reason] = (byReason[reason] ?? 0) + 1
      resolutions.push(r.closedAt - r.openedAt)
      if (r.firstStaffReplyAt) {
        firstStaffDeltas.push(r.firstStaffReplyAt - r.openedAt)
      }
      if ((r.reopenCount ?? 0) > 0) reopenedTickets++
    }
    if (typeof r.csatRating === 'number') csats.push(r.csatRating)
  }
  const avgResolutionMs =
    resolutions.length > 0 ? resolutions.reduce((a, b) => a + b, 0) / resolutions.length : null
  const medianResolutionMs = medianSorted(resolutions)
  const medianMsToFirstStaffReply = medianSorted(firstStaffDeltas)
  const reopenRate = totalClosed > 0 ? reopenedTickets / totalClosed : null
  const avgCsat = csats.length > 0 ? csats.reduce((a, b) => a + b, 0) / csats.length : null
  return {
    totalOpen,
    totalClosed,
    byReason,
    avgResolutionMs,
    medianResolutionMs,
    medianMsToFirstStaffReply,
    reopenedTickets,
    reopenRate,
    avgCsat,
    csatCount: csats.length,
  }
}

/** Return all tickets across all guilds (for dashboard list view). */
export async function listAllTickets(limit = 200): Promise<TicketRecord[]> {
  const data = await load()
  return Object.values(data.records)
    .sort((a, b) => (b.openedAt ?? 0) - (a.openedAt ?? 0))
    .slice(0, limit)
}

/** Aggregated stats across all guilds (for dashboard). */
export async function getGlobalTicketStats(): Promise<TicketStats> {
  const data = await load()
  const list = Object.values(data.records)
  let totalOpen = 0
  let totalClosed = 0
  let reopenedTickets = 0
  const byReason: Record<string, number> = {}
  const resolutions: number[] = []
  const firstStaffDeltas: number[] = []
  const csats: number[] = []
  for (const r of list) {
    if (r.status === 'open') totalOpen++
    if (r.status === 'closed' && r.closedAt) {
      totalClosed++
      const reason = r.reason || 'Unknown'
      byReason[reason] = (byReason[reason] ?? 0) + 1
      resolutions.push(r.closedAt - r.openedAt)
      if (r.firstStaffReplyAt) firstStaffDeltas.push(r.firstStaffReplyAt - r.openedAt)
      if ((r.reopenCount ?? 0) > 0) reopenedTickets++
    }
    if (typeof r.csatRating === 'number') csats.push(r.csatRating)
  }
  const avgResolutionMs =
    resolutions.length > 0 ? resolutions.reduce((a, b) => a + b, 0) / resolutions.length : null
  const medianResolutionMs = medianSorted(resolutions)
  const medianMsToFirstStaffReply = medianSorted(firstStaffDeltas)
  const reopenRate = totalClosed > 0 ? reopenedTickets / totalClosed : null
  const avgCsat = csats.length > 0 ? csats.reduce((a, b) => a + b, 0) / csats.length : null
  return {
    totalOpen,
    totalClosed,
    byReason,
    avgResolutionMs,
    medianResolutionMs,
    medianMsToFirstStaffReply,
    reopenedTickets,
    reopenRate,
    avgCsat,
    csatCount: csats.length,
  }
}

/** Return the most recent `openedAt` for any ticket opened by this user in this guild, or 0. */
export async function getLastOpenedAtForUser(guildId: string, userId: string): Promise<number> {
  const data = await load()
  let max = 0
  for (const r of Object.values(data.records)) {
    if (r.guildId !== guildId || r.userId !== userId) continue
    const v = r.lastOpenedAt ?? r.openedAt
    if (v > max) max = v
  }
  return max
}
