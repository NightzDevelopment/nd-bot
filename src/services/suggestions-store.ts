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

export async function findById(
  id: string,
): Promise<SuggestionEntry | undefined> {
  await load()
  return cache.find((s) => s.id === id)
}

export async function setStatus(
  id: string,
  status: SuggestionEntry['status'],
): Promise<void> {
  await load()
  const s = cache.find((x) => x.id === id)
  if (s) {
    s.status = status
    await writeJson('suggestions.json', cache)
  }
}
