/**
 * Live Nightz store catalog via the public JSON API (STORE_API_BASE).
 *
 * Replaces the old HTML-scrape snapshot: the storefront is client-rendered, so a
 * plain fetch of the page returns no catalog. This pulls the structured product
 * list and premium config, caches under DATA_DIR, and injects real product
 * names + prices into AI context (and the optional embedding corpus). All money
 * from the API is integer minor units (cents) with a `currency` field.
 *
 * The exported function names match the previous snapshot module so every caller
 * (bot.ts loop, /store + /product commands, health, context-bundle, embeddings)
 * keeps working unchanged.
 */
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import {
  storeApiBase,
  storeFeaturedCount,
  storeFeaturedLines,
  storePageFetchTimeoutMs,
  storePageMaxChars,
  storePageSnapshotEnabled,
  storePageUrl,
  storeSnapshotStaleMinutes,
} from '../config.ts'
import { dataPath, ensureDataDir, writeJson } from './data-store.ts'
import {
  buildFeaturedLines,
  lookupStoreListing,
  type StoreListingItem,
} from './store-catalog.ts'

const CACHE_FILE = 'store-catalog.json'

export type StoreProduct = {
  name: string
  slug: string
  url: string
  priceCents: number
  basePriceCents: number
  currency: string
  onSale: boolean
  percentOff: number
  isSubscription: boolean
  premiumIncluded: boolean
  free: boolean
  saleEndsAt: string | null
}

export type PremiumConfig = {
  enabled: boolean
  currency: string
  monthlyCents: number
  threeMonthCents: number
  sixMonthCents: number
  yearlyCents: number
  lifetimeCents: number
  memberDiscountPercent: number
}

type Cache = { products: StoreProduct[]; premium: PremiumConfig | null; fetchedAt: number }

let cached: Cache | null = null
let lastFetchError: string | null = null

// ---- formatting -----------------------------------------------------------

function formatMoney(cents: number, currency: string): string {
  const amount = (Math.max(0, cents) / 100).toFixed(2)
  return currency === 'USD' ? `$${amount}` : `${amount} ${currency}`
}

/** Storefront origin, for building product page links from a slug. */
function productBaseUrl(): string {
  try {
    return `${new URL(storePageUrl).origin}/products`
  } catch {
    return 'https://shop.nightz.dev/products'
  }
}

// ---- API fetch + mapping --------------------------------------------------

function num(v: unknown, def = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : def
}

function mapProduct(p: Record<string, unknown>): StoreProduct {
  const slug = typeof p.slug === 'string' ? p.slug : ''
  const currency = typeof p.currency === 'string' ? p.currency : 'USD'
  const priceCents = num(p.price_cents, num(p.base_price_cents, 0))
  return {
    name: typeof p.name === 'string' ? p.name : slug || 'Product',
    slug,
    url: `${productBaseUrl()}/${slug}`,
    priceCents,
    basePriceCents: num(p.base_price_cents, priceCents),
    currency,
    onSale: p.on_sale === true,
    percentOff: num(p.percent_off, 0),
    isSubscription: p.is_subscription === true,
    premiumIncluded: p.premium_included === true,
    free: priceCents === 0,
    saleEndsAt: typeof p.sale_ends_at === 'string' ? p.sale_ends_at : null,
  }
}

async function fetchJson(url: string): Promise<unknown> {
  const ac = new AbortController()
  const to = setTimeout(() => ac.abort(), storePageFetchTimeoutMs)
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'ND-Discord-Bot/1.0' },
      redirect: 'follow',
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(to)
  }
}

async function fetchAllProducts(): Promise<StoreProduct[]> {
  const out: StoreProduct[] = []
  let page = 1
  let pages = 1
  // Hard page cap so a bad pagination field cannot loop forever.
  do {
    const body = (await fetchJson(`${storeApiBase}/products?limit=100&page=${page}`)) as {
      data?: unknown[]
      pagination?: { pages?: number }
    }
    const data = Array.isArray(body?.data) ? body.data : []
    for (const item of data) {
      if (item && typeof item === 'object') out.push(mapProduct(item as Record<string, unknown>))
    }
    pages = num(body?.pagination?.pages, 1)
    page++
  } while (page <= pages && page <= 25)
  return out
}

async function fetchPremium(): Promise<PremiumConfig | null> {
  try {
    const body = (await fetchJson(`${storeApiBase}/premium/config`)) as { data?: Record<string, unknown> }
    const d = body?.data
    if (!d || typeof d !== 'object') return null
    return {
      enabled: d.enabled === true,
      currency: typeof d.currency === 'string' ? d.currency : 'USD',
      monthlyCents: num(d.monthly_price_cents),
      threeMonthCents: num(d.three_month_price_cents),
      sixMonthCents: num(d.six_month_price_cents),
      yearlyCents: num(d.yearly_price_cents),
      lifetimeCents: num(d.lifetime_price_cents),
      memberDiscountPercent: num(d.member_discount_percent),
    }
  } catch (e) {
    console.warn('[store-catalog] premium config fetch failed:', e)
    return null
  }
}

