import type { Content } from '@google/generative-ai'
import { conversationMemoryFile, persistentMemoryEnabled } from '../config.ts'
import { readJson, writeJson } from './data-store.ts'

export type Turn = { role: 'user' | 'model'; content: string }

const store = new Map<string, Turn[]>()
let saveTimer: ReturnType<typeof setTimeout> | null = null

export async function initConversationMemory(): Promise<void> {
  if (!persistentMemoryEnabled) return
  try {
    const data = await readJson<Record<string, Turn[]>>(conversationMemoryFile, {})
    let n = 0
    for (const [k, v] of Object.entries(data)) {
      if (!Array.isArray(v)) continue
      const capped = v.slice(-40)
      store.set(k, capped)
      n++
    }
    console.log(`[memory] loaded ${n} channel(s) from ${conversationMemoryFile}`)
  } catch (e) {
    console.warn('[memory] load failed:', e)
  }
}

function schedulePersist(): void {
  if (!persistentMemoryEnabled) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    const obj: Record<string, Turn[]> = {}
    for (const [k, v] of store) {
      obj[k] = v
    }
    void writeJson(conversationMemoryFile, obj).catch((e) =>
      console.warn('[memory] save failed:', e),
    )
  }, 900)
}

export function getHistory(channelId: string): Turn[] {
  return store.get(channelId) ?? []
}

export function pushTurn(channelId: string, turn: Turn, maxTurns: number): void {
  const list = store.get(channelId) ?? []
  list.push(turn)
  while (list.length > maxTurns) {
    list.shift()
  }
  store.set(channelId, list)
  schedulePersist()
}

export function clearChannel(channelId: string): void {
  store.delete(channelId)
  schedulePersist()
}

/** Convert to Gemini chat history format (excludes the latest user message if caller sends it separately) */
export function toGeminiHistory(turns: Turn[]): Content[] {
  return turns.map((t) => ({
    role: t.role,
    parts: [{ text: t.content }],
  }))
}
