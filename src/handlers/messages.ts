import { ChannelType, type Client, type Message } from 'discord.js'
import {
  aiAutomodIncludeChannelSnippet,
  aiReplyDisclaimer,
  aiReplyDisclaimerEnabled,
  allowedDmUsers,
  CONVERSATION_HISTORY_LIMIT,
  channelPromptExtraByChannelId,
  enableDmSupport,
  guildAiTicketCategoryIds,
  guildChannelIds,
  modmailEnabled,
  SYSTEM_PROMPT_DM,
  SYSTEM_PROMPT_GUILD,
  staffDraftSourceChannelIds,
  TICKET_CLOSED_CATEGORY_ID,
  TICKET_OPEN_CATEGORY_ID,
} from '../config.ts'
import { isBotPaused } from '../dashboard/runtime-state.ts'
import { awardFirstMessageBadge, checkAndAwardAchievements } from '../services/achievements.ts'
import { isActiveWindow, touchActiveWindow } from '../services/active-window.ts'
import { enqueueAiAutomod } from '../services/ai-automod.ts'
import { getAiProviderMode, setAiProviderMode } from '../services/ai-provider.ts'
import { logEvent as logAnalyticsEvent } from '../services/analytics.ts'
import { recordSupportExchange } from '../services/analytics-store.ts'
import { buildAugmentedUserContentAsync } from '../services/context-bundle.ts'
import { executeCommand, getCommand } from '../services/custom-commands.ts'
import {
  chatReply,
  chatReplyWithImage,
  getModel,
  getPublicAiErrorMessage,
  performOcr,
} from '../services/gemini.ts'
import {
  detectIntent,
  detectIntentAsync,
  getPreferredModelForIntent,
  getResponseStyleForIntent,
  getSystemPromptForIntent,
} from '../services/intent-detection.ts'
import { lockdownGuilds } from '../services/lockdown.ts'
import {
  logDmBlocked,
  logDmExchange,
  reportProfanity,
  reportStaffDraftReply,
} from '../services/logging.ts'
import { incrementMessageCount, syncExternalStats } from '../services/member-profile.ts'
import { getHistory, pushTurn, type Turn } from '../services/memory.ts'
import { containsProfanity } from '../services/profanity.ts'
import { getReputation } from '../services/reputation.ts'
import {
  maybeAutoCreateTicket,
  maybeOfferTicketFromHowQuestion,
  maybeSendTicketOffer,
  shouldOfferTicketFromUserMessage,
} from '../services/ticket-handoff.ts'
import { getTicketByChannel } from '../services/ticket-store.ts'
import {
  getTicketTriagePromptSuffix,
  markTicketStaffEngagedFromModMessage,
  touchTicketUserActivity,
} from '../services/ticket-system.ts'
import { runUniversalAgentLoop } from '../services/universal-nd-expert.ts'
import { markBotMessageDelete } from '../utils/bot-delete-attribution.ts'
import { chunkText } from '../utils/chunk.ts'
import {
  clearComingSoonReplyLast,
  isComingSoonTopic,
  randomComingSoonReply,
} from '../utils/coming-soon.ts'
import { refusalEmbed } from '../utils/embed.ts'
import { fetchAttachmentAsBase64, pickFirstImageAttachment } from '../utils/image-attachment.ts'
import { isGuildMod, isModMessage } from '../utils/permissions.ts'
import { getRecentChannelSnippet, pushRecentChannelLine } from '../utils/recent-channel-messages.ts'
import {
  getGuildChannelCategoryId,
  isFirstMessageFromUserInChannel,
} from '../utils/ticket-ai-gate.ts'
import { pickFirstZipAttachment, summarizeZipAttachment } from '../utils/zip-attachment.ts'
import { runRuleAutomod } from './automod.ts'
import { handlePrefixCommand, isPrefixCommand } from './prefix.ts'

const modelDm = getModel(SYSTEM_PROMPT_DM)
const modelGuild = getModel(SYSTEM_PROMPT_GUILD)

