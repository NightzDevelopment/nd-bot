/**
 * Ticket Copilot Service
 * Developed under strict Nightz Development proprietary standards (no emojis)
 */

import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  Client,
  GuildMember,
  Interaction,
  Message,
  ModalSubmitInteraction,
  TextChannel,
} from 'discord.js'
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js'
import { ticketLogChannelId, ticketSystemEnabled } from '../config.ts'
import { isGuildMod } from '../utils/permissions.ts'
import { readJson, writeJson } from './data-store.ts'
import { generateOnce, getModel } from './gemini.ts'
import { getDb } from './nd-db.ts'
import { getTicketByChannel, type TicketRecord, updateTicketPartial } from './ticket-store.ts'
import { runUniversalAgentLoop } from './universal-nd-expert.ts'

const DATA_DIR = process.env.DATA_DIR || './data'

/**
 * Runtime toggle for the "AI Draft Suggestion" copilot. When OFF (default),
 * the bot does not post draft-for-approval suggestions to the staff log; the
 * normal in-ticket AI triage messages still work. Toggle with `nd!copilotdrafts`.
 */
type CopilotSettings = { draftsEnabled: boolean; updatedAt: number; updatedBy?: string }
const COPILOT_SETTINGS_FILE = 'ticket-copilot-settings.json'
const COPILOT_DEFAULT: CopilotSettings = { draftsEnabled: false, updatedAt: 0 }
let copilotCache: CopilotSettings | null = null

async function loadCopilotSettings(): Promise<CopilotSettings> {
  if (copilotCache) return copilotCache
  const raw = await readJson<CopilotSettings>(COPILOT_SETTINGS_FILE, COPILOT_DEFAULT)
  copilotCache = {
    draftsEnabled: Boolean(raw.draftsEnabled),
    updatedAt: raw.updatedAt || 0,
    ...(raw.updatedBy ? { updatedBy: raw.updatedBy } : {}),
  }
  return copilotCache
}

export async function getCopilotDraftsEnabled(): Promise<boolean> {
  return (await loadCopilotSettings()).draftsEnabled
}

export async function setCopilotDraftsEnabled(
  enabled: boolean,
  updatedBy?: string,
): Promise<boolean> {
  const next: CopilotSettings = {
    draftsEnabled: enabled,
    updatedAt: Date.now(),
    ...(updatedBy ? { updatedBy } : {}),
  }
  copilotCache = next
  await writeJson(COPILOT_SETTINGS_FILE, next)
  return enabled
}

/**
 * Handle new messages in ticket channels to generate AI draft suggestions
 */
export async function handleTicketMessage(msg: Message): Promise<void> {
  if (!ticketSystemEnabled) return
  // AI Draft Suggestions are off by default. Toggle with `nd!copilotdrafts on`.
  if (!(await getCopilotDraftsEnabled())) return
  if (msg.author.bot) return
  if (msg.channel.type === ChannelType.DM) return

  // Check if channel is an open ticket channel
  const ticket = await getTicketByChannel(msg.channel.id)
  if (!ticket || ticket.status !== 'open') return

  // Skip if message is from a moderator/staff
  const member = msg.member
  if (member && isGuildMod(member)) return

  // We have a user message in a ticket. Let's trigger the copilot!
  try {
    // 1. Fetch recent messages for context
    const limit = 15
    const discordMessages = await msg.channel.messages.fetch({ limit })
    const sortedMsgs = [...discordMessages.values()].reverse()
    const prior: any[] = sortedMsgs.slice(0, -1).map((m) => ({
      role: m.author.id === ticket.userId ? 'user' : 'model',
      content: m.content,
    }))
    const latestQuery = sortedMsgs[sortedMsgs.length - 1]?.content || ''

    // 2. Query Gemini to generate a draft response using the universal agent loop
    const systemPrompt = `You are the Support Copilot developed exclusively for Nightz Development. 
You draft professional, technical, extremely helpful support responses for staff to review. 
Do not use any emojis. Focus on technical accuracy, clarity, and professionalism. 
Identify the customer's issues and provide a complete resolution draft.`

    const draftText = await runUniversalAgentLoop(systemPrompt, prior, latestQuery, undefined, {
      userId: msg.author.id,
      ...(msg.guild?.id ? { guildId: msg.guild.id } : {}),
      ...(msg.member ? { member: msg.member } : {}),
    })
    if (!draftText || !draftText.trim()) return

    // 3. Find log channel and message to host/post thread
    const logChannelId = ticketLogChannelId
    if (!logChannelId) return

    const logChannel = (await msg.client.channels.fetch(logChannelId)) as TextChannel | null
    if (!logChannel || !logChannel.isTextBased()) return

    // Get or start thread on log message
    let thread = null
    if (ticket.logMessageId) {
      try {
        const logMsg = await logChannel.messages.fetch(ticket.logMessageId)
        if (logMsg) {
          if (logMsg.thread) {
            thread = logMsg.thread
          } else {
            thread = await logMsg.startThread({
              name: `copilot-ticket-${ticket.id}`,
              autoArchiveDuration: 1440,
            })
          }
        }
      } catch (err) {
        console.error(
          '[copilot] failed to start thread on log message, sending to main channel:',
          err,
        )
      }
    }

    const target = thread || logChannel

    // 4. Send draft message
    const embed = new EmbedBuilder()
      .setColor(0x3b82f6)
      .setTitle(`AI Draft Suggestion for Ticket #${ticket.id}`)
      .setDescription(draftText.slice(0, 4000))
      .setTimestamp()
      .setFooter({ text: `Nightz Development Support Copilot · Ticket: #${ticket.id}` })

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`ndticket:copilot_approve:${msg.channel.id}`)
        .setLabel('[Approve & Send]')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`ndticket:copilot_edit:${msg.channel.id}`)
        .setLabel('[Edit Draft]')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`ndticket:copilot_reject:${msg.channel.id}`)
        .setLabel('[Decline]')
        .setStyle(ButtonStyle.Danger),
    )

    await target.send({
      content: `[AI Copilot Draft] New customer message in <#${msg.channel.id}>:`,
      embeds: [embed],
      components: [row],
    })
  } catch (err) {
    console.error('[copilot] draft generation failed:', err)
  }
}

