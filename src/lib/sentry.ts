/**
 * Sentry initialization.
 *
 * Opt-in: only initializes if SENTRY_DSN is set. No-op otherwise, so local
 * dev and CI don't need a Sentry account.
 *
 * Environment:
 *   - SENTRY_DSN              — required to enable Sentry
 *   - SENTRY_ENVIRONMENT      — defaults to NODE_ENV or 'development'
 *   - SENTRY_RELEASE          — optional, e.g. git SHA
 *   - SENTRY_TRACES_SAMPLE_RATE — 0.0-1.0; default 0 (no perf monitoring)
 *
 * Call initSentry() ONCE from src/process-guards.ts before anything else.
 * Then anywhere in the codebase:
 *   import { captureException } from '../lib/sentry.ts'
 *   captureException(err, { feature: 'automod' })
 */
import * as Sentry from '@sentry/node'

import { childLogger } from './logger.ts'

const log = childLogger('sentry')

let initialized = false

export function initSentry(): void {
  if (initialized) return
  const dsn = process.env.SENTRY_DSN
  if (!dsn) {
    log.debug('SENTRY_DSN not set; Sentry disabled')
    return
  }
  const environment = process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development'
  const release = process.env.SENTRY_RELEASE
  const tracesSampleRate = Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0')

  Sentry.init({
    dsn,
    environment,
    ...(release ? { release } : {}),
    tracesSampleRate: Number.isFinite(tracesSampleRate) ? tracesSampleRate : 0,
    // Reduce noise: drop ECONNRESET and DiscordAPIError 50001 (missing access).
    beforeSend(event, hint) {
      const err = hint.originalException
      if (err && typeof err === 'object') {
        const code = (err as { code?: unknown }).code
        if (code === 'ECONNRESET' || code === 50001) return null
      }
      return event
    },
  })

  initialized = true
  log.info({ environment, release: release ?? null }, 'Sentry initialized')
}

export function captureException(err: unknown, context?: Record<string, unknown>): void {
  if (!initialized) return
  Sentry.captureException(err, context ? { extra: context } : undefined)
}

export function captureMessage(message: string, context?: Record<string, unknown>): void {
  if (!initialized) return
  Sentry.captureMessage(message, context ? { extra: context } : undefined)
}

/** Flush pending events before process exit. Call from uncaughtException handler. */
export async function flushSentry(timeoutMs = 2000): Promise<void> {
  if (!initialized) return
  try {
    await Sentry.flush(timeoutMs)
  } catch {
    // best-effort
  }
}
