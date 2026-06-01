/**
 * Achievements & Badges System
 * Gamified badges for milestones and activities
 */

import { readJson, writeJson } from './data-store.ts'
import { addBadge, getProfile, hasBadge } from './member-profile.ts'

export interface BadgeDefinition {
  id: string
  name: string
  icon: string
  description: string
  category: 'milestone' | 'activity' | 'social' | 'special'
}

export interface AchievementStore {
  badges: BadgeDefinition[]
  userBadges: Record<string, string[]> // userId -> badge IDs
}

const FILE = 'achievements.json'

const DEFAULT_BADGES: BadgeDefinition[] = [
  {
    id: 'first_message',
    name: 'First Step',
    icon: '[HELLO]',
    description: 'Posted your first message',
    category: 'milestone',
  },
  {
    id: 'level_5',
    name: 'Rising Star',
    icon: '[STAR]',
    description: 'Reached level 5',
    category: 'milestone',
  },
  {
    id: 'level_10',
    name: 'Veteran',
    icon: '[VETERAN]',
    description: 'Reached level 10',
    category: 'milestone',
  },
  {
    id: 'level_20',
    name: 'Legend',
    icon: '[CROWN]',
    description: 'Reached level 20',
    category: 'milestone',
  },
  {
    id: 'helpful_5',
    name: 'Helpful Soul',
    icon: '[HEART]',
    description: 'Received 5+ reputation',
    category: 'social',
  },
  {
    id: 'helpful_25',
    name: 'Community Hero',
    icon: '[HERO]',
    description: 'Received 25+ reputation',
    category: 'social',
  },
  {
    id: 'ticket_solver',
    name: 'Problem Solver',
    icon: '[WRENCH]',
    description: 'Helped resolve 5 support tickets',
    category: 'activity',
  },
  {
    id: 'active_7d',
    name: 'Consistent',
    icon: '[CALENDAR]',
    description: 'Active for 7+ consecutive days',
    category: 'activity',
  },
  {
    id: 'active_30d',
    name: 'Dedicated',
    icon: '[FIRE]',
    description: 'Active for 30+ consecutive days',
    category: 'activity',
  },
  {
    id: 'custom_command',
    name: 'Creator',
    icon: '[SPARKLE]',
    description: 'Created a custom command',
    category: 'special',
  },
  {
    id: '100_messages',
    name: 'Chatterbox',
    icon: '[SPEECH]',
    description: 'Posted 100+ messages',
    category: 'activity',
  },
  {
    id: '500_messages',
    name: 'Voice of the Community',
    icon: '[MEGAPHONE]',
    description: 'Posted 500+ messages',
    category: 'activity',
  },
]

async function load(): Promise<AchievementStore> {
  const store = await readJson<AchievementStore>(FILE, {
    badges: DEFAULT_BADGES,
    userBadges: {},
  })
  return store
}

async function save(store: AchievementStore): Promise<void> {
  await writeJson(FILE, store)
}

/**
 * Get all badge definitions
 */
export async function getAllBadges(): Promise<BadgeDefinition[]> {
  const store = await load()
  return store.badges
}

/**
 * Get a badge definition by ID
 */
export async function getBadge(badgeId: string): Promise<BadgeDefinition | null> {
  const badges = await getAllBadges()
  return badges.find((b) => b.id === badgeId) ?? null
}

/**
 * Award a badge to a user
 */
export async function awardBadge(
  userId: string,
  badgeId: string,
): Promise<{ awarded: boolean; isNew: boolean }> {
  const badge = await getBadge(badgeId)
  if (!badge) return { awarded: false, isNew: false }

  const profile = await getProfile(userId)
  const alreadyHas = profile?.badges.includes(badgeId) ?? false

  if (!alreadyHas) {
    await addBadge(userId, badgeId)
    return { awarded: true, isNew: true }
  }
  return { awarded: true, isNew: false }
}

/**
 * Get user's badges with full details
 */
export async function getUserBadges(userId: string): Promise<BadgeDefinition[]> {
  const profile = await getProfile(userId)
  if (!profile) return []

  const badges = await getAllBadges()
  return badges.filter((b) => profile.badges.includes(b.id))
}

/**
 * Check and award achievement based on user stats
 */
export async function checkAndAwardAchievements(
  userId: string,
  stats: {
    level?: number
    reputation?: number
    messages?: number
    ticketsHelped?: number
    createdCommand?: boolean
  },
): Promise<string[]> {
  const awarded: string[] = []

  if (stats.level !== undefined) {
    if (stats.level >= 5) {
      const result = await awardBadge(userId, 'level_5')
      if (result.isNew) awarded.push('level_5')
    }
    if (stats.level >= 10) {
      const result = await awardBadge(userId, 'level_10')
      if (result.isNew) awarded.push('level_10')
    }
    if (stats.level >= 20) {
      const result = await awardBadge(userId, 'level_20')
      if (result.isNew) awarded.push('level_20')
    }
  }

  if (stats.reputation !== undefined) {
    if (stats.reputation >= 5) {
      const result = await awardBadge(userId, 'helpful_5')
      if (result.isNew) awarded.push('helpful_5')
    }
    if (stats.reputation >= 25) {
      const result = await awardBadge(userId, 'helpful_25')
      if (result.isNew) awarded.push('helpful_25')
    }
  }

  if (stats.messages !== undefined) {
    if (stats.messages >= 100) {
      const result = await awardBadge(userId, '100_messages')
      if (result.isNew) awarded.push('100_messages')
    }
    if (stats.messages >= 500) {
      const result = await awardBadge(userId, '500_messages')
      if (result.isNew) awarded.push('500_messages')
    }
  }

  if (stats.ticketsHelped !== undefined) {
    if (stats.ticketsHelped >= 5) {
      const result = await awardBadge(userId, 'ticket_solver')
      if (result.isNew) awarded.push('ticket_solver')
    }
  }

  if (stats.createdCommand) {
    const result = await awardBadge(userId, 'custom_command')
    if (result.isNew) awarded.push('custom_command')
  }

  return awarded
}

/**
 * Get badges by category
 */
export async function getBadgesByCategory(
  category: 'milestone' | 'activity' | 'social' | 'special',
): Promise<BadgeDefinition[]> {
  const badges = await getAllBadges()
  return badges.filter((b) => b.category === category)
}

/**
 * Award first message badge
 */
export async function awardFirstMessageBadge(userId: string): Promise<boolean> {
  const alreadyHas = await hasBadge(userId, 'first_message')
  if (!alreadyHas) {
    await awardBadge(userId, 'first_message')
    return true
  }
  return false
}
