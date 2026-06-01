/**
 * Member Profiles
 * User profiles with custom bios, stats, and achievements
 */

import { readJson, writeJson } from './data-store.ts'

export interface MemberStats {
  messages: number
  level: number
  reputation: number
  ticketsHelped: number
  joinedAt: number
  lastActivityAt: number
}

export interface MemberProfile {
  userId: string
  bio?: string
  badges: string[] // badge IDs
  stats: MemberStats
}

export type ProfileStore = Record<string, MemberProfile>

const FILE = 'profiles.json'
const DEFAULT_STORE: ProfileStore = {}

async function load(): Promise<ProfileStore> {
  return readJson<ProfileStore>(FILE, DEFAULT_STORE)
}

async function save(store: ProfileStore): Promise<void> {
  await writeJson(FILE, store)
}

/**
 * Get or create a member profile
 */
async function getOrCreate(userId: string): Promise<MemberProfile> {
  const store = await load()
  if (!store[userId]) {
    store[userId] = {
      userId,
      bio: undefined,
      badges: [],
      stats: {
        messages: 0,
        level: 0,
        reputation: 0,
        ticketsHelped: 0,
        joinedAt: Date.now(),
        lastActivityAt: Date.now(),
      },
    }
    await save(store)
  }
  return store[userId]
}

/**
 * Get a member's profile
 */
export async function getProfile(userId: string): Promise<MemberProfile | null> {
  const store = await load()
  return store[userId] ?? null
}

/**
 * Update member's bio
 */
export async function updateBio(userId: string, bio: string): Promise<MemberProfile> {
  const profile = await getOrCreate(userId)
  profile.bio = bio.trim().slice(0, 200) // Max 200 chars
  const store = await load()
  store[userId] = profile
  await save(store)
  return profile
}

/**
 * Update member stats (called from other systems)
 */
export async function updateStats(
  userId: string,
  updates: Partial<MemberStats>,
): Promise<MemberProfile> {
  const profile = await getOrCreate(userId)
  profile.stats = { ...profile.stats, ...updates }
  profile.stats.lastActivityAt = Date.now()
  const store = await load()
  store[userId] = profile
  await save(store)
  return profile
}

/**
 * Add a badge to a member
 */
export async function addBadge(userId: string, badgeId: string): Promise<boolean> {
  const profile = await getOrCreate(userId)
  if (!profile.badges.includes(badgeId)) {
    profile.badges.push(badgeId)
    const store = await load()
    store[userId] = profile
    await save(store)
    return true
  }
  return false
}

/**
 * Check if member has a badge
 */
export async function hasBadge(userId: string, badgeId: string): Promise<boolean> {
  const profile = await getProfile(userId)
  return profile?.badges.includes(badgeId) ?? false
}

/**
 * Get all members by a stat (for leaderboards)
 */
export async function getMembersByStats(
  statKey: keyof MemberStats,
  limit: number = 10,
): Promise<Array<{ userId: string; value: number }>> {
  const store = await load()
  return Object.values(store)
    .map((profile) => ({ userId: profile.userId, value: profile.stats[statKey] as number }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit)
}

/**
 * Get every known profile, sorted by last activity (for member list / dashboard).
 */
export async function getAllProfiles(): Promise<MemberProfile[]> {
  const store = await load()
  return Object.values(store).sort(
    (a, b) => (b.stats.lastActivityAt || 0) - (a.stats.lastActivityAt || 0),
  )
}

/**
 * Increment message count (called from message handler)
 */
export async function incrementMessageCount(userId: string): Promise<MemberProfile> {
  const profile = await getOrCreate(userId)
  profile.stats.messages += 1
  profile.stats.lastActivityAt = Date.now()
  const store = await load()
  store[userId] = profile
  await save(store)
  return profile
}

/**
 * Sync level and reputation from external sources
 */
export async function syncExternalStats(
  userId: string,
  level: number,
  reputation: number,
): Promise<MemberProfile> {
  const profile = await getOrCreate(userId)
  profile.stats.level = level
  profile.stats.reputation = reputation
  const store = await load()
  store[userId] = profile
  await save(store)
  return profile
}
