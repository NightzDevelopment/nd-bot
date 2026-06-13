/**
 * Ticket templates: saved staff replies for common ticket scenarios.
 * Storage: data/ticket-templates.json
 *
 * Format:
 *   {
 *     "<key>": { key, title, body, category?, createdAt, createdBy }
 *   }
 *
 * Templates can be inserted via /ticketreply with autocomplete on the key.
 */

import { readJson, writeJson } from './data-store.ts'

const FILE = 'ticket-templates.json'

export interface TicketTemplate {
  key: string
  title: string
  body: string
  /** Optional category hint (matches ticket.reason for filtering). */
  category?: string | undefined
  createdAt: number
  createdBy: string
}

export type TemplateStore = Record<string, TicketTemplate>

const DEFAULT_TEMPLATES: TemplateStore = {
  'install-help': {
    key: 'install-help',
    title: 'Installation help: request details',
    body:
      'Thanks for opening a ticket! To get you running quickly, please share:\n' +
      '• Your **framework** (ESX / QBCore / standalone)\n' +
      '• Your **server artifact** version\n' +
      '• The **exact error** from F8 / server console (paste the SCRIPT ERROR lines)\n' +
      "• The **resource name** and where it's installed",
    createdAt: 0,
    createdBy: 'system',
  },
  'refund-policy': {
    key: 'refund-policy',
    title: 'Refund policy reference',
    body:
      'Per our policy, refunds are reviewed on a case-by-case basis within 7 days of purchase.\n' +
      "Please share your **order/invoice ID** and a brief description of why you'd like a refund.\n" +
      "We'll review and get back to you as soon as possible.",
    createdAt: 0,
    createdBy: 'system',
    category: 'Refund Request',
  },
  'awaiting-info': {
    key: 'awaiting-info',
    title: 'Awaiting more information',
    body:
      "We're holding this ticket open while we wait on the details requested above. " +
      "If you can share them at your convenience, we'll continue the investigation.",
    createdAt: 0,
    createdBy: 'system',
  },
  'fixed-please-test': {
    key: 'fixed-please-test',
    title: 'Fix shipped: please test',
    body: "We've shipped a fix for this issue. Please pull the latest version, restart your server, and let us know if the problem is resolved on your end.",
    createdAt: 0,
    createdBy: 'system',
  },
  'closing-soon': {
    key: 'closing-soon',
    title: 'Closing soon: last chance',
    body: "We haven't heard back in a while, so we'll close this ticket soon. If you still need help, just reply here and we'll keep it open.",
    createdAt: 0,
    createdBy: 'system',
  },
}

async function load(): Promise<TemplateStore> {
  return readJson<TemplateStore>(FILE, DEFAULT_TEMPLATES)
}

async function save(store: TemplateStore): Promise<void> {
  await writeJson(FILE, store)
}

/**
 * Bootstrap the store with default templates if it's empty.
 * Called once at startup so /ticketreply has something to offer immediately.
 */
export async function ensureDefaultTemplates(): Promise<void> {
  const store = await load()
  if (Object.keys(store).length === 0) {
    await save({ ...DEFAULT_TEMPLATES })
  }
}

export async function listTemplates(): Promise<TicketTemplate[]> {
  const store = await load()
  return Object.values(store).sort((a, b) => a.key.localeCompare(b.key))
}

export async function getTemplate(key: string): Promise<TicketTemplate | null> {
  const store = await load()
  return store[key] ?? null
}

export async function setTemplate(t: TicketTemplate): Promise<void> {
  const store = await load()
  store[t.key] = t
  await save(store)
}

export async function deleteTemplate(key: string): Promise<boolean> {
  const store = await load()
  if (!store[key]) return false
  delete store[key]
  await save(store)
  return true
}

export async function searchTemplateKeys(query: string, limit = 25): Promise<string[]> {
  const store = await load()
  const q = (query || '').toLowerCase()
  return Object.values(store)
    .filter((t) => !q || t.key.toLowerCase().includes(q) || t.title.toLowerCase().includes(q))
    .slice(0, limit)
    .map((t) => t.key)
}