/**
 * Handle copilot button interactions
 */
export async function tryHandleCopilotButton(interaction: Interaction): Promise<boolean> {
  if (!interaction.isButton()) return false

  const customId = interaction.customId
  if (!customId.startsWith('ndticket:copilot_')) return false

  const parts = customId.split(':')
  const action = parts[1]
  const channelId = parts[2]
  if (!channelId) return false

  const ticket = await getTicketByChannel(channelId)
  if (!ticket) {
    await interaction.reply({
      content: '[ERROR] Ticket record not found in system.',
      flags: 64, // Ephemeral
    })
    return true
  }

  // Verify moderator permissions
  const member = interaction.member as GuildMember
  if (!member || !isGuildMod(member)) {
    await interaction.reply({
      content: '[ERROR] You do not have permissions to manage copilot drafts.',
      flags: 64, // Ephemeral
    })
    return true
  }

  // Handle actions
  if (action === 'copilot_reject') {
    // Disable buttons and update message
    const message = interaction.message
    const baseEmbed = message.embeds[0]
    const updatedEmbeds = baseEmbed
      ? [
          EmbedBuilder.from(baseEmbed)
            .setColor(0xef4444)
            .setFooter({ text: `Draft declined by ${interaction.user.tag}` }),
        ]
      : []

    await interaction.update({
      content: `[AI Copilot Draft] Declined by ${interaction.user.tag}.`,
      embeds: updatedEmbeds,
      components: [],
    })
    return true
  }

  if (action === 'copilot_approve') {
    const message = interaction.message
    const draftText = message.embeds[0]?.description
    if (!draftText) {
      await interaction.reply({
        content: '[ERROR] Draft text could not be loaded.',
        flags: 64, // Ephemeral
      })
      return true
    }

    try {
      // Send draft to customer ticket channel
      const customerChannel = (await interaction.client.channels.fetch(
        channelId,
      )) as TextChannel | null
      if (customerChannel) {
        await customerChannel.send(draftText)

        // Update staff view
        const baseEmbed = message.embeds[0]
        const updatedEmbeds = baseEmbed
          ? [
              EmbedBuilder.from(baseEmbed)
                .setColor(0x10b981)
                .setFooter({
                  text: `Approved and sent by ${interaction.user.tag}`,
                }),
            ]
          : []

        await interaction.update({
          content: `[AI Copilot Draft] Approved and sent to ticket channel by ${interaction.user.tag}.`,
          embeds: updatedEmbeds,
          components: [],
        })
      } else {
        throw new Error('Customer channel not found.')
      }
    } catch (err) {
      await interaction.reply({
        content: `[ERROR] Failed to send response: ${err instanceof Error ? err.message : String(err)}`,
        flags: 64, // Ephemeral
      })
    }
    return true
  }

  if (action === 'copilot_edit') {
    const message = interaction.message
    const draftText = message.embeds[0]?.description || ''

    const modal = new ModalBuilder()
      .setCustomId(`ndticket:copilot_edit_modal:${channelId}`)
      .setTitle('Edit AI Support Draft')

    const input = new TextInputBuilder()
      .setCustomId('copilot_text')
      .setLabel('Edit draft content (no emojis)')
      .setStyle(TextInputStyle.Paragraph)
      .setValue(draftText.slice(0, 1900))
      .setRequired(true)
      .setMaxLength(2000)

    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input))
    await interaction.showModal(modal)
    return true
  }

  return false
}

