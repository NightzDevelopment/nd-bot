import { type Channel, ChannelType, type Guild, type PartialMessage } from 'discord.js'
import { auditIgnoredCategories, auditIgnoredChannels } from '../config.ts'

/** Category ID for a guild channel (text / voice / forum / thread’s parent text channel). */
function resolveCategoryId(ch: Channel): string | null {
  if (ch.type === ChannelType.DM || ch.type === ChannelType.GroupDM) return null
  if (ch.isThread()) {
    const p = ch.parent
    if (p && 'parentId' in p && p.parentId) return p.parentId
    return null
  }
  if ('parentId' in ch && ch.parentId) return ch.parentId
  return null
}

export function isIgnoredChannelOrCategory(ch: Channel): boolean {
  if (auditIgnoredChannels.has(ch.id)) return true
  const cat = resolveCategoryId(ch)
  if (cat && auditIgnoredCategories.has(cat)) return true
  return false
}

/** For message audit / automod: guild channel by id, using cache for category resolution. */
export function isIgnoredChannelOrCategoryById(guild: Guild | null, channelId: string): boolean {
  if (auditIgnoredChannels.has(channelId)) return true
  if (!guild) return false
  const full = guild.channels.cache.get(channelId)
  if (!full) return false
  return isIgnoredChannelOrCategory(full)
}

export function shouldIgnoreMessageAudit(msg: PartialMessage): boolean {
  if (!msg.channel || msg.channel.isDMBased()) return false
  const guild = msg.guild ?? null
  if (!guild) return false
  return isIgnoredChannelOrCategoryById(guild, msg.channel.id)
}
