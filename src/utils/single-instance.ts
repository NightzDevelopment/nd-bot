/**
 * Prevent two bot processes with the same token from running (duplicate replies).
 * Writes DATA_DIR/nd-bot-instance.lock with our PID; another live PID → exit.
 * Set ND_BOT_ALLOW_DUPLICATE_INSTANCE=1 to skip (e.g. deliberate multi-instance debugging).
 */
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DATA_DIR } from '../config.ts'

const LOCK_NAME = 'nd-bot-instance.lock'
const WAIT_RETRY_MS = 250
const WAIT_MAX_MS = 10_000

function lockPath(): string {
  return join(DATA_DIR, LOCK_NAME)
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function sleepSyncMs(ms: number): void {
  if (
    typeof Bun !== 'undefined' &&
    typeof (Bun as { sleepSync?: (n: number) => void }).sleepSync === 'function'
  ) {
    ;(Bun as { sleepSync: (n: number) => void }).sleepSync(ms)
    return
  }
  const end = Date.now() + ms
  while (Date.now() < end) {
    /* blocking fallback */
  }
}

/** Run after DATA_DIR exists. Exits process with code 1 if another bot holds the lock. */
export function acquireInstanceLock(): void {
  const v = process.env.ND_BOT_ALLOW_DUPLICATE_INSTANCE?.trim().toLowerCase()
  if (v === '1' || v === 'true' || v === 'yes' || v === 'on') {
    console.warn(
      '[instance] ND_BOT_ALLOW_DUPLICATE_INSTANCE is set — single-instance lock skipped (risk of duplicate bots).',
    )
    return
  }

  const path = lockPath()
  const myPid = process.pid

  let waited = 0
  let warned = false

  while (existsSync(path) && waited < WAIT_MAX_MS) {
    let holdPid: number | null = null
    try {
      const raw = readFileSync(path, 'utf8').trim()
      const line = raw.split(/\r?\n/)[0] ?? ''
      const stalePid = parseInt(line, 10)
      if (Number.isFinite(stalePid) && stalePid > 0 && stalePid !== myPid) {
        holdPid = stalePid
      }
    } catch {
      holdPid = null
    }

    if (holdPid === null || !isProcessAlive(holdPid)) break

    if (!warned) {
      warned = true
      console.warn(
        `[instance] Lock held by PID ${holdPid}; waiting up to ${WAIT_MAX_MS / 1000}s (PM2 restart overlap or duplicate).`,
      )
    }
    sleepSyncMs(WAIT_RETRY_MS)
    waited += WAIT_RETRY_MS
  }

  if (existsSync(path)) {
    try {
      const raw = readFileSync(path, 'utf8').trim()
      const firstLine = raw.split(/\r?\n/)[0] ?? ''
      const stalePid = parseInt(firstLine, 10)
      if (Number.isFinite(stalePid) && stalePid > 0 && stalePid !== myPid) {
        if (isProcessAlive(stalePid)) {
          console.error(
            `[instance] Another nd-bot process is running (PID ${stalePid}, lock ${path}).`,
          )
          console.error(
            '[instance] Stop the duplicate (e.g. PM2 and `bun run` together), delete a stale lock, or ND_BOT_ALLOW_DUPLICATE_INSTANCE=1.',
          )
          process.exit(1)
        }
      }
    } catch {
      /* malformed lock — overwrite below */
    }
  }

  writeFileSync(path, `${String(myPid)}\n`, 'utf8')

  const release = (): void => {
    try {
      if (!existsSync(path)) return
      const raw = readFileSync(path, 'utf8').trim()
      const stalePid = parseInt(raw.split(/\r?\n/)[0] ?? '', 10)
      if (Number.isFinite(stalePid) && stalePid === myPid) {
        unlinkSync(path)
      }
    } catch {
      try {
        unlinkSync(path)
      } catch {
        /* ignore */
      }
    }
  }

  process.once('SIGINT', () => {
    release()
    process.exit(0)
  })
  process.once('SIGTERM', () => {
    release()
    process.exit(0)
  })
  process.on('exit', release)
}
