import { readJson, writeJson } from './data-store.ts'

const FILE = 'afk.json'

export type AfkRecord = {
  reason: string
  since: number
}

type AfkStore = Record<string, Record<string, AfkRecord>>

let cache: AfkStore | null = null
let loading: Promise<void> | null = null

async function store(): Promise<AfkStore> {
  if (cache) return cache
  if (!loading) {
    loading = (async () => {
      cache = await readJson<AfkStore>(FILE, {})
    })()
  }
  await loading
  return cache!
}

export async function getAfk(guildId: string, userId: string): Promise<AfkRecord | null> {
  const s = await store()
  return s[guildId]?.[userId] ?? null
}

export async function setAfk(
  guildId: string,
  userId: string,
  reason: string,
  since = Date.now(),
): Promise<AfkRecord> {
  const s = await store()
  const guild = (s[guildId] ??= {})
  const rec = { reason, since }
  guild[userId] = rec
  await writeJson(FILE, s)
  return rec
}

export async function clearAfk(guildId: string, userId: string): Promise<AfkRecord | null> {
  const s = await store()
  const rec = s[guildId]?.[userId] ?? null
  if (s[guildId]) {
    delete s[guildId][userId]
    await writeJson(FILE, s)
  }
  return rec
}
