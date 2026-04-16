import type { Guild } from 'discord.js'
import { readJson, writeJson } from './data-store.ts'

export type WarnEntry = {
  at: number
  reason: string
  moderatorId: string
}

type WarnStore = Record<string, WarnEntry[]>

let cache: WarnStore = {}
let loaded = false

async function load(): Promise<void> {
  if (loaded) return
  cache = await readJson<WarnStore>('warnings.json', {})
  loaded = true
}

export async function getWarnings(guildId: string, userId: string): Promise<WarnEntry[]> {
  await load()
  const key = `${guildId}:${userId}`
  return [...(cache[key] ?? [])]
}

export async function addWarning(
  guildId: string,
  userId: string,
  entry: WarnEntry,
): Promise<WarnEntry[]> {
  await load()
  const key = `${guildId}:${userId}`
  const list = cache[key] ?? []
  list.push(entry)
  cache[key] = list
  await writeJson('warnings.json', cache)
  return list
}

export async function clearWarnings(guildId: string, userId: string): Promise<void> {
  await load()
  const key = `${guildId}:${userId}`
  delete cache[key]
  await writeJson('warnings.json', cache)
}

export function guildSnowflake(g: Guild): string {
  return g.id
}
