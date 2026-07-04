/**
 * Persists the roles a member held before being quarantined, so they can be
 * restored when the quarantine is lifted, even across a bot restart.
 * Keyed by `${guildId}:${userId}` in data/quarantine-saved-roles.json.
 */
import { readJson, writeJson } from './data-store.ts'

const FILE = 'quarantine-saved-roles.json'
type Store = Record<string, string[]>
let cache: Store | null = null

async function load(): Promise<Store> {
  if (!cache) cache = await readJson<Store>(FILE, {})
  return cache
}

function key(guildId: string, userId: string): string {
  return `${guildId}:${userId}`
}

export async function saveQuarantineRoles(
  guildId: string,
  userId: string,
  roleIds: string[],
): Promise<void> {
  const store = await load()
  store[key(guildId, userId)] = roleIds
  await writeJson(FILE, store)
}

export async function getQuarantineRoles(guildId: string, userId: string): Promise<string[]> {
  const store = await load()
  return store[key(guildId, userId)] ?? []
}

export async function clearQuarantineRoles(guildId: string, userId: string): Promise<void> {
  const store = await load()
  if (key(guildId, userId) in store) {
    delete store[key(guildId, userId)]
    await writeJson(FILE, store)
  }
}
