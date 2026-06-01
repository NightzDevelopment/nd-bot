/**
 * Heuristic URL / domain risk for phishing and typosquats (no external API).
 */
import { urlRiskTrustedHosts } from '../config.ts'

const urlRe = /https?:\/\/[^\s<>)"']+/gi

const OFFICIAL_DISCORD = new Set([
  'discord.com',
  'discord.gg',
  'discordapp.com',
  'discordstatus.com',
  'cdn.discordapp.com',
  'media.discordapp.net',
])

/** Obvious typosquat / phishing host substrings */
const SHADY_HOST_MARKERS = [
  'discrd',
  'discrod',
  'dicsord',
  'dlscord',
  'discordc',
  'discord-app',
  'discordnitro',
  'discord-nitro',
  'discorcl',
  'discordd.',
  'steamcommunty',
  'steancommunity',
  'steamscommunity',
  'wallet-connect',
  'opensea-verif',
]

const SHADY_PATH_MARKERS = [
  'free-nitro',
  'freenitro',
  'nitro-gift',
  'claim-nitro',
  'discord.gift',
  'login-verify',
  'wallet-drainer',
]

const ipHostRe = /^(\d{1,3}\.){3}\d{1,3}$/

function normalizeHost(host: string): string {
  return host.replace(/^www\./i, '').toLowerCase()
}

function isTrustedHost(host: string): boolean {
  const h = normalizeHost(host)
  for (const t of urlRiskTrustedHosts) {
    const x = t.toLowerCase().replace(/^www\./, '')
    if (h === x || h.endsWith(`.${x}`)) return true
  }
  for (const o of OFFICIAL_DISCORD) {
    if (h === o || h.endsWith(`.${o}`)) return true
  }
  return false
}

function isOfficialDiscordHost(host: string): boolean {
  const h = normalizeHost(host)
  for (const o of OFFICIAL_DISCORD) {
    if (h === o || h.endsWith(`.${o}`)) return true
  }
  return false
}

function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const dp = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0))
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

export type UrlRiskResult = { score: number; reasons: string[] }

export function scoreMessageUrls(content: string): UrlRiskResult {
  const reasons: string[] = []
  let score = 0
  const urls = content.match(urlRe) ?? []

  for (const raw of urls) {
    let u: URL
    try {
      u = new URL(raw.replace(/[),.;]+$/g, ''))
    } catch {
      continue
    }
    const host = u.hostname
    if (!host) continue
    if (isTrustedHost(host)) continue

    const hNorm = normalizeHost(host)

    if (hNorm.includes('xn--')) {
      score += 35
      reasons.push(`Punycode host: ${host}`)
    }
    if (ipHostRe.test(hNorm)) {
      score += 40
      reasons.push(`IP literal URL: ${host}`)
    }
    if (u.username || u.password) {
      score += 25
      reasons.push('URL embeds credentials')
    }

    const pathLow = `${u.pathname}${u.search}`.toLowerCase()
    for (const p of SHADY_PATH_MARKERS) {
      if (pathLow.includes(p)) {
        score += 30
        reasons.push(`Suspicious path segment (${p})`)
        break
      }
    }

    for (const m of SHADY_HOST_MARKERS) {
      if (hNorm.includes(m)) {
        score += 55
        reasons.push(`Typosquat / shady host marker (${m})`)
        break
      }
    }

    if (!isOfficialDiscordHost(host) && hNorm.includes('discord') && hNorm.length <= 32) {
      const dist = levenshtein(hNorm.replace(/[^a-z]/g, ''), 'discordcom')
      if (dist <= 4 && !OFFICIAL_DISCORD.has(hNorm)) {
        score += 45
        reasons.push(`Host resembles Discord (${host})`)
      }
    }

    if (
      hNorm.includes('steam') &&
      hNorm.includes('community') &&
      !hNorm.endsWith('steamcommunity.com')
    ) {
      score += 40
      reasons.push(`Possible Steam phishing host (${host})`)
    }
  }

  return { score: Math.min(100, score), reasons: [...new Set(reasons)] }
}
