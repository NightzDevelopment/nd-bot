export type BotDeleteAttribution = {
  actor: string
  reason: string
  at: number
}

const recentBotDeletes = new Map<string, BotDeleteAttribution>()
const TTL_MS = 2 * 60 * 1000

function key(guildId: string | null | undefined, channelId: string, messageId: string): string {
  return `${guildId ?? 'dm'}:${channelId}:${messageId}`
}

export function markBotMessageDelete(args: {
  guildId?: string | null | undefined
  channelId: string
  messageId: string
  actor: string
  reason: string
}): void {
  const now = Date.now()
  recentBotDeletes.set(key(args.guildId, args.channelId, args.messageId), {
    actor: args.actor,
    reason: args.reason,
    at: now,
  })
  if (recentBotDeletes.size > 1000) {
    for (const [k, v] of recentBotDeletes) {
      if (now - v.at > TTL_MS) recentBotDeletes.delete(k)
    }
  }
}

export function takeBotMessageDeleteAttribution(args: {
  guildId?: string | null | undefined
  channelId: string
  messageId: string
}): BotDeleteAttribution | null {
  const k = key(args.guildId, args.channelId, args.messageId)
  const hit = recentBotDeletes.get(k)
  if (!hit) return null
  recentBotDeletes.delete(k)
  if (Date.now() - hit.at > TTL_MS) return null
  return hit
}
