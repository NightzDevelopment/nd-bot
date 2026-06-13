/**
 * Weekly moderation digest. Once every 7 days, aggregates the moderation
 * cases (and recent warning activity) from the past week, asks the AI for a
 * short staff-facing narrative, and posts an embed to the staff log channel.
 *
 * The 7-day cadence is anchored to a persisted `lastPostedAt` timestamp so it
 * survives restarts: on first run we just start the clock (no immediate post),
 * then post once each time a full week has elapsed.
 */
import { EmbedBuilder, type Client } from 'discord.js'
import { weeklyModReportChannelId, weeklyModReportEnabled } from '../config.ts'
import { childLogger } from '../lib/logger.ts'
import { readJson, writeJson } from './data-store.ts'
import { generateRaw } from './gemini.ts'
import { listCasesSince } from './mod-cases-store.ts'
import { getRecentWarnings } from './warnings.ts'

const log = childLogger('weekly-mod-report')

const FILE = 'weekly-mod-report.json'
const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000

type Store = { lastPostedAt?: number }

async function load(): Promise<Store> {
  return readJson<Store>(FILE, {})
}
async function save(data: Store): Promise<void> {
  await writeJson(FILE, data)
}

/** Build the stats + AI narrative for the window [sinceMs, now]. */
async function buildReport(sinceMs: number): Promise<EmbedBuilder | null> {
  const cases = await listCasesSince(sinceMs)
  const warned = (await getRecentWarnings(1000)).filter((w) => (w.lastWarningAt ?? 0) >= sinceMs)

  if (cases.length === 0 && warned.length === 0) {
    // Quiet week: still post a short note so staff know the report ran.
    return new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle('Weekly moderation report')
      .setDescription('A quiet week. No moderation cases or new warnings were recorded.')
      .setTimestamp()
  }

  // Tally cases by action and by moderator.
  const byAction = new Map<string, number>()
  const byMod = new Map<string, number>()
  for (const c of cases) {
    byAction.set(c.action, (byAction.get(c.action) ?? 0) + 1)
    byMod.set(c.moderatorTag || c.moderatorId, (byMod.get(c.moderatorTag || c.moderatorId) ?? 0) + 1)
  }
  const actionLines = [...byAction.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([a, n]) => `${a}: ${n}`)
  const topMods = [...byMod.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([m, n]) => `${m}: ${n}`)
  const sampleReasons = cases
    .map((c) => c.reason?.trim())
    .filter((r): r is string => Boolean(r))
    .slice(0, 15)

  // Compact factual digest for the AI to narrate (never invent numbers).
  const digest =
    `Window: last 7 days.\n` +
    `Total moderation cases: ${cases.length}.\n` +
    `By action: ${actionLines.join(', ') || 'none'}.\n` +
    `Users with a new warning this week: ${warned.length}.\n` +
    `Sample reasons: ${sampleReasons.join(' | ') || 'none'}.`

  let narrative = ''
  try {
    narrative = (
      await generateRaw(
        'You are a moderation analyst. Using ONLY the data below, write a brief staff-facing weekly ' +
          'summary (2 to 4 sentences): overall activity level, notable patterns or recurring issues, ' +
          'and one practical suggestion if warranted. Do not invent numbers beyond the data. Plain text.\n\n' +
          digest,
      )
    ).trim()
  } catch (e) {
    log.warn({ err: e }, 'weekly report narrative failed')
  }

  const embed = new EmbedBuilder()
    .setColor(0x3b82f6)
    .setTitle('Weekly moderation report')
    .setTimestamp()
    .addFields(
      { name: 'Cases this week', value: String(cases.length), inline: true },
      { name: 'Users warned', value: String(warned.length), inline: true },
    )
  if (actionLines.length) {
    embed.addFields({ name: 'By action', value: actionLines.join('\n').slice(0, 1024), inline: false })
  }
  if (topMods.length) {
    embed.addFields({ name: 'Top moderators', value: topMods.join('\n').slice(0, 1024), inline: false })
  }
  if (narrative) {
    embed.setDescription(narrative.slice(0, 4000))
  }
  return embed
}

async function postReport(client: Client, sinceMs: number): Promise<boolean> {
  if (!weeklyModReportChannelId) {
    log.warn('no channel configured (set WEEKLY_MOD_REPORT_CHANNEL_ID or STAFF_LOG_CHANNEL_ID)')
    return false
  }
  const embed = await buildReport(sinceMs)
  if (!embed) return false
  try {
    const ch = await client.channels.fetch(weeklyModReportChannelId)
    if (ch?.isTextBased() && 'send' in ch) {
      await ch.send({ embeds: [embed] })
      return true
    }
    log.warn({ channelId: weeklyModReportChannelId }, 'report channel is not a sendable text channel')
  } catch (e) {
    log.warn({ err: e }, 'failed to post weekly report')
  }
  return false
}

export function startWeeklyModReportLoop(client: Client): void {
  if (!weeklyModReportEnabled) return
  const tick = async (): Promise<void> => {
    try {
      const data = await load()
      const now = Date.now()
      if (!data.lastPostedAt) {
        // First run: start the clock, do not post a partial week.
        await save({ lastPostedAt: now })
        return
      }
      if (now - data.lastPostedAt >= WEEK_MS) {
        const posted = await postReport(client, data.lastPostedAt)
        // Advance the clock even if posting failed, so we don't retry every 6h.
        await save({ lastPostedAt: now })
        if (posted) log.info('weekly mod report posted')
      }
    } catch (e) {
      log.warn({ err: e }, 'weekly report tick failed')
    }
  }
  setInterval(() => void tick(), CHECK_EVERY_MS).unref()
  void tick()
}
