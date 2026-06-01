/**
 * Ban-appeal records (JSON store). A banned user submits an appeal via a DM
 * button; staff approve/deny it in a review channel.
 */
import { readJson, writeJson } from './data-store.ts'

const FILE = 'appeals.json'

export type AppealStatus = 'open' | 'approved' | 'denied'

export type Appeal = {
  id: number
  guildId: string
  userId: string
  userTag: string
  body: string
  status: AppealStatus
  createdAt: number
  reviewedBy?: string
  reviewedByTag?: string
  decidedAt?: number
  staffMessageId?: string
}

type Store = { nextId: number; appeals: Appeal[] }
const empty: Store = { nextId: 1, appeals: [] }

let cache: Store | null = null

async function load(): Promise<Store> {
  if (cache) return cache
  const data = await readJson<Store>(FILE, empty)
  if (!Array.isArray(data.appeals)) data.appeals = []
  if (typeof data.nextId !== 'number' || data.nextId < 1) data.nextId = 1
  cache = data
  return data
}

async function save(data: Store): Promise<void> {
  cache = data
  await writeJson(FILE, data)
}

export async function addAppeal(a: Omit<Appeal, 'id' | 'createdAt' | 'status'>): Promise<Appeal> {
  const data = await load()
  const rec: Appeal = { ...a, id: data.nextId++, createdAt: Date.now(), status: 'open' }
  data.appeals.push(rec)
  if (data.appeals.length > 5000) data.appeals = data.appeals.slice(-5000)
  await save(data)
  return rec
}

export async function getAppeal(id: number): Promise<Appeal | undefined> {
  const data = await load()
  return data.appeals.find((a) => a.id === id)
}

/** True if this user already has an open appeal for this guild (rate-limit). */
export async function hasOpenAppeal(guildId: string, userId: string): Promise<boolean> {
  const data = await load()
  return data.appeals.some(
    (a) => a.guildId === guildId && a.userId === userId && a.status === 'open',
  )
}

export async function updateAppeal(id: number, patch: Partial<Appeal>): Promise<Appeal | undefined> {
  const data = await load()
  const cur = data.appeals.find((a) => a.id === id)
  if (!cur) return undefined
  Object.assign(cur, patch)
  await save(data)
  return cur
}
