/**
 * Progressive enforcement after repeated AI AutoMod hits: auto warn → kick → ban.
 * Persists strike counts per guild user in data/ai-automod-strikes.json
 */
import { type Message, PermissionFlagsBits } from 'discord.js'
import {
  aiAutomodEscalationBanAt,
  aiAutomodEscalationDecayDays,
  aiAutomodEscalationEnabled,
  aiAutomodEscalationKickAt,
  aiAutomodEscalationSkipVerdicts,
  aiAutomodEscalationWarnAt,
} from '../config.ts'
import { readJson, writeJson } from './data-store.ts'
import { reportAutomodEscalation } from './logging.ts'
import { addWarning } from './moderation.ts'

const FILE = 'ai-automod-strikes.json'

type StrikeRecord = {
  strikes: number
  autoWarned: boolean
  autoKicked: boolean
  autoBanned: boolean
  lastStrikeAt: number
}

type StrikeStore = Record<string, StrikeRecord>

let storeCache: StrikeStore | null = null
let loadPromise: Promise<void> | null = null

async function ensureStore(): Promise<StrikeStore> {
  if (storeCache) return storeCache
  if (!loadPromise) {
    loadPromise = (async () => {
      storeCache = await readJson<StrikeStore>(FILE, {})
    })()
  }
  await loadPromise
  return storeCache!
}

function storeKey(guildId: string, userId: string): string {
  return `${guildId}:${userId}`
}

const serialChains = new Map<string, Promise<unknown>>()

function runExclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = serialChains.get(key) ?? Promise.resolve()
  const p: Promise<T> = prev.then(() => fn())
  serialChains.set(
    key,
    p.then(
      () => {},
      () => {},
    ),
  )
  return p
}

function applyDecay(record: StrikeRecord, now: number): StrikeRecord {
  if (aiAutomodEscalationDecayDays <= 0) return record
  const ms = aiAutomodEscalationDecayDays * 24 * 60 * 60 * 1000
  if (record.lastStrikeAt > 0 && now - record.lastStrikeAt > ms) {
    return {
      strikes: 0,
      autoWarned: false,
      autoKicked: false,
      autoBanned: false,
      lastStrikeAt: 0,
    }
  }
  return record
}

export async function maybeAutomodEscalation(
  msg: Message,
  verdict: string,
  opts: { reported: boolean; deletedMessage: boolean; timedOut: boolean },
): Promise<void> {
  if (!aiAutomodEscalationEnabled) return
  if (!msg.guild || msg.author.bot) return
  if (!opts.reported && !opts.deletedMessage && !opts.timedOut) return

  const v = verdict.toUpperCase()
  if (aiAutomodEscalationSkipVerdicts.has(v)) return

  const guildId = msg.guild.id
  const userId = msg.author.id
  const key = storeKey(guildId, userId)

  return runExclusive(key, async () => {
    const store = await ensureStore()
    const now = Date.now()
    let rec = applyDecay({ ...(store[key] ?? {}) } as StrikeRecord, now)
    if (!rec.strikes) {
      rec = {
        strikes: 0,
        autoWarned: false,
        autoKicked: false,
        autoBanned: false,
        lastStrikeAt: 0,
      }
    }

    rec.strikes += 1
    rec.lastStrikeAt = now

    const member = msg.member ?? (await msg.guild.members.fetch(userId).catch(() => null))
    const botId = msg.client.user.id

    // Ban first if threshold jumped (e.g. import) — requires highest strikes
    if (
      rec.strikes >= aiAutomodEscalationBanAt &&
      !rec.autoBanned &&
      msg.guild.members.me?.permissions.has(PermissionFlagsBits.BanMembers)
    ) {
      try {
        await msg.guild.members.ban(userId, {
          reason: `AI AutoMod escalation: ${rec.strikes} strikes (ban threshold ${aiAutomodEscalationBanAt})`,
          deleteMessageSeconds: 0,
        })
        rec.autoBanned = true
        store[key] = rec
        await writeJson(FILE, store)
        await reportAutomodEscalation(msg, 'ban', rec.strikes, v)
      } catch (e) {
        console.warn('[ai-automod-escalation] ban failed:', e)
        store[key] = rec
        await writeJson(FILE, store)
      }
      return
    }

    if (
      rec.strikes >= aiAutomodEscalationKickAt &&
      !rec.autoKicked &&
      member &&
      member.kickable &&
      msg.guild.members.me?.permissions.has(PermissionFlagsBits.KickMembers)
    ) {
      try {
        await member.kick(
          `AI AutoMod escalation: ${rec.strikes} strikes (kick threshold ${aiAutomodEscalationKickAt})`,
        )
        rec.autoKicked = true
        store[key] = rec
        await writeJson(FILE, store)
        await reportAutomodEscalation(msg, 'kick', rec.strikes, v)
      } catch (e) {
        console.warn('[ai-automod-escalation] kick failed:', e)
        store[key] = rec
        await writeJson(FILE, store)
      }
      return
    }

    if (rec.strikes >= aiAutomodEscalationWarnAt && !rec.autoWarned) {
      try {
        await addWarning(guildId, userId, {
          at: now,
          reason: `Automatic warning: AI AutoMod strike ${rec.strikes} (threshold ${aiAutomodEscalationWarnAt}) — ${v}`,
          moderatorId: botId,
        })
        rec.autoWarned = true
        await reportAutomodEscalation(msg, 'warn', rec.strikes, v)
      } catch (e) {
        console.warn('[ai-automod-escalation] warn failed:', e)
      }
      store[key] = rec
      await writeJson(FILE, store)
      return
    }

    store[key] = rec
    await writeJson(FILE, store)
  })
}
