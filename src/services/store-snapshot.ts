/**
 * Fetches the public ND **FaxStore** listing (HTML→text), caches under DATA_DIR,
 * and injects into AI user-turn context (and optional embedding corpus when enabled).
 * Platform: https://weblutions.com/store/faxstore · listing URL from `STORE_PAGE_URL`.
 */
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import {
  storeFeaturedLines,
  storePageFetchTimeoutMs,
  storePageMaxChars,
  storePageSnapshotEnabled,
  storePageUrl,
  storeSnapshotStaleMinutes,
} from '../config.ts'
import { dataPath, ensureDataDir, writeJson } from './data-store.ts'
import { buildFeaturedLines, lookupStoreListing, parseStoreListingText } from './store-catalog.ts'

const CACHE_FILE = 'store-page-snapshot.json'
const UA = 'ND-Discord-Gemini-Bot/1.0 (+https://nightz.dev; store context snapshot)'

type Cache = { url: string; text: string; fetchedAt: number }

let cached: Cache | null = null
let lastFetchError: string | null = null

function htmlToPlainText(raw: string): string {
  let t = raw
  t = t.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
  t = t.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
  t = t.replace(/<br\s*\/?>/gi, '\n')
  t = t.replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
  t = t.replace(/<[^>]+>/g, ' ')
  t = t.replace(/&nbsp;/gi, ' ')
  t = t.replace(/&amp;/g, '&')
  t = t.replace(/&lt;/g, '<')
  t = t.replace(/&gt;/g, '>')
  t = t.replace(/&quot;/g, '"')
  t = t.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number.parseInt(n, 10)))
  t = t.replace(/\r\n/g, '\n')
  t = t.replace(/[ \t]+\n/g, '\n')
  t = t.replace(/\n{3,}/g, '\n\n')
  t = t.replace(/[ \t]{2,}/g, ' ')
  return t.trim()
}

function normalizeFetchedText(body: string): string {
  const trimmed = body.trim()
  const looksHtml = /<html[\s>]/i.test(trimmed) || /<\/?[a-z][\s\w:-]*>/i.test(trimmed)
  const text = looksHtml ? htmlToPlainText(body) : body
  const cut =
    text.length > storePageMaxChars ? text.slice(0, storePageMaxChars) + '\n…[truncated]' : text
  return cut.trim()
}

async function readCacheFromDisk(): Promise<Cache | null> {
  try {
    const raw = await readFile(dataPath(CACHE_FILE), 'utf8')
    return parseCacheJson(raw)
  } catch {
    /* missing or invalid */
  }
  return null
}

function parseCacheJson(raw: string): Cache | null {
  try {
    const j = JSON.parse(raw) as Partial<Cache>
    if (typeof j.text === 'string' && j.text.length > 0 && typeof j.fetchedAt === 'number') {
      return {
        url: typeof j.url === 'string' ? j.url : storePageUrl,
        text: j.text,
        fetchedAt: j.fetchedAt,
      }
    }
  } catch {
    /* invalid */
  }
  return null
}

/** Hydrate memory from disk so health/lookup work before the first scheduled refresh. */
export function hydrateStoreCacheFromDiskSync(): void {
  if (cached) return
  try {
    const raw = readFileSync(dataPath(CACHE_FILE), 'utf8')
    const c = parseCacheJson(raw)
    if (c) cached = c
  } catch {
    /* no file */
  }
}

async function writeCache(c: Cache): Promise<void> {
  await ensureDataDir()
  await writeJson(CACHE_FILE, c)
}

/** Plain text for embedding index (same cap as live context). */
export function getStorePageTextForEmbedding(): string {
  if (!storePageSnapshotEnabled) return ''
  if (!cached?.text) hydrateStoreCacheFromDiskSync()
  return cached?.text ?? ''
}

/**
 * Block injected ahead of vector/product/code context so the model sees current store titles/prices.
 */
export function buildStorePageContext(): string {
  if (!storePageSnapshotEnabled) return ''
  if (!cached?.text) hydrateStoreCacheFromDiskSync()
  if (!cached?.text) return ''
  const iso = new Date(cached.fetchedAt).toISOString()
  return [
    '**Live Nightz store catalog (FaxStore; text snapshot from the public listing — prices/titles change, confirm on the site):**',
    `Source: ${cached.url} (fetched ${iso})`,
    cached.text,
  ].join('\n')
}

