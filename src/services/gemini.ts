import { GoogleGenerativeAI } from '@google/generative-ai'
import type { GenerativeModel, Part } from '@google/generative-ai'
import {
  GOOGLE_KEY,
  MODEL_ID,
  geminiFallbackModels,
  openaiApiKey,
  openaiBaseUrl,
  openaiEnabled,
  openaiFallbackModels,
  openaiModel,
  openaiRequestTimeoutMs,
} from '../config.ts'
import { getAiProviderMode } from './ai-provider.ts'
import type { Turn } from './memory.ts'
import { toGeminiHistory } from './memory.ts'

const genAI = new GoogleGenerativeAI(GOOGLE_KEY)

export type GeminiModelRef = { systemInstruction: string; modelIds: readonly string[] }

function modelChain(): string[] {
  return [...new Set([MODEL_ID, ...geminiFallbackModels].map((s) => s.trim()).filter(Boolean))]
}

function buildModel(systemInstruction: string, modelId: string): GenerativeModel {
  return genAI.getGenerativeModel({
    model: modelId,
    ...(systemInstruction.trim() ? { systemInstruction } : {}),
  })
}

export function getModel(systemInstruction: string): GeminiModelRef {
  return { systemInstruction, modelIds: modelChain() }
}

const NO_CODE_SUFFIX = `

CRITICAL: Never include raw source code, long code blocks, or full file contents in your reply. Explain in plain language only. Reference file names when helpful.`

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
    msg.includes('resource_exhausted') ||
    msg.includes('deadline_exceeded') ||
    msg.includes('timed out') ||
    msg.includes('timeout')
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
        `[ai] ${label} attempt ${attempt + 1}/${MAX_RETRIES} failed, retrying in ${RETRY_DELAY_MS}ms...`,
      )
      await sleep(RETRY_DELAY_MS * (attempt + 1))
    }
  }
  throw lastError ?? new Error(`[ai] ${label} request failed`)
}

async function withModelFallback<T>(
  modelRef: GeminiModelRef,
  run: (model: GenerativeModel, modelId: string) => Promise<T>,
): Promise<T> {
  let lastError: unknown = null
  for (const modelId of modelRef.modelIds) {
    const model = buildModel(modelRef.systemInstruction, modelId)
    try {
      if (modelId !== MODEL_ID) {
        console.warn(`[gemini] trying fallback model: ${modelId}`)
      }
      return await withRetry(`gemini:${modelId}`, () => run(model, modelId))
    } catch (e) {
      lastError = e
      const msg = e instanceof Error ? e.message : String(e)
      console.warn(`[gemini] model ${modelId} failed: ${msg.slice(0, 180)}`)
    }
  }
  throw lastError ?? new Error('No Gemini model could produce a response.')
}

type OpenAiTextPart = { type: 'text'; text: string }
type OpenAiImagePart = { type: 'image_url'; image_url: { url: string } }
type OpenAiPart = OpenAiTextPart | OpenAiImagePart
type OpenAiMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string | OpenAiPart[]
}

type OpenAiHealthReason = 'ok' | 'disabled' | 'model_missing' | 'unreachable'

function openaiUrl(path: string): string {
  return `${openaiBaseUrl.replace(/\/+$/, '')}${path}`
}

