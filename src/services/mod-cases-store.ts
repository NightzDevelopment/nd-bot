/**
 * Lightweight moderation case log (JSON).
 */
import { readJson, writeJson } from './data-store.ts'

const FILE = 'mod-cases.json'

export type ModCase = {
  id: number
  guildId: string
  targetId: string
  targetTag: string
  moderatorId: string
  moderatorTag: string
  action: string
  reason: string
  at: number
}

type Store = { nextId: number; cases: ModCase[] }

const empty: Store = { nextId: 1, cases: [] }

async function load(): Promise<Store> {
  const data = await readJson<Store>(FILE, empty)
  if (!data.cases) data.cases = []
  if (typeof data.nextId !== 'number' || data.nextId < 1) data.nextId = 1
  return data
}

async function save(data: Store): Promise<void> {
  await writeJson(FILE, data)
}

export async function addCase(c: Omit<ModCase, 'id'>): Promise<ModCase> {
  const data = await load()
  const id = data.nextId++
  const rec: ModCase = { ...c, id }
  data.cases.push(rec)
  if (data.cases.length > 2000) data.cases = data.cases.slice(-2000)
  await save(data)
  return rec
}

export async function listCasesForGuild(guildId: string, limit = 15): Promise<ModCase[]> {
  const data = await load()
  return data.cases
    .filter((c) => c.guildId === guildId)
    .slice(-limit)
    .reverse()
}

/** All cases with `at >= sinceMs`, newest first. Used by the weekly mod report. */
export async function listCasesSince(sinceMs: number): Promise<ModCase[]> {
  const data = await load()
  return data.cases.filter((c) => c.at >= sinceMs).sort((a, b) => b.at - a.at)
}

export async function listCasesForUser(
  guildId: string,
  targetId: string,
  limit = 25,
): Promise<ModCase[]> {
  const data = await load()
  return data.cases
    .filter((c) => c.guildId === guildId && c.targetId === targetId)
    .slice(-limit)
    .reverse()
}
