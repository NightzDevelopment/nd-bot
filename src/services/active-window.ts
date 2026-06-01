import { ACTIVE_CONVERSATION_MS } from '../config.ts'

const activeWindows = new Map<string, number>()

function key(userId: string, channelId: string): string {
  return `${userId}:${channelId}`
}

export function isActiveWindow(userId: string, channelId: string): boolean {
  const until = activeWindows.get(key(userId, channelId))
  if (!until) return false
  if (Date.now() > until) {
    activeWindows.delete(key(userId, channelId))
    return false
  }
  return true
}

export function touchActiveWindow(userId: string, channelId: string): void {
  activeWindows.set(key(userId, channelId), Date.now() + ACTIVE_CONVERSATION_MS)
}
