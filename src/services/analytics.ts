/**
 * Analytics & Statistics
 * Track bot usage, user activity, and engagement metrics
 *
 * Storage: data/analytics.jsonl (append-only log)
 * Each line is a JSON event: { type, timestamp, userId, channelId, guildId, data }
 */

import { appendFile, readFile } from 'node:fs/promises'
import { writeFileAtomic } from './data-store.ts'

const ANALYTICS_FILE = 'data/analytics.jsonl'

export type EventType =
  | 'message'
  | 'command'
  | 'reaction'
  | 'level_up'
  | 'ai_response'
  | 'error'
  | 'custom_command'

export interface AnalyticsEvent {
  type: EventType
  timestamp: number
  userId?: string | undefined
  channelId?: string | undefined
  guildId?: string | undefined
  data: Record<string, unknown>
}

export interface UserStats {
  userId: string
  messageCount: number
  commandCount: number
  levelUps: number
  firstSeen: number
  lastSeen: number
  favoriteChannel?: string
}

export interface GuildStats {
  guildId: string
  messageCount: number
  userCount: number
  commandCount: number
  customCommandUses: number
}

/**
 * Log an analytics event
 */
export async function logEvent(event: Omit<AnalyticsEvent, 'timestamp'>): Promise<void> {
  const fullEvent: AnalyticsEvent = {
    ...event,
    timestamp: Date.now(),
  }

  try {
    const line = JSON.stringify(fullEvent) + '\n'
    await appendFile(ANALYTICS_FILE, line)
  } catch (e) {
    console.warn('[analytics] failed to log event:', e)
  }
}

/**
 * Get user statistics
 */
export async function getUserStats(userId: string): Promise<UserStats | null> {
  try {
    const content = await readFile(ANALYTICS_FILE, 'utf8')
    const lines = content.split('\n').filter((l) => l.trim())

    const stats: UserStats = {
      userId,
      messageCount: 0,
      commandCount: 0,
      levelUps: 0,
      firstSeen: Date.now(),
      lastSeen: 0,
    }

    for (const line of lines) {
      const event: AnalyticsEvent = JSON.parse(line)
      if (event.userId !== userId) continue

      stats.lastSeen = Math.max(stats.lastSeen, event.timestamp)
      if (stats.firstSeen === 0 || event.timestamp < stats.firstSeen) {
        stats.firstSeen = event.timestamp
      }

      if (event.type === 'message') stats.messageCount++
      if (event.type === 'command') stats.commandCount++
      if (event.type === 'level_up') stats.levelUps++
      if (event.type === 'custom_command') stats.commandCount++

      if (event.channelId && !stats.favoriteChannel) {
        stats.favoriteChannel = event.channelId
      }
    }

    return stats
  } catch {
    return null
  }
}

/**
 * Get guild statistics
 */
export async function getGuildStats(guildId: string): Promise<GuildStats | null> {
  try {
    const content = await readFile(ANALYTICS_FILE, 'utf8')
    const lines = content.split('\n').filter((l) => l.trim())

    const users = new Set<string>()
    const stats: GuildStats = {
      guildId,
      messageCount: 0,
      userCount: 0,
      commandCount: 0,
      customCommandUses: 0,
    }

    for (const line of lines) {
      const event: AnalyticsEvent = JSON.parse(line)
      if (event.guildId !== guildId) continue

      if (event.userId) users.add(event.userId)

      if (event.type === 'message') stats.messageCount++
      if (event.type === 'command') stats.commandCount++
      if (event.type === 'custom_command') stats.customCommandUses++
    }

    stats.userCount = users.size
    return stats
  } catch {
    return null
  }
}

/**
 * Get top users by message count
 */
export async function getTopUsers(limit: number = 10): Promise<UserStats[]> {
  try {
    const content = await readFile(ANALYTICS_FILE, 'utf8')
    const lines = content.split('\n').filter((l) => l.trim())

    const userMap = new Map<string, UserStats>()

    for (const line of lines) {
      const event: AnalyticsEvent = JSON.parse(line)
      if (!event.userId) continue

      let stats = userMap.get(event.userId)
      if (!stats) {
        stats = {
          userId: event.userId,
          messageCount: 0,
          commandCount: 0,
          levelUps: 0,
          firstSeen: Date.now(),
          lastSeen: 0,
        }
        userMap.set(event.userId, stats)
      }

      stats.lastSeen = Math.max(stats.lastSeen, event.timestamp)
      if (event.timestamp < stats.firstSeen) stats.firstSeen = event.timestamp

      if (event.type === 'message') stats.messageCount++
      if (event.type === 'command') stats.commandCount++
      if (event.type === 'level_up') stats.levelUps++
    }

    return Array.from(userMap.values())
      .sort((a, b) => b.messageCount - a.messageCount)
      .slice(0, limit)
  } catch {
    return []
  }
}

/**
 * Get analytics for time range
 */
export async function getAnalyticsByTimeRange(
  startTime: number,
  endTime: number,
): Promise<{ events: AnalyticsEvent[]; summary: Record<EventType, number> }> {
  try {
    const content = await readFile(ANALYTICS_FILE, 'utf8')
    const lines = content.split('\n').filter((l) => l.trim())

    const events: AnalyticsEvent[] = []
    const summary: Record<EventType, number> = {
      message: 0,
      command: 0,
      reaction: 0,
      level_up: 0,
      ai_response: 0,
      error: 0,
      custom_command: 0,
    }

    for (const line of lines) {
      const event: AnalyticsEvent = JSON.parse(line)
      if (event.timestamp >= startTime && event.timestamp <= endTime) {
        events.push(event)
        summary[event.type]++
      }
    }

    return { events, summary }
  } catch {
    return {
      events: [],
      summary: {
        message: 0,
        command: 0,
        reaction: 0,
        level_up: 0,
        ai_response: 0,
        error: 0,
        custom_command: 0,
      },
    }
  }
}

/**
 * Generate analytics report
 */
export async function generateReport(): Promise<string> {
  try {
    const topUsers = await getTopUsers(5)
    const today = new Date().setHours(0, 0, 0, 0)
    const { summary } = await getAnalyticsByTimeRange(today, Date.now())

    let report = '**Analytics Report**\n\n'

    report += "**Today's Activity:**\n"
    report += `Messages: ${summary.message}\n`
    report += `Commands: ${summary.command}\n`
    report += `Custom Commands: ${summary.custom_command}\n`
    report += `AI Responses: ${summary.ai_response}\n\n`

    report += '**Top Users:**\n'
    for (let i = 0; i < topUsers.length; i++) {
      const user = topUsers[i]
      if (!user) continue
      report += `${i + 1}. <@${user.userId}> - ${user.messageCount} messages\n`
    }

    return report
  } catch (e) {
    return 'Failed to generate report'
  }
}

/**
 * Clean old analytics (keep last N days)
 */
export async function cleanOldAnalytics(daysToKeep: number = 30): Promise<void> {
  try {
    const content = await readFile(ANALYTICS_FILE, 'utf8')
    const lines = content.split('\n').filter((l) => l.trim())
    const cutoff = Date.now() - daysToKeep * 24 * 60 * 60 * 1000

    const kept = lines.filter((line) => {
      const event: AnalyticsEvent = JSON.parse(line)
      return event.timestamp >= cutoff
    })

    await writeFileAtomic(ANALYTICS_FILE, kept.map((l) => l + '\n').join(''))
    console.log(`[analytics] cleaned old events, kept ${kept.length}/${lines.length} events`)
  } catch (e) {
    console.warn('[analytics] cleanup failed:', e)
  }
}
