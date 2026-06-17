/**
 * Scan visible profile fields (username, global name, server nickname), optional **custom status**
 * (requires Presence intent), and optionally the profile picture via Gemini vision.
 * Discord does **not** provide “About Me” / bio text to bots; only custom status is scannable as text.
 */
import {
  ActivityType,
  type Client,
  Events,
  GuildMemberFlags,
  type GuildMember,
  type Presence,
  type User,
} from 'discord.js'
import {
  altQuarantineRoleId,
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
  quarantineNameExemptUserIds,
  quarantineNameFilterEnabled,
  quarantineRoleId,
  quarantineToggleRoleId,
  verifyUnverifiedRoleId,
} from '../config.ts'
import { childLogger } from '../lib/logger.ts'
import { isGuildMod } from '../utils/permissions.ts'
import { generateRawWithImage } from './gemini.ts'
import { reportProfileFlag } from './logging.ts'
import { containsProfanity } from './profanity.ts'

const log = childLogger('profile-scan')

const inviteInNameRe = /discord(?:\.gg|\.com\/invite)\//i

/** Last time we ran any scan for guildId:userId (debounce burst events). */
const cooldown = new Map<string, number>()
/** Last name-filter alert signature per guildId:userId, to suppress duplicates. */
const lastNameAlert = new Map<string, string>()
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

