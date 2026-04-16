import { readJson, writeJson } from './data-store.ts'

export type ScheduleEntry = {
  id: string
  guildId: string
  channelId: string
  content: string
  runAt: number
  repeatMs: number | null
  authorId: string
}

let cache: ScheduleEntry[] = []
let loaded = false

async function load(): Promise<void> {
  if (loaded) return
  cache = await readJson<ScheduleEntry[]>('schedules.json', [])
  loaded = true
}

export async function addSchedule(e: ScheduleEntry): Promise<void> {
  await load()
  cache.push(e)
  await writeJson('schedules.json', cache)
}

export async function removeSchedule(id: string): Promise<void> {
  await load()
  cache = cache.filter((s) => s.id !== id)
  await writeJson('schedules.json', cache)
}

export async function listSchedules(): Promise<ScheduleEntry[]> {
  await load()
  return [...cache]
}

export async function updateSchedule(e: ScheduleEntry): Promise<void> {
  await load()
  const i = cache.findIndex((x) => x.id === e.id)
  if (i >= 0) {
    cache[i] = e
    await writeJson('schedules.json', cache)
  }
}