// ---- disk cache -----------------------------------------------------------

function parseCacheJson(raw: string): Cache | null {
  try {
    const j = JSON.parse(raw) as Partial<Cache>
    if (Array.isArray(j.products) && typeof j.fetchedAt === 'number') {
      return { products: j.products, premium: j.premium ?? null, fetchedAt: j.fetchedAt }
    }
  } catch {
    /* invalid */
  }
  return null
}

export function hydrateStoreCacheFromDiskSync(): void {
  if (cached) return
  try {
    const c = parseCacheJson(readFileSync(dataPath(CACHE_FILE), 'utf8'))
    if (c) cached = c
  } catch {
    /* no file */
  }
}

async function readCacheFromDisk(): Promise<Cache | null> {
  try {
    return parseCacheJson(await readFile(dataPath(CACHE_FILE), 'utf8'))
  } catch {
    return null
  }
}

// ---- context builders -----------------------------------------------------

/** True when we have a usable catalog (products or premium) in memory or on disk. */
function hasData(): boolean {
  if (!cached) hydrateStoreCacheFromDiskSync()
  return !!cached && (cached.products.length > 0 || cached.premium != null)
}

function productLine(p: StoreProduct): string {
  if (p.free) {
    const tag = p.premiumIncluded ? ' [included with Premium]' : ''
    return `- ${p.name}: FREE${tag}. ${p.url}`
  }
  const price = formatMoney(p.priceCents, p.currency)
  const sale = p.onSale
    ? ` (on sale ${p.percentOff}% off, was ${formatMoney(p.basePriceCents, p.currency)}${
        p.saleEndsAt ? `, ends ${p.saleEndsAt.slice(0, 10)}` : ''
      })`
    : ''
  const recurring = p.isSubscription ? ' per month' : ' one-time'
  const premium = p.premiumIncluded ? ' [free for Premium members]' : ''
  return `- ${p.name}: ${price}${recurring}${sale}${premium}. ${p.url}`
}

function premiumLine(prem: PremiumConfig): string {
  if (!prem.enabled) return ''
  const c = prem.currency
  const parts: string[] = []
  if (prem.monthlyCents) parts.push(`${formatMoney(prem.monthlyCents, c)}/month`)
  if (prem.threeMonthCents) parts.push(`${formatMoney(prem.threeMonthCents, c)}/3 months`)
  if (prem.sixMonthCents) parts.push(`${formatMoney(prem.sixMonthCents, c)}/6 months`)
  if (prem.yearlyCents) parts.push(`${formatMoney(prem.yearlyCents, c)}/year`)
  if (prem.lifetimeCents) parts.push(`${formatMoney(prem.lifetimeCents, c)} lifetime`)
  const discount = prem.memberDiscountPercent
    ? ` Members save ${prem.memberDiscountPercent}% on everything else.`
    : ''
  return `Premium membership: ${parts.join(', ')}.${discount}`
}

function buildCatalogText(): string {
  if (!cached) return ''
  const lines: string[] = []
  if (cached.products.length > 0) {
    lines.push('Products (live prices, confirm on the store before purchase):')
    for (const p of cached.products) lines.push(productLine(p))
  }
  if (cached.premium && cached.premium.enabled) {
    lines.push('', premiumLine(cached.premium))
  }
  const text = lines.join('\n')
  return text.length > storePageMaxChars ? `${text.slice(0, storePageMaxChars)}\n...[truncated]` : text
}

/** Block injected ahead of other context so the model sees current titles/prices. */
export function buildStorePageContext(): string {
  if (!storePageSnapshotEnabled) return ''
  if (!hasData()) return ''
  return `**Live Nightz store catalog (real prices from the store API; sales and prices can change, confirm on the site):**\n${buildCatalogText()}`
}

/** Plain text for the embedding index. */
export function getStorePageTextForEmbedding(): string {
  if (!storePageSnapshotEnabled) return ''
  if (!hasData()) return ''
  return buildCatalogText()
}

// ---- refresh loop ---------------------------------------------------------

