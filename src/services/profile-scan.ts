/**
 * Scan visible profile fields (username, global name, server nickname), optional **custom status**
 * (requires Presence intent), and optionally the profile picture via Gemini vision.
 * Discord does **not** provide “About Me” / bio text to bots — only custom status is scannable as text.
 */
import {
  ActivityType,
  type Client,
  Events,
  type GuildMember,
  type Presence,
  type User,
} from 'discord.js'
import {
  IMAGE_ATTACHMENT_MAX_BYTES,
  profileFlagTerms,
  profileScanAvatarVision,
  profileScanCooldownSec,
  profileScanCustomStatus,
  profileScanDefaultAvatars,
  profileScanEnabled,
  profileScanInviteInName,
  profileScanMaxPerMinute,
  profileScanMinConfidence,
  profileScanText,
} from '../config.ts'
import { isGuildMod } from '../utils/permissions.ts'
import { generateRawWithImage } from './gemini.ts'
import { reportProfileFlag } from './logging.ts'
import { containsProfanity } from './profanity.ts'

const inviteInNameRe = /discord(?:\.gg|\.com\/invite)\//i

/** Last time we ran any scan for guildId:userId (debounce burst events). */
const cooldown = new Map<string, number>()
let minuteWindow = Date.now()
let scansThisMinute = 0

function cooldownKey(member: GuildMember): string {
  return `${member.guild.id}:${member.user.id}`
}

function canCooldown(member: GuildMember): boolean {
  const k = cooldownKey(member)
  const now = Date.now()
  const last = cooldown.get(k) ?? 0
  if (now - last < profileScanCooldownSec * 1000) return false
  cooldown.set(k, now)
  return true
}

function rateLimitOk(): boolean {
  const now = Date.now()
  if (now - minuteWindow >= 60_000) {
    minuteWindow = now
    scansThisMinute = 0
  }
  if (scansThisMinute >= profileScanMaxPerMinute) return false
  scansThisMinute++
  return true
}

function buildVisibleProfileText(member: GuildMember): string {
  const u = member.user
  const parts = [u.username, u.globalName ?? '', member.nickname ?? '']
  return parts.filter(Boolean).join('\n')
}

/** Custom status line (type Custom) — not the About Me bio. */
function customStatusFromPresence(p: Presence | null): string {
  if (!p?.activities?.length) return ''
  const act = p.activities.find((a) => a.type === ActivityType.Custom)
  return act?.state?.trim() ?? ''
}

function getCustomStatusText(member: GuildMember): string {
  return customStatusFromPresence(member.presence)
}

function mergeProfileTextForScan(member: GuildMember): string {
  const parts: string[] = []
  if (profileScanText) {
    const t = buildVisibleProfileText(member).trim()
    if (t) parts.push(t)
  }
  if (profileScanCustomStatus) {
    const s = getCustomStatusText(member).trim()
    if (s) parts.push(s)
  }
  return parts.join('\n')
}

function buildScannedFieldsBlock(member: GuildMember): {
  name: string
  value: string
} {
  const lines = [
    `**Username:** ${member.user.username}`,
    `**Global display:** ${member.user.globalName ?? '—'}`,
    `**Server nickname:** ${member.nickname ?? '—'}`,
  ]
  if (profileScanCustomStatus) {
    lines.push(`**Custom status:** ${getCustomStatusText(member) || '—'}`)
  }
  return {
    name: 'Scanned fields',
    value: lines.join('\n').slice(0, 1024),
  }
}

function matchCustomTerms(text: string): string | null {
  const lower = text.toLowerCase()
  for (const term of profileFlagTerms) {
    if (term && lower.includes(term)) return term
  }
  return null
}

export async function scanMemberProfile(member: GuildMember): Promise<void> {
  if (!profileScanEnabled) return
  if (!profileScanText && !profileScanAvatarVision && !profileScanCustomStatus) return
  if (member.user.bot) return
  if (isGuildMod(member)) return
  if (!canCooldown(member)) return
  if (!rateLimitOk()) return

  if (profileScanText || profileScanCustomStatus) {
    const text = mergeProfileTextForScan(member)
    const reasons: string[] = []

    if (text.trim() && containsProfanity(text)) {
      reasons.push(
        'Matched server profanity / abuse filter on scanned text (names and/or custom status).',
      )
    }
    const term = matchCustomTerms(text)
    if (term) {
      reasons.push(`Matched custom flag term: \`${term}\``)
    }
    if (profileScanInviteInName && inviteInNameRe.test(text)) {
      reasons.push(
        'Contains a Discord invite pattern in scanned username, name, nickname, or custom status.',
      )
    }

    if (reasons.length > 0) {
      await reportProfileFlag(member, 'text', reasons.join('\n'), [buildScannedFieldsBlock(member)])
    }
  }

  if (profileScanAvatarVision && (member.user.avatar || profileScanDefaultAvatars)) {
    await scanAvatarVision(member)
  }
}

