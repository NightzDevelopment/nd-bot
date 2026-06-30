/**
 * Universal ND Product Expert - Phase 4 AI Agentic Intelligence Upgrade
 * Developed under strict Nightz Development proprietary standards (no emojis)
 */
import { GoogleGenerativeAI, SchemaType, TaskType } from '@google/generative-ai'
import { ChannelType, type Client, type GuildMember } from 'discord.js'
import { readdir, readFile, stat } from 'fs/promises'
import { join, normalize, relative, resolve } from 'path'
import { embeddingModel, GOOGLE_KEY, MODEL_ID, vectorTopK } from '../config.ts'
import { getDiscordClient } from '../dashboard/runtime-state.ts'
import { sanitizeReply } from './gemini.ts'
import { validateMarkdownLuaBlocks } from '../utils/lua-syntax-check.ts'
import { sanitizeAiText } from '../utils/text-style.ts'
import type { Turn } from './memory.ts'
import { getDb } from './nd-db.ts'

const genAI = new GoogleGenerativeAI(GOOGLE_KEY)

// Strict boundary path for jail guards
const ND_ROOT_PATH = normalize('D:\\Nightz Development')

export interface NDResourceMetadata {
  name: string
  version: string
  exports: string[]
  dependencies: string[]
  clientScripts: string[]
  serverScripts: string[]
  configs: string[]
}

let dependencyMapCache: Record<string, NDResourceMetadata> = {}
const lexicalIndexCache: Map<string, string[]> = new Map() // filePath -> words
let lastScanTime = 0

export interface RequesterContext {
  userId: string
  guildId?: string
  member?: GuildMember
}

const SENSITIVE_DB_TABLES = ['warnings', 'users_economy', 'users_levels', 'reputation', 'tickets']

/**
 * Normalizes and guards path resolution, preventing directory traversal attacks.
 */
export function resolveSecureNDPath(relPath: string): string {
  const normalizedRel = relPath.replace(/^\/+/, '').replace(/[/\\]+/g, '\\')
  const resolved = resolve(ND_ROOT_PATH, normalizedRel)
  if (!resolved.startsWith(ND_ROOT_PATH)) {
    throw new Error('ERR-ND-403: Security Clearance Denied. Directory traversal blocked.')
  }
  return resolved
}

/**
 * Dynamic Tool: List files and folders securely
 */
async function handleListNDDirectory(relPath: string): Promise<string[]> {
  try {
    const full = resolveSecureNDPath(relPath)
    const entries = await readdir(full)
    const out: string[] = []
    for (const entry of entries) {
      if (entry.startsWith('.') || entry === 'node_modules') continue
      const st = await stat(join(full, entry))
      out.push(st.isDirectory() ? `[DIR] ${entry}` : `[FILE] ${entry}`)
    }
    return out
  } catch (e: any) {
    return [`Error listing directory: ${e.message}`]
  }
}

/**
 * Dynamic Tool: View specific file contents with line ranges securely
 */
async function handleViewNDFile(
  relPath: string,
  startLine?: number,
  endLine?: number,
): Promise<string> {
  try {
    const full = resolveSecureNDPath(relPath)
    const buf = await readFile(full)
    const text = buf.toString('utf8')
    const lines = text.split('\n')

    const start = Math.max(1, startLine ?? 1)
    const end = Math.min(lines.length, endLine ?? lines.length)

    if (end - start > 500) {
      return `[TRUNCATED] View range too large. Max 500 lines at a time.`
    }

    const rangeLines = lines.slice(start - 1, end)
    return rangeLines.map((l, i) => `${start + i}: ${l}`).join('\n')
  } catch (e: any) {
    return `Error reading file: ${e.message}`
  }
}

/**
 * Dynamic Tool: Perform a localized search_grep over files in D:\Nightz Development
 */
