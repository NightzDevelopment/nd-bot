/**
 * Intent Detection
 * Intelligently categorize user messages to optimize response strategy
 */
import { GoogleGenerativeAI } from '@google/generative-ai'
import { GOOGLE_KEY, MODEL_ID } from '../config.ts'

const genAI = new GoogleGenerativeAI(GOOGLE_KEY)

export enum MessageIntent {
  QUESTION = 'question',
  COMMAND = 'command',
  CREATIVE = 'creative',
  TECHNICAL = 'technical',
  CONVERSATION = 'conversation',
  REQUEST = 'request',
  FEEDBACK = 'feedback',
  HELP = 'help',
}

export interface IntentAnalysis {
  intent: MessageIntent
  confidence: number // 0-1
  keywords: string[]
  reasoning: string
}

/** Pattern-based intent detection */
export function detectIntent(message: string): IntentAnalysis {
  const lower = message.toLowerCase().trim()
  const words = lower.split(/\s+/)

  // Question intent
  if (
    lower.startsWith('what') ||
    lower.startsWith('why') ||
    lower.startsWith('how') ||
    lower.startsWith('when') ||
    lower.startsWith('where') ||
    lower.startsWith('who') ||
    lower.includes('?')
  ) {
    return {
      intent: MessageIntent.QUESTION,
      confidence: 0.95,
      keywords: ['what', 'why', 'how', '?'],
      reasoning: 'Message is phrased as a question',
    }
  }

  // Command intent
  if (
    lower.startsWith('/') ||
    lower.startsWith('!') ||
    lower.includes('run') ||
    lower.includes('execute') ||
    lower.includes('do this')
  ) {
    return {
      intent: MessageIntent.COMMAND,
      confidence: 0.9,
      keywords: ['/', '!', 'run', 'execute'],
      reasoning: 'Message appears to be a command request',
    }
  }

  // Creative intent
  if (
    lower.includes('write') ||
    lower.includes('create') ||
    lower.includes('imagine') ||
    lower.includes('invent') ||
    lower.includes('design') ||
    lower.includes('story') ||
    lower.includes('poem')
  ) {
    return {
      intent: MessageIntent.CREATIVE,
      confidence: 0.88,
      keywords: ['write', 'create', 'imagine', 'story'],
      reasoning: 'Message requests creative content',
    }
  }

  // Technical intent
  if (
    lower.includes('code') ||
    lower.includes('api') ||
    lower.includes('debug') ||
    lower.includes('error') ||
    lower.includes('fix') ||
    lower.includes('implement') ||
    lower.includes('algorithm')
  ) {
    return {
      intent: MessageIntent.TECHNICAL,
      confidence: 0.9,
      keywords: ['code', 'api', 'debug', 'error'],
      reasoning: 'Message is technical in nature',
    }
  }

  // Help intent
  if (
    lower.includes('help') ||
    lower.includes('stuck') ||
    lower.includes("don't know") ||
    lower.includes('confused') ||
    lower.startsWith('help')
  ) {
    return {
      intent: MessageIntent.HELP,
      confidence: 0.85,
      keywords: ['help', 'stuck', 'confused'],
      reasoning: 'User is asking for help',
    }
  }

  // Request intent
  if (
    lower.includes('can you') ||
    lower.includes('could you') ||
    lower.includes('would you') ||
    lower.includes('please') ||
    lower.includes('make') ||
    lower.includes('build')
  ) {
    return {
      intent: MessageIntent.REQUEST,
      confidence: 0.8,
      keywords: ['can you', 'could you', 'please'],
      reasoning: 'Message is a polite request',
    }
  }

  // Feedback intent
  if (
    lower.includes('good job') ||
    lower.includes('great') ||
    lower.includes('thanks') ||
    lower.includes('love') ||
    lower.includes('hate') ||
    lower.includes('wrong') ||
    lower.includes('bad')
  ) {
    return {
      intent: MessageIntent.FEEDBACK,
      confidence: 0.8,
      keywords: ['thanks', 'love', 'hate'],
      reasoning: 'Message contains feedback or evaluation',
    }
  }

  // Default: Conversation
  return {
    intent: MessageIntent.CONVERSATION,
    confidence: 0.7,
    keywords: [],
    reasoning: 'No specific intent pattern detected, treating as conversation',
  }
}

