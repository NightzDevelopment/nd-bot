/**
 * Alt-account / ban-evasion detection. On join, score a member for signals of
 * being an alt of a recently-banned user and post an alert to the staff
 * channel. Bans recorded via recordBan() feed the name-similarity check.
 */
import { type Client, EmbedBuilder, Events, type GuildMember, type User } from 'discord.js'
import { altAlertThreshold, altDetectionEnabled, auditAlertChannelId, raidNewAccountDays } from '../config.ts'
import { childLogger } from '../lib/logger.ts'
import { readJson, writeJson } from './data-store.ts'

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

type AltScore = { score: number; reasons: string[]; matchedBan?: RecentBan }

async function scoreMember(member: GuildMember): Promise<AltScore> {
  const reasons: string[] = []
  let score = 0

  const ageDays = (Date.now() - member.user.createdTimestamp) / (24 * 60 * 60 * 1000)
  if (ageDays < raidNewAccountDays) {
    score += 2
    reasons.push(`account is ${ageDays.toFixed(1)}d old`)
  }
  if (!member.user.avatar) {
    score += 1
    reasons.push('no custom avatar')
  }
  if (/^[a-z._]+\d{3,}$/i.test(member.user.username)) {
    score += 1
    reasons.push('auto-generated-looking username')
  }

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
    score += 3
    reasons.push(`name resembles recently-banned **${best.tag}** (distance ${bestDist})`)
    return { score, reasons, matchedBan: best }
  }

  return { score, reasons }
}

export function registerAltDetection(client: Client): void {
  if (!altDetectionEnabled) return

  client.on(Events.GuildMemberAdd, async (member: GuildMember) => {
    try {
      if (member.user.bot) return
      const { score, reasons, matchedBan } = await scoreMember(member)
      if (score < altAlertThreshold || reasons.length === 0) return
      if (!auditAlertChannelId) return
      const ch = await client.channels.fetch(auditAlertChannelId).catch(() => null)
      if (!ch?.isTextBased() || !('send' in ch)) return

      const embed = new EmbedBuilder()
        .setColor(score >= 5 ? 0xef4444 : 0xfbbf24)
        .setTitle('Possible alt / ban-evasion')
        .setDescription(`<@${member.id}> · \`${member.id}\` · **${member.user.tag}**`)
        .addFields(
          { name: 'Risk score', value: `${score}`, inline: true },
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
      await ch.send({ embeds: [embed] })
      log.info({ userId: member.id, score }, 'alt alert posted')
    } catch (e) {
      log.warn({ err: e, userId: member.id }, 'alt detection failed')
    }
  })
}
