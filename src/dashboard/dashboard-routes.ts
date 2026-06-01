// @ts-nocheck — WIP: depends on `elysia` (not installed) and is not wired
// into src/bot.ts yet. Skipping typecheck until the dashboard router is
// either migrated to elysia (`bun add elysia`) or these routes are folded
// into src/dashboard/server.ts (Bun.serve). Track in Phase 5 (Dashboard
// backend) of the overhaul plan.
/**
 * Dashboard API Routes
 * Admin dashboard endpoints for analytics, members, and moderation
 */

import type { Elysia } from 'elysia'
import { getUserBadges } from '../services/achievements.ts'
import { getMembersByStats, getProfile } from '../services/member-profile.ts'
import { getHighSeverityNotes, getUserNotes } from '../services/mod-notes.ts'
import { getReputation } from '../services/reputation.ts'
import { getRecentWarnings, getUsersNeedingAttention, getWarnings } from '../services/warnings.ts'
import {
  getAnalyticsSummary,
  getCustomCommandUsage,
  getIntentDistribution,
  getMessageCountByDay,
  getModelUsageDistribution,
  getTopUsersByMessages,
} from './analytics-queries.ts'

/**
 * Register dashboard routes
 */
export function registerDashboardRoutes(app: Elysia): Elysia {
  // Analytics endpoints
  app.get('/api/analytics/summary', async (ctx) => {
    try {
      const summary = await getAnalyticsSummary(30)
      return { ok: true, data: summary }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  app.get('/api/analytics/messages', async (ctx) => {
    try {
      const days = parseInt(ctx.query.days as string) || 30
      const data = await getMessageCountByDay(days)
      return { ok: true, data }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  app.get('/api/analytics/top-users', async (ctx) => {
    try {
      const limit = parseInt(ctx.query.limit as string) || 10
      const data = await getTopUsersByMessages(limit)
      return { ok: true, data }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  app.get('/api/analytics/intents', async (ctx) => {
    try {
      const data = await getIntentDistribution()
      return { ok: true, data }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  app.get('/api/analytics/commands', async (ctx) => {
    try {
      const limit = parseInt(ctx.query.limit as string) || 10
      const data = await getCustomCommandUsage(limit)
      return { ok: true, data }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  app.get('/api/analytics/models', async (ctx) => {
    try {
      const data = await getModelUsageDistribution()
      return { ok: true, data }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  // Member endpoints
  app.get('/api/members/:userId', async (ctx) => {
    try {
      const { userId } = ctx.params
      const profile = await getProfile(userId)
      const badges = await getUserBadges(userId)
      const rep = await getReputation(userId)
      const warnings = await getWarnings(userId)
      const notes = await getUserNotes(userId)

      return {
        ok: true,
        data: {
          userId,
          profile,
          badges,
          reputation: rep?.points ?? 0,
          warnings: warnings?.count ?? 0,
          notes: notes?.notes.length ?? 0,
        },
      }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  app.get('/api/members', async (ctx) => {
    try {
      const stat = (ctx.query.stat as string) || 'messages'
      const limit = parseInt(ctx.query.limit as string) || 50

      const members = await getMembersByStats(stat as any, limit)
      return {
        ok: true,
        data: members.map((m) => ({
          userId: m.userId,
          [stat]: m.value,
        })),
      }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  // Moderation endpoints
  app.get('/api/moderation/warnings', async (ctx) => {
    try {
      const limit = parseInt(ctx.query.limit as string) || 50
      const data = await getRecentWarnings(limit)
      return { ok: true, data }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  app.get('/api/moderation/needs-attention', async (ctx) => {
    try {
      const data = await getUsersNeedingAttention()
      return { ok: true, data }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  app.get('/api/moderation/high-severity-notes', async (ctx) => {
    try {
      // Get all users with high severity notes
      const notesList = await import('../services/mod-notes.ts').then((m) => m.getAllNotes?.())
      if (!notesList) return { ok: true, data: [] }

      const users = Object.entries(notesList)
        .filter(([_, record]) => record.notes?.some((n) => n.severity === 'high'))
        .slice(0, 20)

      return {
        ok: true,
        data: users.map(([userId, record]) => ({
          userId,
          noteCount: record.notes?.length ?? 0,
          highCount: record.notes?.filter((n) => n.severity === 'high').length ?? 0,
          latestNote: record.notes?.[record.notes.length - 1],
        })),
      }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  // Health endpoint
  app.get('/api/dashboard/health', async () => {
    return {
      ok: true,
      timestamp: Date.now(),
      uptime: process.uptime(),
    }
  })

  return app
}
