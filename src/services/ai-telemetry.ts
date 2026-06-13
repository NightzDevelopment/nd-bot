/**
 * Lightweight AI usage / cost telemetry. Counts calls and errors per provider
 * (gemini / claude / openai) plus response-cache hits and misses. Counters are
 * cumulative and persisted to disk (throttled) so they survive restarts.
 *
 * In `auto` mode the bot tries Gemini, then Claude, then OpenAI; the per-
 * provider "served" counts therefore double as a fallback indicator (any
 * claude/openai calls while auto is selected were fallbacks).
 *
 * Instrumentation lives at the three provider chokepoints:
 *   - gemini.ts  withModelFallback      (Gemini)
 *   - gemini.ts  openAiChatCompletion   (OpenAI)
 *   - claude-client.ts withClaudeFallback (Claude)
 */
import { childLogger } from '../lib/logger.ts'
import { readJson, writeJson } from './data-store.ts'

const log = childLogger('ai-telemetry')

export type AiProvider = 'gemini' | 'claude' | 'openai'

type ProviderStats = { calls: number; errors: number }
type Telemetry = {
  since: number
  providers: Record<AiProvider, ProviderStats>
  cache: { hits: number; misses: number }
}

const FILE = 'ai-telemetry.json'

function blank(): Telemetry {
  return {
    since: Date.now(),
    providers: {
      gemini: { calls: 0, errors: 0 },
      claude: { calls: 0, errors: 0 },
      openai: { calls: 0, errors: 0 },
    },
    cache: { hits: 0, misses: 0 },
  }
}

const state: Telemetry = blank()

let loadPromise: Promise<void> | null = null
/** Merge any persisted counters into the in-memory state exactly once. */
function ensureLoaded(): Promise<void> {
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        const disk = await readJson<Telemetry>(FILE, blank())
        if (disk?.providers) {
          for (const p of ['gemini', 'claude', 'openai'] as const) {
            const d = disk.providers[p]
            if (d) {
              state.providers[p].calls += d.calls || 0
              state.providers[p].errors += d.errors || 0
            }
          }
        }
        if (disk?.cache) {
          state.cache.hits += disk.cache.hits || 0
          state.cache.misses += disk.cache.misses || 0
        }
        if (typeof disk?.since === 'number' && disk.since > 0) state.since = disk.since
      } catch (e) {
        log.warn({ err: e }, 'telemetry load failed; starting fresh')
      }
    })()
  }
  return loadPromise
}

let dirty = false
let lastFlush = 0
const FLUSH_EVERY_MS = 60_000
function maybeFlush(): void {
  dirty = true
  const now = Date.now()
  if (now - lastFlush < FLUSH_EVERY_MS) return
  lastFlush = now
  dirty = false
  void writeJson(FILE, state).catch((e) => log.warn({ err: e }, 'telemetry flush failed'))
}

export function recordAiCall(provider: AiProvider): void {
  void ensureLoaded()
  state.providers[provider].calls++
  maybeFlush()
}
export function recordAiError(provider: AiProvider): void {
  void ensureLoaded()
  state.providers[provider].errors++
  maybeFlush()
}
export function recordCacheHit(): void {
  void ensureLoaded()
  state.cache.hits++
  maybeFlush()
}
export function recordCacheMiss(): void {
  void ensureLoaded()
  state.cache.misses++
  maybeFlush()
}

export type AiTelemetrySnapshot = Telemetry & {
  totalCalls: number
  totalErrors: number
  fallbackCalls: number
  cacheHitRate: number
}

export async function getAiTelemetry(): Promise<AiTelemetrySnapshot> {
  await ensureLoaded()
  const p = state.providers
  const totalCalls = p.gemini.calls + p.claude.calls + p.openai.calls
  const totalErrors = p.gemini.errors + p.claude.errors + p.openai.errors
  // In auto mode the primary is Gemini, so claude/openai successes are fallbacks.
  const fallbackCalls = p.claude.calls + p.openai.calls
  const cacheTotal = state.cache.hits + state.cache.misses
  return {
    since: state.since,
    providers: { gemini: { ...p.gemini }, claude: { ...p.claude }, openai: { ...p.openai } },
    cache: { ...state.cache },
    totalCalls,
    totalErrors,
    fallbackCalls,
    cacheHitRate: cacheTotal > 0 ? state.cache.hits / cacheTotal : 0,
  }
}

export async function resetAiTelemetry(): Promise<void> {
  await ensureLoaded()
  const fresh = blank()
  state.since = fresh.since
  state.providers = fresh.providers
  state.cache = fresh.cache
  lastFlush = 0
  await writeJson(FILE, state)
}

/** Eager load so the first AI call doesn't race the disk read (optional). */
export async function initAiTelemetry(): Promise<void> {
  await ensureLoaded()
}
