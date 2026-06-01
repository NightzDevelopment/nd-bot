import { readJson, writeJson } from './data-store.ts'

export type SuggestionEntry = {
  id: string
  guildId: string
  channelId: string
  messageId: string
  authorId: string
  content: string
  status: 'open' | 'approved' | 'denied'
}

let cache: SuggestionEntry[] = []
let loaded = false

async function load(): Promise<void> {
  if (loaded) return
  cache = await readJson<SuggestionEntry[]>('suggestions.json', [])
  loaded = true
}

export async function addSuggestion(e: SuggestionEntry): Promise<void> {
  await load()
  cache.push(e)
  await writeJson('suggestions.json', cache)
}

export async function listOpen(guildId: string): Promise<SuggestionEntry[]> {
  await load()
  return cache.filter((s) => s.guildId === guildId && s.status === 'open')
}

export async function findById(id: string): Promise<SuggestionEntry | undefined> {
  await load()
  return cache.find((s) => s.id === id)
}

export async function setStatus(id: string, status: SuggestionEntry['status']): Promise<void> {
  await load()
  const s = cache.find((x) => x.id === id)
  if (s) {
    s.status = status
    await writeJson('suggestions.json', cache)
  }
}

export async function listAll(guildId?: string): Promise<SuggestionEntry[]> {
  await load()
  if (guildId) return cache.filter((s) => s.guildId === guildId)
  return cache.slice()
}

export async function getStats(guildId?: string): Promise<{
  total: number
  open: number
  approved: number
  denied: number
}> {
  await load()
  const list = guildId ? cache.filter((s) => s.guildId === guildId) : cache
  return {
    total: list.length,
    open: list.filter((s) => s.status === 'open').length,
    approved: list.filter((s) => s.status === 'approved').length,
    denied: list.filter((s) => s.status === 'denied').length,
  }
}
