/**
 * Bot / alt / ban-evasion detection on join. Scores a new member for signals of
 * being a bot or an alt of a recently-banned user, posts a staff alert, and
 * (when ALT_ACTION_ENABLED) takes tiered action: quarantine -> kick -> ban by
 * score. Bans recorded via recordBan() feed the name-similarity check.
 *
 * Reuses the manual-ban primitives (recordBan + dmBanAppealPrompt) so auto-bans
 * behave like manual ones, and the verification holding-role for quarantine.
 */
import {
  type Client,
  EmbedBuilder,
  Events,
  GuildMemberFlags,
  type GuildMember,
  type TextChannel,
  type User,
} from 'discord.js'
import {
  altActionEnabled,
  altAlertThreshold,
  altAutobanMaxPerMin,
  altAvatarAiCheck,
  altAvatarAiMinConfidence,
  altBanAt,
  altDetectionEnabled,
  altDryRun,
  altKickAt,
  altQuarantineAt,
  altQuarantineRoleId,
  auditAlertChannelId,
  raidNewAccountDays,
  verifyUnverifiedRoleId,
} from '../config.ts'
import { childLogger } from '../lib/logger.ts'
import { readJson, writeJson } from './data-store.ts'
import { generateRawWithImage } from './gemini.ts'

const log = childLogger('alt-detect')

const FILE = 'recent-bans.json'
type RecentBan = { userId: string; username: string; tag: string; at: number }
type Store = { bans: RecentBan[] }

let cache: Store | null = null

async function load(): Promise<Store> {
  if (cache) return cache
  const data = await readJson<Store>(FILE, { bans: [] })
  if (!Array.isArray(data.bans)) data.bans = []
  cache = data
  return data
}

/** Record a ban so future joins can be checked for name similarity. */
export async function recordBan(user: User): Promise<void> {
  const data = await load()
  data.bans.push({
    userId: user.id,
    username: user.username.toLowerCase(),
    tag: user.tag,
    at: Date.now(),
  })
  if (data.bans.length > 200) data.bans = data.bans.slice(-200)
  cache = data
  await writeJson(FILE, data)
}

/** Levenshtein distance (small strings). */
function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  const prev = new Array(n + 1)
  const cur = new Array(n + 1)
  for (let j = 0; j <= n; j++) prev[j] = j
  for (let i = 1; i <= m; i++) {
    cur[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
    }
    for (let j = 0; j <= n; j++) prev[j] = cur[j]
  }
  return prev[n]
}

// ── Batch-join tracking (several near-identical new accounts joining together) ──
const recentJoins = new Map<string, { name: string; at: number }[]>()
function recordJoinAndCountSimilar(guildId: string, name: string): number {
  const now = Date.now()
  const windowMs = 60_000
  const arr = (recentJoins.get(guildId) ?? []).filter((j) => now - j.at < windowMs)
  let similar = 0
  for (const j of arr) {
    if (j.name === name || levenshtein(j.name, name) <= 3) similar++
  }
  arr.push({ name, at: now })
  if (arr.length > 50) arr.splice(0, arr.length - 50)
  recentJoins.set(guildId, arr)
  return similar
}

// ── Auto-ban rate limit ────────────────────────────────────────────────────────
let autobanTimes: number[] = []
function canAutoban(): boolean {
  const now = Date.now()
  autobanTimes = autobanTimes.filter((t) => now - t < 60_000)
  return autobanTimes.length < altAutobanMaxPerMin
}
function recordAutoban(): void {
  autobanTimes.push(Date.now())
}

type AltScore = { score: number; reasons: string[]; matchedBan?: RecentBan }

