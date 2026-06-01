/**
 * Daily Quests Manager Service
 * Developed under strict Nightz Development proprietary standards (no emojis)
 */

import { addBalance } from './economy-store.ts'
import { addLevelXp } from './levels-store.ts'
import { getDb } from './nd-db.ts'

export interface Quest {
  id: string
  description: string
  progress: number
  target: number
  xpReward: number
  coinReward: number
  claimed: boolean
}

const QUEST_TYPES = [
  { id: 'work', description: 'Complete work tasks 2 times', target: 2, xp: 120, coins: 400 },
  { id: 'crime', description: 'Commit illegal crimes 2 times', target: 2, xp: 150, coins: 500 },
  {
    id: 'gamble',
    description: 'Win casino bets (Slots, Blackjack, Roulette, Coinflip) 3 times',
    target: 3,
    xp: 180,
    coins: 600,
  },
  {
    id: 'message',
    description: 'Send 15 messages in chat channels',
    target: 15,
    xp: 100,
    coins: 300,
  },
  {
    id: 'stock',
    description: 'Execute stock transaction orders (buy or sell) 2 times',
    target: 2,
    xp: 200,
    coins: 800,
  },
]

function initQuestsDb(): void {
  const db = getDb()
  db.exec(`
    CREATE TABLE IF NOT EXISTS users_quests (
      userId TEXT PRIMARY KEY,
      quests TEXT NOT NULL,
      lastReset INTEGER NOT NULL
    );
  `)
}

export function getOrCreateQuests(userId: string): Quest[] {
  initQuestsDb()
  const db = getDb()
  const now = Date.now()
  const row = db
    .prepare('SELECT quests, lastReset FROM users_quests WHERE userId = ?')
    .get(userId) as { quests: string; lastReset: number } | undefined

  // Check if quests exist and were generated in the last 24 hours (or calendar day)
  const isExpired = !row || now - row.lastReset > 24 * 60 * 60 * 1000

  if (isExpired) {
    // Generate 3 random quests
    const shuffled = [...QUEST_TYPES].sort(() => 0.5 - Math.random())
    const selected = shuffled.slice(0, 3).map((q) => ({
      id: q.id,
      description: q.description,
      progress: 0,
      target: q.target,
      xpReward: q.xp,
      coinReward: q.coins,
      claimed: false,
    }))

    const serialized = JSON.stringify(selected)
    db.prepare(
      'INSERT OR REPLACE INTO users_quests (userId, quests, lastReset) VALUES (?, ?, ?)',
    ).run(userId, serialized, now)

    return selected
  }

  return JSON.parse(row.quests)
}

export function incrementQuestProgress(userId: string, questId: string, amount: number = 1): void {
  initQuestsDb()
  const db = getDb()
  const quests = getOrCreateQuests(userId)
  let updated = false

  for (const q of quests) {
    if (q.id === questId && !q.claimed) {
      const prev = q.progress
      q.progress = Math.min(q.target, q.progress + amount)
      if (q.progress !== prev) {
        updated = true
      }
    }
  }

  if (updated) {
    db.prepare('UPDATE users_quests SET quests = ? WHERE userId = ?').run(
      JSON.stringify(quests),
      userId,
    )
  }
}

export async function claimQuestRewards(
  userId: string,
  guildId: string,
): Promise<{
  claimedCount: number
  xpAwarded: number
  coinsAwarded: number
  msg: string
}> {
  initQuestsDb()
  const db = getDb()
  const quests = getOrCreateQuests(userId)
  let claimedCount = 0
  let xpAwarded = 0
  let coinsAwarded = 0

  for (const q of quests) {
    if (q.progress >= q.target && !q.claimed) {
      q.claimed = true
      xpAwarded += q.xpReward
      coinsAwarded += q.coinReward
      claimedCount++
    }
  }

  if (claimedCount > 0) {
    db.prepare('UPDATE users_quests SET quests = ? WHERE userId = ?').run(
      JSON.stringify(quests),
      userId,
    )

    // Award rewards
    await addBalance(userId, coinsAwarded)
    await addLevelXp(guildId, userId, xpAwarded)

    return {
      claimedCount,
      xpAwarded,
      coinsAwarded,
      msg: `[SUCCESS] Claimed ${claimedCount} quest reward(s)! Awarded **${coinsAwarded.toLocaleString()} NDC** and **${xpAwarded.toLocaleString()} XP**!`,
    }
  }

  return {
    claimedCount: 0,
    xpAwarded: 0,
    coinsAwarded: 0,
    msg: 'No completed or unclaimed daily quests found. Work on your quests and try again!',
  }
}