export async function refreshStoreSnapshot(): Promise<void> {
  if (!storePageSnapshotEnabled) {
    cached = null
    return
  }

  try {
    const ac = new AbortController()
    const to = setTimeout(() => ac.abort(), storePageFetchTimeoutMs)
    const res = await fetch(storePageUrl, {
      signal: ac.signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
        'User-Agent': UA,
      },
      redirect: 'follow',
    })
    clearTimeout(to)
    if (!res.ok) {
      lastFetchError = `HTTP ${res.status}`
      console.warn(`[store-snapshot] HTTP ${res.status} for ${storePageUrl}`)
    } else {
      const body = await res.text()
      const text = normalizeFetchedText(body)
      if (text.length < 200) {
        console.warn(
          '[store-snapshot] response very short — page may be JS-only; snapshot may be low-value',
        )
      }
      cached = { url: storePageUrl, text, fetchedAt: Date.now() }
      lastFetchError = null
      await writeCache(cached)
      console.log(`[store-snapshot] refreshed ${text.length} char(s) from ${storePageUrl}`)
      void import('./embeddings.ts').then((m) => m.scheduleEmbeddingRebuild()).catch(() => {})
      return
    }
  } catch (e) {
    lastFetchError = String((e as Error)?.message ?? e).slice(0, 200)
    console.warn('[store-snapshot] fetch failed:', e)
  }

  const disk = await readCacheFromDisk()
  if (disk) {
    cached = disk
    console.warn(
      `[store-snapshot] using on-disk cache (${disk.text.length} char(s), fetched ${new Date(disk.fetchedAt).toISOString()})`,
    )
  } else {
    cached = null
  }

  void import('./embeddings.ts').then((m) => m.scheduleEmbeddingRebuild()).catch(() => {})
}

export function startStorePageSnapshotLoop(refreshMs: number): void {
  if (!storePageSnapshotEnabled) return
  setInterval(() => void refreshStoreSnapshot(), refreshMs).unref?.()
}

export type StoreSnapshotHealth = {
  enabled: boolean
  status: 'disabled' | 'empty' | 'stale' | 'ok' | 'error'
  ageMinutes: number | null
  charCount: number
  url: string
  lastError: string | null
}

export function getStoreSnapshotHealth(): StoreSnapshotHealth {
  hydrateStoreCacheFromDiskSync()
  if (!storePageSnapshotEnabled) {
    return {
      enabled: false,
      status: 'disabled',
      ageMinutes: null,
      charCount: 0,
      url: storePageUrl,
      lastError: null,
    }
  }
  const text = cached?.text ?? ''
  if (!text.length) {
    const st: StoreSnapshotHealth['status'] = lastFetchError ? 'error' : 'empty'
    return {
      enabled: true,
      status: st,
      ageMinutes: null,
      charCount: 0,
      url: storePageUrl,
      lastError: lastFetchError,
    }
  }
  const fetchedAt = cached!.fetchedAt
  const ageMinutes = (Date.now() - fetchedAt) / 60000
  const stale = ageMinutes > storeSnapshotStaleMinutes
  return {
    enabled: true,
    status: stale ? 'stale' : 'ok',
    ageMinutes,
    charCount: text.length,
    url: cached!.url,
    lastError: stale ? lastFetchError : null,
  }
}

/** One line for `/ping`, `nd!ping`, `/status`, `buildHealthSummary`. */
export function formatStoreHealthOneLiner(): string {
  const h = getStoreSnapshotHealth()
  if (!h.enabled) return '**Store snapshot:** disabled'
  const age = h.ageMinutes == null ? '—' : `${Math.max(0, Math.floor(h.ageMinutes))} min`
  const err = h.lastError ? ` · err: ${h.lastError}` : ''
  return `**Store snapshot:** ${h.status} · ${age} ago · ${h.charCount} chars${err}`
}

/** Markdown for `/store` and `nd!store` (no embed required). */
export function buildStoreCommandBody(): string {
  hydrateStoreCacheFromDiskSync()
  const h = getStoreSnapshotHealth()
  const text = cached?.text ?? ''
  const parsed = parseStoreListingText(text)
  const featured = buildFeaturedLines(parsed, storeFeaturedLines)
  const lines: string[] = [
    '**Nightz store**',
    `**Browse:** ${storePageUrl}`,
    '',
    `**Bot snapshot:** ${h.status} · ${h.charCount ? `${h.charCount} chars` : 'no data'} · age ${h.ageMinutes != null ? `${Math.floor(h.ageMinutes)} min` : '—'}`,
  ]
  if (featured.length) {
    lines.push('', '**Featured**')
    for (const f of featured) lines.push(`• ${f}`)
  } else if (h.enabled && !text.length) {
    lines.push(
      '',
      '_No listing text cached yet. Wait for refresh or check `STORE_PAGE_URL` and bot outbound access._',
    )
  }
  lines.push('', 'Confirm price and details on the live store.')
  return lines.join('\n').slice(0, 3900)
}

export function getStoreListingPlaintext(): string {
  hydrateStoreCacheFromDiskSync()
  return cached?.text ?? ''
}

export function lookupProductsFromSnapshot(query: string) {
  hydrateStoreCacheFromDiskSync()
  const items = parseStoreListingText(cached?.text ?? '')
  return lookupStoreListing(items, query)
}
