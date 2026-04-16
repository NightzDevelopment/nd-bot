import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { DATA_DIR } from '../config.ts'

export async function ensureDataDir(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true })
}

export function dataPath(name: string): string {
  return join(DATA_DIR, name)
}

export async function readJson<T>(name: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(dataPath(name), 'utf8')
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export async function writeJson(name: string, data: unknown): Promise<void> {
  await ensureDataDir()
  await writeFile(dataPath(name), JSON.stringify(data, null, 2), 'utf8')
}