function scoreNameAndProfile(member: GuildMember): AltScore {
  const reasons: string[] = []
  let score = 0
  const user = member.user

  const ageDays = (Date.now() - user.createdTimestamp) / (24 * 60 * 60 * 1000)
  const isNew = ageDays < raidNewAccountDays
  if (isNew) {
    score += 2
    reasons.push(`account is ${ageDays.toFixed(1)}d old`)
  }
  if (!user.avatar) {
    score += 1
    reasons.push('no custom avatar')
  }
  if (/^[a-z._]+\d{3,}$/i.test(user.username)) {
    score += 1
    reasons.push('auto-generated-looking username')
  }
  // Discord's own automod flagged the username/nickname as suspicious: strong.
  if (member.flags?.has(GuildMemberFlags.AutomodQuarantinedUsernameOrGuildNickname)) {
    score += 4
    reasons.push('Discord flagged the username/nickname (automod quarantine)')
  }
  // No global display name on a brand-new account is a common bot pattern.
  if (isNew && !user.globalName) {
    score += 1
    reasons.push('new account with no display name')
  }
  // Batch-join: several near-identical new accounts joining together.
  const similar = recordJoinAndCountSimilar(member.guild.id, user.username.toLowerCase())
  if (similar >= 2) {
    score += 2
    reasons.push(`${similar} similar accounts joined in the last minute`)
  }
  return { score, reasons }
}

/**
 * Ask Gemini vision whether an avatar looks AI-generated / stock / bot-like.
 * Returns confidence in [0,1] or null on failure. Best-effort; failures score 0.
 */
async function avatarLooksBot(member: GuildMember): Promise<{ confidence: number } | null> {
  try {
    const url = member.user.displayAvatarURL({ extension: 'png', size: 128 })
    const res = await fetch(url)
    if (!res.ok) return null
    const dataBase64 = Buffer.from(await res.arrayBuffer()).toString('base64')
    const prompt =
      'You are screening Discord profile avatars for likely bot/spam accounts. ' +
      'Does this avatar look AI-generated (GAN/this-person-does-not-exist style), a generic stock photo, ' +
      'or a low-effort placeholder commonly used by bot/spam accounts? A normal personal photo, meme, ' +
      'game art, or anime pfp is NOT suspicious. Reply ONLY compact JSON: ' +
      '{"botAvatar": true|false, "confidence": 0.0-1.0}.'
    const raw = await generateRawWithImage(prompt, { mimeType: 'image/png', dataBase64 })
    const m = raw.match(/\{[\s\S]*\}/)
    if (!m) return null
    const parsed = JSON.parse(m[0]) as { botAvatar?: boolean; confidence?: number }
    if (!parsed.botAvatar) return null
    const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0
    return { confidence }
  } catch (e) {
    log.warn({ err: e, userId: member.id }, 'avatar AI check failed')
    return null
  }
}

async function scoreMember(member: GuildMember): Promise<AltScore> {
  const base = scoreNameAndProfile(member)
  const name = member.user.username.toLowerCase()
  const data = await load()
  let best: RecentBan | undefined
  let bestDist = Infinity
  for (const b of data.bans) {
    if (b.username === name) {
      best = b
      bestDist = 0
      break
    }
    const d = levenshtein(name, b.username)
    if (d < bestDist) {
      bestDist = d
      best = b
    }
  }
  if (best && (bestDist <= 2 || (name.length >= 4 && best.username.includes(name)))) {
    base.score += 3
    base.reasons.push(`name resembles recently-banned **${best.tag}** (distance ${bestDist})`)
    base.matchedBan = best
  }

  // AI-avatar check (vision). Only for borderline-suspicious joiners WITH a custom
  // avatar, to limit cost. The +3 alone cannot reach the ban tier, so a
  // misclassified photo at worst quarantines/kicks, never bans on its own.
  if (
    altAvatarAiCheck &&
    member.user.avatar &&
    base.score >= altAlertThreshold - 1 &&
    base.score < altBanAt
  ) {
    const verdict = await avatarLooksBot(member)
    if (verdict && verdict.confidence >= altAvatarAiMinConfidence) {
      base.score += 3
      base.reasons.push(
        `avatar looks AI-generated/bot-like (${Math.round(verdict.confidence * 100)}%)`,
      )
    }
  }

  return base
}

