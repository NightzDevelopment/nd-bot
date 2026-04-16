import { ChannelType, type Client, type Message } from 'discord.js'
import {
  CONVERSATION_HISTORY_LIMIT,
  SYSTEM_PROMPT_DM,
  SYSTEM_PROMPT_GUILD,
  aiAutomodIncludeChannelSnippet,
  allowedDmUsers,
  enableDmSupport,
  guildAiTicketCategoryIds,
  guildChannelIds,
  staffDraftSourceChannelIds,
} from '../config.ts'
import { chunkText } from '../utils/chunk.ts'
import { refusalEmbed } from '../utils/embed.ts'
import { buildAugmentedUserContentAsync } from '../services/context-bundle.ts'
import { chatReply, chatReplyWithImage, getModel } from '../services/gemini.ts'
import { getHistory, pushTurn, type Turn } from '../services/memory.ts'
import { containsProfanity } from '../services/profanity.ts'
import {
  reportProfanity,
  logDmExchange,
  logDmBlocked,
  reportStaffDraftReply,
} from '../services/logging.ts'
import { recordSupportExchange } from '../services/analytics-store.ts'
import {
  maybeAutoCreateTicket,
  maybeOfferTicketFromHowQuestion,
  maybeSendTicketOffer,
  shouldOfferTicketFromUserMessage,
} from '../services/ticket-handoff.ts'
import { isPrefixCommand, handlePrefixCommand } from './prefix.ts'
import { runRuleAutomod } from './automod.ts'
import { enqueueAiAutomod } from '../services/ai-automod.ts'
import {
  isActiveWindow,
  touchActiveWindow,
} from '../services/active-window.ts'
import { lockdownGuilds } from '../services/lockdown.ts'
import { isModMessage } from '../utils/permissions.ts'
import {
  fetchAttachmentAsBase64,
  pickFirstImageAttachment,
} from '../utils/image-attachment.ts'
import {
  getGuildChannelCategoryId,
  isFirstMessageFromUserInChannel,
} from '../utils/ticket-ai-gate.ts'
import {
  getTicketTriagePromptSuffix,
  markTicketStaffEngagedFromModMessage,
  touchTicketUserActivity,
} from '../services/ticket-system.ts'
import { getTicketByChannel } from '../services/ticket-store.ts'
import {
  clearComingSoonReplyLast,
  isComingSoonTopic,
  randomComingSoonReply,
} from '../utils/coming-soon.ts'
import {
  getRecentChannelSnippet,
  pushRecentChannelLine,
} from '../utils/recent-channel-messages.ts'

const modelDm = getModel(SYSTEM_PROMPT_DM)
const modelGuild = getModel(SYSTEM_PROMPT_GUILD)

const TYPING_INTERVAL_MS = 8_000
const MIN_DELAY_MS = 1_500
const MAX_DELAY_MS = 5_000
const MS_PER_CHAR = 12

function typingDelay(text: string): number {
  return Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, text.length * MS_PER_CHAR))
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function isMonitoredGuildChannel(msg: Message): boolean {
  if (guildChannelIds.size === 0) return true
  const ch = msg.channel
  const parentId = ch.isThread() ? ch.parentId : null
  return (
    guildChannelIds.has(ch.id) ||
    (parentId != null && guildChannelIds.has(parentId))
  )
}

export function shouldHandleMessage(msg: Message): boolean {
  if (msg.author.bot) return false
  if (msg.channel.type === ChannelType.DM) {
    if (!enableDmSupport) return false
    if (allowedDmUsers.size === 0) return true
    return allowedDmUsers.has(msg.author.id)
  }
  const t = msg.channel.type
  const guildish =
    t === ChannelType.GuildText ||
    t === ChannelType.GuildAnnouncement ||
    t === ChannelType.PublicThread ||
    t === ChannelType.PrivateThread ||
    t === ChannelType.AnnouncementThread
  if (guildish) return isMonitoredGuildChannel(msg)
  return false
}