async function scanAvatarVision(member: GuildMember): Promise<void> {
  const u = member.user
  const url = u.displayAvatarURL({ extension: 'png', size: 256 })
  let mimeType = 'image/png'
  let dataBase64: string
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'ND-Discord-Gemini-Bot/1.0 (profile scan)' },
    })
    if (!res.ok) return
    const ab = await res.arrayBuffer()
    if (ab.byteLength > IMAGE_ATTACHMENT_MAX_BYTES) return
    const buf = Buffer.from(ab)
    const ct = res.headers.get('content-type')
    if (ct?.includes('webp')) mimeType = 'image/webp'
    else if (ct?.includes('jpeg') || ct?.includes('jpg')) mimeType = 'image/jpeg'
    else if (ct?.includes('gif')) mimeType = 'image/gif'
    dataBase64 = buf.toString('base64')
  } catch (e) {
    console.warn('[profile-scan] avatar fetch failed:', e)
    return
  }

  const prompt = `You are a strict content moderation assistant for a Discord server profile picture (avatar image).

Return ONLY a single JSON object, no markdown:
{"flag":true or false,"confidence":0.0 to 1.0,"category":"SAFE|NSFW|VIOLENCE|HATE_SYMBOLS|SCAM_TEXT_IN_IMAGE|OTHER","reason":"one short sentence"}

Flag true if the image contains: sexual content, nudity, graphic violence, gore, Nazi/hate symbols, slurs rendered as text in the image, QR codes for obvious scams, or shock content.
Flag false for harmless game logos, neutral avatars, default Discord avatars, or unclear blurry images (prefer false if unsure).

confidence: how sure you are (0-1).`

  try {
    const raw = await generateRawWithImage(prompt, { mimeType, dataBase64 })
    const parsed = parseVisionJson(raw)
    if (!parsed) return
    if (!parsed.flag || parsed.confidence < profileScanMinConfidence) {
      return
    }
    await reportProfileFlag(
      member,
      'avatar',
      `Vision check flagged this avatar.\n**Category:** ${parsed.category}\n**Confidence:** ${parsed.confidence.toFixed(2)}\n**Reason:** ${parsed.reason}`,
      [{ name: 'Model note', value: 'Automated image classification; review context.' }],
    )
  } catch (e) {
    console.warn('[profile-scan] vision failed:', e)
  }
}

function parseVisionJson(raw: string): {
  flag: boolean
  confidence: number
  category: string
  reason: string
} | null {
  const m = raw.match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    const j = JSON.parse(m[0]) as Record<string, unknown>
    const flag = Boolean(j.flag)
    const confidence =
      typeof j.confidence === 'number' ? j.confidence : parseFloat(String(j.confidence ?? 0))
    const category = String(j.category ?? 'OTHER')
    const reason = String(j.reason ?? '')
    if (Number.isNaN(confidence)) return null
    return { flag, confidence, category, reason }
  } catch {
    return null
  }
}

function memberNeedsRescan(oldM: GuildMember | null, newM: GuildMember): boolean {
  if (!oldM) return true
  const ou = oldM.user
  const nu = newM.user
  if (ou.username !== nu.username) return true
  if ((ou.globalName ?? '') !== (nu.globalName ?? '')) return true
  if ((oldM.nickname ?? '') !== (newM.nickname ?? '')) return true
  if (ou.avatar !== nu.avatar) return true
  if (profileScanCustomStatus) {
    if (getCustomStatusText(oldM) !== getCustomStatusText(newM)) {
      return true
    }
  }
  return false
}

function userNeedsRescan(oldU: User, newU: User): boolean {
  if (oldU.username !== newU.username) return true
  if ((oldU.globalName ?? '') !== (newU.globalName ?? '')) return true
  if (oldU.avatar !== newU.avatar) return true
  return false
}

/**
 * Register guild member join/update and user update listeners.
 */
export function registerProfileScan(client: Client): void {
  if (!profileScanEnabled) return
  if (!profileScanText && !profileScanAvatarVision && !profileScanCustomStatus) {
    console.warn(
      '[profile-scan] enabled but PROFILE_SCAN_TEXT, PROFILE_SCAN_CUSTOM_STATUS, and PROFILE_SCAN_AVATAR_VISION are off; no scans will run.',
    )
    return
  }
  if (profileScanCustomStatus) {
    console.log(
      '[profile-scan] custom status scanning on — enable **Presence Intent** in Discord Developer Portal if statuses look empty.',
    )
  }

  client.on(Events.GuildMemberAdd, (member) => {
    void scanMemberProfile(member)
  })

  client.on(Events.GuildMemberUpdate, (oldM, newM) => {
    if (!memberNeedsRescan(oldM, newM)) return
    void scanMemberProfile(newM)
  })

  client.on(Events.UserUpdate, (oldU, newU) => {
    if (newU.bot) return
    if (!userNeedsRescan(oldU, newU)) return
    /** One scan per global profile change (same avatar/text flags for all guilds). */
    let member: GuildMember | undefined
    for (const guild of client.guilds.cache.values()) {
      const m = guild.members.cache.get(newU.id)
      if (m && !isGuildMod(m)) {
        member = m
        break
      }
    }
    if (member) void scanMemberProfile(member)
  })

  client.on(Events.PresenceUpdate, (oldP, newP) => {
    if (!profileScanCustomStatus) return
    const u = newP.user
    if (!u || u.bot) return
    const member = newP.member
    if (!member || isGuildMod(member)) return
    if (customStatusFromPresence(oldP) === customStatusFromPresence(newP)) {
      return
    }
    void scanMemberProfile(member)
  })
}