export async function detectIntentAsync(message: string): Promise<IntentAnalysis> {
  const localAnalysis = detectIntent(message)

  if (localAnalysis.confidence >= 0.85) {
    return localAnalysis
  }

  try {
    const model = genAI.getGenerativeModel({ model: MODEL_ID })
    const prompt = `Analyze the user message below and classify it into one of these intents:
- question (asking for information, help, how things work)
- command (asking to run an action, do a task, execute a command)
- creative (writing, styling, storytelling, creative brainstorming)
- technical (coding, API, debug, stack traces, systems architecture)
- conversation (general chat, greeting, small talk, casual statements)
- request (asking to build, make, or configure something)
- feedback (evaluation of the bot, gratitude, criticism)
- help (asking for support because they are stuck or confused)

Return your response in standard JSON format exactly like this:
{
  "intent": "one of the above lowercase intents",
  "confidence": 0.9,
  "keywords": ["keyword1", "keyword2"],
  "reasoning": "Brief explanation of why this intent was selected"
}

User Message: "${message.replace(/"/g, '\\"')}"`

    const response = await model.generateContent(prompt)
    const text = response.response.text()
    const startIdx = text.indexOf('{')
    const endIdx = text.lastIndexOf('}')
    if (startIdx !== -1 && endIdx !== -1) {
      const jsonStr = text.slice(startIdx, endIdx + 1)
      const data = JSON.parse(jsonStr)
      if (Object.values(MessageIntent).includes(data.intent)) {
        return {
          intent: data.intent as MessageIntent,
          confidence: typeof data.confidence === 'number' ? data.confidence : 0.85,
          keywords: Array.isArray(data.keywords) ? data.keywords : [],
          reasoning: typeof data.reasoning === 'string' ? data.reasoning : 'AI classification',
        }
      }
    }
  } catch (e) {
    console.warn('[intent-detection] AI intent detection failed, using local pattern:', e)
  }

  return localAnalysis
}

/**
 * Get system prompt variant based on intent
 * These can be used to set context for Gemini responses
 */
export function getSystemPromptForIntent(intent: MessageIntent): string {
  const basePrompt = `You are a helpful Discord bot assistant.`

  const variants: Record<MessageIntent, string> = {
    [MessageIntent.QUESTION]: `${basePrompt} Answer questions clearly and concisely with sources when relevant. Focus on accuracy and helpfulness. If you don't know something, say so.`,

    [MessageIntent.COMMAND]: `${basePrompt} The user is asking you to perform an action or provide specific information. Be direct and action-oriented. Confirm what you're doing.`,

    [MessageIntent.CREATIVE]: `${basePrompt} The user wants creative content. Be imaginative, engaging, and fun. Add personality and creativity to your response.`,

    [MessageIntent.TECHNICAL]: `${basePrompt} The user is asking about technical topics. Be precise, use code examples when helpful, explain concepts clearly. Include relevant details.`,

    [MessageIntent.CONVERSATION]: `${basePrompt} The user is making conversation. Be friendly, natural, and engaging. Match their tone and energy.`,

    [MessageIntent.REQUEST]: `${basePrompt} The user is politely requesting something. Be helpful and enthusiastic. Confirm you understand what they want.`,

    [MessageIntent.FEEDBACK]: `${basePrompt} The user is giving feedback or evaluating something. Be responsive and take it seriously. Acknowledge their feedback.`,

    [MessageIntent.HELP]: `${basePrompt} The user needs help. Be supportive, patient, and thorough. Break down the solution into steps if needed.`,
  }

  return variants[intent] || basePrompt
}

/**
 * Get response style recommendations based on intent
 */
export function getResponseStyleForIntent(intent: MessageIntent): {
  length: 'short' | 'medium' | 'long'
  tone: 'formal' | 'casual' | 'friendly' | 'technical'
  structure: 'narrative' | 'bullet' | 'code' | 'natural'
} {
  const styles: Record<MessageIntent, any> = {
    [MessageIntent.QUESTION]: { length: 'medium', tone: 'friendly', structure: 'natural' },
    [MessageIntent.COMMAND]: { length: 'medium', tone: 'friendly', structure: 'bullet' },
    [MessageIntent.CREATIVE]: { length: 'long', tone: 'casual', structure: 'narrative' },
    [MessageIntent.TECHNICAL]: { length: 'long', tone: 'technical', structure: 'code' },
    [MessageIntent.CONVERSATION]: { length: 'medium', tone: 'casual', structure: 'natural' },
    [MessageIntent.REQUEST]: { length: 'medium', tone: 'friendly', structure: 'natural' },
    [MessageIntent.FEEDBACK]: { length: 'short', tone: 'friendly', structure: 'natural' },
    [MessageIntent.HELP]: { length: 'long', tone: 'supportive', structure: 'bullet' },
  }

  return styles[intent]
}

import type { AiProviderMode } from './ai-provider.ts'

/**
 * Get preferred AI model based on intent
 * Routes to Claude for technical/help content, defaults to auto for others
 */
export function getPreferredModelForIntent(intent: MessageIntent): AiProviderMode {
  switch (intent) {
    case MessageIntent.TECHNICAL:
      return 'claude' // Claude excels at code, technical explanations
    case MessageIntent.HELP:
      return 'claude' // Claude is empathetic and thorough for help requests
    case MessageIntent.QUESTION:
      return 'claude' // Claude provides detailed, nuanced answers
    case MessageIntent.CREATIVE:
      return 'gemini' // Gemini is fast and creative
    default:
      return 'auto' // Auto: try Gemini first, fallback to OpenAI, then Claude
  }
}

/**
 * Example of how to use intent detection in message handler:
 *
 * const analysis = detectIntent(message.content)
 * console.log(`Intent: ${analysis.intent} (${Math.round(analysis.confidence * 100)}% confidence)`)
 *
 * const systemPrompt = getSystemPromptForIntent(analysis.intent)
 * const style = getResponseStyleForIntent(analysis.intent)
 * const preferredModel = getPreferredModelForIntent(analysis.intent)
 *
 * // Use systemPrompt + style + preferredModel in AI call
 * // Adjust response length, tone, and structure accordingly
 * // Route to preferred model when possible
 */