async function shouldRespondGuildAi(msg: Message): Promise<boolean> {
  const botId = msg.client.user?.id
  if (!botId) return false
  if (msg.mentions.users.has(botId)) return true
  if (msg.reference?.messageId) {
    try {
      const ref = await msg.channel.messages.fetch(msg.reference.messageId)
      if (ref.author.id === botId) return true
    } catch {
      /* ignore */
    }
  }
  if (isActiveWindow(msg.author.id, msg.channel.id)) return true

  /** ND bot ticket channels: triage from tickets.json; does not depend on GUILD_AI_TICKET_CATEGORY_IDS. */
  if (msg.guild) {
    try {
      const ticket = await getTicketByChannel(msg.channel.id)
      if (
        ticket?.status === 'open' &&
        msg.author.id === ticket.userId &&
        !ticket.staffEngaged
      ) {
        return true
      }
    } catch (e) {
      console.warn('[messages] ND ticket triage check failed:', e)
    }
  }

  if (guildAiTicketCategoryIds.size > 0 && msg.guild) {
    try {
      const categoryId = await getGuildChannelCategoryId(msg.channel)
      if (categoryId && guildAiTicketCategoryIds.has(categoryId)) {
        const ticket = await getTicketByChannel(msg.channel.id)
        if (
          !ticket &&
          (await isFirstMessageFromUserInChannel(msg))
        ) {
          return true
        }
      }
    } catch (e) {
      console.warn('[messages] ticket category / first-message check failed:', e)
    }
  }
  return false
}

/** Last N user lines in this channel so retrieval still matches the active product/thread. */
function keywordContextFromHistory(turns: Turn[], latestUserText: string, maxPriorUser = 5): string {
  const userLines = turns.filter((t) => t.role === 'user').map((t) => t.content)
  const recent = userLines.slice(-maxPriorUser)
  return [...recent, latestUserText].join('\n')
}

const processing = new Set<string>()

