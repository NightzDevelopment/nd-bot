import { ChannelType, type Collection, type FetchMessagesOptions, type Message } from 'discord.js'

const MAX_HISTORY_FETCH_ROUNDS = 25

/**
 * Discord category (parent) ID for a guild text channel, forum, or thread under one of those.
 */
export async function getGuildChannelCategoryId(
  channel: Message['channel'],
): Promise<string | null> {
  if (!channel.isTextBased() || channel.isDMBased()) return null
  if (!('guild' in channel) || !channel.guild) return null

  if (channel.isThread()) {
    let parent: typeof channel.parent = channel.parent
    if (!parent && channel.parentId) {
      const fetched = await channel.guild.channels.fetch(channel.parentId).catch(() => null)
      parent = fetched && 'parentId' in fetched ? (fetched as typeof channel.parent) : null
    }
    if (!parent) return null
    if ('parentId' in parent && parent.parentId) {
      return parent.parentId
    }
    return null
  }

  if (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement) {
    return channel.parentId
  }

  return null
}

/**
 * True if this message is the first in this channel from this user (no older messages from them).
 */
export async function isFirstMessageFromUserInChannel(msg: Message): Promise<boolean> {
  const authorId = msg.author.id
  let before: string | undefined = msg.id
  let rounds = 0

  while (rounds < MAX_HISTORY_FETCH_ROUNDS) {
    rounds++
    const opts: FetchMessagesOptions = before ? { limit: 100, before } : { limit: 100 }
    const batch: Collection<string, Message<boolean>> = await msg.channel.messages.fetch(opts)
    if (batch.size === 0) return true
    for (const m of batch.values()) {
      if (m.author.id === authorId) return false
    }
    before = batch.last()!.id
    if (batch.size < 100) return true
  }
  return true
}
