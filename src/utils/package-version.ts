import { readFileSync } from 'node:fs'
import { join } from 'node:path'

let cached = ''

/** Version from repo package.json — for /ping and health (no npm env required). */
export function packageVersion(): string {
  if (cached) return cached
  try {
    const pkgPath = join(import.meta.dirname, '..', '..', 'package.json')
    const j = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string }
    cached = typeof j.version === 'string' && j.version.trim() ? j.version.trim() : '0.0.0'
  } catch {
    cached = 'dev'
  }
  return cached
}
