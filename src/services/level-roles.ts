/**
 * Level Role Rewards
 * Assigns Discord roles automatically when a member reaches a configured level.
 * Data: data/level-roles.json  { guildId: { "5": "roleId", "10": "roleId", ... } }
 */
import type { Client, Guild } from 'discord.js'
import { readJson, writeJson } from './data-store.ts'
import { getAllLevelRecords } from './levels-store.ts'

const FILE = 'level-roles.json'

type LevelRoleStore = Record<string, Record<string, string>> // guildId → { level → roleId }

let cache: LevelRoleStore | null = null

async function store(): Promise<LevelRoleStore> {
  if (cache) return cache
  cache = await readJson<LevelRoleStore>(FILE, {})
  return cache!
}

async function save(s: LevelRoleStore): Promise<void> {
  cache = s
  await writeJson(FILE, s)
}

export async function setLevelRole(guildId: string, level: number, roleId: string): Promise<void> {
  const s = await store()
  if (!s[guildId]) s[guildId] = {}
  s[guildId][String(level)] = roleId
  await save(s)
}

export async function removeLevelRole(guildId: string, level: number): Promise<boolean> {
  const s = await store()
  if (!s[guildId]?.[String(level)]) return false
  delete s[guildId][String(level)]
  await save(s)
  return true
}

export async function getLevelRoles(
  guildId: string,
): Promise<Array<{ level: number; roleId: string }>> {
  const s = await store()
  return Object.entries(s[guildId] ?? {})
    .map(([level, roleId]) => ({ level: parseInt(level, 10), roleId }))
    .sort((a, b) => a.level - b.level)
}

/** Award all roles the user has earned up to their new level, remove none (cumulative). */
export async function applyLevelRoles(
  client: Client,
  guildId: string,
  userId: string,
  newLevel: number,
): Promise<{ awarded: string[] }> {
  const s = await store()
  const guildRoles = s[guildId] ?? {}
  const roleIds = Object.entries(guildRoles)
    .filter(([lvl]) => parseInt(lvl, 10) <= newLevel)
    .map(([, roleId]) => roleId)

  if (!roleIds.length) return { awarded: [] }

  const guild = client.guilds.cache.get(guildId) as Guild | undefined
  if (!guild) return { awarded: [] }

  const member = await guild.members.fetch(userId).catch(() => null)
  if (!member) return { awarded: [] }

  const awarded: string[] = []
  for (const roleId of roleIds) {
    if (!member.roles.cache.has(roleId)) {
      await member.roles.add(roleId, `Reached level ${newLevel}`).catch(() => {})
      awarded.push(roleId)
    }
  }
  return { awarded }
}

/**
 * Grant a role to all existing members who are already at or above the given level.
 * Called after setLevelRole so retroactive members get the role immediately.
 */
export async function backfillLevelRole(
  client: Client,
  guildId: string,
  level: number,
  roleId: string,
): Promise<{ granted: number; skipped: number; errors: number }> {
  const guild = client.guilds.cache.get(guildId) as Guild | undefined
  if (!guild) return { granted: 0, skipped: 0, errors: 0 }

  const records = await getAllLevelRecords(guildId)
  const eligible = records.filter((r) => r.record.level >= level)

  let granted = 0,
    skipped = 0,
    errors = 0
  for (const { userId } of eligible) {
    try {
      const member = await guild.members.fetch(userId).catch(() => null)
      if (!member) {
        skipped++
        continue
      }
      if (member.roles.cache.has(roleId)) {
        skipped++
        continue
      }
      await member.roles.add(roleId, `Retroactive level role (level ${level})`)
      granted++
    } catch {
      errors++
    }
  }
  return { granted, skipped, errors }
}

/** Returns the role reward for exactly this level (used for level-up announcements). */
export async function getRoleForLevel(guildId: string, level: number): Promise<string | null> {
  const s = await store()
  return s[guildId]?.[String(level)] ?? null
}
