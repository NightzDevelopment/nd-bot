import type { Content } from '@google/generative-ai'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { conversationMemoryFile, GOOGLE_KEY, MODEL_ID, persistentMemoryEnabled } from '../config.ts'
import { readJson, writeJson } from './data-store.ts'

const genAI = new GoogleGenerativeAI(GOOGLE_KEY)

export type Turn = { role: 'user' | 'model'; content: string }

const store = new Map<string, Turn[]>()
const historicalSummaries = new Map<string, string>()
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

    const summariesData = await readJson<Record<string, string>>('conversation-summaries.json', {})
    let sCount = 0
    for (const [k, v] of Object.entries(summariesData)) {
      if (typeof v === 'string') {
        historicalSummaries.set(k, v)
        sCount++
      }
    }
    if (sCount > 0) {
      console.log(`[memory] loaded ${sCount} historical summaries from conversation-summaries.json`)
    }
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

    const sumObj: Record<string, string> = {}
    for (const [k, v] of historicalSummaries) {
      sumObj[k] = v
    }
    void writeJson('conversation-summaries.json', sumObj).catch((e) =>
      console.warn('[memory] summaries save failed:', e),
    )
  }, 900)
}

export function getHistory(channelId: string): Turn[] {
  const list = store.get(channelId) ?? []
  const summary = historicalSummaries.get(channelId)
  if (summary && list.length > 0) {
    const copy = [...list]
    copy[0] = {
      role: copy[0]!.role,
      content: `${summary}\n\n${copy[0]!.content}`,
    }
    return copy
  }
  return list
}

export function pushTurn(channelId: string, turn: Turn, maxTurns: number): void {
  const list = store.get(channelId) ?? []
  list.push(turn)
  while (list.length > maxTurns) {
    list.shift()
  }
  store.set(channelId, list)
  schedulePersist()

  // Dynamic memory compression gate
  if (list.length > 30) {
    void compressMemoryAsync(channelId, list)
  }
}

export function clearChannel(channelId: string): void {
  store.delete(channelId)
  historicalSummaries.delete(channelId)
  schedulePersist()
}

/** Summarizes the oldest 20 turns using Gemini in the background */
export async function compressMemoryAsync(channelId: string, turns: Turn[]): Promise<void> {
  if (turns.length <= 30) return

  const toSummarize = turns.slice(0, 20)
  const remaining = turns.slice(20)

  try {
    const model = genAI.getGenerativeModel({ model: MODEL_ID })
    const formattedTurns = toSummarize
      .map((t) => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.content}`)
      .join('\n')

    const prompt = `Summarize the conversation history below in a single concise paragraph. Focus on core technical context, user goals, and actions completed. Make it a pure factual summary, and strictly DO NOT include any emojis.

Conversation:
${formattedTurns}`

    const res = await model.generateContent(prompt)
    const summary = res.response.text().trim()

    const previousSummary = historicalSummaries.get(channelId) ?? ''
    const cleanPrev = previousSummary
      ? previousSummary.replace(/^\[Historical Context Summary:\s*/i, '').replace(/\]$/i, '')
      : ''

    const nextSummary = cleanPrev
      ? `[Historical Context Summary: ${cleanPrev} Continuing context: ${summary}]`
      : `[Historical Context Summary: ${summary}]`

    historicalSummaries.set(channelId, nextSummary)
    store.set(channelId, remaining)
    schedulePersist()
    console.log(
      `[memory] Compressed 20 turns for channel ${channelId}. Summary length: ${summary.length} characters.`,
    )
  } catch (e) {
    console.warn('[memory] Failed to compress conversation memory:', e)
  }
}

/** Convert to Gemini chat history format (excludes the latest user message if caller sends it separately) */
export function toGeminiHistory(turns: Turn[]): Content[] {
  return turns.map((t) => ({
    role: t.role,
    parts: [{ text: t.content }],
  }))
}
