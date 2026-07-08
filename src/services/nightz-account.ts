/**
 * Nightz website account bridge.
 *
 * A thin, read-only client for the website's authenticated bot gateway
 * (/api/internal/bot). It turns a member's Discord id into real account facts -
 * linked account, licenses (status, expiry, bound IPs), recent orders, product
 * entitlement, Premium status - so the bot can answer "do I own X", "when does my
 * license expire", "what's my order status" in Discord instead of guessing.
 *
 * Design mirrors store-catalog.ts: built on global fetch, hard timeout, no SDK,
 * and it NEVER throws to the caller. Any failure (gateway off, network, bad
 * secret, unlinked member) resolves to a structured "unavailable"/"not linked"
 * result the command layer can render as a friendly hint.
 *
 * The secret (NIGHTZ_GATEWAY_SECRET) must match the website's BOT_GATEWAY_SECRET.
 */
import {
  nightzGatewayBase,
  nightzGatewayEnabled,
  nightzGatewaySecret,
  nightzGatewayTimeoutMs,
  storePageUrl,
} from '../config.ts'

export type GatewayLicenseIp = {
  ip: string
  hostname: string | null
  is_active: boolean
  last_seen_at: string | null
}

export type GatewayLicense = {
  uuid: string
  license_key: string
  product_name: string | null
  product_slug: string | null
  status: string
  max_activations: number
  activation_count: number
  issued_at: string | null
  expires_at: string | null
  ips: GatewayLicenseIp[]
}

export type GatewayOrder = {
  uuid: string
  status: string
  total_cents: number
  currency: string
  created_at: string | null
}

export type GatewayAccount = {
  uuid: string
  username: string | null
  display_name: string | null
  email_masked: string | null
  role: string
  is_management: boolean
  is_active: boolean
  is_premium: boolean
  premium_since: string | null
  premium_plan: string | null
  license_count: number
  order_count: number
  member_since: string | null
}

export type EntitlementResult = {
  linked: boolean
  owns: boolean
  reason: 'not_linked' | 'unknown_product' | 'license' | 'premium' | 'not_owned'
  product?: { name: string; slug: string; premium_included: boolean }
  license?: { uuid: string; status: string; expires_at: string | null }
}

// ---- low-level fetch --------------------------------------------------------

/** The website /account page, for the "link your Discord" hint. */
export function accountPageUrl(): string {
  try {
    return `${new URL(storePageUrl).origin}/account`
  } catch {
    return 'https://shop.nightz.dev/account'
  }
}

