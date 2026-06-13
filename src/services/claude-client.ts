/**
 * Claude (Anthropic) Integration
 * Implements the same interface as Gemini and OpenAI for compatibility
 */

import {
  claudeApiKey,
  claudeEnabled,
  claudeFallbackModels,
  claudeModel,
  claudeRequestTimeoutMs,
} from '../config.ts'
import type { Turn } from './memory.ts'
import { recordAiCall, recordAiError } from './ai-telemetry.ts'

const MAX_RETRIES = 3
const RETRY_DELAY_MS = 2000

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function isRetryableError(e: unknown): boolean {
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase()
  return (
    msg.includes('503') ||
    msg.includes('service unavailable') ||
    msg.includes('overloaded') ||
    msg.includes('429') ||
    msg.includes('too many requests') ||
    msg.includes('rate limit') ||
    msg.includes('timeout') ||
    msg.includes('timed out')
  )
}

async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastError: unknown = null
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fn()
    } catch (e) {
      lastError = e
      if (!isRetryableError(e)) throw e
      if (attempt >= MAX_RETRIES - 1) break
      console.warn(
        `[claude] ${label} attempt ${attempt + 1}/${MAX_RETRIES} failed, retrying in ${RETRY_DELAY_MS}ms...`,
      )
      await sleep(RETRY_DELAY_MS * (attempt + 1))
    }
  }
  throw lastError ?? new Error(`[claude] ${label} request failed`)
}

function claudeModelChain(): string[] {
  return [...new Set([claudeModel, ...claudeFallbackModels].map((s) => s.trim()).filter(Boolean))]
}

function claudeHeaders(): Record<string, string> {
  if (!claudeApiKey) return { 'Content-Type': 'application/json' }
  return {
    'Content-Type': 'application/json',
    'x-api-key': claudeApiKey,
    'anthropic-version': '2023-06-01',
  }
}

async function fetchJsonWithTimeout<T>(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { ...init, signal: controller.signal })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status} ${res.statusText}: ${body.slice(0, 500)}`)
    }
    return (await res.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

type ClaudeMessage = {
  role: 'user' | 'assistant'
  content: string | Array<{ type: string; [key: string]: unknown }>
}

async function claudeApiRequest(
  modelId: string,
  messages: ClaudeMessage[],
  systemPrompt?: string,
): Promise<string> {
  if (!claudeApiKey) throw new Error('CLAUDE_API_KEY is not set.')

  const body: Record<string, unknown> = {
    model: modelId,
    max_tokens: 4096,
    messages,
  }

  if (systemPrompt?.trim()) {
    body.system = systemPrompt
  }

  const data = await fetchJsonWithTimeout<{
    content?: Array<{ type: string; text?: string }>
    error?: { message?: string }
  }>(
    'https://api.anthropic.com/v1/messages',
    {
      method: 'POST',
      headers: claudeHeaders(),
      body: JSON.stringify(body),
    },
    claudeRequestTimeoutMs,
  )

  if (data.error) {
    throw new Error(`Claude API error: ${data.error.message}`)
  }

  const text = data.content?.find((c) => c.type === 'text')?.text
  if (!text) throw new Error('Claude returned empty response.')
  return text
}

async function withClaudeFallback<T>(run: (modelId: string) => Promise<T>): Promise<T> {
  let lastError: unknown = null
  for (const modelId of claudeModelChain()) {
    try {
      if (modelId !== claudeModel) {
        console.warn(`[claude] trying fallback model: ${modelId}`)
      }
      const out = await withRetry(`claude:${modelId}`, () => run(modelId))
      recordAiCall('claude')
      return out
    } catch (e) {
      lastError = e
      const msg = e instanceof Error ? e.message : String(e)
      console.warn(`[claude] model ${modelId} failed: ${msg.slice(0, 180)}`)
    }
  }
  recordAiError('claude')
  throw lastError ?? new Error('No Claude model could produce a response.')
}

function toClaudeMessages(
  systemInstruction: string,
  prior: Turn[],
  latestUserContent: string,
): { messages: ClaudeMessage[]; systemPrompt: string } {
  const messages: ClaudeMessage[] = []

  for (const t of prior) {
    messages.push({
      role: t.role === 'model' ? 'assistant' : 'user',
      content: t.content,
    })
  }

  messages.push({
    role: 'user',
    content: latestUserContent,
  })

  return { messages, systemPrompt: systemInstruction }
}

function buildBase64Image(image: { mimeType: string; dataBase64: string }): string {
  // Claude expects media type to be one of: image/jpeg, image/png, image/gif, image/webp
  const mediaType = image.mimeType === 'image/jpg' ? 'image/jpeg' : image.mimeType
  return `data:${mediaType};base64,${image.dataBase64}`
}

export async function claudeChatReply(
  systemInstruction: string,
  prior: Turn[],
  latestUserContent: string,
): Promise<string> {
  const { messages, systemPrompt } = toClaudeMessages(systemInstruction, prior, latestUserContent)
  return withClaudeFallback((modelId) => claudeApiRequest(modelId, messages, systemPrompt))
}

export async function claudeChatReplyWithImage(
  systemInstruction: string,
  prior: Turn[],
  textBlock: string,
  image: { mimeType: string; dataBase64: string },
): Promise<string> {
  const messages: ClaudeMessage[] = []

  for (const t of prior) {
    messages.push({
      role: t.role === 'model' ? 'assistant' : 'user',
      content: t.content,
    })
  }

  messages.push({
    role: 'user',
    content: [
      { type: 'text', text: textBlock },
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: image.mimeType === 'image/jpg' ? 'image/jpeg' : image.mimeType,
          data: image.dataBase64,
        },
      },
    ],
  })

  return withClaudeFallback((modelId) => claudeApiRequest(modelId, messages, systemInstruction))
}

export async function claudeGenerate(systemInstruction: string, prompt: string): Promise<string> {
  const messages: ClaudeMessage[] = [
    {
      role: 'user',
      content: prompt,
    },
  ]
  return withClaudeFallback((modelId) => claudeApiRequest(modelId, messages, systemInstruction))
}

export async function checkClaudeAvailability(): Promise<{
  ok: boolean
  reason: 'ok' | 'disabled' | 'unreachable'
  detail: string
}> {
  if (!claudeEnabled || !claudeApiKey) {
    return {
      ok: false,
      reason: 'disabled',
      detail: 'Claude is disabled (`CLAUDE_API_KEY` is not set).',
    }
  }

  try {
    // Test with a simple request to check availability
    const testMessages: ClaudeMessage[] = [
      {
        role: 'user',
        content: 'ping',
      },
    ]

    await fetchJsonWithTimeout<unknown>(
      'https://api.anthropic.com/v1/messages',
      {
        method: 'POST',
        headers: claudeHeaders(),
        body: JSON.stringify({
          model: claudeModel,
          max_tokens: 10,
          messages: testMessages,
        }),
      },
      Math.min(10_000, claudeRequestTimeoutMs),
    )

    return {
      ok: true,
      reason: 'ok',
      detail: `Claude API reachable. Model \`${claudeModel}\` is available.`,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return {
      ok: false,
      reason: 'unreachable',
      detail: `Claude API is not reachable (${msg.slice(0, 180)}).`,
    }
  }
}
