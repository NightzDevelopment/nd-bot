import { GoogleGenerativeAI, TaskType } from '@google/generative-ai'
import {
  embeddingMaxChunkChars,
  embeddingMaxCorpusChunks,
  embeddingModel,
  GOOGLE_KEY,
  MODEL_ID,
  vectorRetrievalEnabled,
  vectorTopK,
} from '../config.ts'
import { getCodebaseIndex } from './codebase.ts'
import { getFaqCachedTexts } from './faq.ts'
import { getDb } from './nd-db.ts'
import { getProductDocsForEmbedding } from './product-docs.ts'
import { getStorePageTextForEmbedding } from './store-snapshot.ts'

const genAI = new GoogleGenerativeAI(GOOGLE_KEY)

type Chunk = { source: string; text: string; embedding: number[] }

let corpus: Chunk[] = []
let rebuildTimer: ReturnType<typeof setTimeout> | null = null
let building = false

export function getCorpus(): Chunk[] {
  return corpus
}

export function isEmbeddingBuilding(): boolean {
  return building
}

function chunkString(source: string, text: string): { source: string; text: string }[] {
  const max = embeddingMaxChunkChars
  const t = text.trim()
  if (!t) return []
  const out: { source: string; text: string }[] = []
  for (let i = 0, part = 0; i < t.length; i += max, part++) {
    out.push({ source: `${source}#${part}`, text: t.slice(i, i + max) })
  }
  return out
}

function cosine(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) {
    dot += a[i]! * b[i]!
    na += a[i]! * a[i]!
    nb += b[i]! * b[i]!
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-12)
}

export function scheduleEmbeddingRebuild(): void {
  if (!vectorRetrievalEnabled) return
  if (rebuildTimer) clearTimeout(rebuildTimer)
  rebuildTimer = setTimeout(() => {
    rebuildTimer = null
    void rebuildEmbeddingIndex()
  }, 2500)
}

export async function rebuildEmbeddingIndex(): Promise<void> {
  if (!vectorRetrievalEnabled || building) return
  building = true
  try {
    const rawPieces: { source: string; text: string }[] = []

    getFaqCachedTexts().forEach((t, i) => {
      for (const c of chunkString(`faq:${i + 1}`, t)) rawPieces.push(c)
    })
    for (const { source, text } of getProductDocsForEmbedding()) {
      for (const c of chunkString(source, text)) rawPieces.push(c)
    }
    const idx = getCodebaseIndex()
    for (const [rel, content] of idx) {
      for (const c of chunkString(`code:${rel}`, content)) rawPieces.push(c)
    }

    const pieces = rawPieces.slice(0, embeddingMaxCorpusChunks)
    const model = genAI.getGenerativeModel({ model: embeddingModel })
    const next: Chunk[] = []

    for (let i = 0; i < pieces.length; i++) {
      const p = pieces[i]!
      if (i > 0) await new Promise((r) => setTimeout(r, 40))
      try {
        const res = await model.embedContent({
          content: { role: 'user', parts: [{ text: p.text.slice(0, 8000) }] },
          taskType: TaskType.RETRIEVAL_DOCUMENT,
        })
        next.push({
          source: p.source,
          text: p.text,
          embedding: res.embedding.values,
        })
      } catch (e) {
        console.warn('[embeddings] document embed failed:', p.source, e)
      }
    }
    corpus = next
    console.log(`[embeddings] indexed ${corpus.length} chunk(s)`)
  } finally {
    building = false
  }
}

/**
 * Generates 3 diverse query variations using the primary Gemini model to ensure robust vector search.
 */
async function generateQueryVariations(query: string): Promise<string[]> {
  try {
    const model = genAI.getGenerativeModel({ model: MODEL_ID })
    const prompt = `Generate 3 diverse search queries based on the user query below to help retrieve relevant documentation or code from a vector database. Output each query on a new line without any numbers, emojis, or punctuation.
User Query: ${query}`
    const result = await model.generateContent(prompt)
    const text = result.response.text()
    const variations = text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('-') && !line.startsWith('*'))
    return [query, ...variations.slice(0, 3)]
  } catch (e) {
    console.warn(
      '[embeddings] Failed to generate query variations, falling back to single query:',
      e,
    )
    return [query]
  }
}

/**
 * Loads penalty values for chunks based on reaction feedback loop metrics.
 */
