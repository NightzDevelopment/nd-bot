import type { Client } from 'discord.js'
import { FAQ_CHANNEL_ID, FAQ_REFRESH_MS } from '../config.ts'

let cached: string[] = []

export function getFaqText(): string {
  if (cached.length === 0) return ''
  return 'FAQ (from pinned messages in the FAQ channel):\n' + cached.map((t, i) => `${i + 1}. ${t}`).join('\n\n')
}

/** Raw FAQ pin texts (for embedding index). */
export function getFaqCachedTexts(): string[] {
  return [...cached]
}

async function refresh(client: Client): Promise<void> {
  if (!FAQ_CHANNEL_ID) {
    cached = []
    return
  }
  try {
    const ch = await client.channels.fetch(FAQ_CHANNEL_ID)
    if (!ch?.isTextBased() || ch.isDMBased()) {
      console.warn('[faq] FAQ_CHANNEL_ID is not a guild text channel')
      return
    }
    const pins = await ch.messages.fetchPinned()
    const texts = [...pins.values()]
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
      .map((m) => m.content || '(empty message)')
      .filter(Boolean)
    cached = texts
    console.log(`[faq] loaded ${cached.length} pinned FAQ entries`)
    void import('./embeddings.ts')
      .then((m) => m.scheduleEmbeddingRebuild())
      .catch(() => {})
  } catch (e) {
    console.error('[faq] refresh failed:', e)
  }
}

/** Await once at startup so FAQ is warm before first AI reply. */
export async function refreshFaqOnce(client: Client): Promise<void> {
  await refresh(client)
}

export function startFaqLoop(client: Client): void {
  setInterval(() => void refresh(client), FAQ_REFRESH_MS).unref()
}

export function searchFaq(query: string | null): string[] {
  const q = query?.trim().toLowerCase()
  if (!q) return [...cached]
  return cached.filter((t) => t.toLowerCase().includes(q))
}
