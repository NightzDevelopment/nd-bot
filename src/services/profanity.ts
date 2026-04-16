/**
 * Profanity / slur filter + EXTRA_BANNED_WORDS (phrases, @everyone/@here, URL prefixes).
 * Use `domain/path/*` in env: matches any URL containing `domain/path/`.
 */
import { ChannelType, type Message } from 'discord.js'
import { EXTRA_BANNED_WORDS } from '../config.ts'
import { isModMessage } from '../utils/permissions.ts'

const BASE = new Set<string>([
  'fuck',
  'shit',
  'bitch',
  'cunt',
  'nigger',
  'nigga',
  'faggot',
  'retard',
  'rape',
  'porn',
  'dick',
  'cock',
  'pussy',
  'slut',
  'whore',
])

const EXTRA_PLAIN: string[] = []
const EXTRA_URL_PREFIXES: string[] = []

for (let w of EXTRA_BANNED_WORDS) {
  w = w.trim()
  if (!w) continue
  const lower = w.toLowerCase()
  if (lower.endsWith('/*')) {
    const base = lower.slice(0, -2).trim().replace(/\s+/g, '')
    EXTRA_URL_PREFIXES.push(base.endsWith('/') ? base : `${base}/`)
    continue
  }
  if (lower.includes('*')) {
    EXTRA_URL_PREFIXES.push(lower.replace(/\*/g, '').replace(/\s+/g, ''))
    continue
  }
  EXTRA_PLAIN.push(lower)
  if (lower.length >= 3) BASE.add(lower)
}

function normalizeForScan(s: string): string {
  let t = s.toLowerCase()
  t = t.replace(/[@4]/g, 'a')
  t = t.replace(/[!1|]/g, 'i')
  t = t.replace(/[0]/g, 'o')
  t = t.replace(/[$5]/g, 's')
  t = t.replace(/[7]/g, 't')
  t = t.replace(/[3]/g, 'e')
  t = t.replace(/\s+/g, '')
  t = t.replace(/[^a-z]/g, '')
  return t
}

function stripSpaces(s: string): string {
  return s.replace(/\s+/g, '')
}

/**
 * @param msg Optional, in guilds, blocks @everyone / @here pings for non-mods.
 */
export function containsProfanity(text: string, msg?: Message): boolean {
  if (
    msg &&
    msg.channel.type !== ChannelType.DM &&
    !isModMessage(msg) &&
    msg.mentions.everyone
  ) {
    return true
  }

  const raw = text.toLowerCase()
  const compact = normalizeForScan(text)
  const noSpace = stripSpaces(raw)

  for (const prefix of EXTRA_URL_PREFIXES) {
    if (prefix && raw.includes(prefix)) return true
  }

  for (const frag of EXTRA_PLAIN) {
    if (frag.length < 2) continue
    if (raw.includes(frag)) return true
  }

  for (const word of BASE) {
    if (word.length < 3) continue
    if (raw.includes(word)) return true
    if (compact.includes(word)) return true
    if (noSpace.includes(word)) return true
  }
  return false
}
