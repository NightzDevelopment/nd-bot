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

let unhandledRejectionCount = 0

export function installProcessGuards(): void {
  initSentry()

  process.on('uncaughtException', (err) => {
    log.fatal({ err }, '[process] uncaughtException: bot will exit so the supervisor can restart')
    captureException(err, { source: 'uncaughtException' })
    void flushSentry().finally(() => process.exit(1))
  })

  process.on('unhandledRejection', (reason, promise) => {
    unhandledRejectionCount += 1
    const err = reason instanceof Error ? reason : new Error(String(reason))
    log.error(
      { err, count: unhandledRejectionCount, promise },
      `[process] unhandledRejection #${unhandledRejectionCount}`,
    )
    captureException(err, { source: 'unhandledRejection', count: unhandledRejectionCount })

    if (unhandledRejectionCount >= 5) {
      log.fatal('[process] too many unhandled rejections, exiting so supervisor can restart')
      void flushSentry().finally(() => process.exit(1))
    }
  })
}
