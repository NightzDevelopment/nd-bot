/**
 * Generic "do X at time T" store + background loop.
 *
 * Foundational infra: temp-ban auto-expiry today, extensible to verification
 * kicks, raid auto-unlock, event reminders, and seasonal-event end. To add a
 * new action type: extend ScheduledActionType and add a case to the dispatch
 * switch in startScheduledActionsLoop.
 *
 * Follows the JSON-store pattern (cached load/save via data-store.ts).
 */
import type { Client } from 'discord.js'
import { childLogger } from '../lib/logger.ts'
import { addCase } from './mod-cases-store.ts'
import { readJson, writeJson } from './data-store.ts'

const log = childLogger('sched')

export type ScheduledActionType = 'unban' | 'verify_kick' | 'raid_unlock'

export type ScheduledAction = {
  id: number
  type: ScheduledActionType
  guildId: string
  userId: string
  userTag?: string
  dueAt: number
  reason?: string
  createdAt: number
  createdBy?: string
}

type Store = { nextId: number; actions: ScheduledAction[] }

const FILE = 'scheduled-actions.json'
const empty: Store = { nextId: 1, actions: [] }

let cache: Store | null = null

async function load(): Promise<Store> {
  if (cache) return cache
  const data = await readJson<Store>(FILE, empty)
  if (!Array.isArray(data.actions)) data.actions = []
  if (typeof data.nextId !== 'number' || data.nextId < 1) data.nextId = 1
  cache = data
  return data
}

async function save(data: Store): Promise<void> {
  cache = data
  await writeJson(FILE, data)
}

export async function scheduleAction(
  a: Omit<ScheduledAction, 'id' | 'createdAt'>,
): Promise<ScheduledAction> {
  const data = await load()
  const rec: ScheduledAction = { ...a, id: data.nextId++, createdAt: Date.now() }
  data.actions.push(rec)
  await save(data)
  return rec
}

/** Cancel pending actions matching a predicate. Returns count removed. */
export async function cancelActions(pred: (a: ScheduledAction) => boolean): Promise<number> {
  const data = await load()
  const before = data.actions.length
  data.actions = data.actions.filter((a) => !pred(a))
  const removed = before - data.actions.length
  if (removed) await save(data)
  return removed
}

/** Atomically pull and remove all actions due at or before `now`. */
async function takeDue(now: number): Promise<ScheduledAction[]> {
  const data = await load()
  const due = data.actions.filter((a) => a.dueAt <= now)
  if (due.length) {
    const dueIds = new Set(due.map((a) => a.id))
    data.actions = data.actions.filter((a) => !dueIds.has(a.id))
    await save(data)
  }
  return due
}

const CHECK_INTERVAL_MS = 60_000

export function startScheduledActionsLoop(client: Client): void {
  const tick = async (): Promise<void> => {
    let due: ScheduledAction[]
    try {
      due = await takeDue(Date.now())
    } catch (e) {
      log.warn({ err: e }, 'failed to read due actions')
      return
    }
    for (const a of due) {
      try {
        const guild = await client.guilds.fetch(a.guildId).catch(() => null)
        if (!guild) continue
        switch (a.type) {
          case 'unban': {
            await guild.bans.remove(a.userId, a.reason ?? 'Temp-ban expired').catch(() => {})
            await addCase({
              guildId: a.guildId,
              targetId: a.userId,
              targetTag: a.userTag ?? a.userId,
              moderatorId: client.user?.id ?? 'system',
              moderatorTag: client.user?.tag ?? 'system',
              action: 'unban (auto)',
              reason: a.reason ?? 'Temp-ban expired',
              at: Date.now(),
            })
            log.info({ userId: a.userId, guildId: a.guildId }, 'auto-unban executed')
            break
          }
          case 'verify_kick': {
            // Only kick if the member is still present and still unverified.
            const member = await guild.members.fetch(a.userId).catch(() => null)
            if (!member) break
            const { isStillUnverified } = await import('./verification.ts')
            if (!isStillUnverified(member)) break
            if (member.kickable) {
              await member.kick(a.reason ?? 'Did not verify in time').catch(() => {})
              log.info({ userId: a.userId, guildId: a.guildId }, 'verify_kick executed')
            }
            break
          }
          case 'raid_unlock': {
            const { setLockdown, lockdownGuilds } = await import('./lockdown.ts')
            if (lockdownGuilds.has(a.guildId)) {
              await setLockdown(a.guildId, false)
              log.info({ guildId: a.guildId }, 'raid auto-unlock executed')
            }
            break
          }
        }
      } catch (e) {
        log.warn({ err: e, type: a.type, userId: a.userId }, 'scheduled action failed')
      }
    }
  }
  setInterval(() => void tick(), CHECK_INTERVAL_MS).unref()
  void tick()
}
