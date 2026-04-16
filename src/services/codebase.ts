/**
 * Index local dev build files for context injection (no raw code in Discord replies).
 */
import { readdir, readFile, stat } from 'fs/promises'
import { basename, join, relative } from 'path'
import {
  CODEBASE_MAX_FILE_BYTES,
  CODEBASE_REFRESH_MINUTES,
  devBuildPaths,
  codebaseExcludePathSubstrings,
  codebaseMaxFiles,
  codebaseSingleResourceMode,
} from '../config.ts'

const EXT = new Set(['.lua', '.js', '.ts', '.sql', '.cfg', '.json', '.md', '.txt'])

let index = new Map<string, string>()
let lastScan = 0

export function getCodebaseIndex(): Map<string, string> {
  return index
}

async function walk(
  dir: string,
  root: string,
  out: Map<string, string>,
  keyPrefix: string,
): Promise<void> {
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return
  }
  for (const name of entries) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const full = join(dir, name)
    let st
    try {
      st = await stat(full)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      await walk(full, root, out, keyPrefix)
    } else if (st.isFile() && st.size <= CODEBASE_MAX_FILE_BYTES) {
      const ext = name.slice(name.lastIndexOf('.')).toLowerCase()
      if (!EXT.has(ext)) continue
      try {
        const buf = await readFile(full)
        const text = buf.toString('utf8')
        const rel = relative(root, full).replace(/\\/g, '/')
        const key = rel ? `${keyPrefix}/${rel}` : keyPrefix
        out.set(key, text)
      } catch {
        /* skip */
      }
    }
  }
}

export async function refreshCodebaseIndex(): Promise<void> {
  const next = new Map<string, string>()
  const labelUse = new Map<string, number>()
  for (let i = 0; i < devBuildPaths.length; i++) {
    const rootPath = devBuildPaths[i]!
    const base =
      basename(rootPath.replace(/[/\\]+$/, '')) || `root${i}`
    const n = (labelUse.get(base) ?? 0) + 1
    labelUse.set(base, n)
    const keyPrefix = n > 1 ? `${base}~${n}` : base
    await walk(rootPath, rootPath, next, keyPrefix)
  }
  index = next
  lastScan = Date.now()
  console.log(
    `[codebase] indexed ${index.size} files across ${devBuildPaths.length} root(s): ${devBuildPaths.join(' | ')}`,
  )
  void import('./embeddings.ts')
    .then((m) => m.scheduleEmbeddingRebuild())
    .catch(() => {})
}

export function startCodebaseRefreshLoop(): void {
  setInterval(() => {
    void refreshCodebaseIndex()
  }, CODEBASE_REFRESH_MINUTES * 60 * 1000).unref()
}

function isExcludedPath(rel: string): boolean {
  const low = rel.toLowerCase()
  for (const sub of codebaseExcludePathSubstrings) {
    if (low.includes(sub.toLowerCase())) return true
  }
  return false
}

/**
 * Cluster key: dev-root label + first resource folder (e.g. `[Dev Build]/ND_DiscordUnified`).
 * Indexed paths look like `RootLabel/ResourceFolder/...`.
 */
function resourceRoot(rel: string): string {
  const parts = rel.split('/').filter(Boolean)
  if (parts.length >= 2) return `${parts[0]}/${parts[1]}`
  return parts[0] || '_'
}

/** Extract keywords from user message (+ optional recent thread text) */
function keywords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_]+/g)
    .filter((w) => w.length > 2)
    .slice(0, 40)
}

/** Score file by keyword overlap + filename match */
function scoreFile(rel: string, content: string, kws: string[]): number {
  const low = rel.toLowerCase() + '\n' + content.slice(0, 8000).toLowerCase()
  let s = 0
  for (const w of kws) {
    if (low.includes(w)) s += rel.toLowerCase().includes(w) ? 3 : 1
  }
  const root = resourceRoot(rel).toLowerCase().replace(/[^a-z0-9]/g, '')
  const blob = textBlobForPathBoost(rel, content)
  for (const w of kws) {
    if (w.length < 4) continue
    if (root.includes(w) || blob.includes(w)) s += 4
  }
  return s
}

function textBlobForPathBoost(rel: string, content: string): string {
  return (
    rel
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '') +
    content.slice(0, 2000).toLowerCase().replace(/[^a-z0-9]+/g, '')
  )
}

const SNIPPET = 2000

export function buildRelevantContext(keywordSource: string): string {
  if (index.size === 0) return ''
  const kws = keywords(keywordSource)
  if (kws.length === 0) return ''

  const scored: { rel: string; content: string; score: number }[] = []
  for (const [rel, content] of index) {
    if (isExcludedPath(rel)) continue
    const sc = scoreFile(rel, content, kws)
    if (sc > 0) scored.push({ rel, content, score: sc })
  }
  scored.sort((a, b) => b.score - a.score)

  let top: typeof scored = []
  const maxFiles = codebaseMaxFiles

  if (codebaseSingleResourceMode && scored.length > 0) {
    const byRoot = new Map<string, typeof scored>()
    for (const item of scored) {
      const root = resourceRoot(item.rel)
      const arr = byRoot.get(root) ?? []
      arr.push(item)
      byRoot.set(root, arr)
    }
    let bestRoot = ''
    let bestRank = -1
    for (const [root, items] of byRoot) {
      const sorted = [...items].sort((a, b) => b.score - a.score)
      const maxS = sorted[0]?.score ?? 0
      const sumTop = sorted.slice(0, 3).reduce((acc, x) => acc + x.score, 0)
      const rank = maxS * 10_000 + sumTop
      if (rank > bestRank) {
        bestRank = rank
        bestRoot = root
      }
    }
    const pool = byRoot.get(bestRoot) ?? []
    top = pool.sort((a, b) => b.score - a.score).slice(0, maxFiles)
  } else {
    top = scored.slice(0, maxFiles)
  }

  if (top.length === 0) return ''

  const parts: string[] = [
    'Here is relevant context from the Nightz Development indexed dev trees (for your reasoning only, do NOT paste raw code in Discord replies). Paths are prefixed by the indexed root folder name; files are from one product subfolder when possible:',
  ]
  for (const { rel, content } of top) {
    const snippet = content.length > SNIPPET ? content.slice(0, SNIPPET) + '\n…[truncated]' : content
    parts.push(`\n--- File: ${rel} ---\n${snippet}`)
  }
  return parts.join('\n')
}