const TYPING_INTERVAL_MS = 8_000
const MIN_DELAY_MS = 1_500
const MAX_DELAY_MS = 5_000
const MS_PER_CHAR = 12
function typingDelay(text: string): number {
  return Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, text.length * MS_PER_CHAR))
}

/**
 * Tickets should not feel like an instant bot. A real support agent takes a
 * moment to read and type, longer for longer answers. Short answers still come
 * back quickly; longer answers take proportionally more time, capped so it
 * never drags. Tuned to feel deliberate, not sluggish.
 */
const TICKET_MIN_DELAY_MS = 1_200
const TICKET_MAX_DELAY_MS = 9_000
const TICKET_MS_PER_CHAR = 22
function ticketTypingDelay(text: string): number {
  return Math.min(
    TICKET_MAX_DELAY_MS,
    Math.max(TICKET_MIN_DELAY_MS, text.length * TICKET_MS_PER_CHAR),
  )
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function isMonitoredGuildChannel(msg: Message): boolean {
  if (guildChannelIds.size === 0) return true
  const ch = msg.channel
  const parentId = ch.isThread() ? ch.parentId : null
  return guildChannelIds.has(ch.id) || (parentId != null && guildChannelIds.has(parentId))
}

function isTicketChannel(msg: Message): boolean {
  if (!('parentId' in msg.channel)) return false
  const parentId = (msg.channel as { parentId?: string | null }).parentId
  return (
    (!!TICKET_OPEN_CATEGORY_ID && parentId === TICKET_OPEN_CATEGORY_ID) ||
    (!!TICKET_CLOSED_CATEGORY_ID && parentId === TICKET_CLOSED_CATEGORY_ID)
  )
}

function extractUrls(text: string): string[] {
  const urlRe = /https?:\/\/[^\s)]+/gi
  const matches = text.match(urlRe) || []
  return [...new Set(matches)] // deduplicate
}

