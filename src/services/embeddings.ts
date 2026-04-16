/**
 * Optional Gemini embedding retrieval over FAQ pins, product docs, and codebase index.
 */
import { GoogleGenerativeAI, TaskType } from '@google/generative-ai'
import {
  GOOGLE_KEY,
  embeddingMaxChunkChars,
  embeddingMaxCorpusChunks,
  embeddingModel,
  vectorRetrievalEnabled,
  vectorTopK,
} from '../config.ts'
import { getCodebaseIndex } from './codebase.ts'
import { getFaqCachedTexts } from './faq.ts'
import { getProductDocsForEmbedding } from './product-docs.ts'

const genAI = new GoogleGenerativeAI(GOOGLE_KEY)

type Chunk = { source: string; text: string; embedding: number[] }

let corpus: Chunk[] = []
let rebuildTimer: ReturnType<typeof setTimeout> | null = null
let building = false

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

export async function buildVectorContextAsync(query: string): Promise<string> {
  if (!vectorRetrievalEnabled || corpus.length === 0) return ''
  const q = query.trim()
  if (!q) return ''
  try {
    const model = genAI.getGenerativeModel({ model: embeddingModel })
    const res = await model.embedContent({
      content: { role: 'user', parts: [{ text: q.slice(0, 8000) }] },
      taskType: TaskType.RETRIEVAL_QUERY,
    })
    const qv = res.embedding.values
    const scored = corpus.map((c) => ({ c, s: cosine(qv, c.embedding) }))
    scored.sort((a, b) => b.s - a.s)
    const top = scored.slice(0, vectorTopK).filter((x) => x.s > 0.12)
    if (top.length === 0) return ''
    const parts = [
      'Semantic retrieval (embeddings over FAQ, product docs, and indexed dev files; for reasoning only, do not paste long raw code):',
    ]
    for (const { c } of top) {
      parts.push(`\n--- ${c.source} ---\n${c.text.slice(0, 1800)}`)
    }
    return parts.join('\n')
  } catch (e) {
    console.warn('[embeddings] query embed failed:', e)
    return ''
  }
}