function openaiHeaders(): Record<string, string> {
  if (!openaiApiKey) return { 'Content-Type': 'application/json' }
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${openaiApiKey}`,
  }
}

function openAiModelChain(): string[] {
  return [...new Set([openaiModel, ...openaiFallbackModels].map((s) => s.trim()).filter(Boolean))]
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

function extractOpenAiText(content: unknown): string {
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  const text = content
    .map((item) => {
      if (!item || typeof item !== 'object') return ''
      const x = item as Record<string, unknown>
      if (x.type === 'output_text' || x.type === 'text') {
        return typeof x.text === 'string' ? x.text : ''
      }
      return ''
    })
    .filter(Boolean)
    .join('\n')
    .trim()
  return text
}

async function withOpenAiFallback<T>(
  run: (modelId: string) => Promise<T>,
): Promise<T> {
  let lastError: unknown = null
  for (const modelId of openAiModelChain()) {
    try {
      if (modelId !== openaiModel) {
        console.warn(`[openai] trying fallback model: ${modelId}`)
      }
      return await withRetry(`openai:${modelId}`, () => run(modelId))
    } catch (e) {
      lastError = e
      const msg = e instanceof Error ? e.message : String(e)
      console.warn(`[openai] model ${modelId} failed: ${msg.slice(0, 180)}`)
    }
  }
  throw lastError ?? new Error('No OpenAI model could produce a response.')
}

async function openAiChatCompletion(
  modelId: string,
  messages: OpenAiMessage[],
): Promise<string> {
  if (!openaiApiKey) throw new Error('OPENAI_API_KEY is not set.')
  const data = await fetchJsonWithTimeout<{
    choices?: Array<{ message?: { content?: unknown } }>
  }>(
    openaiUrl('/chat/completions'),
    {
      method: 'POST',
      headers: openaiHeaders(),
      body: JSON.stringify({
        model: modelId,
        messages,
      }),
    },
    openaiRequestTimeoutMs,
  )
  const out = extractOpenAiText(data.choices?.[0]?.message?.content)
  if (!out) throw new Error('OpenAI returned empty response.')
  return out
}

export async function checkOpenAiAvailability(): Promise<{
  ok: boolean
  reason: OpenAiHealthReason
  detail: string
}> {
  if (!openaiEnabled || !openaiApiKey) {
    return {
      ok: false,
      reason: 'disabled',
      detail: 'OpenAI is disabled (`OPENAI_API_KEY` is not set).',
    }
  }
  try {
    const data = await fetchJsonWithTimeout<{ data?: Array<{ id?: string }> }>(
      openaiUrl('/models'),
      { method: 'GET', headers: openaiHeaders() },
      Math.min(10_000, openaiRequestTimeoutMs),
    )
    const ids = (data.data ?? []).map((m) => m.id ?? '').filter(Boolean)
    const available = openAiModelChain().find((id) => ids.includes(id))
    if (!available) {
      return {
        ok: false,
        reason: 'model_missing',
        detail: `OpenAI is reachable, but none of the configured models are available: ${openAiModelChain().map((m) => `\`${m}\``).join(', ')}.`,
      }
    }
    if (available !== openaiModel) {
      return {
        ok: true,
        reason: 'ok',
        detail: `OpenAI reachable. Primary model \`${openaiModel}\` is unavailable; fallback \`${available}\` will be used.`,
      }
    }
    return {
      ok: true,
      reason: 'ok',
      detail: `OpenAI reachable and model \`${openaiModel}\` is available.`,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return {
      ok: false,
      reason: 'unreachable',
      detail: `OpenAI is not reachable at \`${openaiBaseUrl}\` (${msg.slice(0, 180)}).`,
    }
  }
}

export async function getPublicAiErrorMessage(): Promise<string> {
  const provider = await getAiProviderMode()
  if (provider !== 'openai') {
    return "I can't help with this request right now."
  }
  const health = await checkOpenAiAvailability()
  if (health.ok) {
    return 'OpenAI is having trouble right now. Please try again in a moment.'
  }
  if (health.reason === 'disabled') {
    return 'OpenAI is disabled right now. Ask a moderator to switch AI mode to auto or gemini.'
  }
  if (health.reason === 'model_missing') {
    return 'OpenAI is not ready yet on this server. Ask staff to check OPENAI_MODEL or switch to auto/gemini.'
  }
  return 'OpenAI is currently offline. Ask staff to switch AI mode to auto/gemini, then try again.'
}

function toOpenAiMessages(
  modelRef: GeminiModelRef,
  prior: Turn[],
  latestUserContent: string,
): OpenAiMessage[] {
  const messages: OpenAiMessage[] = []
  if (modelRef.systemInstruction.trim()) {
    messages.push({
      role: 'system',
      content: `${modelRef.systemInstruction}\n\n${NO_CODE_SUFFIX.trim()}`,
    })
  }
  for (const t of prior) {
    messages.push({
      role: t.role === 'model' ? 'assistant' : 'user',
      content: t.content,
    })
  }
  messages.push({
    role: 'user',
    content: latestUserContent + NO_CODE_SUFFIX,
  })
  return messages
}

async function openAiChatReply(
  modelRef: GeminiModelRef,
  prior: Turn[],
  latestUserContent: string,
): Promise<string> {
  const messages = toOpenAiMessages(modelRef, prior, latestUserContent)
  return withOpenAiFallback((modelId) => openAiChatCompletion(modelId, messages))
}

async function openAiChatReplyWithImage(
  modelRef: GeminiModelRef,
  prior: Turn[],
  textBlock: string,
  image: { mimeType: string; dataBase64: string },
): Promise<string> {
  const messages: OpenAiMessage[] = []
  if (modelRef.systemInstruction.trim()) {
    messages.push({
      role: 'system',
      content: `${modelRef.systemInstruction}\n\n${NO_CODE_SUFFIX.trim()}`,
    })
  }
  for (const t of prior) {
    messages.push({
      role: t.role === 'model' ? 'assistant' : 'user',
      content: t.content,
    })
  }
  messages.push({
    role: 'user',
    content: [
      { type: 'text', text: textBlock + NO_CODE_SUFFIX },
      {
        type: 'image_url',
        image_url: { url: `data:${image.mimeType};base64,${image.dataBase64}` },
      },
    ],
  })
  return withOpenAiFallback((modelId) => openAiChatCompletion(modelId, messages))
}