function parsePartnershipIntakeAnswers(text: string): { parsed: boolean; answers: string[] } {
  // Check if this looks like answers to the intake questions (numbered format or contains question markers)
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

  // Check for numbered format (1. 2. 3.) or direct answers to questions
  const isNumberedFormat = /^[12]\s*\.|\b(?:1st|2nd|3rd)\b|^1\s*[-:)]|^2\s*[-:)]/i.test(text)
  const mentionsCollaboration = /collaborat|partnership|integrat|co-develop|joint|together/i.test(
    text,
  )

  if ((isNumberedFormat || mentionsCollaboration) && lines.length >= 2) {
    // Try to extract answer blocks
    const answers: string[] = []
    let currentAnswer = ''

    for (const line of lines) {
      // Look for numbered lines or section breaks
      if (/^[12][\s.\-:)]/i.test(line)) {
        if (currentAnswer) answers.push(currentAnswer.trim())
        currentAnswer = line.replace(/^[12][\s.\-:)]*/, '').trim()
      } else if (/^(Anything else|Nope|No|Nothing)/i.test(line)) {
        if (currentAnswer) answers.push(currentAnswer.trim())
        currentAnswer = line.trim()
      } else {
        currentAnswer += (currentAnswer ? ' ' : '') + line
      }
    }
    if (currentAnswer) answers.push(currentAnswer.trim())

    return { parsed: answers.length >= 2, answers }
  }

  return { parsed: false, answers: [] }
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

  // Always respond if bot is mentioned (even in tickets)
  if (msg.mentions.users.has(botId)) return true

  // Allow responses in partnership tickets only (if staff hasn't engaged)
  if (isTicketChannel(msg)) {
    try {
      const ticket = await getTicketByChannel(msg.channel.id)
      if (ticket) {
        const normalizedReason = ticket.reason?.trim().toLowerCase()
        const isPartnership =
          normalizedReason === 'partnership' || normalizedReason === 'partnership/collaboration'
        // Only respond in partnership tickets if staff hasn't engaged yet
        return isPartnership && !ticket.staffEngaged
      }
    } catch {
      /* ignore */
    }
    return false
  }
  if (msg.reference?.messageId) {
    try {
      const ref = await msg.channel.messages.fetch(msg.reference.messageId)
      if (ref.author.id === botId) return true
    } catch {
      /* ignore */
    }
  }
  if (isActiveWindow(msg.author.id, msg.channel.id)) return true

  if (guildAiTicketCategoryIds.size > 0 && msg.guild) {
    try {
      const categoryId = await getGuildChannelCategoryId(msg.channel)
      if (categoryId && guildAiTicketCategoryIds.has(categoryId)) {
        const ticket = await getTicketByChannel(msg.channel.id)
        if (!ticket && (await isFirstMessageFromUserInChannel(msg))) {
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
function keywordContextFromHistory(
  turns: Turn[],
  latestUserText: string,
  maxPriorUser = 5,
): string {
  const userLines = turns.filter((t) => t.role === 'user').map((t) => t.content)
  const recent = userLines.slice(-maxPriorUser)
  return [...recent, latestUserText].join('\n')
}

const processing = new Set<string>()

/** Guild: user/channel ping-only body (e.g. "@Bot" with no other text). */
function isMentionOrChannelPingsOnlyMessage(msg: Message): boolean {
  const raw = msg.content ?? ''
  const withoutPings = raw
    .replace(/<@!?\d+>/g, '')
    .replace(/<@&\d+>/g, '')
    .replace(/<#[0-9]+>/g, '')
    .trim()
  if (withoutPings.length > 0) return false
  if (!raw.trim().length) return false
  return /<(?:@!?|@&|#)\d+>/.test(raw)
}

const lastMentionOnlyGuildPingAt = new Map<string, number>()
const MENTION_ONLY_DEDUPE_MS = 4_000

/**
 * Stops a second in-flight or near-simultaneous `messageCreate` (often with a
 * different id) from running another AI reply on the same "ping the bot" action.
 */
function shouldDebounceMentionOnlyGuildPing(msg: Message): boolean {
  if (msg.channel.type === ChannelType.DM) return true
  if (!isMentionOrChannelPingsOnlyMessage(msg)) return true
  const k = `${msg.channel.id}:${msg.author.id}`
  const now = Date.now()
  const prev = lastMentionOnlyGuildPingAt.get(k) ?? 0
  if (prev > 0 && now - prev < MENTION_ONLY_DEDUPE_MS) {
    console.info(
      `[messages] debounced duplicate mention-only guild ping (+${now - prev}ms) ch=${msg.channel.id} user=${msg.author.id} msg=${msg.id}`,
    )
    return false
  }
  lastMentionOnlyGuildPingAt.set(k, now)
  return true
}

export function registerMessageHandler(client: Client): void {
  client.on('messageCreate', async (msg: Message) => {
    // Soft-stop: when paused via dashboard, ignore everything
    if (isBotPaused()) return

    if (msg.guild && !msg.author.bot && msg.channel.type !== ChannelType.DM) {
      void touchTicketUserActivity(msg).catch(() => {})
      void markTicketStaffEngagedFromModMessage(msg).catch(() => {})

      if (isTicketChannel(msg)) {
        import('../services/ticket-copilot.ts')
          .then(({ handleTicketMessage }) => {
            void handleTicketMessage(msg).catch((err) => {
              console.error('[copilot] error in handleTicketMessage:', err)
            })
          })
          .catch((err) => {
            console.error('[copilot] failed to import ticket copilot:', err)
          })
      }

      // Relay a staff reply in a modmail channel back to the user's DMs.
      if (modmailEnabled) {
        const relayed = await import('../services/modmail.ts')
          .then(({ relayStaffMessage }) => relayStaffMessage(msg))
          .catch(() => false)
        if (relayed) return
      }
    }
    if (msg.channel.type === ChannelType.DM && !msg.author.bot) {
      console.log(`[DM] received from ${msg.author.tag}: "${msg.content?.slice(0, 80)}"`)
    }
    if (!shouldHandleMessage(msg)) return
    if (!msg.id) return
    if (processing.has(msg.id)) return
    processing.add(msg.id)

    try {
      const rawText = msg.content?.trim() || ''

      // Log message for analytics
      void logAnalyticsEvent({
        type: 'message',
        userId: msg.author.id,
        channelId: msg.channel.id,
        guildId: msg.guild?.id,
        data: { contentLength: rawText.length },
      }).catch(() => {})

      if (rawText && isPrefixCommand(rawText)) {
        try {
          await handlePrefixCommand(msg)
        } catch (e) {
          console.error('[prefix]', e)
        }
        return
      }

      // Modmail: if this DM user has an open session, relay to staff (skip AI).
      if (modmailEnabled && msg.channel.type === ChannelType.DM) {
        const relayed = await import('../services/modmail.ts')
          .then(({ relayUserDm }) => relayUserDm(client, msg))
          .catch(() => false)
        if (relayed) return
      }

      // Handle custom commands (e.g., !hello, !mycommand)
      if (rawText && rawText.startsWith('!')) {
        const cmdName = rawText.slice(1).split(/\s+/)[0] ?? ''
        const cmd = getCommand(cmdName)
        if (cmd) {
          try {
            const result = await executeCommand(cmdName)
            if (result.ok && result.response) {
              await msg.reply(result.response)
              void logAnalyticsEvent({
                type: 'custom_command',
                userId: msg.author.id,
                channelId: msg.channel.id,
                guildId: msg.guild?.id,
                data: { command: cmdName },
              }).catch(() => {})
              console.log(`[custom-command] executed ${cmdName} for ${msg.author.tag}`)
              return
            } else if (!result.ok) {
              await msg.reply(`${result.error || 'Command execution failed'}`)
              return
            }
          } catch (e) {
            console.error('[custom-command] execution failed:', e)
            await msg.reply('Error executing command')
            return
          }
        }
      }

      if (msg.guild && lockdownGuilds.has(msg.guild.id) && !isModMessage(msg)) {
        try {
          markBotMessageDelete({
            guildId: msg.guild.id,
            channelId: msg.channel.id,
            messageId: msg.id,
            actor: 'ND Bot · Lockdown',
            reason: 'Server lockdown deleted a non-staff message',
          })
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
      const zipAtt = pickFirstZipAttachment(msg.attachments)
      let zipSummary = ''
      if (zipAtt) {
        try {
          zipSummary = await summarizeZipAttachment(zipAtt)
        } catch (e) {
          console.warn('[zip] summary failed:', e)
          zipSummary = `[ZIP attached: ${zipAtt.name}] Could not inspect ZIP contents.`
        }
      }

      let ocrText = ''
      if (imageAtt) {
        try {
          console.log(`[ocr] preprocessing image attachment: ${imageAtt.name}`)
          const image = await fetchAttachmentAsBase64(imageAtt)
          ocrText = await performOcr(image)
          if (ocrText.trim()) {
            console.log(
              `[ocr] extracted ${ocrText.split('\n').length} lines of text from image attachment`,
            )
          }
        } catch (ocrErr) {
          console.warn('[ocr] preprocessing image failed:', ocrErr)
        }
      }
      if (!rawText && msg.attachments.size > 0 && !imageAtt && !zipAtt) {
        await msg.reply(
          'I can only use **image** attachments (PNG, JPEG, WebP, GIF) or **ZIP** files under the size limit. Add a caption or describe what you need in text.',
        )
        return
      }

      if (msg.channel.type !== ChannelType.DM) {
        const allowAi = await shouldRespondGuildAi(msg)
        if (!allowAi) return
      }

      if (!shouldDebounceMentionOnlyGuildPing(msg)) return

      // Skip profanity check in partnership tickets (business content)
      let skipProfanityCheck = false
      if (msg.guild && isTicketChannel(msg)) {
        try {
          const ticket = await getTicketByChannel(msg.channel.id)
          if (ticket) {
            const normalizedReason = ticket.reason?.trim().toLowerCase()
            skipProfanityCheck =
              normalizedReason === 'partnership' || normalizedReason === 'partnership/collaboration'
          }
        } catch {
          /* ignore */
        }
      }

      if (!skipProfanityCheck && containsProfanity(rawText, msg)) {
        console.warn('[profanity] blocked message from', msg.author.tag)
        await msg.reply({ embeds: [refusalEmbed()] })
        void reportProfanity(msg)
        if (msg.channel.type === ChannelType.DM) void logDmBlocked(msg)
        return
      }

      // Track user engagement and award achievements
      void (async () => {
        try {
          // Increment message count for this user
          const profile = await incrementMessageCount(msg.author.id)

          // Award first message badge
          await awardFirstMessageBadge(msg.author.id)

          // Get reputation and sync stats
          const rep = await getReputation(msg.author.id)
          await syncExternalStats(msg.author.id, profile.stats.level, rep?.points ?? 0)

          // Check for achievements
          await checkAndAwardAchievements(msg.author.id, {
            messages: profile.stats.messages,
            level: profile.stats.level,
            reputation: rep?.points ?? 0,
          })
        } catch (e) {
          console.warn('[profile] failed to update user profile:', e)
        }
      })().catch(() => {})

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
      const zipPromptSuffix = zipAtt ? `\n\n[ZIP attached: ${zipAtt.name}]\n${zipSummary}` : ''

      let displayPrompt: string
      if (ch.type === ChannelType.DM) {
        if (rawText && imageAtt) {
          displayPrompt = `${rawText}${multiImageNote}\n\n[Image attached: ${imageAtt.name}]${zipPromptSuffix}`
        } else if (imageAtt) {
          displayPrompt = `[Image: ${imageAtt.name}] User sent a screenshot with no text caption. Describe what you see and help with ND / FiveM support if relevant.${multiImageNote}${zipPromptSuffix}`
        } else {
          displayPrompt = `${rawText}${zipPromptSuffix}`
        }
      } else if (rawText && imageAtt) {
        displayPrompt = `[#${chLabel} from ${displayName}]: ${rawText}${multiImageNote}\n\n[Image attached: ${imageAtt.name}]${zipPromptSuffix}`
      } else if (imageAtt) {
        displayPrompt = `[#${chLabel} from ${displayName}]: (screenshot, no caption) Describe what you see and help with ND / FiveM support if relevant. [Image: ${imageAtt.name}]${multiImageNote}${zipPromptSuffix}`
      } else {
        displayPrompt = `[#${chLabel} from ${displayName}]: ${rawText}${zipPromptSuffix}`
      }

      const ticketTriage = await getTicketTriagePromptSuffix(msg)
      if (ticketTriage) {
        displayPrompt += ticketTriage
      }

      if (ocrText.trim()) {
        displayPrompt += `\n\n[Extracted OCR Text/Code from Screenshot]:\n\`\`\`\n${ocrText}\n\`\`\``
      }

      const userMemoryContent =
        rawText && imageAtt
          ? `${rawText}\n[Image: ${imageAtt.name}]${zipAtt ? `\n[ZIP: ${zipAtt.name}]` : ''}`
          : rawText ||
            (imageAtt ? `[Image: ${imageAtt.name}]` : '') ||
            (zipAtt ? `[ZIP: ${zipAtt.name}]` : '')

      const model = ch.type === ChannelType.DM ? modelDm : modelGuild
      const channelId = ch.id
      const prior = getHistory(channelId)
      const keywordBlob = keywordContextFromHistory(prior, userMemoryContent)

      // Skip coming soon check in tickets - keep the bot engaged
      const isInTicket = msg.guild && isTicketChannel(msg)
      if (!isInTicket) {
        const comingSoonProbe = [rawText, imageAtt?.name ?? '', zipAtt?.name ?? '']
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
          pushTurn(
            channelId,
            { role: 'user', content: userMemoryContent },
            CONVERSATION_HISTORY_LIMIT,
          )
          pushTurn(channelId, { role: 'model', content: reply }, CONVERSATION_HISTORY_LIMIT)
          if (ch.type === ChannelType.DM) void logDmExchange(msg, reply)
          if (msg.guild && ch.type !== ChannelType.DM) {
            void recordSupportExchange(msg.channel.id, userMemoryContent, reply)
          }
          return
        }
      }

      let augmented = await buildAugmentedUserContentAsync(
        displayPrompt,
        keywordBlob,
        'User message',
      )
      if (msg.guild) {
        const chExtra = channelPromptExtraByChannelId()[msg.channel.id]
        if (chExtra) {
          augmented = `${chExtra}\n\n${augmented}`
        }
      }

      // Add partnership research context for partnership tickets (only if staff hasn't engaged yet)
      if (msg.guild && isTicketChannel(msg)) {
        try {
          const ticket = await getTicketByChannel(msg.channel.id)
          if (ticket) {
            const normalizedReason = ticket.reason?.trim().toLowerCase()
            const isPartnership =
              normalizedReason === 'partnership' || normalizedReason === 'partnership/collaboration'
            if (isPartnership && !ticket.staffEngaged) {
              const urls = extractUrls(rawText)
              const urlsBlock =
                urls.length > 0
                  ? `\n\nRelevant links:\n${urls.map((u) => `- ${u}`).join('\n')}`
                  : ''

              // Check if intake questions have already been answered in prior conversation
              const priorText = prior
                .map((t) => t.content)
                .join(' ')
                .toLowerCase()
              const intakeAlreadyAnswered =
                /collaborat|partnership|integrat|co-develop|phase|scope|timeline|deliverable/i.test(
                  priorText,
                )

              // Try to parse structured intake answers from current message
              const { parsed: isParsedIntake, answers } = parsePartnershipIntakeAnswers(rawText)
              let intakeContext = ''

              if (isParsedIntake && answers.length >= 2) {
                intakeContext = `\n\n[Partnership Proposal Details]\n`
                if (answers[0]) intakeContext += `- Collaboration type: ${answers[0]}\n`
                if (answers[1]) intakeContext += `- Focus area/product: ${answers[1]}\n`
                if (answers[2]) intakeContext += `- Additional notes: ${answers[2]}\n`
                intakeContext += `\nUse these details to provide targeted engagement and follow-up questions about their specific proposal. Do NOT re-ask the intake questions.`
              } else if (intakeAlreadyAnswered) {
                // Intake has been discussed, focus on moving forward
                intakeContext = `\n\n[Partnership Already in Progress]\nThe initial intake questions have been discussed. Continue the technical discussion and proposal refinement. Do NOT ask the intake questions again.`
              }

              augmented += `\n\n[PARTNERSHIP TICKET - Full engagement mode]\nThis is a partnership/collaboration inquiry. Engage fully, professionally, and enthusiastically. Do not refuse or decline to help.${intakeContext}${urlsBlock}\nAsk specific follow-up questions about their proposal areas and show genuine interest. Be warm, professional, and collaborative in tone.\n\nIMPORTANT: Do NOT re-ask the intake questions once they have been answered. Progress the discussion forward. Do NOT suggest opening a new support ticket. Keep all discussion here. The Affiliate and Partner Manager has already been notified and will join this ticket directly, so do NOT say you are escalating this, forwarding it, or handing it off to the ND Support Team or any other team. Just continue helping and gathering details until they arrive.`
            }
          }
        } catch {
          /* ignore */
        }
      }

      // Append strict citation guidelines, Nightz Development brand rules, and emoji ban
      augmented += `\n\n[ADMINISTRATIVE DIRECTIVES]\n1. Use bracketed footnotes like [1], [2] to cite information from the provided vector context when referencing facts, docs, or code. Do NOT make up any citations.\n2. Maintain a strict professional corporate brand, representing Nightz Development (ND) administration. This is proprietary ND property.\n3. ZERO EMOJI MANDATE: Under no circumstances should any emojis or visual glyphs exist in your response. Strictly use text only.`

      if (ch.type !== ChannelType.DM) {
        touchActiveWindow(msg.author.id, msg.channel.id)
      }

      // Detect intent to optimize response strategy
      const intentAnalysis = await detectIntentAsync(rawText || userMemoryContent)
      console.log(
        `[intent] ${intentAnalysis.intent} (${Math.round(intentAnalysis.confidence * 100)}% confidence) from "${rawText.slice(0, 60)}${rawText.length > 60 ? '...' : ''}"`,
      )

      try {
        if ('sendTyping' in msg.channel) await msg.channel.sendTyping()

        const typingTimer = setInterval(() => {
          if ('sendTyping' in msg.channel) void (msg.channel as any).sendTyping()
        }, TYPING_INTERVAL_MS)

        let reply: string
        try {
          // Get preferred model based on intent analysis
          let preferredModel = getPreferredModelForIntent(intentAnalysis.intent)

          // High/critical tickets get Claude regardless of intent (better at empathy + careful answers).
          try {
            const ticketRec = await getTicketByChannel(msg.channel.id)
            if (
              ticketRec &&
              ticketRec.status === 'open' &&
              (ticketRec.priority === 'high' || ticketRec.priority === 'critical')
            ) {
              preferredModel = 'claude'
            }
          } catch {
            /* ignore */
          }

          const originalMode = await getAiProviderMode()
          const shouldOverride = preferredModel !== 'auto'

          if (shouldOverride) {
            await setAiProviderMode(preferredModel)
          }

          try {
            const provider = await getAiProviderMode()
            if (provider === 'gemini' || provider === 'auto') {
              const image = imageAtt ? await fetchAttachmentAsBase64(imageAtt) : undefined
              reply = await runUniversalAgentLoop(model.systemInstruction, prior, augmented, image)
            } else {
              if (imageAtt) {
                const image = await fetchAttachmentAsBase64(imageAtt)
                reply = await chatReplyWithImage(model, prior, augmented, image)
              } else {
                reply = await chatReply(model, prior, augmented)
              }
            }
          } finally {
            if (shouldOverride) {
              await setAiProviderMode(originalMode)
            }
          }
        } finally {
          clearInterval(typingTimer)
        }

        // Tickets get a longer, length-aware delay so replies feel typed, not
        // instant. Short answers still come back quickly. Keep the typing
        // indicator alive so the channel shows the bot is composing.
        const replyDelayMs = isInTicket ? ticketTypingDelay(reply) : typingDelay(reply)
        if (replyDelayMs > 0 && 'sendTyping' in msg.channel) {
          void (msg.channel as any).sendTyping()
        }
        await sleep(replyDelayMs)

        // Clean up response: remove --- separators and extra blank lines
        reply = reply
          .replace(/\n---+\n/g, '\n')
          .replace(/^---+\n/gm, '')
          .replace(/\n---+$/gm, '')
          .replace(/\n\n\n+/g, '\n\n')
          .trim()

        // Append the AI warning disclaimer as Discord subtext (small grey line)
        // ONLY to the outgoing message. The clean reply (without the disclaimer)
        // is what we store in conversation memory, so the model never sees its
        // own disclaimer in history and stops echoing it (which caused a
        // doubled warning).
        const outgoing =
          aiReplyDisclaimerEnabled && aiReplyDisclaimer
            ? `${reply}\n\n-# ${aiReplyDisclaimer}`
            : reply

        const parts = chunkText(outgoing)
        for (let i = 0; i < parts.length; i++) {
          const chunk = parts[i]!
          if (i === 0) await msg.reply({ content: chunk })
          else {
            await sleep(Math.min(2000, chunk.length * MS_PER_CHAR))
            if (msg.channel.isTextBased() && 'send' in msg.channel) {
              await msg.channel.send({ content: chunk })
            }
          }
        }
        pushTurn(
          channelId,
          { role: 'user', content: userMemoryContent },
          CONVERSATION_HISTORY_LIMIT,
        )
        pushTurn(channelId, { role: 'model', content: reply }, CONVERSATION_HISTORY_LIMIT)

        // Log AI response for analytics (including model routing info)
        void logAnalyticsEvent({
          type: 'ai_response',
          userId: msg.author.id,
          channelId: msg.channel.id,
          guildId: msg.guild?.id,
          data: {
            contentLength: reply.length,
            intent: intentAnalysis.intent,
            intentConfidence: Math.round(intentAnalysis.confidence * 100),
            preferredModel: getPreferredModelForIntent(intentAnalysis.intent),
          },
        }).catch(() => {})

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
          await msg.reply(await getPublicAiErrorMessage())
        } catch {
          /* ignore */
        }
      }
    } finally {
      processing.delete(msg.id)
    }
  })
}
