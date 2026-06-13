/**
 * Analytics Query Helpers
 * Aggregate and query analytics data for dashboard display
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DATA_DIR } from '../config.ts'

export interface AnalyticsEvent {
  type: string
  userId: string
  channelId: string
  guildId?: string
  data?: Record<string, unknown>
  timestamp: number
}

/**
 * Read analytics.jsonl as NDJSON (one event per line).
 * The previous readJson() helper expected a single JSON array, but this file
 * is line-delimited, so it always parsed as empty.
 */
async function readAnalyticsEvents(): Promise<AnalyticsEvent[]> {
  try {
    const filePath = join(DATA_DIR, 'analytics.jsonl')
    const raw = await readFile(filePath, 'utf8')
    const events: AnalyticsEvent[] = []
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        events.push(JSON.parse(trimmed) as AnalyticsEvent)
      } catch {
        // skip malformed lines
      }
    }
    return events
  } catch {
    return []
  }
}

export interface MessageStats {
  date: string
  count: number
}

export interface UserActivity {
  userId: string
  messageCount: number
  commandCount: number
  aiResponses: number
  customCommands: number
}

export interface IntentBreakdown {
  intent: string
  count: number
  percentage: number
}

export interface TopUsersStat {
  userId: string
  messageCount: number
  aiResponses: number
  customCommands: number
}

/**
 * Get message count by day (last N days)
 */
export async function getMessageCountByDay(days: number = 30): Promise<MessageStats[]> {
  try {
    const events = await readAnalyticsEvents()
    const now = Date.now()
    const cutoff = now - days * 24 * 60 * 60 * 1000

    const byDay: Record<string, number> = {}

    for (const event of events) {
      if (event.timestamp < cutoff) continue
      if (event.type !== 'message' && event.type !== 'ai_response') continue

      const date = new Date(event.timestamp).toISOString().split('T')[0] ?? ''
      byDay[date] = (byDay[date] ?? 0) + 1
    }

    return Object.entries(byDay)
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date))
  } catch {
    return []
  }
}

/**
 * Get top users by message count
 */
export async function getTopUsersByMessages(limit: number = 10): Promise<TopUsersStat[]> {
  try {
    const events = await readAnalyticsEvents()
    const userStats: Record<string, TopUsersStat> = {}

    for (const event of events) {
      if (!event.userId) continue

      const us = (userStats[event.userId] ??= {
        userId: event.userId,
        messageCount: 0,
        aiResponses: 0,
        customCommands: 0,
      })

      if (event.type === 'message') {
        us.messageCount += 1
      } else if (event.type === 'ai_response') {
        us.aiResponses += 1
      } else if (event.type === 'custom_command') {
        us.customCommands += 1
      }
    }

    return Object.values(userStats)
      .sort((a, b) => b.messageCount - a.messageCount)
      .slice(0, limit)
  } catch {
    return []
  }
}

/**
 * Get intent distribution (percentage breakdown)
 */
export async function getIntentDistribution(): Promise<IntentBreakdown[]> {
  try {
    const events = await readAnalyticsEvents()
    const intentCounts: Record<string, number> = {}
    let total = 0

    for (const event of events) {
      if (event.type !== 'ai_response') continue
      if (!event.data?.intent) continue

      const intent = event.data.intent as string
      intentCounts[intent] = (intentCounts[intent] ?? 0) + 1
      total += 1
    }

    if (total === 0) return []

    return Object.entries(intentCounts)
      .map(([intent, count]) => ({
        intent,
        count,
        percentage: Math.round((count / total) * 100),
      }))
      .sort((a, b) => b.count - a.count)
  } catch {
    return []
  }
}

/**
 * Get custom command usage stats
 */