function getChunkPenalties(): Map<string, number> {
  const map = new Map<string, number>()
  try {
    const db = getDb()
    const rows = db.prepare('SELECT chunkId, penaltyWeight FROM chunk_penalties').all() as {
      chunkId: string
      penaltyWeight: number
    }[]
    for (const r of rows) {
      map.set(r.chunkId, r.penaltyWeight)
    }
  } catch (e) {
    console.warn('[embeddings] Failed to read chunk penalties from db:', e)
  }
  return map
}

/**
 * Records dynamic thumb up / down reaction feedback to vectors and updates chunk penalties.
 */
export function recordChunkFeedback(
  messageId: string,
  chunkId: string,
  userId: string,
  reaction: string,
): void {
  try {
    const db = getDb()
    const now = Date.now()
    db.prepare(`
      INSERT INTO ai_feedback_loop (messageId, chunkId, userId, reaction, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `).run(messageId, chunkId, userId, reaction, now)

    let adjustment = 0
    const lowerReaction = reaction.toLowerCase()
    if (
      lowerReaction.includes('down') ||
      lowerReaction.includes('bad') ||
      lowerReaction.includes('no') ||
      lowerReaction.includes('cross')
    ) {
      adjustment = 0.15
    } else if (
      lowerReaction.includes('up') ||
      lowerReaction.includes('good') ||
      lowerReaction.includes('yes') ||
      lowerReaction.includes('check')
    ) {
      adjustment = -0.05
    }

    if (adjustment !== 0) {
      const existing = db
        .prepare('SELECT penaltyWeight FROM chunk_penalties WHERE chunkId = ?')
        .get(chunkId) as { penaltyWeight: number } | undefined
      const current = existing ? existing.penaltyWeight : 0.0
      const nextWeight = Math.max(0.0, Math.min(1.0, current + adjustment))
      db.prepare(`
        INSERT INTO chunk_penalties (chunkId, penaltyWeight, updatedAt)
        VALUES (?, ?, ?)
        ON CONFLICT(chunkId) DO UPDATE SET penaltyWeight = ?, updatedAt = ?
      `).run(chunkId, nextWeight, now, nextWeight, now)
      console.log(
        `[embeddings] Updated penalty for chunk ${chunkId} to ${nextWeight} (adjustment: ${adjustment})`,
      )
    }
  } catch (e) {
    console.warn('[embeddings] Failed to record chunk feedback:', e)
  }
}

export async function buildVectorContextAsync(query: string): Promise<string> {
  if (!vectorRetrievalEnabled || corpus.length === 0) return ''
  const q = query.trim()
  if (!q) return ''
  try {
    const queries = await generateQueryVariations(q)
    const queryEmbeddings: number[][] = []
    const model = genAI.getGenerativeModel({ model: embeddingModel })

    for (const textVal of queries) {
      try {
        const res = await model.embedContent({
          content: { role: 'user', parts: [{ text: textVal.slice(0, 8000) }] },
          taskType: TaskType.RETRIEVAL_QUERY,
        })
        queryEmbeddings.push(res.embedding.values)
      } catch (err) {
        console.warn(`[embeddings] query embed failed for variation "${textVal}":`, err)
      }
    }

    if (queryEmbeddings.length === 0) return ''

    const penalties = getChunkPenalties()

    const scored = corpus.map((c) => {
      let maxScore = -1
      for (const qv of queryEmbeddings) {
        const score = cosine(qv, c.embedding)
        if (score > maxScore) {
          maxScore = score
        }
      }
      const penalty = penalties.get(c.source) ?? 0
      const adjustedScore = maxScore - penalty
      return { c, s: adjustedScore }
    })

    scored.sort((a, b) => b.s - a.s)
    const top = scored.slice(0, vectorTopK).filter((x) => x.s > 0.12)
    if (top.length === 0) return ''

    const parts = [
      'Semantic retrieval context (embeddings over FAQ, store page snapshot, product docs, and indexed dev files):',
    ]

    top.forEach((item, index) => {
      const footnoteIndex = index + 1
      parts.push(`\n[${footnoteIndex}] Source: ${item.c.source}\n${item.c.text.slice(0, 1800)}`)
    })

    return parts.join('\n')
  } catch (e) {
    console.warn('[embeddings] query build failed:', e)
    return ''
  }
}
