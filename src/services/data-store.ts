import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
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
  await writeFileAtomic(dataPath(name), JSON.stringify(data, null, 2))
}

/**
 * Crash-safe write: stage to a sibling `<file>.tmp.<rand>`, then `rename` into place.
 * `rename` is atomic on the same filesystem on POSIX and on NTFS (Windows). A power loss
 * mid-write leaves the staging file behind but never a half-written target.
 */
export async function writeFileAtomic(
  abs: string,
  contents: string,
  encoding: BufferEncoding = 'utf8',
): Promise<void> {
  await mkdir(dirname(abs), { recursive: true })
  const tmp = `${abs}.tmp.${process.pid}.${Date.now().toString(36)}.${Math.random()
    .toString(36)
    .slice(2, 8)}`
  await writeFile(tmp, contents, encoding)
  try {
    await rename(tmp, abs)
  } catch (err) {
    // Best-effort cleanup if rename fails (e.g., cross-device).
    try {
      const { unlink } = await import('node:fs/promises')
      await unlink(tmp)
    } catch {
      /* ignore */
    }
    throw err
  }
}
