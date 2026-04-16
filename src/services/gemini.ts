import { GoogleGenerativeAI } from '@google/generative-ai'
import type { GenerativeModel, Part } from '@google/generative-ai'
import { GOOGLE_KEY, MODEL_ID } from '../config.ts'
import type { Turn } from './memory.ts'
import { toGeminiHistory } from './memory.ts'

const genAI = new GoogleGenerativeAI(GOOGLE_KEY)

const FALLBACK_MODELS = [
  'gemini-3.1-pro-preview',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash-lite',
  'gemini-1.5-flash',
]

export function getModel(systemInstruction: string): GenerativeModel {
  return genAI.getGenerativeModel({
    model: MODEL_ID,
    systemInstruction,
  })
}

function getFallbackModel(systemInstruction: string, modelId: string): GenerativeModel {
  return genAI.getGenerativeModel({ model: modelId, systemInstruction })
}

const NO_CODE_SUFFIX = `

CRITICAL: Never include raw source code, long code blocks, or full file contents in your reply. Explain in plain language only. Reference file names when helpful.`

const MAX_RETRIES = 3
const RETRY_DELAY_MS = 2000

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function withRetry<T>(fn: () => Promise<T>, systemInstruction?: string): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fn()
    } catch (e: any) {
      lastError = e
      const msg = e?.message ?? String(e)
      const is503 = msg.includes('503') || msg.includes('Service Unavailable') || msg.includes('overloaded')
      const is429 = msg.includes('429') || msg.includes('Too Many Requests') || msg.includes('RESOURCE_EXHAUSTED')
      if (!is503 && !is429) throw e
      console.warn(`[gemini] attempt ${attempt + 1}/${MAX_RETRIES} failed (${is503 ? '503' : '429'}), retrying in ${RETRY_DELAY_MS}ms...`)
      await sleep(RETRY_DELAY_MS * (attempt + 1))
    }
  }

  if (systemInstruction) {
    for (const fallbackId of FALLBACK_MODELS) {
      if (fallbackId === MODEL_ID) continue
      try {
        console.log(`[gemini] trying fallback model: ${fallbackId}`)
        const fbModel = getFallbackModel(systemInstruction, fallbackId)
        const result = await fbModel.generateContent('Please respond briefly: I am operational.')
        if (result.response.text()) {
          console.log(`[gemini] fallback ${fallbackId} available`)
        }
        return await fn()
      } catch {
        continue
      }
    }
  }

  throw lastError
}

export async function chatReply(
  model: GenerativeModel,
  prior: Turn[],
  latestUserContent: string,
): Promise<string> {
  return withRetry(async () => {
    const history = toGeminiHistory(prior)
    const chat = model.startChat({
      history: history.length > 0 ? history : undefined,
    })
    const result = await chat.sendMessage(latestUserContent + NO_CODE_SUFFIX)
    return result.response.text()
  })
}

/** One inline image + text (vision). Image is the first screenshot only. */
export async function chatReplyWithImage(
  model: GenerativeModel,
  prior: Turn[],
  textBlock: string,
  image: { mimeType: string; dataBase64: string },
): Promise<string> {
  return withRetry(async () => {
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

export async function generateOnce(
  model: GenerativeModel,
  prompt: string,
): Promise<string> {
  return withRetry(async () => {
    const result = await model.generateContent(prompt + NO_CODE_SUFFIX)
    return result.response.text()
  })
}

/** Raw generation (no support suffix), for AI AutoMod JSON output */
export async function generateRaw(prompt: string): Promise<string> {
  const model = genAI.getGenerativeModel({ model: MODEL_ID })
  return withRetry(async () => {
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
  const model = genAI.getGenerativeModel({ model: MODEL_ID })
  return withRetry(async () => {
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
