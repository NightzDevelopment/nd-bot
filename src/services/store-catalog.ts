/**
 * Parse plain-text store listing snapshots and fuzzy-match product names (rules-based, no LLM).
 * Works with FaxStore / Weblutions-style pages that expose "View Item" links in HTML→text.
 */
import { storeFeaturedCount, storeLookupMaxResults, storePageUrl } from '../config.ts'

export type StoreListingItem = {
  title: string
  price: string
  url: string
}

function listingHostname(): string {
  try {
    return new URL(storePageUrl).hostname
  } catch {
    return ''
  }
}

/** Accept item URLs on the same host as STORE_PAGE_URL or obvious store paths. */
function urlMatchesStore(urlStr: string): boolean {
  try {
    const u = new URL(urlStr)
    const h = listingHostname()
    if (h && (u.hostname === h || u.hostname.endsWith(`.${h}`))) return true
    if (/\/store\//i.test(u.pathname)) return true
    return false
  } catch {
    return false
  }
}

function extractBlockBefore(text: string, endIndex: number, maxChars: number): string {
  const start = Math.max(0, endIndex - maxChars)
  return text.slice(start, endIndex)
}

function extractTitleAndPrice(block: string): { title: string; price: string } {
  const lines = block.split(/\n/)
  let title = ''
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim()
    const h2 = /^##\s+(.+)$/.exec(line)
    if (h2) {
      title = h2[1]!.trim()
      break
    }
  }
  if (!title) {
    for (const line of lines) {
      const h1 = /^#\s+(.+)$/.exec(line.trim())
      if (h1) {
        title = h1[1]!.trim().slice(0, 120)
        break
      }
    }
  }
  let price = ''
  for (const line of lines) {
    const t = line.trim()
    if (/^\$[\d.,]+$/.test(t)) {
      price = t
      break
    }
    if (/^FREE$/i.test(t)) {
      price = 'FREE'
      break
    }
  }
  return { title: title || 'Product', price: price || '-' }
}

/** Bare product URLs (HTML→text often omits `[text](url)` markdown). */
const BARE_STORE_URL = /\b(https?:\/\/[^\s\])'">]+\/(?:store|package)\/[^\s\])'">?#]+)/gi

function isProductStorePath(urlStr: string): boolean {
  try {
    const u = new URL(urlStr)
    if (/addcart/i.test(u.pathname + u.search)) return false
    return /\/(?:store|package)\/[^/]+/i.test(u.pathname)
  } catch {
    return false
  }
}

type UrlHit = { url: string; idx: number }

function collectUrlHits(text: string): UrlHit[] {
  const hits: UrlHit[] = []
  const linkMd = /\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/gi
  for (const m of text.matchAll(linkMd)) {
    const url = m[1]!
    if (/addcart/i.test(url)) continue
    if (!urlMatchesStore(url)) continue
    const full = m[0]
    if (!/\bview\s*item\b/i.test(full) && !isProductStorePath(url)) continue
    hits.push({ url, idx: m.index ?? 0 })
  }
  for (const m of text.matchAll(BARE_STORE_URL)) {
    const url = m[1]!.replace(/[),.;]+$/, '')
    if (/addcart/i.test(url)) continue
    if (!urlMatchesStore(url)) continue
    if (!isProductStorePath(url)) continue
    hits.push({ url, idx: m.index ?? 0 })
  }
  return hits
}

/** Extract product rows from snapshot plain text. */
export function parseStoreListingText(text: string): StoreListingItem[] {
  if (!text.trim()) return []
  const out: StoreListingItem[] = []
  const seen = new Set<string>()

  const sorted = collectUrlHits(text).sort((a, b) => a.idx - b.idx)
  for (const { url: rawUrl, idx } of sorted) {
    const url = rawUrl.split('?')[0]!
    const key = url.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)

    const block = extractBlockBefore(text, idx, 4000)
    const { title, price } = extractTitleAndPrice(block)
    let safeTitle = title?.trim() || ''
    if (!safeTitle || safeTitle === 'Product') {
      try {
        const seg = new URL(url).pathname.split('/').filter(Boolean).pop()
        if (seg) {
          safeTitle = decodeURIComponent(seg.replace(/[-_+]/g, ' ')).slice(0, 100)
        }
      } catch {
        safeTitle = safeTitle || 'Product'
      }
    }
    out.push({ title: safeTitle || 'Product', price, url })
  }

  return out
}

function normalizeKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function slugKeysFromUrl(urlStr: string): string[] {
  try {
    const path = new URL(urlStr).pathname
    const seg = path.split('/').filter(Boolean).pop()
    if (!seg) return []
    const dec = decodeURIComponent(seg)
    const full = normalizeKey(dec)
    const noPkg = dec.replace(/^package[-_]/i, '')
    const parts = [full, normalizeKey(noPkg)]
    const numeric = dec.match(/^(?:package[-_])?(\d+)$/)
    if (numeric) parts.push(numeric[1]!)
    return [...new Set(parts.filter(Boolean))]
  } catch {
    return []
  }
}

function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i]![0] = i
  for (let j = 0; j <= n; j++) dp[0]![j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + c)
    }
  }
  return dp[m]![n]!
}

function bestScoreAgainstKeys(q: string, keys: string[]): number {
  if (!q) return 0
  let best = 0
  for (const t of keys) {
    if (!t) continue
    if (t === q) {
      best = Math.max(best, 100)
      continue
    }
    if (t.includes(q) || q.includes(t)) {
      best = Math.max(best, 93)
      continue
    }
    if (q.length >= 3 && t.includes(q)) {
      best = Math.max(best, 90)
      continue
    }
    const dist = levenshtein(q, t)
    const maxLen = Math.max(q.length, t.length, 1)
    const ratio = 1 - dist / maxLen
    best = Math.max(best, ratio * 72)
  }
  return best
}

function scoreMatch(query: string, item: StoreListingItem): number {
  const q = normalizeKey(query.trim())
  if (!q) return 0
  const titleK = normalizeKey(item.title)
  const slugKeys = slugKeysFromUrl(item.url)
  const keys = [...new Set([titleK, ...slugKeys].filter(Boolean))]
  let s = bestScoreAgainstKeys(q, keys)
  if (item.title.toLowerCase().includes(query.trim().toLowerCase())) {
    s = Math.min(100, s + 8)
  }
  for (const sk of slugKeys) {
    if (sk.length >= 4 && (sk.includes(q) || q.includes(sk))) {
      s = Math.max(s, 88)
      break
    }
  }
  return Math.min(100, s)
}

export function lookupStoreListing(
  items: StoreListingItem[],
  query: string,
  limit = storeLookupMaxResults,
): { item: StoreListingItem; score: number }[] {
  const q = query.trim()
  if (!q || items.length === 0) return []
  const scored = items
    .map((item) => ({ item, score: scoreMatch(q, item) }))
    .filter((x) => x.score >= 38)
    .sort((a, b) => b.score - a.score)
  return scored.slice(0, Math.max(1, limit))
}

/** Bullet lines for `/store` embed (curated env wins; else first N parsed). */
export function buildFeaturedLines(
  parsed: StoreListingItem[],
  curatedLines: readonly string[],
): string[] {
  const trimmed = curatedLines.map((l) => l.trim()).filter(Boolean)
  if (trimmed.length > 0) return trimmed.slice(0, storeFeaturedCount)
  return parsed.slice(0, storeFeaturedCount).map((p) => {
    const price = p.price === '-' ? '' : ` - ${p.price}`
    return `**${p.title}**${price} · ${p.url}`
  })
}

export function formatProductLookupReply(
  query: string,
  hits: { item: StoreListingItem; score: number }[],
): string {
  if (hits.length === 0) {
    return (
      `No match in the cached store listing for **${query}**. ` +
      `Try \`/store\` or open <${storePageUrl}>, or set a manual alias in \`PRODUCT_ALIAS_URLS\`.`
    )
  }
  const lines = hits.map(
    (h) =>
      `• **${h.item.title}** - ${h.item.price} - ${h.item.url} _(score ${Math.round(h.score)})_`,
  )
  return `Matches for **${query}** (cached Nightz listing):\n${lines.join('\n')}`.slice(0, 3900)
}

/** Short block appended to commerce-related ticket welcome follow-ups. */
export function buildTicketProductHintBlock(listingText: string): string {
  const items = parseStoreListingText(listingText)
  if (items.length === 0) return ''
  const lines = items
    .slice(0, 5)
    .map((p) => `• **${p.title}** (${p.price}) - ${p.url}`)
    .join('\n')
  return (
    `\n\n**Which product?** Name the **resource** or paste a store link.\n` +
    `Examples from the **current store snapshot** (verify on the site):\n${lines}`
  )
}
