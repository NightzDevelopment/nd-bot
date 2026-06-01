/**
 * Leveling store - Experience Points (XP)
 * Driven by high-performance SQLite database.
 */
import { getDb } from './nd-db.ts'

export type LevelMemberRecord = {
  xp: number
  level: number
  messageCount: number
  lastXpAt: number
  updatedAt: number
}

function defaultRecord(): LevelMemberRecord {
  return {
    xp: 0,
    level: 0,
    messageCount: 0,
    lastXpAt: 0,
    updatedAt: 0,
  }
}

export function xpForLevel(level: number): number {
  if (level <= 0) return 0
  return 100 * level * level
}

export function levelForXp(xp: number): number {
  let level = 0
  while (xp >= xpForLevel(level + 1)) level += 1
  return level
}

export async function getLevelRecord(guildId: string, userId: string): Promise<LevelMemberRecord> {
  const db = getDb()
  const row = db
    .prepare(
      'SELECT xp, level, messageCount, lastXpAt, updatedAt FROM users_levels WHERE guildId = ? AND userId = ?',
    )
    .get(guildId, userId) as LevelMemberRecord | undefined
  if (!row) {
    const def = defaultRecord()
    db.prepare(`
      INSERT OR IGNORE INTO users_levels (guildId, userId, xp, level, messageCount, lastXpAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(guildId, userId, def.xp, def.level, def.messageCount, def.lastXpAt, def.updatedAt)
    return def
  }
  return row
}

export async function addLevelXp(
  guildId: string,
  userId: string,
  amount: number,
  now = Date.now(),
): Promise<{ before: LevelMemberRecord; after: LevelMemberRecord; leveledUp: boolean }> {
  const db = getDb()
  const before = await getLevelRecord(guildId, userId)
  const afterXp = Math.max(0, before.xp + amount)
  const afterLevel = levelForXp(afterXp)

  db.prepare(`
    UPDATE users_levels
    SET xp = ?, level = ?, messageCount = messageCount + 1, lastXpAt = ?, updatedAt = ?
    WHERE guildId = ? AND userId = ?
  `).run(afterXp, afterLevel, now, now, guildId, userId)

  const after = await getLevelRecord(guildId, userId)
  return { before, after, leveledUp: after.level > before.level }
}

export async function setLevelRecord(
  guildId: string,
  userId: string,
  patch: Partial<Pick<LevelMemberRecord, 'xp' | 'level' | 'messageCount'>>,
): Promise<LevelMemberRecord> {
  const db = getDb()
  const current = await getLevelRecord(guildId, userId)
  const rec = { ...current, ...patch, updatedAt: Date.now() }

  if (patch.xp !== undefined && patch.level === undefined) rec.level = levelForXp(rec.xp)
  if (patch.level !== undefined && patch.xp === undefined)
    rec.xp = Math.max(rec.xp, xpForLevel(rec.level))

  db.prepare(`
    UPDATE users_levels
    SET xp = ?, level = ?, messageCount = ?, updatedAt = ?
    WHERE guildId = ? AND userId = ?
  `).run(rec.xp, rec.level, rec.messageCount, rec.updatedAt, guildId, userId)

  return rec
}

export async function resetLevelRecord(guildId: string, userId: string): Promise<void> {
  const db = getDb()
  db.prepare('DELETE FROM users_levels WHERE guildId = ? AND userId = ?').run(guildId, userId)
}

export async function getAllLevelRecords(
  guildId: string,
): Promise<Array<{ userId: string; record: LevelMemberRecord }>> {
  const db = getDb()
  const rows = db
    .prepare(
      'SELECT userId, xp, level, messageCount, lastXpAt, updatedAt FROM users_levels WHERE guildId = ?',
    )
    .all(guildId) as any[]
  return rows.map((r) => ({
    userId: r.userId,
    record: {
      xp: r.xp,
      level: r.level,
      messageCount: r.messageCount,
      lastXpAt: r.lastXpAt,
      updatedAt: r.updatedAt,
    },
  }))
}

export async function topLevelRecords(
  guildId: string,
  limit = 10,
): Promise<Array<{ userId: string; record: LevelMemberRecord }>> {
  const db = getDb()
  const rows = db
    .prepare(
      'SELECT userId, xp, level, messageCount, lastXpAt, updatedAt FROM users_levels WHERE guildId = ? ORDER BY xp DESC LIMIT ?',
    )
    .all(guildId, limit) as any[]
  return rows.map((r) => ({
    userId: r.userId,
    record: {
      xp: r.xp,
      level: r.level,
      messageCount: r.messageCount,
      lastXpAt: r.lastXpAt,
      updatedAt: r.updatedAt,
    },
  }))
}