export async function refreshStoreSnapshot(): Promise<void> {
  if (!storePageSnapshotEnabled) {
    cached = null
    return
  }
  try {
    const [products, premium] = await Promise.all([fetchAllProducts(), fetchPremium()])
    if (products.length === 0 && !premium) {
      throw new Error('catalog returned no products and no premium config')
    }
    cached = { products, premium, fetchedAt: Date.now() }
    lastFetchError = null
    await ensureDataDir()
    await writeJson(CACHE_FILE, cached)
    console.log(`[store-catalog] refreshed ${products.length} product(s) from ${storeApiBase}`)
    void import('./embeddings.ts').then((m) => m.scheduleEmbeddingRebuild()).catch(() => {})
    return
  } catch (e) {
    lastFetchError = String((e as Error)?.message ?? e).slice(0, 200)
    console.warn('[store-catalog] refresh failed:', lastFetchError)
  }

  const disk = await readCacheFromDisk()
  if (disk) {
    cached = disk
    console.warn(
      `[store-catalog] using on-disk cache (${disk.products.length} product(s), fetched ${new Date(disk.fetchedAt).toISOString()})`,
    )
  }
  void import('./embeddings.ts').then((m) => m.scheduleEmbeddingRebuild()).catch(() => {})
}

export function startStorePageSnapshotLoop(refreshMs: number): void {
  if (!storePageSnapshotEnabled) return
  setInterval(() => void refreshStoreSnapshot(), refreshMs).unref?.()
}

// ---- health ---------------------------------------------------------------

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
    return { enabled: false, status: 'disabled', ageMinutes: null, charCount: 0, url: storePageUrl, lastError: null }
  }
  const count = cached?.products.length ?? 0
  if (count === 0 && !cached?.premium) {
    return {
      enabled: true,
      status: lastFetchError ? 'error' : 'empty',
      ageMinutes: null,
      charCount: 0,
      url: storePageUrl,
      lastError: lastFetchError,
    }
  }
  const ageMinutes = (Date.now() - (cached?.fetchedAt ?? 0)) / 60000
  const stale = ageMinutes > storeSnapshotStaleMinutes
  return {
    enabled: true,
    status: stale ? 'stale' : 'ok',
    ageMinutes,
    charCount: count,
    url: storePageUrl,
    lastError: stale ? lastFetchError : null,
  }
}

/** One line for `/ping`, `/status`, health summary. */
export function formatStoreHealthOneLiner(): string {
  const h = getStoreSnapshotHealth()
  if (!h.enabled) return '**Store catalog:** disabled'
  const age = h.ageMinutes == null ? '-' : `${Math.max(0, Math.floor(h.ageMinutes))} min`
  const err = h.lastError ? ` · err: ${h.lastError}` : ''
  return `**Store catalog:** ${h.status} · ${h.charCount} product(s) · ${age} ago${err}`
}

// ---- command surface ------------------------------------------------------

function productsAsListingItems(): StoreListingItem[] {
  hydrateStoreCacheFromDiskSync()
  return (cached?.products ?? []).map((p) => ({
    title: p.name,
    price: p.free ? 'FREE' : formatMoney(p.priceCents, p.currency),
    url: p.url,
  }))
}

/** Markdown for `/store` and `nd!store`. */
export function buildStoreCommandBody(): string {
  hydrateStoreCacheFromDiskSync()
  const h = getStoreSnapshotHealth()
  const items = productsAsListingItems()
  const featured = buildFeaturedLines(items, storeFeaturedLines)
  const lines: string[] = [
    '**Nightz store**',
    `**Browse:** ${storePageUrl}`,
    '',
    `**Catalog:** ${h.status} · ${h.charCount} product(s) · age ${
      h.ageMinutes != null ? `${Math.floor(h.ageMinutes)} min` : '-'
    }`,
  ]
  if (featured.length) {
    lines.push('', '**Featured**')
    for (const f of featured.slice(0, storeFeaturedCount)) lines.push(`- ${f}`)
  } else if (h.charCount === 0) {
    lines.push('', '_Catalog not loaded yet. Try again shortly or check the store directly._')
  }
  if (cached?.premium?.enabled) {
    lines.push('', premiumLine(cached.premium))
  }
  lines.push('', 'Confirm current prices and details on the live store.')
  return lines.join('\n').slice(0, 3900)
}

export function getStoreListingPlaintext(): string {
  hydrateStoreCacheFromDiskSync()
  return buildCatalogText()
}

export function lookupProductsFromSnapshot(query: string) {
  return lookupStoreListing(productsAsListingItems(), query)
}

/** A few example products to seed a ticket's "which product?" prompt. */
export function buildTicketProductHint(): string {
  const items = productsAsListingItems()
  if (items.length === 0) return ''
  const lines = items
    .slice(0, 5)
    .map((p) => `- **${p.title}** (${p.price}) ${p.url}`)
    .join('\n')
  return (
    `\n\n**Which product?** Name the resource or paste a store link.\n` +
    `Examples from the current catalog (verify on the site):\n${lines}`
  )
}
