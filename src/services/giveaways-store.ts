import { readJson, writeJson } from './data-store.ts'

export type GiveawayEntry = {
  id: string
  guildId: string
  channelId: string
  messageId: string
  prize: string
  endsAt: number
  winnerCount: number
  hostId: string
  ended: boolean
}

let cache: GiveawayEntry[] = []
let loaded = false

async function load(): Promise<void> {
  if (loaded) return
  cache = await readJson<GiveawayEntry[]>('giveaways.json', [])
  loaded = true
}

export async function listGiveaways(): Promise<GiveawayEntry[]> {
  await load()
  return cache.filter((g) => !g.ended)
}

export async function saveGiveaway(g: GiveawayEntry): Promise<void> {
  await load()
  const i = cache.findIndex((x) => x.id === g.id)
  if (i >= 0) cache[i] = g
  else cache.push(g)
  await writeJson('giveaways.json', cache)
}

export async function getByMessageId(
  messageId: string,
): Promise<GiveawayEntry | undefined> {
  await load()
  return cache.find((g) => g.messageId === messageId)
}

export async function getGiveawayById(
  id: string,
): Promise<GiveawayEntry | undefined> {
  await load()
  return cache.find((g) => g.id === id)
}

export async function endGiveaway(id: string): Promise<void> {
  await load()
  const g = cache.find((x) => x.id === id)
  if (g) {
    g.ended = true
    await writeJson('giveaways.json', cache)
  }
}
