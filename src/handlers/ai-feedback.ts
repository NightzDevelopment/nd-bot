/**
 * Staff reactions on bot AI messages for quality review (+1 / flag).
 */
import {
  type Client,
  Events,
  type Message,
  type MessageReaction,
  type PartialMessageReaction,
  type PartialUser,
  type User,
} from 'discord.js'
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

  client.on(
    Events.MessageReactionAdd,
    async (reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser) => {
      try {
        if (user.bot) return
        const fullReaction = reaction.partial ? await reaction.fetch() : reaction
        if (!fullReaction.message.guild) return
        const msg = fullReaction.message.partial
          ? await fullReaction.message.fetch()
          : fullReaction.message
        if (!msg.author.bot || msg.author.id !== client.user?.id) return
        if (!msg.content?.trim() && msg.embeds.length === 0) return

        const fullUser = user.partial ? await user.fetch() : user
        const member = await fullReaction.message.guild.members.fetch(fullUser.id).catch(() => null)
        if (!member || !isGuildMod(member)) return

        const isNeg = emojiMatches(fullReaction, aiFeedbackNegativeEmoji)
        const isPos = emojiMatches(fullReaction, aiFeedbackPositiveEmoji)
        if (!isNeg && !isPos) return

        if (isNeg) {
          await reportAiFeedbackNegative(fullUser.tag, fullUser.id, msg as Message)
        } else if (isPos) {
          await reportAiFeedbackPositive(fullUser.tag, fullUser.id, msg as Message)
        }
      } catch (e) {
        console.error('[ai-feedback]', e)
      }
    },
  )
}