async function handleGrepNDSearch(query: string): Promise<string[]> {
  const normalizedQuery = query.toLowerCase().trim()
  if (normalizedQuery.length < 3) return ['Search query too short. Min 3 characters.']

  const matches: string[] = []

  async function searchWalk(dir: string): Promise<void> {
    let entries: string[]
    try {
      entries = await readdir(dir)
    } catch {
      return
    }

    for (const entry of entries) {
      if (
        entry.startsWith('.') ||
        entry === 'node_modules' ||
        entry === '.backup' ||
        entry === 'data'
      )
        continue
      const full = join(dir, entry)
      let st
      try {
        st = await stat(full)
      } catch {
        continue
      }

      if (st.isDirectory()) {
        await searchWalk(full)
      } else if (st.isFile() && st.size <= 200 * 1024) {
        const ext = entry.slice(entry.lastIndexOf('.')).toLowerCase()
        if (['.lua', '.js', '.ts', '.sql', '.cfg', '.json', '.md', '.txt'].includes(ext)) {
          try {
            const content = await readFile(full, 'utf8')
            if (content.toLowerCase().includes(normalizedQuery)) {
              const rel = relative(ND_ROOT_PATH, full).replace(/\\/g, '/')
              // Find occurrences
              const lines = content.split('\n')
              let count = 0
              for (let i = 0; i < lines.length; i++) {
                if (lines[i]!.toLowerCase().includes(normalizedQuery)) {
                  matches.push(`File: ${rel} (Line ${i + 1}): ${lines[i]!.trim()}`)
                  count++
                  if (count > 2) break // Limit hits per file to keep output clean
                }
              }
            }
          } catch {
            // skip unreadable
          }
        }
      }
      if (matches.length >= 30) break
    }
  }

  try {
    await searchWalk(ND_ROOT_PATH)
    if (matches.length === 0) return ['No matching records found.']
    return matches.slice(0, 30)
  } catch (e: any) {
    return [`Error during search: ${e.message}`]
  }
}

/**
 * Dynamic Tool: Safe, read-only SQLite database inspection.
 * Queries touching sensitive per-user tables must be scoped to the requester's own userId;
 * the caller-supplied SQL is never trusted to add that scoping itself.
 */
async function handleInspectSystemDb(
  sql: string,
  requesterContext?: RequesterContext,
): Promise<any[]> {
  const upper = sql.trim().toUpperCase()
  if (!upper.startsWith('SELECT')) {
    return [
      { error: 'ERR-ND-403: Security Clearance Denied. Only SELECT statements are permitted.' },
    ]
  }

  const lower = sql.toLowerCase()
  const touchesSensitiveTable = SENSITIVE_DB_TABLES.some((table) =>
    new RegExp(`\\b${table}\\b`).test(lower),
  )

  if (touchesSensitiveTable) {
    if (!requesterContext?.userId) {
      return [
        {
          error:
            'ERR-ND-403: Security Clearance Denied. Sensitive table access requires a verified requester.',
        },
      ]
    }
    const requiredClause = `userid = '${requesterContext.userId.toLowerCase()}'`
    if (!lower.includes(requiredClause)) {
      return [
        {
          error:
            'ERR-ND-403: Security Clearance Denied. Queries on sensitive tables must filter to your own userId.',
        },
      ]
    }
  }

  try {
    const db = getDb()
    const rows = db.prepare(sql).all()
    return rows
  } catch (e: any) {
    return [{ error: `SQL execution failed: ${e.message}` }]
  }
}

/**
 * Dynamic Tool: Read other Discord channels securely
 */