function tierFor(score: number): 'ban' | 'kick' | 'quarantine' | 'none' {
  if (score >= altBanAt) return 'ban'
  if (score >= altKickAt) return 'kick'
  if (score >= altQuarantineAt) return 'quarantine'
  return 'none'
}

/** Take the tiered action. Returns a human label of what happened. */
async function takeAction(member: GuildMember, score: number): Promise<string> {
  const tier = tierFor(score)
  if (tier === 'none') return 'none'
  if (!altActionEnabled) return `none (action disabled; would ${tier})`
  if (altDryRun) return `dry-run: would ${tier}`

  try {
    if (tier === 'ban') {
      if (!member.bannable) return 'cannot ban (missing perms/hierarchy)'
      if (!canAutoban()) return 'rate-limited (alert only)'
      recordAutoban()
      await member.ban({
        reason: `Auto-ban: likely bot/alt on join (risk ${score})`,
        deleteMessageSeconds: 0,
      })
      await recordBan(member.user)
      try {
        const { dmBanAppealPrompt } = await import('./appeals.ts')
        await dmBanAppealPrompt(member.user, member.guild.id, member.guild.name)
      } catch {
        /* appeals optional */
      }
      return 'banned'
    }
    if (tier === 'kick') {
      if (!member.kickable) return 'cannot kick (missing perms/hierarchy)'
      await member.kick(`Auto-kick: likely bot/alt on join (risk ${score})`)
      return 'kicked'
    }
    // quarantine
    const roleId = altQuarantineRoleId ?? verifyUnverifiedRoleId
    if (!roleId) return 'quarantine skipped (no ALT_QUARANTINE_ROLE_ID / VERIFY_UNVERIFIED_ROLE_ID)'
    const role = await member.guild.roles.fetch(roleId).catch(() => null)
    if (!role) return 'quarantine role not found'
    await member.roles.add(role, `Quarantine: suspected bot/alt on join (risk ${score})`)
    return 'quarantined'
  } catch (e) {
    log.warn({ err: e, userId: member.id, tier }, 'auto-action failed')
    return `${tier} failed`
  }
}

export function registerAltDetection(client: Client): void {
  if (!altDetectionEnabled) return

  client.on(Events.GuildMemberAdd, async (member: GuildMember) => {
    try {
      if (member.user.bot) return
      const { score, reasons, matchedBan } = await scoreMember(member)

      const action = await takeAction(member, score)

      // Alert if it crossed the alert threshold or we took/considered an action.
      if (score < altAlertThreshold && action === 'none') return
      if (reasons.length === 0) return
      if (!auditAlertChannelId) return
      const ch = await client.channels.fetch(auditAlertChannelId).catch(() => null)
      if (!ch?.isTextBased() || !('send' in ch)) return

      const acted = action !== 'none' && !action.startsWith('none')
      const embed = new EmbedBuilder()
        .setColor(action === 'banned' ? 0xef4444 : score >= 5 ? 0xef4444 : 0xfbbf24)
        .setTitle(acted ? `Suspected bot/alt: ${action}` : 'Possible alt / ban-evasion')
        .setDescription(`<@${member.id}> · \`${member.id}\` · **${member.user.tag}**`)
        .addFields(
          { name: 'Risk score', value: `${score}`, inline: true },
          { name: 'Action', value: action, inline: true },
          { name: 'Signals', value: reasons.map((r) => `• ${r}`).join('\n').slice(0, 1024) },
        )
        .setTimestamp()
      if (matchedBan) {
        embed.addFields({
          name: 'Matched ban',
          value: `${matchedBan.tag} (\`${matchedBan.userId}\`)`,
          inline: false,
        })
      }
      embed.setFooter({ text: 'Run /dossier on this user for full history' })
      await (ch as TextChannel).send({ embeds: [embed] })
      log.info({ userId: member.id, score, action }, 'alt detection processed')
    } catch (e) {
      log.warn({ err: e, userId: member.id }, 'alt detection failed')
    }
  })
}
