/**
 * AI scam/phishing classification for UNKNOWN links, i.e. links the URL-risk
 * heuristics and blocklist did not catch. Per-domain verdicts are cached so a
 * domain is classified once, and a per-minute rate limit bounds cost.
 */
import {
  scamLinkAiMaxPerMin,
  scamLinkAiMinConfidence,
  scamCheckExtraTrustedHosts,
} from '../config.ts'
import { childLogger } from '../lib/logger.ts'
import { generateRaw } from './gemini.ts'

const log = childLogger('scam-link-ai')

const urlRe = /https?:\/\/[^\s<>()]+/gi

/** Hosts never sent to the AI (obviously safe / extremely common). */
const TRUSTED = new Set<string>([
  'discord.com',
  'discord.gg',
  'discordapp.com',
  'youtube.com',
  'youtu.be',
  'google.com',
  'github.com',
  'githubusercontent.com',
  'imgur.com',
  'tenor.com',
  'giphy.com',
  'twitter.com',
  'x.com',
  'reddit.com',
  'wikipedia.org',
  'nightz.dev',
  'weblutions.com',
  ...scamCheckExtraTrustedHosts,
])

function isTrusted(host: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, '')
  for (const t of TRUSTED) {
    if (h === t || h.endsWith(`.${t}`)) return true
  }
  return false
}

type Verdict = { scam: boolean; confidence: number; reason: string }
const domainCache = new Map<string, Verdict>()

let callTimes: number[] = []
function canCall(): boolean {
  const now = Date.now()
  callTimes = callTimes.filter((t) => now - t < 60_000)
  return callTimes.length < scamLinkAiMaxPerMin
}

async function classifyDomain(host: string, sampleUrl: string): Promise<Verdict | null> {
  const cached = domainCache.get(host)
  if (cached) return cached
  if (!canCall()) return null
  callTimes.push(Date.now())
  try {
    const prompt =
      'You are a security classifier for a Discord server. Decide if a link is likely a phishing, ' +
      'scam, malware, fake-giveaway, fake-Nitro, or credential-stealing site. Judge by the domain and ' +
      'path; legitimate well-known sites are NOT scams. Reply ONLY compact JSON: ' +
      `{"scam": true|false, "confidence": 0.0-1.0, "reason": "brief"}. Link: ${sampleUrl}`
    const raw = await generateRaw(prompt)
    const m = raw.match(/\{[\s\S]*\}/)
    if (!m) return null
    const parsed = JSON.parse(m[0]) as Partial<Verdict>
    const verdict: Verdict = {
      scam: Boolean(parsed.scam),
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
      reason: typeof parsed.reason === 'string' ? parsed.reason.slice(0, 200) : '',
    }
    domainCache.set(host, verdict)
    if (domainCache.size > 2000) domainCache.delete(domainCache.keys().next().value as string)
    return verdict
  } catch (e) {
    log.warn({ err: e, host }, 'scam-link classification failed')
    return null
  }
}

/**
 * Classify the untrusted links in a message. Returns the first link the AI
 * flags as scam at or above the confidence threshold, else null.
 */
export async function classifyMessageLinks(
  content: string,
): Promise<{ url: string; confidence: number; reason: string } | null> {
  const urls = content.match(urlRe) ?? []
  const seen = new Set<string>()
  for (const raw of urls.slice(0, 5)) {
    let u: URL
    try {
      u = new URL(raw.replace(/[),.;]+$/g, ''))
    } catch {
      continue
    }
    const host = u.hostname.toLowerCase()
    if (!host || isTrusted(host) || seen.has(host)) continue
    seen.add(host)
    const verdict = await classifyDomain(host, u.toString().slice(0, 300))
    if (verdict?.scam && verdict.confidence >= scamLinkAiMinConfidence) {
      return { url: u.toString(), confidence: verdict.confidence, reason: verdict.reason }
    }
  }
  return null
}
