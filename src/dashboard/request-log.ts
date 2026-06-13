/**
 * Dashboard HTTP request logger.
 * Keeps a fixed-size in-memory ring buffer and tails to logs/dashboard-access.log.
 */

import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

const RING_MAX = 500
const LOG_DIR = join(import.meta.dir, '../../logs')
const LOG_FILE = join(LOG_DIR, 'dashboard-access.log')

export interface RequestLogEntry {
  at: number
  method: string
  path: string
  status: number
  durationMs: number
  ip: string
  user: string | null
  bytes: number
}

const _ring: RequestLogEntry[] = []
let _writeReady = false

async function ensureLogDir() {
  if (_writeReady) return
  try {
    await mkdir(LOG_DIR, { recursive: true })
    _writeReady = true
  } catch {
    _writeReady = true
  }
}

export function recordRequest(entry: RequestLogEntry): void {
  // Ring buffer
  _ring.push(entry)
  if (_ring.length > RING_MAX) _ring.shift()

  // Async file write, fire-and-forget
  const line = `${new Date(entry.at).toISOString()} ${entry.method.padEnd(6)} ${String(entry.status).padEnd(3)} ${String(entry.durationMs).padStart(6)}ms ${entry.path.slice(0, 120).padEnd(80)} ${(entry.ip || '-').padEnd(20)} ${entry.user ?? '-'}\n`
  void ensureLogDir().then(() => appendFile(LOG_FILE, line).catch(() => {}))
}

export function getRequestLog(limit = 200): RequestLogEntry[] {
  return _ring.slice(-limit).reverse()
}

export function clearRequestLog(): void {
  _ring.length = 0
}
