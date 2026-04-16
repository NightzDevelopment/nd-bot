/**
 * Bounded per-channel recent user message lines for AI AutoMod context (optional).
 */
const MAX_CHANNELS = 500
const LINES_PER_CHANNEL = 4
const MAX_LINE_CHARS = 200

const linesByChannel = new Map<string, string[]>()

export function pushRecentChannelLine(channelId: string, text: string): void {
  const t = text.trim().replace(/\s+/g, ' ')
  if (t.length < 2) return
  const line = t.length > MAX_LINE_CHARS ? t.slice(0, MAX_LINE_CHARS) + '…' : t
  let arr = linesByChannel.get(channelId) ?? []
  arr.push(line)
  if (arr.length > LINES_PER_CHANNEL) arr = arr.slice(-LINES_PER_CHANNEL)
  linesByChannel.set(channelId, arr)
  if (linesByChannel.size > MAX_CHANNELS) {
    const first = linesByChannel.keys().next().value
    if (first) linesByChannel.delete(first)
  }
}

export function getRecentChannelSnippet(channelId: string): string {
  const arr = linesByChannel.get(channelId)
  if (!arr || arr.length === 0) return ''
  return `Recent in channel: ${arr.join(' | ')}`
}
