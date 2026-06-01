/**
 * Structured logger backed by pino.
 *
 * Use a child logger with a namespace so log lines stay greppable:
 *   import { logger } from '../lib/logger.ts'
 *   const log = logger.child({ ns: 'dashboard' })
 *   log.info({ port }, 'listening')
 *
 * Output format:
 *   - dev (NODE_ENV !== 'production'): pretty-printed, colored, single-line
 *   - prod: NDJSON (one JSON record per line) — easy to ship to any log
 *     aggregator (Loki, Datadog, CloudWatch, etc.)
 *
 * Levels respect LOG_LEVEL env var (trace/debug/info/warn/error/fatal).
 * Defaults to 'info'.
 *
 * Migration note: `console.log/warn/error` calls across src/ have NOT been
 * replaced yet (128 files). Migrate opportunistically — both work side-by-side.
 */
import pino, { type Logger, type LoggerOptions } from 'pino'

const isProd = process.env.NODE_ENV === 'production'
const level = (process.env.LOG_LEVEL ?? 'info').toLowerCase()

const baseOptions: LoggerOptions = {
  level,
  base: { pid: process.pid },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => ({ level: label }),
  },
  // Redact common secret-ish keys in case they ever land in a log payload.
  redact: {
    paths: [
      'token',
      'TOKEN',
      'apiKey',
      'API_KEY',
      'authorization',
      'Authorization',
      '*.token',
      '*.apiKey',
      '*.authorization',
    ],
    censor: '[REDACTED]',
  },
}

const prettyTransport = !isProd
  ? {
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss.l',
          ignore: 'pid,hostname',
          singleLine: true,
        },
      },
    }
  : {}

export const logger: Logger = pino({ ...baseOptions, ...prettyTransport })

/** Convenience factory: `const log = childLogger('automod')`. */
export function childLogger(namespace: string, extra?: Record<string, unknown>): Logger {
  return logger.child({ ns: namespace, ...extra })
}
