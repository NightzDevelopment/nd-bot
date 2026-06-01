/**
 * Timezone and Reminder Scheduler Service
 * Developed under strict Nightz Development proprietary standards (no emojis)
 */

import type { Client, TextChannel } from 'discord.js'
import { getDb } from './nd-db.ts'

export interface ReminderRecord {
  id: number
  userId: string
  channelId: string
  message: string
  triggerTime: number
  recurring: string | null
}

/** Set a user's timezone */
export function setUserTimezone(userId: string, tz: string): { ok: boolean; msg: string } {
  try {
    // Validate timezone using built-in Intl check
    Intl.DateTimeFormat(undefined, { timeZone: tz })
  } catch (e) {
    return {
      ok: false,
      msg: `Invalid timezone: "${tz}". Please use standard tz names like "America/New_York", "Europe/London", or "UTC".`,
    }
  }

  const db = getDb()
  // Ensure profile row exists
  const check = db.prepare('SELECT 1 FROM users_profiles WHERE userId = ?').get(userId)
  if (!check) {
    db.prepare('INSERT INTO users_profiles (userId, timezone) VALUES (?, ?)').run(userId, tz)
  } else {
    db.prepare('UPDATE users_profiles SET timezone = ? WHERE userId = ?').run(tz, userId)
  }

  return { ok: true, msg: `Your timezone has been set to ${tz}.` }
}

/** Get a user's timezone (defaults to UTC) */
export function getUserTimezone(userId: string): string {
  const db = getDb()
  const row = db.prepare('SELECT timezone FROM users_profiles WHERE userId = ?').get(userId) as
    | { timezone: string }
    | undefined
  return row ? row.timezone : 'UTC'
}

/** Add a reminder */
export function addReminder(
  userId: string,
  channelId: string,
  message: string,
  triggerTime: number,
  recurring: string | null = null,
): number {
  const db = getDb()
  const result = db
    .prepare(`
    INSERT INTO reminders (user_id, channel_id, message, trigger_time, recurring)
    VALUES (?, ?, ?, ?, ?)
  `)
    .run(userId, channelId, message, triggerTime, recurring)

  return Number(result.lastInsertRowid)
}

/** Get active reminders */
export function getRemindersForUser(userId: string): ReminderRecord[] {
  const db = getDb()
  const rows = db
    .prepare(
      'SELECT id, user_id, channel_id, message, trigger_time, recurring FROM reminders WHERE user_id = ?',
    )
    .all(userId)
  return rows.map((r: any) => ({
    id: r.id,
    userId: r.user_id,
    channelId: r.channel_id,
    message: r.message,
    triggerTime: r.trigger_time,
    recurring: r.recurring,
  }))
}

/** Delete a reminder */
export function deleteReminder(id: number): boolean {
  const db = getDb()
  const result = db.prepare('DELETE FROM reminders WHERE id = ?').run(id)
  return result.changes > 0
}

