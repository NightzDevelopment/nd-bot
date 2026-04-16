/**
 * Rolling support analytics for weekly digest (JSON in DATA_DIR).
 */
import { readJson, writeJson } from './data-store.ts'

export type AnalyticsEntry = {
  t: number
  channelId: string
  userSnippet: string
  botSnippet: string
  ticketCue: boolean
}

type Store = { entries: AnalyticsEntry[] }

const FILE = 'support-analytics.json'
const MAX_ENTRIES = 2000
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000

/** Same heuristic as recorded ticketCue on bot replies; used for ticket-offer UI. */
export function isTicketCueBotReply(botSnippet: string): boolean {
  return /\b(open (a )?ticket|support ticket|ticket\s*[#\d])\b/i.test(botSnippet)
}

async function load(): Promise<Store> {
  return readJson<Store>(FILE, { entries: [] })
}

function trim(store: Store): void {
  const now = Date.now()
  store.entries = store.entries.filter((e) => now - e.t < MAX_AGE_MS)
  if (store.entries.length > MAX_ENTRIES) {
    store.entries = store.entries.slice(-MAX_ENTRIES)
  }
}

export async function recordSupportExchange(
  channelId: string,
  userSnippet: string,
  botSnippet: string,
): Promise<void> {
  const ticketCue = isTicketCueBotReply(botSnippet)
  const store = await load()
  store.entries.push({
    t: Date.now(),
    channelId,
    userSnippet: userSnippet.slice(0, 600),
    botSnippet: botSnippet.slice(0, 800),
    ticketCue,
  })
  trim(store)
  await writeJson(FILE, store)
}

export async function getEntriesLastMs(ms: number): Promise<AnalyticsEntry[]> {
  const store = await load()
  trim(store)
  const cutoff = Date.now() - ms
  return store.entries.filter((e) => e.t >= cutoff)
}
