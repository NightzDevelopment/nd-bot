import { ChannelType, type Message } from 'discord.js'

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
    let parent = channel.parent
    if (!parent && channel.parentId) {
      parent = (await channel.guild.channels.fetch(channel.parentId).catch(() => null)) ?? null
    }
    if (!parent) return null
    if ('parentId' in parent && parent.parentId) {
      return parent.parentId
    }
    return null
  }

  if (
    channel.type === ChannelType.GuildText ||
    channel.type === ChannelType.GuildAnnouncement ||
    channel.type === ChannelType.GuildForum ||
    channel.type === ChannelType.GuildMedia
  ) {
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
    const batch = await msg.channel.messages.fetch({ limit: 100, before })
    if (batch.size === 0) return true
    for (const m of batch.values()) {
      if (m.author.id === authorId) return false
    }
    before = batch.last()!.id
    if (batch.size < 100) return true
  }
  return true
}
