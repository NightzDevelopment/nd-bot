/**
 * Tiny in-memory response cache for the deterministic-style classifier path
 * (generateRaw): AutoMod, scam-link, appeal triage, etc. Identical prompts
 * within a short TTL return the stored answer instead of re-calling a provider.
 * Chat replies are intentionally NOT cached (they are contextual).
 *
 * Bounded by size (oldest evicted) and TTL. RAM only; cleared on restart.
 */
import { aiResponseCacheMax, aiResponseCacheTtlSec } from '../config.ts'

type Entry = { value: string; expires: number }
const store = new Map<string, Entry>()

/** Stable 32-bit FNV-1a hash so keys stay short regardless of prompt length. */
function hashKey(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36) + ':' + s.length
}

export function getCached(prompt: string): string | null {
  const key = hashKey(prompt)
  const hit = store.get(key)
  if (!hit) return null
  if (hit.expires <= Date.now()) {
    store.delete(key)
    return null
  }
  // Refresh recency: re-insert so it is considered most recent for eviction.
  store.delete(key)
  store.set(key, hit)
  return hit.value
}

export function setCached(prompt: string, value: string): void {
  const ttl = Math.max(1, aiResponseCacheTtlSec) * 1000
  const key = hashKey(prompt)
  store.set(key, { value, expires: Date.now() + ttl })
  while (store.size > Math.max(1, aiResponseCacheMax)) {
    const oldest = store.keys().next().value
    if (oldest === undefined) break
    store.delete(oldest)
  }
}

export function clearAiCache(): void {
  store.clear()
}