/**
 * Handle copilot modal submissions
 */
export async function tryHandleCopilotModal(interaction: ModalSubmitInteraction): Promise<boolean> {
  const customId = interaction.customId
  if (!customId.startsWith('ndticket:copilot_edit_modal:')) return false

  const channelId = customId.split(':').pop()!
  const editedText = interaction.fields.getTextInputValue('copilot_text')?.trim()

  if (!editedText) {
    await interaction.reply({
      content: '[ERROR] Message body cannot be empty.',
      flags: 64, // Ephemeral
    })
    return true
  }

  try {
    const customerChannel = (await interaction.client.channels.fetch(
      channelId,
    )) as TextChannel | null
    if (customerChannel) {
      await customerChannel.send(editedText)

      // Update interaction
      await interaction.reply({
        content: 'Edited draft successfully sent to the ticket channel.',
        flags: 64, // Ephemeral
      })

      // Since the button interaction is different from the modal submit,
      // we might want to update the original thread message if we can find it.
      // Let's attempt to update the thread message components/embed.
      const baseEmbed = interaction.message?.embeds[0]
      if (interaction.message && baseEmbed) {
        const updatedEmbed = EmbedBuilder.from(baseEmbed)
          .setColor(0x10b981)
          .setDescription(editedText)
          .setFooter({ text: `Edited and sent by ${interaction.user.tag}` })

        await interaction.message
          .edit({
            content: `[AI Copilot Draft] Edited and sent by ${interaction.user.tag}.`,
            embeds: [updatedEmbed],
            components: [],
          })
          .catch(() => {})
      }
    } else {
      throw new Error('Customer channel not found.')
    }
  } catch (err) {
    await interaction.reply({
      content: `[ERROR] Failed to send edited response: ${err instanceof Error ? err.message : String(err)}`,
      flags: 64, // Ephemeral
    })
  }

  return true
}

/**
 * AI Post-Mortem Ticket Summarizer
 * Generates a beautiful markdown summary of the resolved ticket, saving it locally.
 */
export async function generateAndSavePostMortem(
  client: Client,
  ticket: TicketRecord,
  messages: any[],
  closedByTag: string,
  closeNotes: string,
): Promise<void> {
  try {
    const contextLines = messages
      .map((m) => {
        const role = m.authorId === ticket.userId ? 'User' : 'Staff/Bot'
        return `[${role}] ${m.authorTag ?? m.authorId}: ${m.content}`
      })
      .join('\n')

    const systemPrompt = `You are the Support Post-Mortem Engineer for Nightz Development. 
Analyze the support ticket conversation and write a professional, highly detailed post-mortem report in markdown.
Do not use any emojis. Focus on the core issue raised, troubleshooting steps, and final resolution. 
Provide a clear timeline.`

    const modelRef = getModel(systemPrompt)
    const prompt = `Here is the full conversation history of ticket #${ticket.id} which has just been closed by ${closedByTag}.
Notes from closing: ${closeNotes || 'none'}
\`\`\`
${contextLines}
\`\`\`
Generate a complete, professional markdown post-mortem report.`

    const report = await generateOnce(modelRef, prompt)
    if (!report || !report.trim()) return

    // Save to local markdown file
    const dir = join(DATA_DIR, 'tickets')
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true })
    }

    const filePath = join(dir, `resolved-${ticket.id}.md`)
    await writeFile(filePath, report, 'utf8')
    console.log(`[copilot] saved ticket #${ticket.id} post-mortem to ${filePath}`)

    // Post to staff archive/log channel
    const logChannelId = ticketLogChannelId
    if (logChannelId) {
      const logChannel = await client.channels.fetch(logChannelId)
      if (logChannel?.isSendable()) {
        const fileAttachment = {
          attachment: Buffer.from(report),
          name: `resolved-postmortem-${ticket.id}.md`,
        }
        await logChannel
          .send({
            content: `[AI Post-Mortem] Support ticket #${ticket.id} has been fully documented and summarized.`,
            files: [fileAttachment],
          })
          .catch(() => {})
      }
    }
  } catch (err) {
    console.error('[copilot] post-mortem generation failed:', err)
  }
}
