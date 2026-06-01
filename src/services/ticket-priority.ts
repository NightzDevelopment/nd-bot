/**
 * Ticket priority + SLA helpers.
 * Priority drives:
 *  - First-response SLA target (used by ticket-system SLA nudges)
 *  - Embed color (visual signal in the channel)
 *  - Staff ping rules (high/critical may ping a role)
 *  - Sort order in dashboard list
 */

import type { TicketPriority } from './ticket-store.ts'

/** Priority weight for sorting (higher = more urgent). */
export const PRIORITY_WEIGHT: Record<TicketPriority, number> = {
  critical: 4,
  high: 3,
  normal: 2,
  low: 1,
}

/** Default first-response SLA targets in milliseconds. */
export const SLA_TARGETS_MS: Record<TicketPriority, number> = {
  critical: 15 * 60 * 1000, // 15 min
  high: 2 * 60 * 60 * 1000, // 2 hours
  normal: 12 * 60 * 60 * 1000, // 12 hours
  low: 48 * 60 * 60 * 1000, // 48 hours
}

/** Visual label / emoji for priority. */
export const PRIORITY_LABEL: Record<TicketPriority, string> = {
  critical: '🚨 Critical',
  high: '🔴 High',
  normal: '🟢 Normal',
  low: '🔵 Low',
}

/** Discord embed color for priority. */
export const PRIORITY_COLOR: Record<TicketPriority, number> = {
  critical: 0xef4444,
  high: 0xfbbf24,
  normal: 0x60a5fa,
  low: 0x94a3b8,
}

/**
 * Auto-assign a default priority based on the ticket category text and
 * (optionally) the user's intake details. Conservative defaults — most
 * tickets land at 'normal' unless the category explicitly suggests urgency.
 */
export function inferPriorityFromCategory(category: string, details?: string): TicketPriority {
  const c = (category || '').toLowerCase()
  const d = (details || '').toLowerCase()

  // Critical signals
  if (
    c.includes('exploit') ||
    c.includes('security') ||
    /\b(hack|hacked|stolen|fraud|emergency|urgent)\b/.test(d)
  ) {
    return 'critical'
  }

  // High-priority categories
  if (
    c.includes('billing') ||
    c.includes('refund') ||
    c.includes('account') ||
    c.includes('bug report') ||
    c === 'report a problem' ||
    /\b(broken|crash|down|payment failed)\b/.test(d)
  ) {
    return 'high'
  }

  // Low-priority categories (informational)
  if (
    c.includes('partnership') ||
    c.includes('suggestion') ||
    c.includes('pre-sale') ||
    c.includes('commission')
  ) {
    return 'low'
  }

  return 'normal'
}

/**
 * Has the SLA been breached? Returns true if (now - openedAt) > target for the priority.
 */
export function isSlaBreached(
  openedAt: number,
  priority: TicketPriority,
  firstStaffReplyAt?: number,
): boolean {
  if (firstStaffReplyAt) return false // already responded
  const elapsed = Date.now() - openedAt
  return elapsed > (SLA_TARGETS_MS[priority] ?? SLA_TARGETS_MS.normal)
}

/**
 * Format SLA target as a human-readable string (e.g. "15 min", "2h", "12h").
 */
export function formatSlaTarget(priority: TicketPriority): string {
  const ms = SLA_TARGETS_MS[priority] ?? SLA_TARGETS_MS.normal
  const min = Math.round(ms / 60000)
  if (min < 60) return `${min} min`
  const hours = Math.round(min / 60)
  return `${hours}h`
}
