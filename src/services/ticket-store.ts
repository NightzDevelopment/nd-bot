/**
 * JSON persistence for ND ticket system (open/closed/deleted tickets).
 */
import { readJson, writeJson } from './data-store.ts'

const FILE = 'tickets.json'

export type TicketStatus = 'open' | 'closed' | 'deleted'

export type TicketRecord = {
  id: number
  channelId: string
  guildId: string
  userId: string
  userTag: string
  reason: string
  /** Staff workflow label (see TICKET_WORKFLOW_STATUSES). */
  workflowStatus?: string
  claimedBy?: string
  claimedByTag?: string
  openedAt: number
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
}

type StoreFile = {
  nextId: number
  records: Record<string, TicketRecord>
}

const empty: StoreFile = { nextId: 1, records: {} }

async function load(): Promise<StoreFile> {
  const data = await readJson<StoreFile>(FILE, empty)
  if (!data.records) data.records = {}
  if (typeof data.nextId !== 'number' || data.nextId < 1) data.nextId = 1
  return data
}

async function save(data: StoreFile): Promise<void> {
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

export async function getTicketByChannel(
  channelId: string,
): Promise<TicketRecord | undefined> {
  const data = await load()
  return data.records[channelId]
}

export async function listOpenTickets(guildId: string): Promise<TicketRecord[]> {
  const data = await load()
  return Object.values(data.records).filter(
    (r) => r.guildId === guildId && r.status === 'open',
  )
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
  return Object.values(data.records).filter(
    (r) =>
      r.guildId === guildId &&
      r.userId === userId &&
      r.status === 'open',
  )
}

export async function updateTicketPartial(
  channelId: string,
  patch: Partial<TicketRecord>,
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

export type TicketStats = {
  totalOpen: number
  totalClosed: number
  byReason: Record<string, number>
  avgResolutionMs: number | null
}

export async function getTicketStats(guildId: string): Promise<TicketStats> {
  const data = await load()
  const list = Object.values(data.records).filter((r) => r.guildId === guildId)
  let totalOpen = 0
  let totalClosed = 0
  const byReason: Record<string, number> = {}
  const resolutions: number[] = []
  for (const r of list) {
    if (r.status === 'open') totalOpen++
    if (r.status === 'closed' && r.closedAt) {
      totalClosed++
      const reason = r.reason || 'Unknown'
      byReason[reason] = (byReason[reason] ?? 0) + 1
      resolutions.push(r.closedAt - r.openedAt)
    }
  }
  const avgResolutionMs =
    resolutions.length > 0
      ? resolutions.reduce((a, b) => a + b, 0) / resolutions.length
      : null
  return { totalOpen, totalClosed, byReason, avgResolutionMs }
}
