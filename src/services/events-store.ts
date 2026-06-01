/**
 * Community events with RSVP. Each event has a posted message with Yes/No/Maybe
 * buttons; a reminder fires shortly before it starts.
 */
import { readJson, writeJson } from './data-store.ts'

const FILE = 'events.json'

export type RsvpChoice = 'yes' | 'no' | 'maybe'

export type EventRecord = {
  id: string
  guildId: string
  channelId: string
  messageId?: string
  title: string
  description: string
  startsAt: number
  createdBy: string
  createdAt: number
  cancelled?: boolean
  rsvps: { yes: string[]; no: string[]; maybe: string[] }
}

type Store = { events: Record<string, EventRecord> }
let cache: Store | null = null

async function load(): Promise<Store> {
  if (cache) return cache
  const data = await readJson<Store>(FILE, { events: {} })
  if (!data.events) data.events = {}
  cache = data
  return data
}

async function save(data: Store): Promise<void> {
  cache = data
  await writeJson(FILE, data)
}

function newId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

export async function createEvent(
  e: Omit<EventRecord, 'id' | 'createdAt' | 'rsvps'>,
): Promise<EventRecord> {
  const data = await load()
  const rec: EventRecord = {
    ...e,
    id: newId(),
    createdAt: Date.now(),
    rsvps: { yes: [], no: [], maybe: [] },
  }
  data.events[rec.id] = rec
  await save(data)
  return rec
}

export async function getEvent(id: string): Promise<EventRecord | undefined> {
  return (await load()).events[id]
}

export async function updateEvent(
  id: string,
  patch: Partial<EventRecord>,
): Promise<EventRecord | undefined> {
  const data = await load()
  const cur = data.events[id]
  if (!cur) return undefined
  Object.assign(cur, patch)
  await save(data)
  return cur
}

/** Set a user's RSVP choice (removes them from the other lists). */
export async function setRsvp(
  id: string,
  userId: string,
  choice: RsvpChoice,
): Promise<EventRecord | undefined> {
  const data = await load()
  const ev = data.events[id]
  if (!ev) return undefined
  for (const k of ['yes', 'no', 'maybe'] as const) {
    ev.rsvps[k] = ev.rsvps[k].filter((u) => u !== userId)
  }
  ev.rsvps[choice].push(userId)
  await save(data)
  return ev
}

export async function listUpcomingEvents(guildId: string): Promise<EventRecord[]> {
  const data = await load()
  const now = Date.now()
  return Object.values(data.events)
    .filter((e) => e.guildId === guildId && !e.cancelled && e.startsAt > now)
    .sort((a, b) => a.startsAt - b.startsAt)
}
