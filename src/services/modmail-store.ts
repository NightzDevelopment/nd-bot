/**
 * Open modmail sessions: a per-user private staff channel that relays DMs both
 * directions. Keyed by userId, with a channelId reverse index.
 */
import { readJson, writeJson } from './data-store.ts'

const FILE = 'modmail.json'

export type ModmailSession = {
  userId: string
  userTag: string
  channelId: string
  guildId: string
  openedAt: number
}

type Store = { sessions: Record<string, ModmailSession>; byChannel: Record<string, string> }
const empty: Store = { sessions: {}, byChannel: {} }

let cache: Store | null = null

async function load(): Promise<Store> {
  if (cache) return cache
  const data = await readJson<Store>(FILE, empty)
  if (!data.sessions) data.sessions = {}
  if (!data.byChannel) data.byChannel = {}
  cache = data
  return data
}

async function save(data: Store): Promise<void> {
  cache = data
  await writeJson(FILE, data)
}

export async function openSession(s: ModmailSession): Promise<void> {
  const data = await load()
  data.sessions[s.userId] = s
  data.byChannel[s.channelId] = s.userId
  await save(data)
}

export async function getSessionByUser(userId: string): Promise<ModmailSession | undefined> {
  return (await load()).sessions[userId]
}

export async function getSessionByChannel(
  channelId: string,
): Promise<ModmailSession | undefined> {
  const data = await load()
  const userId = data.byChannel[channelId]
  return userId ? data.sessions[userId] : undefined
}

export async function closeSession(userId: string): Promise<ModmailSession | undefined> {
  const data = await load()
  const s = data.sessions[userId]
  if (s) {
    delete data.sessions[userId]
    delete data.byChannel[s.channelId]
    await save(data)
  }
  return s
}
