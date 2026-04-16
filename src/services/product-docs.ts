/**
 * Curated per-product markdown (data/products/*.md), keyword-scored for injection.
 */
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { productDocsDir, productDocsMaxFiles } from '../config.ts'

const SNIPPET = 2500

let docs = new Map<string, string>()

function keywords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_]+/g)
    .filter((w) => w.length > 2)
    .slice(0, 40)
}

function scoreDoc(name: string, content: string, kws: string[]): number {
  const low = name.toLowerCase() + '\n' + content.slice(0, 8000).toLowerCase()
  let s = 0
  for (const w of kws) {
    if (low.includes(w)) s += name.toLowerCase().includes(w) ? 5 : 1
  }
  return s
}

export async function refreshProductDocs(): Promise<void> {
  const dir = resolve(process.cwd(), productDocsDir)
  const next = new Map<string, string>()
  if (!existsSync(dir)) {
    docs = next
    console.warn(`[product-docs] directory missing: ${dir}`)
    void import('./embeddings.ts')
      .then((m) => m.scheduleEmbeddingRebuild())
      .catch(() => {})
    return
  }
  const names = await readdir(dir)
  for (const name of names) {
    if (!name.toLowerCase().endsWith('.md')) continue
    try {
      const text = await readFile(join(dir, name), 'utf8')
      next.set(name, text)
    } catch {
      /* skip */
    }
  }
  docs = next
  console.log(`[product-docs] loaded ${docs.size} markdown file(s) from ${dir}`)
  void import('./embeddings.ts')
    .then((m) => m.scheduleEmbeddingRebuild())
    .catch(() => {})
}

export function buildProductDocsContext(keywordSource: string): string {
  if (docs.size === 0) return ''
  const kws = keywords(keywordSource)
  if (kws.length === 0) return ''

  const scored: { name: string; content: string; score: number }[] = []
  for (const [name, content] of docs) {
    const sc = scoreDoc(name, content, kws)
    if (sc > 0) scored.push({ name, content, score: sc })
  }
  scored.sort((a, b) => b.score - a.score)
  const top = scored.slice(0, productDocsMaxFiles)
  if (top.length === 0) return ''

  const parts: string[] = [
    'Curated product documentation (markdown, for reasoning only; do not paste raw code blocks in Discord unless the user asks for a tiny snippet):',
  ]
  for (const { name, content } of top) {
    const snippet =
      content.length > SNIPPET ? content.slice(0, SNIPPET) + '\n…[truncated]' : content
    parts.push(`\n--- Product doc: ${name} ---\n${snippet}`)
  }
  return parts.join('\n')
}

/** Full docs for embedding index (chunked in embeddings service). */
export function getProductDocsForEmbedding(): { source: string; text: string }[] {
  const out: { source: string; text: string }[] = []
  for (const [name, content] of docs) {
    out.push({ source: `product-doc:${name}`, text: content })
  }
  return out
}

/** Re-scan markdown files periodically (new product docs without restart). */
export function startProductDocsRefreshLoop(): void {
  setInterval(() => void refreshProductDocs(), 15 * 60 * 1000).unref()
}