export async function getCustomCommandUsage(
  limit: number = 10,
): Promise<Array<{ command: string; count: number }>> {
  try {
    const events = await readAnalyticsEvents()
    const commands: Record<string, number> = {}

    for (const event of events) {
      if (event.type !== 'custom_command') continue
      if (!event.data?.command) continue

      const cmd = event.data.command as string
      commands[cmd] = (commands[cmd] ?? 0) + 1
    }

    return Object.entries(commands)
      .map(([command, count]) => ({ command, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit)
  } catch {
    return []
  }
}

/**
 * Get overall analytics summary
 */
export async function getAnalyticsSummary(days: number = 30): Promise<{
  totalMessages: number
  totalAiResponses: number
  uniqueUsers: number
  totalCustomCommands: number
  avgMessagesPerDay: number
  topIntent: string | null
}> {
  try {
    const events = await readAnalyticsEvents()
    const now = Date.now()
    const cutoff = now - days * 24 * 60 * 60 * 1000

    let totalMessages = 0
    let totalAiResponses = 0
    let totalCustomCommands = 0
    const uniqueUsers = new Set<string>()
    const intents: Record<string, number> = {}

    for (const event of events) {
      if (event.timestamp < cutoff) continue

      if (event.userId) uniqueUsers.add(event.userId)

      if (event.type === 'message') {
        totalMessages += 1
      } else if (event.type === 'ai_response') {
        totalAiResponses += 1
        if (event.data?.intent) {
          const intent = event.data.intent as string
          intents[intent] = (intents[intent] ?? 0) + 1
        }
      } else if (event.type === 'custom_command') {
        totalCustomCommands += 1
      }
    }

    const topIntent = Object.entries(intents).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

    return {
      totalMessages,
      totalAiResponses,
      uniqueUsers: uniqueUsers.size,
      totalCustomCommands,
      avgMessagesPerDay: Math.round(totalMessages / days),
      topIntent,
    }
  } catch {
    return {
      totalMessages: 0,
      totalAiResponses: 0,
      uniqueUsers: 0,
      totalCustomCommands: 0,
      avgMessagesPerDay: 0,
      topIntent: null,
    }
  }
}

/**
 * Get AI model usage distribution
 */
export async function getLeaderboard(
  stat: 'reputation' | 'messages' | 'level' | string,
  limit: number = 10,
): Promise<Array<{ userId: string; value: number }>> {
  try {
    const dataDir = DATA_DIR ?? './data'
    if (stat === 'reputation') {
      const raw = await readFile(join(dataDir, 'reputation.json'), 'utf8').catch(() => '{}')
      const map = JSON.parse(raw) as Record<string, { points?: number }>
      return Object.entries(map)
        .map(([userId, v]) => ({ userId, value: v.points ?? 0 }))
        .filter((r) => r.value > 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, limit)
    }
    if (stat === 'messages' || stat === 'level') {
      const raw = await readFile(join(dataDir, 'levels.json'), 'utf8').catch(() => '{}')
      const map = JSON.parse(raw) as Record<
        string,
        Record<string, { messages?: number; level?: number }>
      >
      const agg: Record<string, number> = {}
      for (const guildData of Object.values(map)) {
        for (const [uid, d] of Object.entries(guildData)) {
          agg[uid] = (agg[uid] ?? 0) + (stat === 'level' ? (d.level ?? 0) : (d.messages ?? 0))
        }
      }
      return Object.entries(agg)
        .map(([userId, value]) => ({ userId, value }))
        .filter((r) => r.value > 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, limit)
    }
    return []
  } catch {
    return []
  }
}

export async function getModelUsageDistribution(): Promise<
  Array<{ model: string; count: number; percentage: number }>
> {
  try {
    const events = await readAnalyticsEvents()
    const models: Record<string, number> = {}
    let total = 0

    for (const event of events) {
      if (event.type !== 'ai_response') continue
      if (!event.data?.preferredModel) continue

      const model = event.data.preferredModel as string
      models[model] = (models[model] ?? 0) + 1
      total += 1
    }

    if (total === 0) return []

    return Object.entries(models)
      .map(([model, count]) => ({
        model,
        count,
        percentage: Math.round((count / total) * 100),
      }))
      .sort((a, b) => b.count - a.count)
  } catch {
    return []
  }
}
