import { readJson, writeJson } from './data-store.ts'

export type AiProviderMode = 'auto' | 'gemini' | 'openai' | 'claude'

export type AiProviderState = {
  mode: AiProviderMode
  updatedAt: number
  updatedBy?: string
}

const FILE = 'ai-provider.json'
const FALLBACK: AiProviderState = {
  mode: 'auto',
  updatedAt: 0,
}

let cache: AiProviderState | null = null

function normalizeMode(v: string | undefined): AiProviderMode | null {
  const x = v?.trim().toLowerCase()
  // Legacy migration: qwen mode was removed; map to auto.
  if (x === 'qwen') return 'auto'
  if (x === 'auto' || x === 'gemini' || x === 'openai' || x === 'claude') return x
  return null
}

async function load(): Promise<AiProviderState> {
  if (cache) return cache
  const raw = await readJson<AiProviderState>(FILE, FALLBACK)
  const mode = normalizeMode(raw.mode) ?? 'auto'
  cache = {
    mode,
    updatedAt: raw.updatedAt || 0,
    ...(raw.updatedBy ? { updatedBy: raw.updatedBy } : {}),
  }
  return cache
}

export async function getAiProviderState(): Promise<AiProviderState> {
  return load()
}

export async function getAiProviderMode(): Promise<AiProviderMode> {
  return (await load()).mode
}

export async function setAiProviderMode(
  mode: AiProviderMode,
  updatedBy?: string,
): Promise<AiProviderState> {
  const next: AiProviderState = {
    mode,
    updatedAt: Date.now(),
    ...(updatedBy ? { updatedBy } : {}),
  }
  cache = next
  await writeJson(FILE, next)
  return next
}