/** Custom status line (type Custom), not the About Me bio. */
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
    `**Global display:** ${member.user.globalName ?? '-'}`,
    `**Server nickname:** ${member.nickname ?? '-'}`,
  ]
  if (profileScanCustomStatus) {
    lines.push(`**Custom status:** ${getCustomStatusText(member) || '-'}`)
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

/**
 * Reasons a member's name (username, global display, or server nickname) is
 * flagged. Used by the auto-quarantine path and runs regardless of
 * PROFILE_SCAN_TEXT. Returns an empty array when the name is clean.
 */
export function computeNameReasons(member: GuildMember): string[] {
  const reasons: string[] = []
  // Discord's own automod flagged the username/nickname.
  if (member.flags?.has(GuildMemberFlags.AutomodQuarantinedUsernameOrGuildNickname)) {
    reasons.push('Discord flagged the username/nickname (automod quarantine).')
  }
  const nameText = buildVisibleProfileText(member).trim()
  if (nameText) {
    if (containsProfanity(nameText)) {
      reasons.push('Username, display name, or nickname matched the profanity/abuse filter.')
    }
    const term = matchCustomTerms(nameText)
    if (term) reasons.push(`Name matched custom flag term: \`${term}\``)
    if (inviteInNameRe.test(nameText)) {
      reasons.push('Username, display name, or nickname contains a Discord invite link.')
    }
  }
  return reasons
}

/**
 * Apply the quarantine role to a member whose name was flagged. The
 * quarantine role-swap then strips their normal member role. Idempotent and
 * best-effort. Returns a short status label for the staff alert.
 */
export async function applyNameQuarantine(member: GuildMember): Promise<string> {
  const roleId = quarantineRoleId ?? altQuarantineRoleId ?? verifyUnverifiedRoleId
  if (!roleId) return 'quarantine skipped (no QUARANTINE_ROLE_ID configured)'
  if (member.roles.cache.has(roleId)) {
    // Already quarantined: the role-swap will not re-fire (role unchanged), so if
    // a prior member-role strip failed, reconcile it here so access stays revoked.
    await reconcileToggleRole(member)
    return 'already quarantined'
  }
  const role = await member.guild.roles.fetch(roleId).catch(() => null)
  if (!role) return 'quarantine role not found'
  const me = member.guild.members.me
  if (me && role.position >= me.roles.highest.position) {
    return 'cannot quarantine (role above bot in hierarchy)'
  }
  try {
    await member.roles.add(role, 'Name filter: flagged username/nickname')
    log.info({ userId: member.id }, 'name-filter quarantine applied')
    return 'quarantined'
  } catch (e) {
    log.warn({ err: e, userId: member.id }, 'name-filter quarantine failed')
    return 'quarantine failed (missing perms?)'
  }
}

/** Best-effort: strip the member role if a quarantined member still holds it. */
async function reconcileToggleRole(member: GuildMember): Promise<void> {
  if (!quarantineToggleRoleId) return
  if (!member.roles.cache.has(quarantineToggleRoleId)) return
  const me = member.guild.members.me
  const role = member.guild.roles.cache.get(quarantineToggleRoleId)
  if (me && role && role.position >= me.roles.highest.position) return
  await member.roles
    .remove(quarantineToggleRoleId, 'Quarantined member still held the member role')
    .catch((e) => log.warn({ err: e, userId: member.id }, 'reconcile toggle-role removal failed'))
}

export async function scanMemberProfile(member: GuildMember): Promise<void> {
  if (!profileScanEnabled) return
  if (
    !profileScanText &&
    !profileScanAvatarVision &&
    !profileScanCustomStatus &&
    !quarantineNameFilterEnabled
  ) {
    return
  }
  if (member.user.bot) return
  if (isGuildMod(member)) return
  if (!canCooldown(member)) return
  if (!rateLimitOk()) return

  // Name-based auto-quarantine. Runs regardless of PROFILE_SCAN_TEXT: a flagged
  // username/display/nickname gets the quarantine role (role-swap isolates them)
  // plus a staff alert. When this fires we skip the legacy text report below to
  // avoid a duplicate alert for the same member.
  let nameAlerted = false
  if (quarantineNameFilterEnabled && !quarantineNameExemptUserIds.has(member.user.id)) {
    const nameReasons = computeNameReasons(member)
    if (nameReasons.length > 0) {
      const status = await applyNameQuarantine(member)
      // Suppress duplicate staff alerts: only post when the reason-set or action
      // changed since the last alert for this member (avoids a drip of repeat
      // "cannot quarantine" alerts when the role is mis-positioned above the bot).
      const key = cooldownKey(member)
      const signature = `${nameReasons.join('|')}::${status}`
      if (lastNameAlert.get(key) !== signature) {
        lastNameAlert.set(key, signature)
        if (lastNameAlert.size > 5000) lastNameAlert.delete(lastNameAlert.keys().next().value as string)
        await reportProfileFlag(
          member,
          'text',
          `${nameReasons.join('\n')}\n\n**Action:** ${status}`,
          [buildScannedFieldsBlock(member)],
        )
      }
      nameAlerted = true
    }
  }

  if (!nameAlerted && (profileScanText || profileScanCustomStatus)) {
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
  // Discord's automod-quarantine flag turning on is a fresh name signal.
  const flag = GuildMemberFlags.AutomodQuarantinedUsernameOrGuildNickname
  if ((oldM.flags?.has(flag) ?? false) !== (newM.flags?.has(flag) ?? false)) return true
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
  if (
    !profileScanText &&
    !profileScanAvatarVision &&
    !profileScanCustomStatus &&
    !quarantineNameFilterEnabled
  ) {
    console.warn(
      '[profile-scan] enabled but PROFILE_SCAN_TEXT, PROFILE_SCAN_CUSTOM_STATUS, PROFILE_SCAN_AVATAR_VISION, and QUARANTINE_NAME_FILTER_ENABLED are all off; no scans will run.',
    )
    return
  }
  if (quarantineNameFilterEnabled) {
    if (!(quarantineRoleId ?? altQuarantineRoleId ?? verifyUnverifiedRoleId)) {
      console.warn(
        '[profile-scan] name-filter quarantine on but no quarantine role configured; flagged names will alert staff but not be quarantined.',
      )
    } else if (!quarantineRoleId) {
      // The role-swap only strips the member role for QUARANTINE_ROLE_ID. A
      // fallback role gets added but access is NOT revoked (cosmetic quarantine).
      console.warn(
        '[profile-scan] name-filter quarantine will add a fallback role, but QUARANTINE_ROLE_ID is unset so the member role will NOT be stripped (cosmetic quarantine). Set QUARANTINE_ROLE_ID to fully isolate.',
      )
    }
  }
  if (profileScanCustomStatus) {
    console.log(
      '[profile-scan] custom status scanning on: enable **Presence Intent** in Discord Developer Portal if statuses look empty.',
    )
  }

  client.on(Events.GuildMemberAdd, (member) => {
    void scanMemberProfile(member)
  })

  client.on(Events.GuildMemberUpdate, (oldM, newM) => {
    // Partial old member: we cannot diff prior state, so rescan to be safe.
    if (oldM.partial) {
      void scanMemberProfile(newM)
      return
    }
    if (!memberNeedsRescan(oldM, newM)) return
    void scanMemberProfile(newM)
  })

  client.on(Events.UserUpdate, (oldU, newU) => {
    if (newU.bot) return
    // Partial old user: cannot diff, so always rescan; otherwise gate on a change.
    if (!oldU.partial && !userNeedsRescan(oldU, newU)) return
    // A username/global-name change is global, so scan the user in EVERY shared
    // guild. scanMemberProfile self-guards (bot / mod / cooldown / rate limit).
    for (const guild of client.guilds.cache.values()) {
      const m = guild.members.cache.get(newU.id)
      if (m) void scanMemberProfile(m)
    }
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