async function gatewayGet<T>(path: string): Promise<T | null> {
  if (!nightzGatewayEnabled) return null
  const ac = new AbortController()
  const to = setTimeout(() => ac.abort(), nightzGatewayTimeoutMs)
  try {
    const res = await fetch(`${nightzGatewayBase}${path}`, {
      signal: ac.signal,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${nightzGatewaySecret}`,
        'User-Agent': 'ND-Discord-Bot/1.0',
      },
      redirect: 'follow',
    })
    if (!res.ok) {
      console.warn(`[nightz-account] ${path} -> HTTP ${res.status}`)
      return null
    }
    const body = (await res.json()) as { data?: T }
    return (body?.data ?? null) as T | null
  } catch (e) {
    console.warn('[nightz-account] fetch failed:', String((e as Error)?.message ?? e))
    return null
  } finally {
    clearTimeout(to)
  }
}

// Snowflakes only; refuse anything else before it hits the gateway.
function isSnowflake(id: string): boolean {
  return /^\d{5,32}$/.test(id)
}

// Does a message look account-related? Used to gate the (networked) account
// context lookup so casual chatter never triggers a gateway call - only messages
// about keys/licenses/orders/premium/etc. pull the asker's account facts.
const ACCOUNT_INTENT_RE =
  /\b(my\s+(account|key|license|licence|order|sub|purchase|server)|account|licen[sc]e|license\s*key|order|purchase|receipt|invoice|subscription|premium|expir\w*|renew\w*|refund|invalid|activat\w*|server\s*ip|ip\s*(bind|bound|slot)|entitl\w*|download|owned?)\b/i
export function looksAccountRelated(text: string): boolean {
  return ACCOUNT_INTENT_RE.test(text || '')
}

// ---- typed lookups ----------------------------------------------------------

export async function getAccountSummary(
  discordId: string,
): Promise<{ linked: boolean; account?: GatewayAccount } | null> {
  if (!isSnowflake(discordId)) return { linked: false }
  return gatewayGet(`/user/${discordId}`)
}

export async function getLicenses(
  discordId: string,
): Promise<{ linked: boolean; licenses: GatewayLicense[] } | null> {
  if (!isSnowflake(discordId)) return { linked: false, licenses: [] }
  return gatewayGet(`/user/${discordId}/licenses`)
}

export async function getOrders(
  discordId: string,
): Promise<{ linked: boolean; orders: GatewayOrder[] } | null> {
  if (!isSnowflake(discordId)) return { linked: false, orders: [] }
  return gatewayGet(`/user/${discordId}/orders`)
}

export async function getEntitlement(
  discordId: string,
  slug: string,
): Promise<EntitlementResult | null> {
  if (!isSnowflake(discordId)) return { linked: false, owns: false, reason: 'not_linked' }
  const clean = encodeURIComponent(slug.trim().toLowerCase())
  return gatewayGet(`/user/${discordId}/entitlement/${clean}`)
}

// ---- presentation -----------------------------------------------------------

function dateOnly(iso: string | null): string {
  return iso ? iso.slice(0, 10) : '-'
}

function licenseLine(l: GatewayLicense): string {
  const name = l.product_name ?? l.product_slug ?? 'Product'
  const expiry = l.expires_at ? `expires ${dateOnly(l.expires_at)}` : 'no expiry'
  const ips = l.ips.length ? l.ips.map((i) => i.ip).join(', ') : 'no server IP set'
  return `- **${name}** · ${l.status} · ${expiry}\n  IP: ${ips}`
}

/**
 * Markdown body for an ephemeral `/myaccount` reply. Pulls the summary + licenses
 * in parallel and degrades gracefully:
 *   - gateway disabled/unreachable -> a "check the website" hint (never an error)
 *   - member not linked -> a "sign in and link your Discord" hint
 * License keys are intentionally NOT printed here - `/myaccount` runs in a channel
 * even when ephemeral, so keys stay on the website account page only.
 */
export async function buildMyAccountBody(discordId: string): Promise<string> {
  if (!nightzGatewayEnabled) {
    return (
      'Account lookups are not enabled right now. ' +
      `You can view your licenses, orders and Premium status on the website: ${accountPageUrl()}`
    )
  }

  const [summary, licenses] = await Promise.all([
    getAccountSummary(discordId),
    getLicenses(discordId),
  ])

  if (summary == null) {
    return (
      'I could not reach the account service just now. ' +
      `Please try again shortly, or check ${accountPageUrl()}.`
    )
  }

  if (!summary.linked || !summary.account) {
    return (
      '**No linked Nightz account found.**\n' +
      `Sign in with Discord on the website to link this account, then run this again:\n${accountPageUrl()}`
    )
  }

  const a = summary.account
  const lines: string[] = []
  lines.push(`**Your Nightz account**${a.display_name ? ` · ${a.display_name}` : ''}`)
  const bits: string[] = []
  bits.push(
    a.is_premium ? `Premium: active${a.premium_plan ? ` (${a.premium_plan})` : ''}` : 'Premium: no',
  )
  bits.push(`${a.license_count} license(s)`)
  bits.push(`${a.order_count} order(s)`)
  if (a.email_masked) bits.push(a.email_masked)
  lines.push(bits.join(' · '))

  const list = licenses?.licenses ?? []
  if (list.length) {
    lines.push('', '**Licenses**')
    for (const l of list.slice(0, 10)) lines.push(licenseLine(l))
    if (list.length > 10) lines.push(`- ...and ${list.length - 10} more`)
  } else if (summary.linked) {
    lines.push('', '_No licenses on this account yet._')
  }

  lines.push('', `Manage everything (keys, downloads, receipts): ${accountPageUrl()}`)
  return lines.join('\n').slice(0, 3900)
}

/** One-line entitlement answer for "do I own X" style prompts. */
export async function describeEntitlement(discordId: string, slug: string): Promise<string> {
  const r = await getEntitlement(discordId, slug)
  if (r == null) return 'I could not check that right now. Please try again shortly.'
  const productName = r.product?.name ?? slug
  switch (r.reason) {
    case 'not_linked':
      return `Link your Discord on the website first, then I can check: ${accountPageUrl()}`
    case 'unknown_product':
      return `I could not find a product matching "${slug}".`
    case 'license':
      return `Yes - you own **${productName}** (license ${r.license?.status ?? 'active'}).`
    case 'premium':
      return `Yes - **${productName}** is included with your active Premium membership.`
    default:
      return `You do not currently own **${productName}**.`
  }
}

function money(cents: number, currency: string): string {
  const amount = (Math.max(0, Number(cents) || 0) / 100).toFixed(2)
  return currency === 'USD' ? `$${amount}` : `${amount} ${currency}`
}

function orderLine(o: GatewayOrder): string {
  return `- ${o.uuid.slice(0, 8)} · ${o.status} · ${money(o.total_cents, o.currency)} · ${dateOnly(o.created_at)}`
}

/**
 * Staff-facing account lookup for `/lookup @user`. Pulls the target member's
 * summary + licenses + recent orders in parallel and formats a support view.
 * Ephemeral-only (the command replies ephemerally), and even so, license KEYS
 * are never printed - staff get status/expiry/bound IPs, which is what support
 * needs; the full key lives on the website only. Never throws: gateway
 * off/unreachable and unlinked members resolve to a clear line.
 *
 * `targetTag` is the Discord tag of the looked-up user, purely for the header.
 */
export async function buildLookupBody(discordId: string, targetTag: string): Promise<string> {
  if (!nightzGatewayEnabled) {
    return 'Account lookups are not enabled (NIGHTZ_GATEWAY_SECRET is unset on the bot).'
  }

  const [summary, licenses, orders] = await Promise.all([
    getAccountSummary(discordId),
    getLicenses(discordId),
    getOrders(discordId),
  ])

  if (summary == null) {
    return `Could not reach the account service just now. Try again shortly, or check ${accountPageUrl()}.`
  }
  if (!summary.linked || !summary.account) {
    return `**${targetTag}** has no linked Nightz account (they have not signed in on the website with this Discord).`
  }

  const a = summary.account
  const lines: string[] = []
  lines.push(`**Nightz account for ${targetTag}**`)

  const bits: string[] = []
  if (a.username) bits.push(`@${a.username}`)
  bits.push(`role: ${a.is_management ? 'management' : a.role}`)
  bits.push(
    a.is_premium ? `Premium: active${a.premium_plan ? ` (${a.premium_plan})` : ''}` : 'Premium: no',
  )
  if (a.email_masked) bits.push(a.email_masked)
  if (!a.is_active) bits.push('⚠️ deactivated')
  lines.push(bits.join(' · '))
  lines.push(
    `${a.license_count} license(s) · ${a.order_count} order(s) · member since ${dateOnly(a.member_since)}`,
  )

  const licList = licenses?.licenses ?? []
  if (licList.length) {
    lines.push('', '**Licenses**')
    for (const l of licList.slice(0, 15)) lines.push(licenseLine(l))
    if (licList.length > 15) lines.push(`- ...and ${licList.length - 15} more`)
  } else {
    lines.push('', '_No licenses._')
  }

  const ordList = orders?.orders ?? []
  if (ordList.length) {
    lines.push('', '**Recent orders**')
    for (const o of ordList.slice(0, 10)) lines.push(orderLine(o))
  }

  lines.push('', `Full account: ${accountPageUrl()}`)
  return lines.join('\n').slice(0, 3900)
}

export type CustomerCheck = {
  linked: boolean
  qualifies: boolean
  reason: 'gateway_off' | 'unreachable' | 'not_linked' | 'no_purchase' | 'ok'
  account?: GatewayAccount
}

/**
 * Does this member qualify for the "Customer" role? True when they have a linked
 * website account AND own something (a license or active Premium). Used by
 * /verifypurchase to self-serve the role. Never throws.
 */
export async function qualifiesAsCustomer(discordId: string): Promise<CustomerCheck> {
  if (!nightzGatewayEnabled) return { linked: false, qualifies: false, reason: 'gateway_off' }
  if (!isSnowflake(discordId)) return { linked: false, qualifies: false, reason: 'not_linked' }
  const summary = await getAccountSummary(discordId)
  if (summary == null) return { linked: false, qualifies: false, reason: 'unreachable' }
  if (!summary.linked || !summary.account) {
    return { linked: false, qualifies: false, reason: 'not_linked' }
  }
  const a = summary.account
  const owns = a.license_count > 0 || a.is_premium
  return {
    linked: true,
    qualifies: owns,
    reason: owns ? 'ok' : 'no_purchase',
    account: a,
  }
}

/**
 * Compact, model-facing block of the ASKING member's own account facts, for the
 * AI to ground support answers in reality ("your ND Scenes license expired on
 * ...", "your key is bound to IP ..."). Pulled only for the person asking, so it
 * is safe to feed to the model answering them.
 *
 * Returns '' when the gateway is off, the member is not linked, or on any error,
 * so the AI simply answers without it (never blocks a reply). No license keys and
 * only a masked email are ever included.
 */
export async function buildAccountContext(discordId: string): Promise<string> {
  if (!nightzGatewayEnabled || !isSnowflake(discordId)) return ''
  const [summary, licenses] = await Promise.all([
    getAccountSummary(discordId),
    getLicenses(discordId),
  ])
  if (summary == null || !summary.linked || !summary.account) return ''

  const a = summary.account
  const lines: string[] = []
  lines.push(
    'NIGHTZ ACCOUNT CONTEXT (facts about the person asking - use them to answer accurately; ' +
      "never reveal another user's data, and do not print license keys):",
  )
  lines.push(`- Linked website account: yes${a.username ? ` (@${a.username})` : ''}`)
  lines.push(
    `- Premium: ${a.is_premium ? `active${a.premium_plan ? ` (${a.premium_plan})` : ''}` : 'none'}`,
  )
  lines.push(`- Licenses owned: ${a.license_count} · Orders: ${a.order_count}`)
  const list = licenses?.licenses ?? []
  if (list.length) {
    lines.push('- License details:')
    for (const l of list.slice(0, 12)) {
      const name = l.product_name ?? l.product_slug ?? 'product'
      const expiry = l.expires_at ? `expires ${dateOnly(l.expires_at)}` : 'no expiry'
      const ip = l.ips.length ? `bound IP ${l.ips.map((i) => i.ip).join(', ')}` : 'no server IP set'
      lines.push(`    - ${name}: ${l.status}, ${expiry}, ${ip}`)
    }
  }
  return lines.join('\n')
}
