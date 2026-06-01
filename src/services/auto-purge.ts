import {
  type Client,
  Collection,
  type Message,
  PermissionFlagsBits,
  type TextBasedChannel,
} from 'discord.js'
import { autoPurgeIntervalMs, autoPurgeRulesJson } from '../config.ts'
import { isFeatureEnabled } from './feature-gates.ts'

type AutoPurgeRule = {
  name?: string
  channelId?: string
  channelIds?: string[]
  maxAgeDays: number
  limitPerRun?: number
}

const DISCORD_BULK_DELETE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000

function parseRules(): AutoPurgeRule[] {
  if (!autoPurgeRulesJson) return []
  try {
    const raw = JSON.parse(autoPurgeRulesJson) as unknown
    if (!Array.isArray(raw)) return []
    return raw
      .map((x) => x as Partial<AutoPurgeRule>)
      .filter((x): x is AutoPurgeRule => Number(x.maxAgeDays) > 0)
  } catch {
    console.warn('[auto-purge] invalid AUTO_PURGE_RULES_JSON')
    return []
  }
}

function channelIdsForRule(rule: AutoPurgeRule): string[] {
  return [...(rule.channelIds ?? []), ...(rule.channelId ? [rule.channelId] : [])]
    .map((x) => x.trim())
    .filter(Boolean)
}

async function runRule(client: Client, rule: AutoPurgeRule): Promise<number> {
  let total = 0
  const now = Date.now()
  const olderThan = now - rule.maxAgeDays * 24 * 60 * 60 * 1000
  const newestBulkAllowed = now - DISCORD_BULK_DELETE_MAX_AGE_MS
  const limit = Math.min(500, Math.max(1, Number(rule.limitPerRun) || 100))

  for (const channelId of channelIdsForRule(rule)) {
    const ch = await client.channels.fetch(channelId).catch(() => null)
    if (!ch?.isTextBased() || ch.isDMBased()) continue
    const channel = ch as TextBasedChannel
    const guild = 'guild' in channel ? channel.guild : null
    if (!guild?.members.me?.permissions.has(PermissionFlagsBits.ManageMessages)) continue
    if (!('messages' in channel)) continue

    const fetched = await channel.messages.fetch({ limit: 100 }).catch(() => null)
    if (!fetched) continue
    const deletable = fetched.filter((m: Message) => {
      const age = now - m.createdTimestamp
      return m.createdTimestamp <= olderThan && age < DISCORD_BULK_DELETE_MAX_AGE_MS
    })
    const batch = new Collection<string, Message>()
    for (const [id, msg] of deletable) {
      if (batch.size >= limit - total) break
      batch.set(id, msg)
    }
    if (batch.size === 0) {
      if (olderThan < newestBulkAllowed) {
        console.info(
          `[auto-purge] ${rule.name ?? channelId}: messages older than 14 days cannot be bulk-deleted by Discord`,
        )
      }
      continue
    }
    const deleted = await channel.bulkDelete(batch, true).catch((e: unknown) => {
      console.warn('[auto-purge] bulk delete failed:', rule.name ?? channelId, e)
      return null
    })
    total += deleted?.size ?? 0
    if (total >= limit) break
  }
  return total
}

export function startAutoPurgeLoop(client: Client): void {
  if (!isFeatureEnabled('auto_purge')) return
  const rules = parseRules()
  if (rules.length === 0) {
    console.info('[auto-purge] enabled but no AUTO_PURGE_RULES_JSON rules were loaded')
    return
  }

  const tick = () => {
    for (const rule of rules) {
      void runRule(client, rule).catch((e) => {
        console.warn('[auto-purge] rule failed:', rule.name ?? '(unnamed)', e)
      })
    }
  }
  setInterval(tick, autoPurgeIntervalMs).unref?.()
  tick()
  console.info(`[auto-purge] loaded ${rules.length} rule(s)`)
}