export function registerMessageHandler(client: Client): void {
  client.on('messageCreate', async (msg: Message) => {
    if (
      msg.guild &&
      !msg.author.bot &&
      msg.channel.type !== ChannelType.DM
    ) {
      void touchTicketUserActivity(msg).catch(() => {})
      void markTicketStaffEngagedFromModMessage(msg).catch(() => {})
    }
    if (msg.channel.type === ChannelType.DM && !msg.author.bot) {
      console.log(
        `[DM] received from ${msg.author.tag}: "${msg.content?.slice(0, 80)}"`,
      )
    }
    if (!shouldHandleMessage(msg)) return
    if (processing.has(msg.id)) return
    processing.add(msg.id)
    setTimeout(() => processing.delete(msg.id), 30_000)

    const rawText = msg.content?.trim() || ''

    if (rawText && isPrefixCommand(rawText)) {
      try {
        await handlePrefixCommand(msg)
      } catch (e) {
        console.error('[prefix]', e)
      }
      return
    }

    if (msg.guild && lockdownGuilds.has(msg.guild.id) && !isModMessage(msg)) {
      try {
        await msg.delete()
      } catch {
        /* ignore */
      }
      return
    }

    const blocked = await runRuleAutomod(msg)
    if (blocked === 'blocked') return

    let channelSnippet: string | undefined
    if (msg.guild && aiAutomodIncludeChannelSnippet) {
      channelSnippet = getRecentChannelSnippet(msg.channel.id)
      if (rawText) pushRecentChannelLine(msg.channel.id, rawText)
    }
    enqueueAiAutomod(msg, channelSnippet)

    if (!rawText && msg.attachments.size === 0) return

    const imageAtt = pickFirstImageAttachment(msg.attachments)
    if (!rawText && msg.attachments.size > 0 && !imageAtt) {
      await msg.reply(
        'I can only use **image** attachments (PNG, JPEG, WebP, GIF) under the size limit. Add a caption or describe what you need in text.',
      )
      return
    }

    if (msg.channel.type !== ChannelType.DM) {
      const allowAi = await shouldRespondGuildAi(msg)
      if (!allowAi) return
    }

    if (containsProfanity(rawText, msg)) {
      console.warn('[profanity] blocked message from', msg.author.tag)
      await msg.reply({ embeds: [refusalEmbed()] })
      void reportProfanity(msg)
      if (msg.channel.type === ChannelType.DM) void logDmBlocked(msg)
      return
    }

    const ch = msg.channel
    const displayName = msg.member?.displayName ?? msg.author.username
    const chLabel =
      ch.type === ChannelType.DM
        ? 'DM'
        : 'name' in ch && ch.name
          ? ch.name
          : ch.isThread()
            ? `thread:${ch.id}`
            : 'channel'

    const multiImageNote =
      imageAtt && msg.attachments.size > 1
        ? '\n(Only the first valid image attachment is analyzed.)'
        : ''

    let displayPrompt: string
    if (ch.type === ChannelType.DM) {
      if (rawText && imageAtt) {
        displayPrompt = `${rawText}${multiImageNote}\n\n[Image attached: ${imageAtt.name}]`
      } else if (imageAtt) {
        displayPrompt =
          `[Image: ${imageAtt.name}] User sent a screenshot with no text caption. Describe what you see and help with ND / FiveM support if relevant.${multiImageNote}`
      } else {
        displayPrompt = rawText
      }
    } else if (rawText && imageAtt) {
      displayPrompt = `[#${chLabel} from ${displayName}]: ${rawText}${multiImageNote}\n\n[Image attached: ${imageAtt.name}]`
    } else if (imageAtt) {
      displayPrompt =
        `[#${chLabel} from ${displayName}]: (screenshot, no caption) Describe what you see and help with ND / FiveM support if relevant. [Image: ${imageAtt.name}]${multiImageNote}`
    } else {
      displayPrompt = `[#${chLabel} from ${displayName}]: ${rawText}`
    }

    const ticketTriage = await getTicketTriagePromptSuffix(msg)
    if (ticketTriage) {
      displayPrompt += ticketTriage
    }

    const userMemoryContent =
      rawText && imageAtt
        ? `${rawText}\n[Image: ${imageAtt.name}]`
        : rawText || (imageAtt ? `[Image: ${imageAtt.name}]` : '')

    const model = ch.type === ChannelType.DM ? modelDm : modelGuild
    const channelId = ch.id
    const prior = getHistory(channelId)
    const keywordBlob = keywordContextFromHistory(prior, userMemoryContent)
    const comingSoonProbe = [rawText, imageAtt?.name ?? '']
      .map((s) => s.trim())
      .filter(Boolean)
      .join(' ')
    if (comingSoonProbe && isComingSoonTopic(comingSoonProbe)) {
      if (ch.type !== ChannelType.DM) {
        touchActiveWindow(msg.author.id, msg.channel.id)
      }
      const reply = randomComingSoonReply(channelId)
      await sleep(typingDelay(reply))
      await msg.reply(reply)
      pushTurn(channelId, { role: 'user', content: userMemoryContent }, CONVERSATION_HISTORY_LIMIT)
      pushTurn(channelId, { role: 'model', content: reply }, CONVERSATION_HISTORY_LIMIT)
      if (ch.type === ChannelType.DM) void logDmExchange(msg, reply)
      if (msg.guild && ch.type !== ChannelType.DM) {
        void recordSupportExchange(msg.channel.id, userMemoryContent, reply)
      }
      return
    }

    const augmented = await buildAugmentedUserContentAsync(
      displayPrompt,
      keywordBlob,
      'User message',
    )

    if (ch.type !== ChannelType.DM) {
      touchActiveWindow(msg.author.id, msg.channel.id)
    }

    try {
      if ('sendTyping' in msg.channel) await msg.channel.sendTyping()

      const typingTimer = setInterval(() => {
        if ('sendTyping' in msg.channel) void (msg.channel as any).sendTyping()
      }, TYPING_INTERVAL_MS)

      let reply: string
      try {
        if (imageAtt) {
          const image = await fetchAttachmentAsBase64(imageAtt)
          reply = await chatReplyWithImage(model, prior, augmented, image)
        } else {
          reply = await chatReply(model, prior, augmented)
        }
      } finally {
        clearInterval(typingTimer)
      }

      await sleep(typingDelay(reply))

      const parts = chunkText(reply)
      for (let i = 0; i < parts.length; i++) {
        const chunk = parts[i]!
        if (i === 0) await msg.reply({ content: chunk })
        else {
          await sleep(Math.min(2000, chunk.length * MS_PER_CHAR))
          await msg.channel.send({ content: chunk })
        }
      }
      pushTurn(
        channelId,
        { role: 'user', content: userMemoryContent },
        CONVERSATION_HISTORY_LIMIT,
      )
      pushTurn(
        channelId,
        { role: 'model', content: reply },
        CONVERSATION_HISTORY_LIMIT,
      )
      if (ch.type === ChannelType.DM) void logDmExchange(msg, reply)
      if (msg.guild && staffDraftSourceChannelIds.has(msg.channel.id)) {
        void reportStaffDraftReply(msg, reply)
      }
      if (msg.guild && ch.type !== ChannelType.DM) {
        void recordSupportExchange(msg.channel.id, userMemoryContent, reply)
        if (shouldOfferTicketFromUserMessage(rawText)) {
          void maybeOfferTicketFromHowQuestion(msg)
        } else {
          void maybeSendTicketOffer(msg, reply)
        }
        void maybeAutoCreateTicket(msg, reply)
      }
      clearComingSoonReplyLast(channelId)
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e)
      console.error('handle message:', err)
      try {
        await msg.reply(
          `Something went wrong while reaching the AI: ${err.slice(0, 350)}`,
        )
      } catch {
        /* ignore */
      }
    }
  })
}
