/**
 * Register first in bot entry so crashes and rejections are visible in PM2 logs.
 * PM2 will restart the process when the process exits (see ecosystem.config.cjs).
 *
 * Also initializes Sentry (no-op if SENTRY_DSN unset) so uncaught errors are
 * captured before the process exits.
 */
import { childLogger } from './lib/logger.ts'
import { captureException, flushSentry, initSentry } from './lib/sentry.ts'

const log = childLogger('process')

/**
 * Timestamps of recent unhandled rejections. We only force-exit on a genuine
 * crash *loop* (many within a short window), not on sparse transient errors
 * accumulated over days of uptime - an unbounded lifetime counter would slowly
 * guarantee a self-kill on a 24/7 bot.
 */
const rejectionTimes: number[] = []
const REJECTION_WINDOW_MS = 60_000
const REJECTION_BURST_LIMIT = 8

export function installProcessGuards(): void {
  initSentry()

  process.on('uncaughtException', (err) => {
    log.fatal({ err }, '[process] uncaughtException: bot will exit so the supervisor can restart')
    captureException(err, { source: 'uncaughtException' })
    void flushSentry().finally(() => process.exit(1))
  })

  process.on('unhandledRejection', (reason, promise) => {
    const now = Date.now()
    // Drop timestamps outside the sliding window.
    while (rejectionTimes.length > 0 && now - (rejectionTimes[0] as number) > REJECTION_WINDOW_MS) {
      rejectionTimes.shift()
    }
    rejectionTimes.push(now)
    const err = reason instanceof Error ? reason : new Error(String(reason))
    log.error(
      { err, recent: rejectionTimes.length, promise },
      `[process] unhandledRejection (${rejectionTimes.length} in last ${REJECTION_WINDOW_MS / 1000}s)`,
    )
    captureException(err, { source: 'unhandledRejection', recent: rejectionTimes.length })

    if (rejectionTimes.length >= REJECTION_BURST_LIMIT) {
      log.fatal('[process] unhandled-rejection burst, exiting so supervisor can restart')
      void flushSentry().finally(() => process.exit(1))
    }
  })
}