async function openAiGenerate(
  modelRef: GeminiModelRef,
  prompt: string,
): Promise<string> {
  return openAiChatReply(modelRef, [], prompt)
}

export async function chatReply(
  modelRef: GeminiModelRef,
  prior: Turn[],
  latestUserContent: string,
): Promise<string> {
  const provider = await getAiProviderMode()
  if (provider === 'openai') {
    return openAiChatReply(modelRef, prior, latestUserContent)
  }
  if (provider === 'gemini') {
    return withModelFallback(modelRef, async (model) => {
      const history = toGeminiHistory(prior)
      const chat = model.startChat({
        history: history.length > 0 ? history : undefined,
      })
      const result = await chat.sendMessage(latestUserContent + NO_CODE_SUFFIX)
      return result.response.text()
    })
  }
  try {
    return await withModelFallback(modelRef, async (model) => {
      const history = toGeminiHistory(prior)
      const chat = model.startChat({
        history: history.length > 0 ? history : undefined,
      })
      const result = await chat.sendMessage(latestUserContent + NO_CODE_SUFFIX)
      return result.response.text()
    })
  } catch (e) {
    if (!openaiEnabled) throw e
    console.warn('[gemini] all Gemini models failed; using OpenAI fallback')
    return openAiChatReply(modelRef, prior, latestUserContent)
  }
}

/** One inline image + text (vision). Image is the first screenshot only. */
export async function chatReplyWithImage(
  modelRef: GeminiModelRef,
  prior: Turn[],
  textBlock: string,
  image: { mimeType: string; dataBase64: string },
): Promise<string> {
  const provider = await getAiProviderMode()
  if (provider === 'openai') {
    return openAiChatReplyWithImage(modelRef, prior, textBlock, image)
  }
  if (provider === 'gemini') {
    return withModelFallback(modelRef, async (model) => {
      const history = toGeminiHistory(prior)
      const chat = model.startChat({
        history: history.length > 0 ? history : undefined,
      })
      const parts: Part[] = [
        { text: textBlock + NO_CODE_SUFFIX },
        { inlineData: { mimeType: image.mimeType, data: image.dataBase64 } },
      ]
      const result = await chat.sendMessage(parts)
      return result.response.text()
    })
  }
  try {
    return await withModelFallback(modelRef, async (model) => {
      const history = toGeminiHistory(prior)
      const chat = model.startChat({
        history: history.length > 0 ? history : undefined,
      })
      const parts: Part[] = [
        { text: textBlock + NO_CODE_SUFFIX },
        { inlineData: { mimeType: image.mimeType, data: image.dataBase64 } },
      ]
      const result = await chat.sendMessage(parts)
      return result.response.text()
    })
  } catch (e) {
    if (!openaiEnabled) throw e
    console.warn('[gemini] image request failed across Gemini models; using OpenAI fallback')
    return openAiChatReplyWithImage(modelRef, prior, textBlock, image)
  }
}

export async function generateOnce(
  modelRef: GeminiModelRef,
  prompt: string,
): Promise<string> {
  const provider = await getAiProviderMode()
  if (provider === 'openai') {
    return openAiGenerate(modelRef, prompt)
  }
  if (provider === 'gemini') {
    return withModelFallback(modelRef, async (model) => {
      const result = await model.generateContent(prompt + NO_CODE_SUFFIX)
      return result.response.text()
    })
  }
  try {
    return await withModelFallback(modelRef, async (model) => {
      const result = await model.generateContent(prompt + NO_CODE_SUFFIX)
      return result.response.text()
    })
  } catch (e) {
    if (!openaiEnabled) throw e
    console.warn('[gemini] generateOnce failed across Gemini models; using OpenAI fallback')
    return openAiGenerate(modelRef, prompt)
  }
}

/** Raw generation (no support suffix), for AI AutoMod JSON output */
export async function generateRaw(prompt: string): Promise<string> {
  const modelRef = getModel('')
  return withModelFallback(modelRef, async (model) => {
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: 1024,
        temperature: 0.2,
      },
    })
    return result.response.text()
  })
}

/** Vision + text for AI AutoMod (single image, JSON output expected in prompt) */
export async function generateRawWithImage(
  prompt: string,
  image: { mimeType: string; dataBase64: string },
): Promise<string> {
  const modelRef = getModel('')
  return withModelFallback(modelRef, async (model) => {
    const parts: Part[] = [
      { text: prompt },
      { inlineData: { mimeType: image.mimeType, data: image.dataBase64 } },
    ]
    const result = await model.generateContent({
      contents: [{ role: 'user', parts }],
      generationConfig: {
        maxOutputTokens: 1024,
        temperature: 0.2,
      },
    })
    return result.response.text()
  })
}
