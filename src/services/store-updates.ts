/**
 * Store update notifier. Polls the store catalog and posts to a channel whenever
 * a product is updated (its updated_at changes) or a new product appears.
 *
 * The first run after enabling seeds the seen-state silently (persisted to
 * data/store-updates-seen.json) so it does not dump the whole catalog as
 * "updates". Off when STORE_UPDATES_CHANNEL_ID is unset.
 */
import type { Client } from 'discord.js'
import { storeUpdatesChannelId, storeUpdatesPollMinutes } from '../config.ts'
import { readJson, writeJson } from './data-store.ts'
import { fetchStoreProductsLive, type StoreProduct } from './store-snapshot.ts'
import { ndEmbed } from '../utils/embed.ts'

const FILE = 'store-updates-seen.json'
type Seen = Record<string, string> // slug -> updatedAt

function price(p: StoreProduct): string {
  if (p.free) return 'Free'
  const amount = (p.priceCents / 100).toFixed(2)
  const base = p.currency === 'USD' ? `$${amount}` : `${amount} ${p.currency}`
  return p.onSale ? `${base} (${p.percentOff}% off)` : base
}

async function poll(client: Client): Promise<void> {
  if (!storeUpdatesChannelId) return
  let products: StoreProduct[]
  try {
    products = await fetchStoreProductsLive()
  } catch {
    return
  }
  if (products.length === 0) return

  const seen = await readJson<Seen>(FILE, {})
  const firstRun = Object.keys(seen).length === 0
  const changes: { p: StoreProduct; kind: 'new' | 'updated' }[] = []

  for (const p of products) {
    if (!p.slug || !p.updatedAt) continue
    const prev = seen[p.slug]
    if (prev === undefined) {
      if (!firstRun) changes.push({ p, kind: 'new' })
    } else if (prev !== p.updatedAt) {
      changes.push({ p, kind: 'updated' })
    }
    seen[p.slug] = p.updatedAt
  }
  await writeJson(FILE, seen)

  if (firstRun || changes.length === 0) return

  const ch = await client.channels.fetch(storeUpdatesChannelId).catch(() => null)
  if (!ch?.isTextBased() || !('send' in ch)) return

  // Cap per poll so a bulk backend change cannot spam the channel.
  for (const { p, kind } of changes.slice(0, 10)) {
    const embed = ndEmbed()
      .setColor(kind === 'new' ? 0x00ff88 : 0x3178c6)
      .setTitle(`${kind === 'new' ? 'New release' : 'Updated'}: ${p.name}`)
      .setDescription(`${price(p)}\n${p.url}`)
      .setTimestamp()
    await ch.send({ embeds: [embed] }).catch(() => undefined)
  }
}

export function startStoreUpdatesLoop(client: Client): void {
  if (!storeUpdatesChannelId) return
  // Seed + first check shortly after boot, then on the configured interval.
  setTimeout(() => void poll(client), 15_000)
  setInterval(() => void poll(client), storeUpdatesPollMinutes * 60_000).unref?.()
}
