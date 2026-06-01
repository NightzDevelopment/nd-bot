/**
 * Bot health summary for `/status` and `nd!status`.
 */
import type { Client } from 'discord.js'
import { MODEL_ID, openaiEnabled } from '../config.ts'
import { getAiProviderState } from './ai-provider.ts'
import { checkOpenAiAvailability } from './gemini.ts'
import { formatStoreHealthOneLiner } from './store-snapshot.ts'

export async function buildHealthSummary(client: Client): Promise<string> {
  const ws = client.ws.ping
  const guilds = client.guilds.cache.size
  const state = await getAiProviderState()
  const openaiHealth = openaiEnabled
    ? await checkOpenAiAvailability()
    : { ok: false as const, detail: 'OpenAI not configured' }
  const lines = [
    `**Latency:** gateway ${ws}ms`,
    `**Guilds:** ${guilds}`,
    `**AI mode:** ${state.mode}`,
    `**Gemini model:** \`${MODEL_ID}\``,
    `**OpenAI:** ${openaiEnabled ? (openaiHealth.ok ? 'reachable' : `offline (${openaiHealth.detail})`) : 'disabled'}`,
    formatStoreHealthOneLiner(),
  ]
  return lines.join('\n').slice(0, 1900)
}
