import { readJson, writeJson } from './data-store.ts'

export type ReactionRoleEntry = {
  guildId: string
  channelId: string
  messageId: string
  emoji: string
  roleId: string
}

let cache: ReactionRoleEntry[] = []
let loaded = false

async function load(): Promise<void> {
  if (loaded) return
  cache = await readJson<ReactionRoleEntry[]>('roles.json', [])
  loaded = true
}

export async function getAllReactionRoles(): Promise<ReactionRoleEntry[]> {
  await load()
  return [...cache]
}

export async function addReactionRole(entry: ReactionRoleEntry): Promise<void> {
  await load()
  cache.push(entry)
  await writeJson('roles.json', cache)
}

export async function removeReactionRole(
  messageId: string,
  emoji: string,
): Promise<void> {
  await load()
  cache = cache.filter(
    (e) => !(e.messageId === messageId && e.emoji === emoji),
  )
  await writeJson('roles.json', cache)
}