async function handleReadDiscordChannel(
  channelNameOrId: string,
  limit?: number,
  requesterContext?: RequesterContext,
): Promise<string[]> {
  try {
    const client = getDiscordClient<Client>()
    if (!client) return ['Error: Discord client is not ready yet.']

    // Find the channel
    let channel: any = null
    const query = channelNameOrId.trim().toLowerCase().replace(/^#/, '')

    // First try finding by exact ID
    if (query.match(/^\d+$/)) {
      channel = await client.channels.fetch(query).catch(() => null)
    }

    // Fallback: search in cache by name
    if (!channel) {
      channel = client.channels.cache.find(
        (c) =>
          (c.type === ChannelType.GuildText ||
            c.type === ChannelType.GuildAnnouncement ||
            c.type === ChannelType.PublicThread ||
            c.type === ChannelType.PrivateThread) &&
          c.name.toLowerCase() === query,
      )
    }

    if (!channel) {
      return [`Channel "${channelNameOrId}" not found or bot does not have permission to view it.`]
    }

    if (!requesterContext?.guildId || channel.guildId !== requesterContext.guildId) {
      return [`Channel "${channelNameOrId}" not found or bot does not have permission to view it.`]
    }

    if (requesterContext.member) {
      const canView = channel.permissionsFor(requesterContext.member)?.has('ViewChannel')
      if (!canView) {
        return [`Channel "${channelNameOrId}" not found or bot does not have permission to view it.`]
      }
    }

    // Fetch last N messages
    const fetchLimit = Math.min(25, Math.max(1, limit ?? 10))
    const messages = await channel.messages.fetch({ limit: fetchLimit })
    const sorted = [...messages.values()].reverse()

    const lines = sorted.map((m) => {
      const time = new Date(m.createdTimestamp).toLocaleTimeString()
      // Mask pings
      const cleanContent = m.cleanContent.replace(/@/g, '@\u200B')
      return `[${time}] ${m.author.tag}: ${cleanContent}`
    })

    if (lines.length === 0) {
      return [`Channel #${channel.name} is empty or no messages retrieved.`]
    }

    return [`Channel: #${channel.name} (${channel.id})`, ...lines]
  } catch (e: any) {
    return [`Error reading channel: ${e.message}`]
  }
}

/**
 * Pillar 3: Scans and auto-discovers dependencies/exports across ND products
 */
export async function scanNDProductDependencies(): Promise<Record<string, NDResourceMetadata>> {
  const now = Date.now()
  if (now - lastScanTime < 30 * 60 * 1000 && Object.keys(dependencyMapCache).length > 0) {
    return dependencyMapCache
  }

  const devBuildRoot = normalize('D:\\Nightz Development\\[Scripts]\\[Dev Build]')
  const metadataMap: Record<string, NDResourceMetadata> = {}

  async function walkScan(dir: string): Promise<void> {
    let entries: string[]
    try {
      entries = await readdir(dir)
    } catch {
      return
    }

    // Check if current directory has a FiveM manifest
    const hasManifest = entries.some(
      (e) => e.toLowerCase() === 'fxmanifest.lua' || e.toLowerCase() === '__resource.lua',
    )

    if (hasManifest) {
      const resourceName = basename(dir)
      const meta: NDResourceMetadata = {
        name: resourceName,
        version: '1.0.0',
        exports: [],
        dependencies: [],
        clientScripts: [],
        serverScripts: [],
        configs: [],
      }

      const manifestFile = entries.find(
        (e) => e.toLowerCase() === 'fxmanifest.lua' || e.toLowerCase() === '__resource.lua',
      )!
      try {
        const manifestContent = await readFile(join(dir, manifestFile), 'utf8')

        // Match version
        const vMatch = manifestContent.match(/version\s+['"]([^'"]+)['"]/i)
        if (vMatch?.[1]) meta.version = vMatch[1]

        // Match exports
        const exportRegex = /export\s+['"]([^'"]+)['"]/gi
        let expMatch
        while ((expMatch = exportRegex.exec(manifestContent)) !== null) {
          if (expMatch[1]) meta.exports.push(expMatch[1])
        }

        // Match dependencies
        const depRegex = /dependenc(?:y|ies)\s*\{\s*([^}]+)\}/gi
        const depMatch = depRegex.exec(manifestContent)
        if (depMatch?.[1]) {
          const list = depMatch[1]
            .split(/[\r\n,]+/)
            .map((s) => s.replace(/['"\s]+/g, ''))
            .filter(Boolean)
          meta.dependencies.push(...list)
        }

        // Alternate single dep syntax
        const depLineRegex = /dependenc(?:y|ies)\s+['"]([^'"]+)['"]/gi
        let dlMatch
        while ((dlMatch = depLineRegex.exec(manifestContent)) !== null) {
          if (dlMatch[1]) meta.dependencies.push(dlMatch[1])
        }

        // Find configs in directory
        for (const file of entries) {
          if (file.toLowerCase().includes('config') && file.endsWith('.lua')) {
            meta.configs.push(file)
          }
        }
      } catch {
        // skip read fails
      }

      metadataMap[resourceName] = meta
      return
    }

    for (const entry of entries) {
      if (entry.startsWith('.') || entry === 'node_modules') continue
      const full = join(dir, entry)
      try {
        const st = await stat(full)
        if (st.isDirectory()) {
          await walkScan(full)
        }
      } catch {}
    }
  }

  try {
    await walkScan(devBuildRoot)
    dependencyMapCache = metadataMap
    lastScanTime = Date.now()
    console.log(
      `[dependency-map] Auto-discovered ${Object.keys(dependencyMapCache).length} FiveM ND resources`,
    )
  } catch (e) {
    console.warn('[dependency-map] Scanning failed:', e)
  }
  return dependencyMapCache
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf('\\') + 1)
}

/**
 * Pillar 2: Hybrid BM25 Lexical + Cosine Semantic RAG
 * Combines Lexical keyword extraction with standard vector similarity scores
 */
export async function buildHybridVectorContextAsync(query: string): Promise<string> {
  const { buildVectorContextAsync, getCorpus } = await import('./embeddings.ts')
  const semanticContext = await buildVectorContextAsync(query)

  const qLower = query.toLowerCase().trim()
  const qTokens = qLower.split(/[^a-z0-9_]+/g).filter((w) => w.length > 3)

  if (qTokens.length === 0) return semanticContext

  const corpusList = getCorpus()
  if (corpusList.length === 0) return semanticContext

  // Lexical scoring (BM25 overlap simulation)
  const lexicalScored = corpusList
    .map((chunk) => {
      let score = 0
      const chunkTextLower = chunk.text.toLowerCase()
      const sourceLower = chunk.source.toLowerCase()

      for (const token of qTokens) {
        if (chunkTextLower.includes(token)) {
          score += 1.0
          // Exact syntax/event boost
          if (chunkTextLower.includes(`:${token}`) || chunkTextLower.includes(`.${token}`)) {
            score += 1.5
          }
        }
        if (sourceLower.includes(token)) {
          score += 3.0 // Path matching boost
        }
      }
      return { chunk, score }
    })
    .filter((x) => x.score > 0)

  if (lexicalScored.length === 0) return semanticContext

  lexicalScored.sort((a, b) => b.score - a.score)
  const topLexical = lexicalScored.slice(0, vectorTopK)

  // Synthesize custom hybrid outputs
  const parts = [
    semanticContext ||
      'Hybrid retrieval context (FAQ, store page snapshot, and indexed product documents):',
    '\nHigh-Relevance Lexical Identifiers matched in codebase:',
  ]

  topLexical.forEach((item, index) => {
    parts.push(
      `\n[Lexical #${index + 1}] Source: ${item.chunk.source}\n${item.chunk.text.slice(0, 1000)}`,
    )
  })

  return parts.join('\n')
}

/**
 * Pillar 5: Agentic Execution Loop with Gemini function calling
 */
export async function runUniversalAgentLoop(
  systemInstruction: string,
  prior: Turn[],
  latestQuery: string,
  imageAttachment?: { mimeType: string; dataBase64: string },
  requesterContext?: RequesterContext,
): Promise<string> {
  // Generate automated product dependency context
  const deps = await scanNDProductDependencies()
  const depsContext =
    `\n\n[Auto-Discovered ND FiveM Resource Catalog]\n` +
    Object.values(deps)
      .map(
        (d) =>
          `- **${d.name}** (v${d.version}) | exports: [${d.exports.join(', ') || 'none'}] | dependencies: [${d.dependencies.join(', ') || 'none'}]`,
      )
      .join('\n')

  const augmentedInstruction =
    systemInstruction +
    depsContext +
    `\n\n` +
    `CRITICAL TOOL-USE RULES (override any prior assumptions):

You have LIVE access to other Discord channels, the ND codebase, and the bot database through the tools below. You are NOT limited to this channel. NEVER say "I cannot see other channels" or "I do not have direct visibility": you DO, via the readDiscordChannel tool.

MANDATORY TOOL CALLS: you MUST call the appropriate tool BEFORE answering when:
- The user mentions or references ANY Discord channel (with or without #, e.g. "public-sneak-peeks", "#announcements", "updates channel") → call readDiscordChannel
- The user asks about code, scripts, configs, exports, errors, or FiveM resources → call grepNDSearch, viewNDFile, or listNDDirectory
- The user asks about their balance, level, warnings, quests, or any player data → call inspectSystemDb

Available Tools:
1. "listNDDirectory" / "viewNDFile" / "grepNDSearch": Browse, read, and search raw code files in D:\\Nightz Development.
2. "inspectSystemDb": Run read-only SELECT queries on the bot's SQLite database (tables: users_economy, users_levels, warnings, tickets, stocks, reminders, reputation).
3. "readDiscordChannel": Fetch the last N messages from ANY server channel by name or ID. Use this whenever a user references another channel: read it first, then answer based on what you find there.

Always call tools FIRST, then compose your answer from the tool results. Do not guess or say you lack access.`

  const model = genAI.getGenerativeModel({
    model: MODEL_ID,
    systemInstruction: augmentedInstruction,
    tools: [
      {
        functionDeclarations: [
          {
            name: 'listNDDirectory',
            description:
              'Lists all files and subdirectories under a relative path in the proprietary Nightz Development workspace (D:\\Nightz Development). Returns relative file paths.',
            parameters: {
              type: SchemaType.OBJECT,
              properties: {
                path: {
                  type: SchemaType.STRING,
                  description:
                    'The relative path under the Nightz Development directory (e.g. "[Scripts]/[Dev Build]/ND_Interactions"). Do not include leading slash.',
                },
              },
              required: ['path'],
            },
          },
          {
            name: 'viewNDFile',
            description:
              'Reads raw code lines from a specific file within D:\\Nightz Development. Highly useful to inspect Lua/JS/TS/JSON/Config files for exact variables, exports, or configurations.',
            parameters: {
              type: SchemaType.OBJECT,
              properties: {
                filePath: {
                  type: SchemaType.STRING,
                  description:
                    'The relative file path under D:\\Nightz Development (e.g. "[Scripts]/[Dev Build]/ND_Interactions/config.lua").',
                },
                startLine: {
                  type: SchemaType.INTEGER,
                  description: 'The starting line number to read (1-indexed). Optional.',
                },
                endLine: {
                  type: SchemaType.INTEGER,
                  description: 'The ending line number to read (inclusive). Optional.',
                },
              },
              required: ['filePath'],
            },
          },
          {
            name: 'grepNDSearch',
            description:
              'Grep searches for exact text strings, FiveM exports, events, variables, or functions across all files under D:\\Nightz Development.',
            parameters: {
              type: SchemaType.OBJECT,
              properties: {
                query: {
                  type: SchemaType.STRING,
                  description: 'The exact string/variable/export/event signature to search for.',
                },
              },
              required: ['query'],
            },
          },
          {
            name: 'inspectSystemDb',
            description:
              "Executes a read-only SELECT query on the bot's local SQLite database (nd-bot.db) to inspect player levels, warned users, daily quest states, or stock market tickers. Only SELECT queries are permitted.",
            parameters: {
              type: SchemaType.OBJECT,
              properties: {
                sql: {
                  type: SchemaType.STRING,
                  description: 'A read-only SELECT SQL query.',
                },
              },
              required: ['sql'],
            },
          },
          {
            name: 'readDiscordChannel',
            description:
              'Reads the recent message history from a public Discord channel by name (e.g. "public-sneak-peeks", "announcements") or numeric channel ID to verify announcements, sneak peeks, server updates, or instructions the user references.',
            parameters: {
              type: SchemaType.OBJECT,
              properties: {
                channelNameOrId: {
                  type: SchemaType.STRING,
                  description:
                    'The name of the channel (with or without #) or the numeric channel ID (e.g. "public-sneak-peeks").',
                },
                limit: {
                  type: SchemaType.INTEGER,
                  description:
                    'Max number of messages to retrieve (1-25). Optional, defaults to 10.',
                },
              },
              required: ['channelNameOrId'],
            },
          },
        ],
      },
    ],
  })

  const contents: any[] = []

  // Format prior history turns
  for (const t of prior) {
    contents.push({
      role: t.role === 'model' ? 'model' : 'user',
      parts: [{ text: t.content }],
    })
  }

  // Latest user query with image support
  if (imageAttachment) {
    contents.push({
      role: 'user',
      parts: [
        { text: latestQuery },
        { inlineData: { mimeType: imageAttachment.mimeType, data: imageAttachment.dataBase64 } },
      ],
    })
  } else {
    contents.push({
      role: 'user',
      parts: [{ text: latestQuery }],
    })
  }

  const maxIterations = 5

  for (let iter = 0; iter < maxIterations; iter++) {
    try {
      const response = await model.generateContent({ contents })
      const resVal = response.response

      const functionCalls = resVal.functionCalls()
      if (!functionCalls || functionCalls.length === 0) {
        // No more tool execution requested, return final text
        const text = resVal.text()

        // Pillar 1 AST Syntax validation check
        const syntaxRes = validateMarkdownLuaBlocks(text)
        if (!syntaxRes.valid && iter < maxIterations - 1) {
          console.log(
            `[ai-agent] Lua syntax check failed, requesting self-correction:`,
            syntaxRes.error,
          )
          contents.push({
            role: 'model',
            parts: [{ text }],
          })
          contents.push({
            role: 'user',
            parts: [
              {
                text: `[SYNTAX CHECK FAILURE] The generated Lua code block in your response contains syntax errors: ${syntaxRes.error} on line ${syntaxRes.line} (relative to the block) in context: "${syntaxRes.context}". Please review, correct the code syntax (ensure all blocks have matching end, parenthesis, brackets, braces), and output your corrected response without emojis.`,
              },
            ],
          })
          continue
        }

        return sanitizeReply(text)
      }

      // Append model response with tool calls to memory history
      contents.push({
        role: 'model',
        parts: resVal.candidates?.[0]?.content?.parts ?? [],
      })

      const functionResponses: any[] = []

      for (const call of functionCalls) {
        const { name, args } = call
        let result: any
        console.log(`[ai-agent] calling tool ${name} with args:`, JSON.stringify(args))

        if (name === 'listNDDirectory') {
          result = await handleListNDDirectory((args as any).path)
        } else if (name === 'viewNDFile') {
          result = await handleViewNDFile(
            (args as any).filePath,
            (args as any).startLine,
            (args as any).endLine,
          )
        } else if (name === 'grepNDSearch') {
          result = await handleGrepNDSearch((args as any).query)
        } else if (name === 'inspectSystemDb') {
          result = await handleInspectSystemDb((args as any).sql, requesterContext)
        } else if (name === 'readDiscordChannel') {
          result = await handleReadDiscordChannel(
            (args as any).channelNameOrId,
            (args as any).limit,
            requesterContext,
          )
        } else {
          result = { error: 'Unknown tool called' }
        }

        functionResponses.push({
          functionResponse: {
            name,
            response: { result },
          },
        })
      }

      // Append tool executions responses back to memory history
      contents.push({
        role: 'user', // Function answers are modeled under user/function response roles
        parts: functionResponses,
      })
    } catch (err: any) {
      console.error('[ai-agent] Error during agent execution turn:', err)
      return `[ERROR] AI Agent execution interrupted: ${err.message}`
    }
  }

  return `[ERROR] AI Agent loop exceeded maximum iteration limits of ${maxIterations} runs.`
}
