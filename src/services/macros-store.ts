/**
 * Staff text snippets: data/macros.json → { "key": "body" }.
 */
import { readJson, writeJson } from './data-store.ts'

const FILE = 'macros.json'

type Store = Record<string, string>

const empty: Store = {}

async function load(): Promise<Store> {
  const data = await readJson<Store>(FILE, empty)
  return data && typeof data === 'object' ? data : {}
}

export async function listMacroKeys(): Promise<string[]> {
  const s = await load()
  return Object.keys(s).sort()
}

export async function getMacroBody(key: string): Promise<string | undefined> {
  const s = await load()
  return s[key.trim().toLowerCase()]
}

export async function setMacro(key: string, body: string): Promise<void> {
  const s = await load()
  s[key.trim().toLowerCase()] = body
  await writeJson(FILE, s)
}
