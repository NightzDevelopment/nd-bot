/**
 * Starboard: when a message gets enough star reactions, repost it to a
 * highlights channel and keep the star count live. Posted messages are tracked
 * to avoid duplicates.
 */
import {
  type Client,
  EmbedBuilder,
  Events,
  type Message,
  type MessageReaction,
  type PartialMessageReaction,
  type PartialUser,
  type TextChannel,
  type User,
} from 'discord.js'
import { starboardChannelId, starboardEmoji, starboardEnabled, starboardThreshold } from '../config.ts'
import { childLogger } from '../lib/logger.ts'
import { readJson, writeJson } from './data-store.ts'

const log = childLogger('starboard')

const FILE = 'starboard.json'
type Store = { posts: Record<string, { starboardMessageId: string; count: number }> }
let cache: Store | null = null

async function load(): Promise<Store> {
  if (cache) return cache
  const data = await readJson<Store>(FILE, { posts: {} })
  if (!data.posts) data.posts = {}
  cache = data
  return data
}

async function save(data: Store): Promise<void> {
  cache = data
  await writeJson(FILE, data)
}

function emojiMatches(reaction: MessageReaction | PartialMessageReaction): boolean {
  const e = reaction.emoji
  return e.name === starboardEmoji || e.toString() === starboardEmoji || e.id === starboardEmoji
}

function buildEmbed(msg: Message, count: number): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(0xfbbf24)
    .setAuthor({
      name: msg.author?.tag ?? 'unknown',
      iconURL: msg.author?.displayAvatarURL({ size: 64 }),
    })
    .setDescription(msg.content?.slice(0, 3500) || '*(no text)*')
    .addFields({ name: 'Source', value: `[Jump to message](${msg.url})`, inline: true })
    .setFooter({ text: `${starboardEmoji} ${count}` })
    .setTimestamp(msg.createdAt)
  const image = [...msg.attachments.values()].find((a) =>
    (a.contentType ?? '').startsWith('image/'),
  )
  if (image) embed.setImage(image.url)
  return embed
}

async function handleReaction(
  client: Client,
  reaction: MessageReaction | PartialMessageReaction,
): Promise<void> {
  if (!starboardChannelId) return
  if (!emojiMatches(reaction)) return
  try {
    if (reaction.partial) await reaction.fetch()
    const msg = reaction.message.partial ? await reaction.message.fetch() : reaction.message
    if (!msg.guild) return
    // Don't star messages already in the starboard channel.
    if (msg.channel.id === starboardChannelId) return

    const count = reaction.count ?? 0
    const data = await load()
    const existing = data.posts[msg.id]
    const board = await client.channels.fetch(starboardChannelId).catch(() => null)
    if (!board?.isTextBased() || !('send' in board)) return
    const boardCh = board as TextChannel

    if (count < starboardThreshold) {
      // Below threshold: if previously posted and count dropped, update count.
      if (existing) {
        const bmsg = await boardCh.messages.fetch(existing.starboardMessageId).catch(() => null)
        if (bmsg) await bmsg.edit({ embeds: [buildEmbed(msg as Message, count)] }).catch(() => {})
        existing.count = count
        await save(data)
      }
      return
    }

    if (existing) {
      const bmsg = await boardCh.messages.fetch(existing.starboardMessageId).catch(() => null)
      if (bmsg) await bmsg.edit({ embeds: [buildEmbed(msg as Message, count)] }).catch(() => {})
      existing.count = count
      await save(data)
      return
    }

    const sent = await boardCh.send({ embeds: [buildEmbed(msg as Message, count)] })
    data.posts[msg.id] = { starboardMessageId: sent.id, count }
    // Cap stored history to avoid unbounded growth.
    const ids = Object.keys(data.posts)
    if (ids.length > 3000) delete data.posts[ids[0]!]
    await save(data)
    log.info({ messageId: msg.id, count }, 'message added to starboard')
  } catch (e) {
    log.warn({ err: e }, 'starboard reaction handling failed')
  }
}

export function registerStarboard(client: Client): void {
  if (!starboardEnabled) return

  client.on(
    Events.MessageReactionAdd,
    (reaction: MessageReaction | PartialMessageReaction, _user: User | PartialUser) => {
      void handleReaction(client, reaction)
    },
  )
  client.on(
    Events.MessageReactionRemove,
    (reaction: MessageReaction | PartialMessageReaction, _user: User | PartialUser) => {
      void handleReaction(client, reaction)
    },
  )
}