/** Simple parser for natural language duration/time */
export function parseNaturalTime(
  input: string,
  userTz: string,
): { triggerTime: number; recurring: string | null; error?: string } {
  const cleaned = input.toLowerCase().trim()

  // 1. Match relative formats e.g. "in 5 minutes", "in 2 hours", "in 1 day"
  const relMatch =
    /^in\s+(\d+(?:\.\d+)?)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)$/.exec(
      cleaned,
    )
  if (relMatch) {
    const amount = parseFloat(relMatch[1]!)
    const unit = relMatch[2]!
    let ms = 0
    if (unit.startsWith('m')) ms = amount * 60 * 1000
    else if (unit.startsWith('h')) ms = amount * 60 * 60 * 1000
    else if (unit.startsWith('d')) ms = amount * 24 * 60 * 60 * 1000
    return { triggerTime: Date.now() + ms, recurring: null }
  }

  // 2. Match absolute time formats e.g. "at 16:30", "at 4:30pm", "at 4pm"
  const absMatch = /^at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(cleaned)
  if (absMatch) {
    let hrs = parseInt(absMatch[1]!, 10)
    const mins = absMatch[2] ? parseInt(absMatch[2], 10) : 0
    const ampm = absMatch[3]

    if (ampm === 'pm' && hrs < 12) hrs += 12
    if (ampm === 'am' && hrs === 12) hrs = 0

    if (hrs < 0 || hrs > 23 || mins < 0 || mins > 59) {
      return { triggerTime: 0, recurring: null, error: 'Invalid hour or minute parameters.' }
    }

    // Compute trigger time based on user timezone
    try {
      const now = new Date()
      // Represent local now in user timezone
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: userTz,
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        hour12: false,
      })
      const parts = formatter.formatToParts(now)
      const getPart = (type: string) => parseInt(parts.find((p) => p.type === type)!.value, 10)

      const year = getPart('year')
      const month = getPart('month') - 1 // JS Date month is 0-indexed
      const day = getPart('day')

      // Create date object in target timezone
      // We parse as ISO/toLocaleString style or construct directly
      // In JS, constructing via timezone string is cleanest by using a template literal and Date.parse
      const pad = (n: number) => String(n).padStart(2, '0')
      const targetStr = `${year}-${pad(month + 1)}-${pad(day)}T${pad(hrs)}:${pad(mins)}:00`

      // We need to parse targetStr in the user's timezone.
      // We can use Intl offset trick or simple local target then adjustment.
      // Actually, standard way to construct absolute Date in timezone in vanilla Node/Bun:
      // Construct a Date object representing the time today.
      const localTarget = new Date(now)
      // Get the timezone offset difference between local time and user timezone
      // Easiest is to set hours/minutes locally, then adjust offset
      // A safe vanilla JS way:
      const tzTarget = new Date(new Date(targetStr).toLocaleString('en-US', { timeZone: userTz }))
      const offsetDiff = new Date(targetStr).getTime() - tzTarget.getTime()
      let finalTrigger = new Date(targetStr).getTime() + offsetDiff

      // If that time today has already passed, set it for tomorrow
      if (finalTrigger <= Date.now()) {
        finalTrigger += 24 * 60 * 60 * 1000
      }

      return { triggerTime: finalTrigger, recurring: null }
    } catch (e) {
      return {
        triggerTime: 0,
        recurring: null,
        error: `Timezone calculation failed: ${e instanceof Error ? e.message : String(e)}`,
      }
    }
  }

  return {
    triggerTime: 0,
    recurring: null,
    error:
      'Unsupported format. Use relative "in X mins/hours/days" or absolute "at HH:MM (am/pm)".',
  }
}

/** Ticks and checks reminders, executes due alarms */
export async function tickReminders(client: Client): Promise<void> {
  const db = getDb()
  const now = Date.now()
  const rows = db
    .prepare(
      'SELECT id, user_id, channel_id, message, trigger_time, recurring FROM reminders WHERE trigger_time <= ?',
    )
    .all(now)

  for (const r of rows as any[]) {
    try {
      const channel = (await client.channels.fetch(r.channel_id)) as TextChannel | null
      if (channel?.isTextBased()) {
        await channel.send(`[REMINDER] <@${r.user_id}>: ${r.message}`)
      }
    } catch (err) {
      console.warn(`[reminder] Failed to send reminder ${r.id}:`, err)
    }

    if (r.recurring) {
      // Re-schedule recurring alarm (e.g. daily, or recurring relative time if designated)
      // For now, if recurring is set, we increment trigger_time by 24h as a placeholder recurring interval
      const nextTrigger = now + 24 * 60 * 60 * 1000
      db.prepare('UPDATE reminders SET trigger_time = ? WHERE id = ?').run(nextTrigger, r.id)
    } else {
      db.prepare('DELETE FROM reminders WHERE id = ?').run(r.id)
    }
  }
}

/** Start the scheduler background loop */
export function startReminderLoop(client: Client): void {
  setInterval(() => void tickReminders(client), 15_000).unref()
  console.log('[reminder] Background reminder loop initiated (15s intervals)')
}
