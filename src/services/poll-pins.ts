/**
 * Staff-pinned poll message IDs per guild (JSON under DATA_DIR).
 */
import { readJson, writeJson } from './data-store.ts'

const FILE = 'poll-pins.json'

type Store = { byGuild: Record<string, string[]> }

const empty: Store = { byGuild: {} }

async function load(): Promise<Store> {
  const data = await readJson<Store>(FILE, empty)
  if (!data.byGuild) data.byGuild = {}
  return data
}

async function save(data: Store): Promise<void> {
  await writeJson(FILE, data)
}

export async function listPinnedPollIds(guildId: string): Promise<string[]> {
  const data = await load()
  return [...(data.byGuild[guildId] ?? [])]
}

export async function addPollPin(guildId: string, messageId: string): Promise<void> {
  const data = await load()
  const cur = data.byGuild[guildId] ?? []
  if (!cur.includes(messageId)) {
    cur.push(messageId)
    data.byGuild[guildId] = cur.slice(-50)
  }
  await save(data)
}

export async function removePollPin(guildId: string, messageId: string): Promise<void> {
  const data = await load()
  const cur = data.byGuild[guildId] ?? []
  data.byGuild[guildId] = cur.filter((id) => id !== messageId)
  await save(data)
}
