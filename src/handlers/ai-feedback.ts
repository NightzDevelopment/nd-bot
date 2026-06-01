/**
 * Staff reactions on bot AI messages for quality review (+1 / flag).
 */
import { type Client, Events, type Message, type MessageReaction, type User } from 'discord.js'
import {
  aiFeedbackNegativeEmoji,
  aiFeedbackPositiveEmoji,
  aiFeedbackReactionsEnabled,
} from '../config.ts'
import { reportAiFeedbackNegative, reportAiFeedbackPositive } from '../services/logging.ts'
import { isGuildMod } from '../utils/permissions.ts'

function emojiMatches(reaction: MessageReaction, expected: string): boolean {
  if (reaction.emoji.id) return false
  const ex = expected.trim()
  if (!ex) return false
  const name = reaction.emoji.name ?? ''
  if (name === ex || reaction.emoji.toString() === ex) return true
  // Discord sometimes uses short names vs literal unicode in .env
  if (ex === '\u2705' && name === 'white_check_mark') return true
  if (ex === '\u274c' && (name === 'x' || name === 'cross_mark')) return true
  return false
}

export function registerAiFeedbackHandler(client: Client): void {
  if (!aiFeedbackReactionsEnabled) return

  client.on(Events.MessageReactionAdd, async (reaction: MessageReaction, user: User) => {
    try {
      if (user.bot) return
      if (!reaction.message.guild) return
      const msg = reaction.message.partial ? await reaction.message.fetch() : reaction.message
      if (!msg.author.bot || msg.author.id !== client.user?.id) return
      if (!msg.content?.trim() && msg.embeds.length === 0) return

      const member = await reaction.message.guild.members.fetch(user.id).catch(() => null)
      if (!member || !isGuildMod(member)) return

      const isNeg = emojiMatches(reaction, aiFeedbackNegativeEmoji)
      const isPos = emojiMatches(reaction, aiFeedbackPositiveEmoji)
      if (!isNeg && !isPos) return

      if (isNeg) {
        await reportAiFeedbackNegative(user.tag, user.id, msg as Message)
      } else if (isPos) {
        await reportAiFeedbackPositive(user.tag, user.id, msg as Message)
      }
    } catch (e) {
      console.error('[ai-feedback]', e)
    }
  })
}
