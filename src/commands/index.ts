import {
  AuditLogEvent,
  type ButtonInteraction,
  ChannelType,
  type ChatInputCommandInteraction,
  type Client,
  EmbedBuilder,
  Events,
  type GuildMember,
  type Interaction,
  MessageFlags,
  type TextChannel,
} from 'discord.js'
import {
  aiMonitoringNotice,
  automodPublicBlurb,
  claudeEnabled,
  claudeFallbackModels,
  claudeModel,
  geminiFallbackModels,
  MODEL_ID,
  openaiEnabled,
  openaiFallbackModels,
  openaiModel,
  productAliasUrls,
  reportCooldownMs,
  reportMaxBodyLength,
  SYSTEM_PROMPT_DM,
  SYSTEM_PROMPT_GUILD,
  safetyExtraMarkdown,
  scamCheckExtraTrustedHosts,
  slashCommandsGuildId,
  ticketSystemEnabled,
  WELCOME_TICKET_CHANNEL_ID,
} from '../config.ts'
import { consumeTranslateSlot } from '../handlers/prefix.ts'
import { handleAfkSlash } from '../services/afk.ts'
import {
  type AiProviderMode,
  getAiProviderState,
  setAiProviderMode,
} from '../services/ai-provider.ts'
import { checkClaudeAvailability } from '../services/claude-client.ts'
import { buildAugmentedUserContentAsync } from '../services/context-bundle.ts'
import { handleCountersSlash } from '../services/counter-channels.ts'
import { addCommand } from '../services/custom-commands.ts'
import { fetchDiscordAuditLogs } from '../services/discord-audit.ts'
import {
  claimDaily,
  claimWork,
  commitCrime,
  commitHeist,
  deposit,
  fish,
  gamble,
  getBalance,
  getCooldowns,
  hunt,
  mine,
  richestUsers,
  rob,
  transfer,
  withdraw,
} from '../services/economy-store.ts'
import { searchFaq } from '../services/faq.ts'
import {
  checkOpenAiAvailability,
  generateOnce,
  getModel,
  getPublicAiErrorMessage,
} from '../services/gemini.ts'
import { buildHealthSummary } from '../services/health.ts'
import {
  handleLeaderboardSlash,
  handleLevelResetSlash,
  handleLevelRoleSlash,
  handleRankSlash,
} from '../services/levels.ts'
import { reportUserReport } from '../services/logging.ts'
import { getMacroBody, listMacroKeys, setMacro } from '../services/macros-store.ts'
import { clearChannel } from '../services/memory.ts'
import { addCase, listCasesForGuild } from '../services/mod-cases-store.ts'
import { addWarning } from '../services/moderation.ts'
import { handlePollsSlash } from '../services/polls-slash.ts'
import { containsProfanity } from '../services/profanity.ts'
import { handleShopSlash } from '../services/shop.ts'
import { formatProductLookupReply } from '../services/store-catalog.ts'
import {
  buildStoreCommandBody,
  formatStoreHealthOneLiner,
  lookupProductsFromSnapshot,
} from '../services/store-snapshot.ts'
import { tryHandleTicketButton } from '../services/ticket-handoff.ts'
import { listOpenTickets } from '../services/ticket-store.ts'
import {
  formatOpenTicketsList,
  formatTicketStatsLine,
  type OpenTicketsListOptions,
  setTicketStaffNote,
  tryHandleTicketSystem,
} from '../services/ticket-system.ts'
import { addWarning as addDashboardWarning } from '../services/warnings.ts'
import { formatModAutomodStatus } from '../utils/automod-status-text.ts'
import { chunkText } from '../utils/chunk.ts'
import { isComingSoonTopic, randomComingSoonReply } from '../utils/coming-soon.ts'
import { rollDiceSpec } from '../utils/dice.ts'
import { ndEmbed, refusalEmbed } from '../utils/embed.ts'
import { buildHelpEmbed } from '../utils/help-text.ts'
import { packageVersion } from '../utils/package-version.ts'
import { isGuildMod } from '../utils/permissions.ts'
import { takeReportSlot } from '../utils/report-cooldown.ts'
import { buildServerInfoEmbed } from '../utils/server-info.ts'
import { formatSupportLinksMarkdown } from '../utils/support-links.ts'
import { buildUserInfoEmbed } from '../utils/user-info.ts'
import { handleAchievementsSlash, handleProfileSlash, handleReputationSlash } from './community.ts'
import { slashCommands } from './definitions.ts'
import { handleUserNoteSlash, handleWarningsSlash } from './moderation.ts'

const modelDm = getModel(SYSTEM_PROMPT_DM)
const modelGuild = getModel(SYSTEM_PROMPT_GUILD)

export async function registerSlashCommands(client: Client): Promise<void> {
  const app = client.application
  if (!app) return
  const n = slashCommands.length
  if (slashCommandsGuildId) {
    const g = await client.guilds.fetch(slashCommandsGuildId).catch(() => null)
    if (g) {
      await g.commands.set(slashCommands)
      console.log(
        `[commands] registered ${n} slash commands to guild ${slashCommandsGuildId} (SLASH_COMMANDS_GUILD_ID; instant). Unset to register globally.`,
      )
      return
    }
    console.warn(
      `[commands] SLASH_COMMANDS_GUILD_ID ${slashCommandsGuildId} not reachable; falling back to global registration`,
    )
  }
  await app.commands.set(slashCommands)
  console.log(
    `[commands] registered ${n} slash commands (global; new/updated commands can take up to about an hour to appear in every server)`,
  )
}

async function replyWithReceipt(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  title: string,
  result: { ok: boolean; amount: number; msg: string; balance?: number },
  isSuccess: boolean,
  ephemeral: boolean = true,
) {
  const isButton = interaction.isButton()

  if (!result.ok) {
    if (isButton) {
      await (interaction as ButtonInteraction).followUp({
        content: result.msg,
        flags: MessageFlags.Ephemeral,
      })
    } else {
      await interaction.reply({
        content: result.msg,
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      })
    }
    return
  }

  if (!isButton) {
    await (interaction as ChatInputCommandInteraction).deferReply({
      flags: ephemeral ? MessageFlags.Ephemeral : undefined,
    })
  } else {
    if (!interaction.deferred && !interaction.replied) {
      await (interaction as ButtonInteraction).deferUpdate()
    }
  }

  try {
    const { getBalance } = await import('../services/economy-store.ts')
    const balanceRec = await getBalance(interaction.user.id)
    const avatarUrl = interaction.user.displayAvatarURL({ extension: 'png', size: 128 })

    const { generateReceiptCard } = await import('../services/receipt-card.ts')
    const buffer = await generateReceiptCard({
      userId: interaction.user.id,
      username: interaction.user.username,
      avatarUrl,
      title,
      description: result.msg.replace(/^\[[A-Z]+\]\s*/, ''),
      amount: result.amount,
      balance: balanceRec.balance,
      isSuccess,
    })

    const { AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = await import(
      'discord.js'
    )
    const file = new AttachmentBuilder(buffer, { name: `receipt-${interaction.user.id}.png` })

    // Determine repeatable commands and build quick-action repeat buttons
    let action: string | null = null
    let label = ''
    if (title === 'WORK TRANSACTION') {
      action = 'work'
      label = '[Work Again]'
    } else if (title === 'CRIME DISPATCH') {
      action = 'crime'
      label = '[Commit Crime]'
    } else if (title === 'HEIST BREACH') {
      action = 'heist'
      label = '[Attempt Heist]'
    } else if (title === 'HUNT VENTURE') {
      action = 'hunt'
      label = '[Hunt Again]'
    } else if (title === 'FISHING EXPEDITION') {
      action = 'fish'
      label = '[Fish Again]'
    } else if (title === 'MINING EXCAVATION') {
      action = 'mine'
      label = '[Mine Again]'
    }

    const components: any[] = []
    if (action) {
      const repeatButton = new ButtonBuilder()
        .setCustomId(`econ_repeat_${action}_${interaction.user.id}`)
        .setLabel(label)
        .setStyle(ButtonStyle.Primary)
      components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(repeatButton))
    }

    await interaction.editReply({ files: [file], components })
  } catch (err) {
    console.error('[receipt] Error generating card receipt, falling back to text:', err)
    await interaction.editReply({ content: result.msg, components: [] })
  }
}

export function registerInteractionHandler(client: Client): void {
  client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    // Soft-stop: when paused via dashboard, ignore everything
    const { isBotPaused } = await import('../dashboard/runtime-state.ts')
    if (isBotPaused()) {
      try {
        if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: 'The bot is currently paused by an operator. Please try again shortly.',
            flags: MessageFlags.Ephemeral,
          })
        }
      } catch {
        /* ignore */
      }
      return
    }

    if (interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit()) {
      const handled = await tryHandleTicketSystem(interaction)
      if (handled) return
    }

    if (interaction.isButton() || interaction.isModalSubmit()) {
      const { tryHandleAppealInteraction } = await import('../services/appeals.ts')
      const handled = await tryHandleAppealInteraction(interaction)
      if (handled) return
    }

    if (interaction.isButton()) {
      const { tryHandleModmailInteraction } = await import('../services/modmail.ts')
      const handled = await tryHandleModmailInteraction(interaction)
      if (handled) return
    }

    if (interaction.isButton()) {
      const handled = await tryHandleTicketButton(interaction)
      if (handled) return

      const customId = interaction.customId

      if (customId.startsWith('econ_repeat_')) {
        const parts = customId.split('_')
        const action = parts[2]
        const targetUserId = parts[3]

        if (interaction.user.id !== targetUserId) {
          await interaction.reply({
            content: '[ERROR] This receipt is not yours to repeat!',
            flags: MessageFlags.Ephemeral,
          })
          return
        }

        try {
          let result: any
          let title = ''
          let isSuccess = false

          if (action === 'work') {
            const { claimWork } = await import('../services/economy-store.ts')
            result = await claimWork(targetUserId)
            title = 'WORK TRANSACTION'
            isSuccess = result.ok
          } else if (action === 'crime') {
            const { commitCrime } = await import('../services/economy-store.ts')
            result = await commitCrime(targetUserId)
            title = 'CRIME DISPATCH'
            isSuccess = result.result === 'success'
          } else if (action === 'heist') {
            const { commitHeist } = await import('../services/economy-store.ts')
            result = await commitHeist(targetUserId)
            title = 'HEIST BREACH'
            isSuccess = result.result === 'success'
          } else if (action === 'hunt') {
            const { hunt } = await import('../services/economy-store.ts')
            result = await hunt(targetUserId)
            title = 'HUNT VENTURE'
            isSuccess = result.ok
          } else if (action === 'fish') {
            const { fish } = await import('../services/economy-store.ts')
            result = await fish(targetUserId)
            title = 'FISHING EXPEDITION'
            isSuccess = result.ok
          } else if (action === 'mine') {
            const { mine } = await import('../services/economy-store.ts')
            result = await mine(targetUserId)
            title = 'MINING EXCAVATION'
            isSuccess = result.ok
          }

          if (result) {
            await replyWithReceipt(interaction, title, result, isSuccess, false)
          }
        } catch (err) {
          console.error('[econ-repeat] Error executing repeat action:', err)
          try {
            await interaction.reply({
              content: '[ERROR] Something went wrong executing that action.',
              flags: MessageFlags.Ephemeral,
            })
          } catch {
            await interaction
              .followUp({
                content: '[ERROR] Something went wrong executing that action.',
                flags: MessageFlags.Ephemeral,
              })
              .catch(() => {})
          }
        }
        return
      }
      if (customId.startsWith('bj_hit_') || customId.startsWith('bj_stand_')) {
        const parts = customId.split('_')
        const action = parts[1] // 'hit' or 'stand'
        const targetUserId = parts[2]

        if (interaction.user.id !== targetUserId) {
          await interaction.reply({
            content: '[ERROR] You cannot control this blackjack session.',
            flags: MessageFlags.Ephemeral,
          })
          return
        }

        const { blackjackHit, blackjackStand, calculateHandValue } = await import(
          '../services/casino.ts'
        )

        await interaction.deferUpdate()

        let result
        if (action === 'hit') {
          result = await blackjackHit(targetUserId)
        } else {
          result = await blackjackStand(targetUserId)
        }

        if (!result.success) {
          await interaction.followUp({
            content: `[ERROR] ${result.msg}`,
            flags: MessageFlags.Ephemeral,
          })
          return
        }

        const session = result.session
        if (session) {
          const pScore = calculateHandValue(session.playerHand)
          let dScore = calculateHandValue(session.dealerHand.slice(0, 1))
          if (session.status !== 'playing') {
            dScore = calculateHandValue(session.dealerHand)
          }

          const { generateBlackjackCard } = await import('../services/casino-card.ts')
          const buffer = await generateBlackjackCard({
            username: interaction.user.username,
            playerHand: session.playerHand,
            dealerHand: session.dealerHand,
            playerScore: pScore,
            dealerScore: dScore,
            bet: session.bet,
            status: session.status,
          })

          const { AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = await import(
            'discord.js'
          )
          const attachment = new AttachmentBuilder(buffer, { name: 'blackjack.png' })

          if (session.status === 'playing') {
            const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
              new ButtonBuilder()
                .setCustomId(`bj_hit_${targetUserId}`)
                .setLabel('[Hit]')
                .setStyle(ButtonStyle.Primary),
              new ButtonBuilder()
                .setCustomId(`bj_stand_${targetUserId}`)
                .setLabel('[Stand]')
                .setStyle(ButtonStyle.Secondary),
            )
            await interaction.editReply({ embeds: [], components: [row], files: [attachment] })
          } else {
            await interaction.editReply({
              content: result.msg,
              embeds: [],
              components: [],
              files: [attachment],
            })
          }
        } else {
          await interaction.editReply({ content: result.msg, embeds: [], components: [] })
        }
        return
      }
    }

    // Autocomplete for ticket templates
    if (interaction.isAutocomplete()) {
      try {
        if (
          interaction.commandName === 'ticketreply' ||
          interaction.commandName === 'tickettemplates'
        ) {
          const focused = interaction.options.getFocused(true)
          if (focused.name === 'template' || focused.name === 'key') {
            const { searchTemplateKeys } = await import('../services/ticket-templates.ts')
            const keys = await searchTemplateKeys(String(focused.value || ''))
            await interaction.respond(keys.map((k) => ({ name: k, value: k })))
            return
          }
        }
      } catch (e) {
        console.warn('[autocomplete] error:', e)
      }
      return
    }

    if (!interaction.isChatInputCommand()) return

    const { commandName, options } = interaction

    try {
      if (commandName === 'polls') {
        await handlePollsSlash(interaction)
        return
      }

      if (commandName === 'counters') {
        await handleCountersSlash(interaction)
        return
      }

      if (
        (await handleRankSlash(interaction)) ||
        (await handleLeaderboardSlash(interaction)) ||
        (await handleLevelResetSlash(interaction)) ||
        (await handleLevelRoleSlash(interaction)) ||
        (await handleShopSlash(interaction)) ||
        (await handleAfkSlash(interaction))
      ) {
        return
      }

      if (commandName === 'help') {
        await interaction.reply({ embeds: [buildHelpEmbed()], flags: MessageFlags.Ephemeral })
        return
      }

      if (commandName === 'clear') {
        clearChannel(interaction.channelId)
        await interaction.reply({
          content: 'Conversation memory cleared for this channel.',
          flags: MessageFlags.Ephemeral,
        })
        return
      }

      if (commandName === 'faq') {
        const q = options.getString('search')
        const matches = searchFaq(q)
        if (matches.length === 0) {
          await interaction.reply({
            content: q
              ? `No FAQ entries matching "${q}".`
              : 'No FAQ loaded. Set `FAQ_CHANNEL_ID` and pin messages in that channel.',
            flags: MessageFlags.Ephemeral,
          })
          return
        }
        const body = matches.slice(0, 10).join('\n\n---\n\n').slice(0, 3500)
        const embed = ndEmbed()
          .setTitle('FAQ')
          .setDescription(body || '(empty)')
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral })
        return
      }

      if (commandName === 'serverinfo') {
        if (!interaction.guild) {
          await interaction.reply({ content: 'Use in a server.', flags: MessageFlags.Ephemeral })
          return
        }
        const embed = await buildServerInfoEmbed(interaction.guild)
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral })
        return
      }

      if (commandName === 'userinfo') {
        const user = options.getUser('user') ?? interaction.user
        let member = interaction.guild?.members.cache.get(user.id) ?? null
        if (interaction.guild) {
          member = await interaction.guild.members.fetch(user.id).catch(() => member)
        }
        const embed = await buildUserInfoEmbed(user, member)
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral })
        return
      }

      if (commandName === 'warn') {
        if (!interaction.guild || !interaction.member) {
          await interaction.reply({ content: 'Use in a server.', flags: MessageFlags.Ephemeral })
          return
        }
        const m = await interaction.guild.members.fetch(interaction.user.id)
        if (!isGuildMod(m)) {
          await interaction.reply({ content: 'No permission.', flags: MessageFlags.Ephemeral })
          return
        }
        const target = options.getUser('user', true)
        const reason = options.getString('reason')?.trim() || 'No reason given'
        const list = await addWarning(interaction.guild.id, target.id, {
          at: Date.now(),
          reason,
          moderatorId: interaction.user.id,
        })
        // Mirror to dashboard store so the Enforcement panel sees it
        await addDashboardWarning(target.id, interaction.user.id, reason).catch((e) => {
          console.warn('[warn] dashboard mirror failed:', e)
        })
        await interaction.reply({
          content: `Warned **${target.tag}** (${list.length} total).`,
          flags: MessageFlags.Ephemeral,
        })
        return
      }

      if (commandName === 'purge') {
        if (!interaction.guild || !interaction.channel?.isTextBased()) {
          await interaction.reply({
            content: 'Use in a text channel.',
            flags: MessageFlags.Ephemeral,
          })
          return
        }
        const m = await interaction.guild.members.fetch(interaction.user.id)
        if (!isGuildMod(m)) {
          await interaction.reply({ content: 'No permission.', flags: MessageFlags.Ephemeral })
          return
        }
        const n = options.getInteger('amount', true)
        const deleted = await interaction.channel.bulkDelete(n, true).catch(() => null)
        await interaction.reply({
          content: deleted ? `Deleted ${deleted.size} message(s).` : 'Failed.',
          flags: MessageFlags.Ephemeral,
        })
        return
      }

      if (commandName === 'translate') {
        const text = options.getString('text', true).trim()
        const limitMsg = consumeTranslateSlot(interaction.user.id)
        if (limitMsg) {
          await interaction.reply({ content: limitMsg, flags: MessageFlags.Ephemeral })
          return
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral })
        const prompt = `Translate to natural English. Output ONLY the translation, no quotes.\n\n${text.slice(0, 3500)}`
        const mini = getModel('You only output direct translations.')
        const out = await generateOnce(mini, prompt)
        await interaction.editReply(`**English:** ${out.slice(0, 3800)}`)
        return
      }

      if (commandName === 'ping') {
        const t0 = Date.now()
        await interaction.reply({
          content: 'Pong…',
          fetchReply: true,
          flags: MessageFlags.Ephemeral,
        })
        const ws = interaction.client.ws.ping
        const upSec = Math.max(1, Math.floor(process.uptime()))
        const um =
          upSec < 3600
            ? `${Math.floor(upSec / 60)}m ${upSec % 60}s`
            : upSec < 86400
              ? `${Math.floor(upSec / 3600)}h ${Math.floor((upSec % 3600) / 60)}m`
              : `${Math.floor(upSec / 86400)}d ${Math.floor((upSec % 86400) / 3600)}h`
        const v = packageVersion()
        await interaction.editReply(
          `**nd-bot** \`v${v}\` · \`${MODEL_ID}\`\n` +
            `Round-trip **${Date.now() - t0}**ms · gateway **${ws}**ms · uptime **${um}**\n` +
            `${formatStoreHealthOneLiner()}\n` +
            `If replies duplicate, stop extra \`bun run src/bot.ts\` — use **one** PM2 (or dev) task only.`,
        )
        return
      }

      if (commandName === 'store') {
        await interaction.reply({
          content: buildStoreCommandBody(),
          flags: MessageFlags.Ephemeral,
        })
        return
      }

      if (commandName === 'links') {
        const body = formatSupportLinksMarkdown()
        await interaction.reply({
          embeds: [ndEmbed().setTitle('Support links').setDescription(body)],
          flags: MessageFlags.Ephemeral,
        })
        return
      }

      if (commandName === 'ticket') {
        let line = WELCOME_TICKET_CHANNEL_ID
          ? `**Open a ticket:** go to <#${WELCOME_TICKET_CHANNEL_ID}> → pick a **category** → **Open Ticket**.`
          : '**Support:** ask staff where the ticket panel is for this server.'
        if (ticketSystemEnabled && interaction.guildId) {
          const n = (await listOpenTickets(interaction.guildId)).length
          line += `\n\n**Open tickets (queue):** ${n}`
        }
        await interaction.reply({ content: line.slice(0, 2000), flags: MessageFlags.Ephemeral })
        return
      }

      if (commandName === 'tickets') {
        if (!interaction.guild) {
          await interaction.reply({ content: 'Use in a server.', flags: MessageFlags.Ephemeral })
          return
        }
        const m = await interaction.guild.members.fetch(interaction.user.id)
        if (!isGuildMod(m)) {
          await interaction.reply({ content: 'Moderator only.', flags: MessageFlags.Ephemeral })
          return
        }
        const filterOpt = options.getString('filter')
        const listOpts: OpenTicketsListOptions = {
          filter:
            filterOpt === 'unclaimed' || filterOpt === 'claimed' || filterOpt === 'awaiting_staff'
              ? filterOpt
              : 'all',
          reasonContains: options.getString('reason_contains')?.trim() || undefined,
          sort: options.getString('sort') === 'newest_first' ? 'newest_first' : 'oldest_first',
        }
        const body = await formatOpenTicketsList(interaction.guild.id, listOpts)
        await interaction.reply({
          content: body.slice(0, 2000),
          flags: MessageFlags.Ephemeral,
        })
        return
      }

      if (commandName === 'ticketstats') {
        if (!interaction.guild) {
          await interaction.reply({ content: 'Use in a server.', flags: MessageFlags.Ephemeral })
          return
        }
        const m = await interaction.guild.members.fetch(interaction.user.id)
        if (!isGuildMod(m)) {
          await interaction.reply({ content: 'Moderator only.', flags: MessageFlags.Ephemeral })
          return
        }
        const line = await formatTicketStatsLine(interaction.guild.id)
        await interaction.reply({ content: line.slice(0, 2000), flags: MessageFlags.Ephemeral })
        return
      }

      if (commandName === 'ticketnote') {
        if (!interaction.guild || !interaction.channel || interaction.channel.isDMBased()) {
          await interaction.reply({
            content: 'Use this inside a **ticket channel** in the server.',
            flags: MessageFlags.Ephemeral,
          })
          return
        }
        const m = await interaction.guild.members.fetch(interaction.user.id)
        if (!isGuildMod(m)) {
          await interaction.reply({ content: 'Moderator only.', flags: MessageFlags.Ephemeral })
          return
        }
        const note = options.getString('note')?.trim() ?? ''
        const out = await setTicketStaffNote(interaction.channel as TextChannel, m, note)
        await interaction.reply({ content: out.slice(0, 2000), flags: MessageFlags.Ephemeral })
        return
      }

      if (commandName === 'ticketreply') {
        if (
          !interaction.guild ||
          !interaction.channel ||
          interaction.channel.isDMBased() ||
          !interaction.channel.isTextBased()
        ) {
          await interaction.reply({
            content: 'Use this inside a **ticket channel**.',
            flags: MessageFlags.Ephemeral,
          })
          return
        }
        const m = await interaction.guild.members.fetch(interaction.user.id)
        if (!isGuildMod(m)) {
          await interaction.reply({ content: 'Moderator only.', flags: MessageFlags.Ephemeral })
          return
        }
        const key = options.getString('template', true).trim()
        const { getTemplate } = await import('../services/ticket-templates.ts')
        const tpl = await getTemplate(key)
        if (!tpl) {
          await interaction.reply({
            content: `No template with key \`${key}\`.`,
            flags: MessageFlags.Ephemeral,
          })
          return
        }
        // Post the template body publicly in the channel
        const ch = interaction.channel as TextChannel
        await ch.send({ content: tpl.body.slice(0, 2000) })
        await interaction.reply({
          content: `Posted template \`${key}\`.`,
          flags: MessageFlags.Ephemeral,
        })
        return
      }

      if (commandName === 'tickettemplates') {
        if (!interaction.guild) {
          await interaction.reply({ content: 'Use in a server.', flags: MessageFlags.Ephemeral })
          return
        }
        const m = await interaction.guild.members.fetch(interaction.user.id)
        if (!isGuildMod(m)) {
          await interaction.reply({ content: 'Moderator only.', flags: MessageFlags.Ephemeral })
          return
        }
        const sub = options.getSubcommand()
        const tpls = await import('../services/ticket-templates.ts')

        if (sub === 'list') {
          const list = await tpls.listTemplates()
          if (list.length === 0) {
            await interaction.reply({
              content: 'No templates saved.',
              flags: MessageFlags.Ephemeral,
            })
            return
          }
          const lines = list.map(
            (t) => `• \`${t.key}\` — ${t.title}${t.category ? ` _(${t.category})_` : ''}`,
          )
          await interaction.reply({
            content: lines.join('\n').slice(0, 1900),
            flags: MessageFlags.Ephemeral,
          })
          return
        }
        if (sub === 'add') {
          const key = options.getString('key', true).trim().toLowerCase().replace(/\s+/g, '-')
          const title = options.getString('title', true).trim()
          const body = options.getString('body', true)
          const category = options.getString('category')?.trim() || undefined
          await tpls.setTemplate({
            key,
            title,
            body,
            category,
            createdAt: Date.now(),
            createdBy: interaction.user.id,
          })
          await interaction.reply({
            content: `Saved template \`${key}\`.`,
            flags: MessageFlags.Ephemeral,
          })
          return
        }
        if (sub === 'delete') {
          const key = options.getString('key', true).trim()
          const removed = await tpls.deleteTemplate(key)
          await interaction.reply({
            content: removed ? `Deleted template \`${key}\`.` : `No template with key \`${key}\`.`,
            flags: MessageFlags.Ephemeral,
          })
          return
        }
        return
      }

      if (commandName === 'ticketpriority') {
        if (!interaction.guild || !interaction.channel || interaction.channel.isDMBased()) {
          await interaction.reply({
            content: 'Use this inside a **ticket channel** in the server.',
            flags: MessageFlags.Ephemeral,
          })
          return
        }
        const m = await interaction.guild.members.fetch(interaction.user.id)
        if (!isGuildMod(m)) {
          await interaction.reply({ content: 'Moderator only.', flags: MessageFlags.Ephemeral })
          return
        }
        const level = options.getString('level', true) as 'critical' | 'high' | 'normal' | 'low'
        const channelId = interaction.channel.id
        const { getTicketByChannel, updateTicketPartial } = await import(
          '../services/ticket-store.ts'
        )
        const { PRIORITY_LABEL, formatSlaTarget } = await import('../services/ticket-priority.ts')
        const cur = await getTicketByChannel(channelId)
        if (!cur) {
          await interaction.reply({
            content: 'This channel is not a tracked ticket.',
            flags: MessageFlags.Ephemeral,
          })
          return
        }
        await updateTicketPartial(channelId, { priority: level })
        await interaction.reply({
          content: `Priority set to ${PRIORITY_LABEL[level]} (SLA ${formatSlaTarget(level)}).`,
          flags: MessageFlags.Ephemeral,
        })
        return
      }

      if (commandName === 'search') {
        const q = options.getString('query')
        const matches = searchFaq(q)
        if (matches.length === 0) {
          await interaction.reply({
            content: q ? `No FAQ entries matching "${q}".` : 'No FAQ loaded. Set `FAQ_CHANNEL_ID`.',
            flags: MessageFlags.Ephemeral,
          })
          return
        }
        const body = matches.slice(0, 10).join('\n\n---\n\n').slice(0, 3500)
        await interaction.reply({
          embeds: [
            ndEmbed()
              .setTitle('FAQ search')
              .setDescription(body || '(empty)'),
          ],
          flags: MessageFlags.Ephemeral,
        })
        return
      }

      if (commandName === 'product') {
        const name = options.getString('name', true).trim()
        const key = name.toUpperCase().replace(/[^A-Z0-9_]/g, '')
        const aliasUrl = productAliasUrls.get(key)
        if (aliasUrl) {
          await interaction.reply({
            content: `**${name}** (manual alias) → ${aliasUrl}`,
            flags: MessageFlags.Ephemeral,
          })
          return
        }
        const hits = lookupProductsFromSnapshot(name)
        await interaction.reply({
          content: formatProductLookupReply(name, hits),
          flags: MessageFlags.Ephemeral,
        })
        return
      }

      if (commandName === 'roll') {
        const spec = options.getString('dice')?.trim() || '1d20'
        await interaction.reply({ content: rollDiceSpec(spec), flags: MessageFlags.Ephemeral })
        return
      }

      if (commandName === 'choose') {
        const raw = options.getString('options', true)
        const opts = raw
          .split(/[|,]/g)
          .map((s) => s.trim())
          .filter(Boolean)
        if (opts.length < 2) {
          await interaction.reply({
            content: 'Give at least two options separated by commas or |.',
            flags: MessageFlags.Ephemeral,
          })
          return
        }
        const pick = opts[Math.floor(Math.random() * opts.length)]!
        await interaction.reply({ content: `I choose: **${pick}**`, flags: MessageFlags.Ephemeral })
        return
      }

      if (commandName === 'safety') {
        const base =
          '• Use Discord’s **Safety** tools: open Settings, then Privacy and Safety.\n' +
          '• **Block** and **report** users/messages in-app.\n' +
          '• Staff will **never** ask for your password or 2FA codes.\n' +
          '• Official Discord safety: https://discord.com/safety'
        const extra = safetyExtraMarkdown ? `\n\n${safetyExtraMarkdown.slice(0, 1500)}` : ''
        await interaction.reply({
          embeds: [
            ndEmbed()
              .setTitle('Safety')
              .setDescription(base + extra),
          ],
          flags: MessageFlags.Ephemeral,
        })
        return
      }

      if (commandName === 'scamtips') {
        const body =
          '• **Fake Nitro / Steam / “free Robux”** links: only trust official domains.\n' +
          '• **“Verify your account”** DMs are scams; never paste tokens.\n' +
          '• **Fake staff:** real staff have roles here; we won’t DM you first for credentials.\n' +
          '• When in doubt, **don’t click**; open a ticket.'
        await interaction.reply({
          embeds: [ndEmbed().setTitle('Scam awareness').setDescription(body)],
          flags: MessageFlags.Ephemeral,
        })
        return
      }

      if (commandName === 'privacy') {
        await interaction.reply({
          content:
            'This bot may log **support conversations** and **moderation flags** in channels configured by the server owner (e.g. staff log). Do not send passwords or secrets in chat.\n\n' +
            aiMonitoringNotice,
          flags: MessageFlags.Ephemeral,
        })
        return
      }

      if (commandName === 'report') {
        if (!interaction.guild) {
          await interaction.reply({
            content: 'Use this in a server.',
            flags: MessageFlags.Ephemeral,
          })
          return
        }
        const details = options.getString('details', true).trim()
        if (details.length > reportMaxBodyLength) {
          await interaction.reply({ content: 'Details too long.', flags: MessageFlags.Ephemeral })
          return
        }
        if (!takeReportSlot(interaction.user.id, reportCooldownMs)) {
          await interaction.reply({
            content: 'You can submit another report after a cooldown.',
            flags: MessageFlags.Ephemeral,
          })
          return
        }
        const category = options.getString('category', true)
        await interaction.reply({
          content: 'Report sent to staff. Thank you.',
          flags: MessageFlags.Ephemeral,
        })
        await reportUserReport(
          { tag: interaction.user.tag, id: interaction.user.id },
          category,
          details,
          interaction.guild.name,
          interaction.guild.id,
          `https://discord.com/channels/${interaction.guild.id}/${interaction.channelId}`,
        )
        return
      }

      if (commandName === 'automod_public') {
        await interaction.reply({
          embeds: [ndEmbed().setTitle('Automated moderation').setDescription(automodPublicBlurb)],
          flags: MessageFlags.Ephemeral,
        })
        return
      }

      if (commandName === 'scam_check') {
        const text = options.getString('text', true).trim().slice(0, 2000)
        if (containsProfanity(text)) {
          await interaction.reply({ embeds: [refusalEmbed()], flags: MessageFlags.Ephemeral })
          return
        }
        const hostMatch = text.match(/https?:\/\/([^/\s]+)/i)
        if (hostMatch) {
          const host = hostMatch[1]!.toLowerCase().split(':')[0]!
          if (scamCheckExtraTrustedHosts.has(host)) {
            await interaction.reply({
              content:
                'That hostname is on **SCAM_CHECK_EXTRA_TRUSTED_HOSTS** for this bot (treated as a known-good domain for checks).',
              flags: MessageFlags.Ephemeral,
            })
            return
          }
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral })
        const mini = getModel('You only output short risk assessments.')
        const prompt = `Is this message likely a scam or safe? Reply in 2-4 sentences. Not legal advice. Message:\n\n${text}`
        const out = await generateOnce(mini, prompt)
        await interaction.editReply(
          `${out.slice(0, 3500)}\n\n_When in doubt, do not click links or send tokens; ask staff._`,
        )
        return
      }

      if (commandName === 'tldr') {
        const text = options.getString('text', true).trim().slice(0, 4000)
        if (containsProfanity(text)) {
          await interaction.reply({ embeds: [refusalEmbed()], flags: MessageFlags.Ephemeral })
          return
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral })
        const mini = getModel('You write short neutral summaries.')
        const out = await generateOnce(
          mini,
          `Summarize in one short paragraph, plain language:\n\n${text}`,
        )
        await interaction.editReply(out.slice(0, 3900))
        return
      }

      if (commandName === 'mod_automod') {
        if (!interaction.guild || !interaction.member) {
          await interaction.reply({ content: 'Use in a server.', flags: MessageFlags.Ephemeral })
          return
        }
        const m = await interaction.guild.members.fetch(interaction.user.id)
        if (!isGuildMod(m)) {
          await interaction.reply({ content: 'Moderator only.', flags: MessageFlags.Ephemeral })
          return
        }
        await interaction.reply({
          content: formatModAutomodStatus().slice(0, 3900),
          flags: MessageFlags.Ephemeral,
        })
        return
      }

      if (commandName === 'ai_model') {
        const selected = options.getString('provider') as AiProviderMode | null
        const state = await getAiProviderState()
        const [openaiHealth, claudeHealth] = await Promise.all([
          openaiEnabled
            ? checkOpenAiAvailability()
            : Promise.resolve({
                ok: false,
                reason: 'disabled' as const,
                detail: 'OpenAI is disabled (`OPENAI_API_KEY` is not set).',
              }),
          claudeEnabled
            ? checkClaudeAvailability()
            : Promise.resolve({
                ok: false,
                reason: 'disabled' as const,
                detail: 'Claude is disabled (`CLAUDE_API_KEY` is not set).',
              }),
        ])

        const available = [
          `Current mode: **${state.mode}**`,
          ``,
          `**Gemini**`,
          `Primary: \`${MODEL_ID}\``,
          `Fallbacks: ${geminiFallbackModels.length ? geminiFallbackModels.map((m) => `\`${m}\``).join(', ') : '(none)'}`,
          ``,
          `**Claude**`,
          `Provider: ${claudeEnabled ? `enabled (\`${claudeModel}\`)` : 'disabled'}`,
          `Fallbacks: ${claudeEnabled && claudeFallbackModels.length ? claudeFallbackModels.map((m) => `\`${m}\``).join(', ') : '(none)'}`,
          `Status: ${claudeHealth.ok ? 'online' : claudeEnabled ? 'offline' : 'disabled'}`,
          `Details: ${claudeHealth.detail}`,
          ``,
          `**OpenAI**`,
          `Provider: ${openaiEnabled ? `enabled (\`${openaiModel}\`)` : 'disabled'}`,
          `Fallbacks: ${openaiFallbackModels.length ? openaiFallbackModels.map((m) => `\`${m}\``).join(', ') : '(none)'}`,
          `Status: ${openaiHealth.ok ? 'online' : openaiEnabled ? 'offline' : 'disabled'}`,
          `Details: ${openaiHealth.detail}`,
        ].join('\n')

        if (!selected) {
          await interaction.reply({
            content: available.slice(0, 1900),
            flags: MessageFlags.Ephemeral,
          })
          return
        }
        if (!interaction.guild) {
          await interaction.reply({
            content: 'Use this command in a server (moderator only).',
            flags: MessageFlags.Ephemeral,
          })
          return
        }
        const m = await interaction.guild.members.fetch(interaction.user.id)
        if (!isGuildMod(m)) {
          await interaction.reply({ content: 'Moderator only.', flags: MessageFlags.Ephemeral })
          return
        }
        if (selected === 'openai' && !openaiEnabled) {
          await interaction.reply({
            content: 'OpenAI provider is disabled in `.env` (`OPENAI_API_KEY` not set).',
            flags: MessageFlags.Ephemeral,
          })
          return
        }
        if (selected === 'openai' && !openaiHealth.ok) {
          await interaction.reply({
            content: `Cannot switch to **openai** right now.\n${openaiHealth.detail}`.slice(
              0,
              1900,
            ),
            flags: MessageFlags.Ephemeral,
          })
          return
        }
        if (selected === 'claude' && !claudeEnabled) {
          await interaction.reply({
            content: 'Claude provider is disabled in `.env` (`CLAUDE_API_KEY` not set).',
            flags: MessageFlags.Ephemeral,
          })
          return
        }
        if (selected === 'claude' && !claudeHealth.ok) {
          await interaction.reply({
            content: `Cannot switch to **claude** right now.\n${claudeHealth.detail}`.slice(
              0,
              1900,
            ),
            flags: MessageFlags.Ephemeral,
          })
          return
        }
        const next = await setAiProviderMode(selected, interaction.user.id)
        await interaction.reply({
          content:
            `AI provider mode set to **${next.mode}**.\n\nUse \`/ai_model\` (no provider arg) to see full status.`.slice(
              0,
              1900,
            ),
          flags: MessageFlags.Ephemeral,
        })
        return
      }

      if (commandName === 'status') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral })
        await interaction.editReply((await buildHealthSummary(interaction.client)).slice(0, 1900))
        return
      }

      if (commandName === 'macro') {
        if (!interaction.guild) {
          await interaction.reply({ content: 'Use in a server.', flags: MessageFlags.Ephemeral })
          return
        }
        const mem = await interaction.guild.members.fetch(interaction.user.id)
        if (!isGuildMod(mem)) {
          await interaction.reply({ content: 'Moderator only.', flags: MessageFlags.Ephemeral })
          return
        }
        const sub = options.getSubcommand(true)
        if (sub === 'list') {
          const keys = await listMacroKeys()
          await interaction.reply({
            content: keys.length
              ? `**Macros:** ${keys.map((k) => `\`${k}\``).join(', ')}`
              : 'No macros yet. Use `/macro set`.',
            flags: MessageFlags.Ephemeral,
          })
          return
        }
        if (sub === 'run') {
          const name = options.getString('name', true).trim().toLowerCase()
          const body = await getMacroBody(name)
          if (!body) {
            await interaction.reply({ content: 'Unknown macro.', flags: MessageFlags.Ephemeral })
            return
          }
          if (!interaction.channel?.isTextBased()) {
            await interaction.reply({
              content: 'Use in a text channel.',
              flags: MessageFlags.Ephemeral,
            })
            return
          }
          await interaction.deferReply({ flags: MessageFlags.Ephemeral })
          await (interaction.channel as TextChannel).send(body.slice(0, 2000))
          await interaction.editReply('Posted.')
          return
        }
        if (sub === 'set') {
          const name = options.getString('name', true).trim().toLowerCase()
          const text = options.getString('text', true)
          await setMacro(name, text)
          await interaction.reply({
            content: `Saved macro \`${name}\`.`,
            flags: MessageFlags.Ephemeral,
          })
        }
        return
      }

      if (commandName === 'case') {
        if (!interaction.guild) {
          await interaction.reply({ content: 'Use in a server.', flags: MessageFlags.Ephemeral })
          return
        }
        const mem = await interaction.guild.members.fetch(interaction.user.id)
        if (!isGuildMod(mem)) {
          await interaction.reply({ content: 'Moderator only.', flags: MessageFlags.Ephemeral })
          return
        }
        const sub = options.getSubcommand(true)
        if (sub === 'list') {
          const list = await listCasesForGuild(interaction.guild.id, 15)
          if (list.length === 0) {
            await interaction.reply({ content: 'No cases logged.', flags: MessageFlags.Ephemeral })
            return
          }
          const lines = list.map(
            (c) => `**#${c.id}** · <@${c.targetId}> · ${c.action} · _${c.reason.slice(0, 80)}_`,
          )
          await interaction.reply({
            content: lines.join('\n').slice(0, 1900),
            flags: MessageFlags.Ephemeral,
          })
          return
        }
        if (sub === 'add') {
          const u = options.getUser('user', true)
          const action = options.getString('action', true)
          const reason = options.getString('reason', true)
          const c = await addCase({
            guildId: interaction.guild.id,
            targetId: u.id,
            targetTag: u.tag,
            moderatorId: interaction.user.id,
            moderatorTag: interaction.user.tag,
            action,
            reason,
            at: Date.now(),
          })
          await interaction.reply({
            content: `Logged case **#${c.id}**.`,
            flags: MessageFlags.Ephemeral,
          })
        }
        return
      }

      if (commandName === 'slowmode') {
        if (!interaction.guild) {
          await interaction.reply({ content: 'Use in a server.', flags: MessageFlags.Ephemeral })
          return
        }
        const mem = await interaction.guild.members.fetch(interaction.user.id)
        if (!isGuildMod(mem)) {
          await interaction.reply({ content: 'Moderator only.', flags: MessageFlags.Ephemeral })
          return
        }
        const seconds = options.getInteger('seconds', true)
        const chOpt = options.getChannel('channel')
        const ch = (chOpt?.isTextBased() ? chOpt : interaction.channel) as TextChannel | null
        if (!ch?.isTextBased()) {
          await interaction.reply({ content: 'Invalid channel.', flags: MessageFlags.Ephemeral })
          return
        }
        await ch.setRateLimitPerUser(seconds)
        await interaction.reply({
          content: `Slowmode set to **${seconds}s** in ${ch}.`,
          flags: MessageFlags.Ephemeral,
        })
        return
      }

      if (commandName === 'ask') {
        const question = options.getString('question', true).trim()
        if (containsProfanity(question)) {
          await interaction.reply({ embeds: [refusalEmbed()], flags: MessageFlags.Ephemeral })
          return
        }

        if (isComingSoonTopic(question)) {
          const scope = interaction.channel?.id ?? `dm:${interaction.user.id}`
          await interaction.reply({
            content: randomComingSoonReply(scope),
            flags: MessageFlags.Ephemeral,
          })
          return
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral })

        const prompt = await buildAugmentedUserContentAsync(question, question, 'Question')

        const model = interaction.channel?.type === ChannelType.DM ? modelDm : modelGuild
        const text = await generateOnce(model, prompt)
        const chunks = chunkText(text)
        await interaction.editReply({ content: chunks[0] ?? '(empty)' })
        for (let i = 1; i < chunks.length; i++) {
          await interaction.followUp({ content: chunks[i], flags: MessageFlags.Ephemeral })
        }
        return
      }

      if (commandName === 'addcommand') {
        const name = options.getString('name', true).trim()
        const response = options.getString('response', true)
        const result = await addCommand(name, response, interaction.user.id)
        if (result.ok) {
          await interaction.reply({
            content: `[SUCCESS] Custom command \`!${name}\` created! Use it with \`!${name}\` in any channel.`,
            flags: MessageFlags.Ephemeral,
          })
        } else {
          await interaction.reply({
            content: `[ERROR] ${result.error || 'Failed to create command'}`,
            flags: MessageFlags.Ephemeral,
          })
        }
        return
      }

      if (commandName === 'listcommands') {
        const { generateHelpText } = await import('../services/custom-commands.ts')
        const helpText = generateHelpText()
        await interaction.reply({
          content: helpText || 'No custom commands yet. Use `/addcommand` to create one!',
          flags: MessageFlags.Ephemeral,
        })
        return
      }

      if (commandName === 'delcommand') {
        const name = options.getString('name', true).trim()
        const { deleteCommand } = await import('../services/custom-commands.ts')
        const result = await deleteCommand(name, interaction.user.id)
        if (result.ok) {
          await interaction.reply({
            content: `[SUCCESS] Custom command \`!${name}\` deleted.`,
            flags: MessageFlags.Ephemeral,
          })
        } else {
          await interaction.reply({
            content: `[ERROR] ${result.error || 'Failed to delete command'}`,
            flags: MessageFlags.Ephemeral,
          })
        }
        return
      }

      // Community commands
      if (commandName === 'reputation') {
        if (await handleReputationSlash(interaction)) return
      }

      if (commandName === 'profile') {
        if (await handleProfileSlash(interaction)) return
      }

      if (commandName === 'achievements') {
        if (await handleAchievementsSlash(interaction)) return
      }

      // Moderation commands
      if (commandName === 'warnings') {
        if (await handleWarningsSlash(interaction)) return
      }

      if (commandName === 'usernote') {
        if (await handleUserNoteSlash(interaction)) return
      }

      if (commandName === 'dossier') {
        if (!interaction.isChatInputCommand()) return
        if (!isGuildMod(interaction.member as GuildMember | null)) {
          await interaction.reply({
            content: 'This command is for staff only.',
            flags: MessageFlags.Ephemeral,
          })
          return
        }
        if (!interaction.guild) {
          await interaction.reply({ content: 'Use this in a server.', flags: MessageFlags.Ephemeral })
          return
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral })
        const target = interaction.options.getUser('user', true)
        const { buildDossier, formatDossierEmbed } = await import('../services/user-dossier.ts')
        const dossier = await buildDossier(interaction.guild.id, target.id)
        await interaction.editReply({ embeds: [formatDossierEmbed(dossier, target.tag)] })
        return
      }

      if (commandName === 'auditlog') {
        if (!interaction.isChatInputCommand()) return
        if (!isGuildMod(interaction.member)) {
          await interaction.reply({
            content: 'This command is for staff only.',
            flags: MessageFlags.Ephemeral,
          })
          return
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral })
        const targetUser = interaction.options.getUser('user', false)
        const actionFilter = interaction.options.getString('action', false)
        const limit = interaction.options.getInteger('limit', false) ?? 10

        const ACTION_FILTER_MAP: Record<string, number[]> = {
          ban: [AuditLogEvent.MemberBanAdd, AuditLogEvent.MemberBanRemove],
          kick: [AuditLogEvent.MemberKick],
          role: [AuditLogEvent.MemberRoleUpdate],
          message_delete: [AuditLogEvent.MessageDelete, AuditLogEvent.MessageBulkDelete],
          channel: [
            AuditLogEvent.ChannelCreate,
            AuditLogEvent.ChannelUpdate,
            AuditLogEvent.ChannelDelete,
          ],
          permission: [
            AuditLogEvent.ChannelOverwriteCreate,
            AuditLogEvent.ChannelOverwriteUpdate,
            AuditLogEvent.ChannelOverwriteDelete,
            AuditLogEvent.RoleUpdate,
            AuditLogEvent.RoleCreate,
            AuditLogEvent.RoleDelete,
          ],
        }

        const actionCodes = actionFilter ? ACTION_FILTER_MAP[actionFilter] : undefined
        const client = interaction.client

        let entries: Awaited<ReturnType<typeof fetchDiscordAuditLogs>> = []
        if (actionCodes && actionCodes.length > 1) {
          // Fetch each action type and merge+sort
          const results = await Promise.all(
            actionCodes.map((code) =>
              fetchDiscordAuditLogs(client, {
                guildId: interaction.guildId ?? undefined,
                limit,
                actionCode: code,
                userId: targetUser?.id,
                bust: true,
              }),
            ),
          )
          entries = results
            .flat()
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, limit)
        } else {
          entries = await fetchDiscordAuditLogs(client, {
            guildId: interaction.guildId ?? undefined,
            limit,
            actionCode: actionCodes?.[0],
            userId: targetUser?.id,
            bust: true,
          })
        }

        if (!entries.length) {
          await interaction.editReply({
            content: 'No audit log entries found for the given filters.',
          })
          return
        }

        const lines = entries.slice(0, 15).map((e) => {
          const ts = `<t:${Math.floor(e.createdAt / 1000)}:R>`
          const exec = e.executor ? `**${e.executor.tag}**` : 'Unknown'
          const tgt = e.target ? ` → ${e.target.tag}` : ''
          const reason = e.reason ? ` — *${e.reason.slice(0, 60)}*` : ''
          return `${ts} ${exec}${tgt}: ${e.action}${reason}`
        })

        const embed = new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle('Discord Audit Log')
          .setDescription(lines.join('\n'))
          .setFooter({
            text: `Showing ${entries.slice(0, 15).length} of ${entries.length} entries`,
          })
          .setTimestamp()

        if (targetUser)
          embed.setAuthor({
            name: `Filtered by: ${targetUser.tag}`,
            iconURL: targetUser.displayAvatarURL(),
          })

        await interaction.editReply({ embeds: [embed] })
        return
      }

      // Economy commands
      if (commandName === 'balance') {
        const target = options.getUser('user') ?? interaction.user
        const rec = await getBalance(target.id)
        const embed = ndEmbed()
          .setTitle(`${target.username}'s NDC Balance`)
          .addFields(
            { name: 'Wallet', value: `**${rec.balance.toLocaleString()} NDC**`, inline: true },
            { name: 'Bank', value: `**${rec.bank.toLocaleString()} NDC**`, inline: true },
            {
              name: 'Total',
              value: `**${(rec.balance + rec.bank).toLocaleString()} NDC**`,
              inline: true,
            },
            {
              name: 'Lifetime Earned',
              value: `${rec.totalEarned.toLocaleString()} NDC`,
              inline: false,
            },
          )
          .setColor(0xf5c542)
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral })
        return
      }

      if (commandName === 'daily') {
        const result = await claimDaily(interaction.user.id)
        await replyWithReceipt(interaction, 'DAILY REWARD', result, result.ok)
        return
      }

      if (commandName === 'work') {
        const result = await claimWork(interaction.user.id)
        await replyWithReceipt(interaction, 'WORK TRANSACTION', result, result.ok)
        return
      }

      if (commandName === 'deposit') {
        const amount = options.getInteger('amount', true)
        const result = await deposit(interaction.user.id, amount)
        await interaction.reply({ content: result.msg, flags: MessageFlags.Ephemeral })
        return
      }

      if (commandName === 'withdraw') {
        const amount = options.getInteger('amount', true)
        const result = await withdraw(interaction.user.id, amount)
        await interaction.reply({ content: result.msg, flags: MessageFlags.Ephemeral })
        return
      }

      if (commandName === 'pay') {
        const target = options.getUser('user', true)
        if (target.id === interaction.user.id) {
          await interaction.reply({
            content: "You can't pay yourself.",
            flags: MessageFlags.Ephemeral,
          })
          return
        }
        const amount = options.getInteger('amount', true)
        const result = await transfer(interaction.user.id, target.id, amount)
        const msg = result.ok ? `${result.msg} to **${target.username}**.` : result.msg
        await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral })
        return
      }

      if (commandName === 'gamble') {
        const bet = options.getInteger('bet', true)
        const result = await gamble(interaction.user.id, bet)
        await interaction.reply({ content: result.msg })
        return
      }

      if (commandName === 'rob') {
        if (!interaction.guild) {
          await interaction.reply({ content: 'Use in a server.', flags: MessageFlags.Ephemeral })
          return
        }
        const target = options.getUser('user', true)
        if (target.id === interaction.user.id) {
          await interaction.reply({
            content: "You can't rob yourself.",
            flags: MessageFlags.Ephemeral,
          })
          return
        }
        const result = await rob(interaction.user.id, target.id)
        await replyWithReceipt(interaction, 'ROBBERY REGISTER', result, result.ok, false)
        return
      }

      if (commandName === 'crime') {
        const result = await commitCrime(interaction.user.id)
        await replyWithReceipt(interaction, 'CRIME DISPATCH', result, result.result === 'success')
        return
      }

      if (commandName === 'heist') {
        const result = await commitHeist(interaction.user.id)
        await replyWithReceipt(
          interaction,
          'HEIST BREACH',
          result,
          result.result === 'success',
          false,
        )
        return
      }

      if (commandName === 'hunt') {
        const result = await hunt(interaction.user.id)
        await replyWithReceipt(interaction, 'HUNT VENTURE', result, result.ok)
        return
      }

      if (commandName === 'fish') {
        const result = await fish(interaction.user.id)
        await replyWithReceipt(interaction, 'FISHING EXPEDITION', result, result.ok)
        return
      }

      if (commandName === 'mine') {
        const result = await mine(interaction.user.id)
        await replyWithReceipt(interaction, 'MINING EXCAVATION', result, result.ok)
        return
      }

      if (commandName === 'cooldowns') {
        const cooldowns = await getCooldowns(interaction.user.id)
        const formatRemaining = (ms: number): string => {
          if (ms === 0) return '[READY] **Ready!**'
          const h = Math.floor(ms / 3_600_000)
          const m = Math.floor((ms % 3_600_000) / 60_000)
          const s = Math.floor((ms % 60_000) / 1000)
          if (h > 0) return `[COOLDOWN] ${h}h ${m}m`
          if (m > 0) return `[COOLDOWN] ${m}m ${s}s`
          return `[COOLDOWN] ${s}s`
        }
        const labels: Record<string, string> = {
          daily: '[DAILY]',
          work: '[WORK]',
          crime: '[CRIME]',
          heist: '[HEIST]',
          hunt: '[HUNT]',
          fish: '[FISH]',
          mine: '[MINE]',
        }
        const lines = cooldowns.map(
          (c) =>
            `${labels[c.command] || '•'} \`/${c.command}\` — ${formatRemaining(c.remainingMs)}`,
        )
        const embed = ndEmbed()
          .setTitle('Your Economy Cooldowns')
          .setDescription(lines.join('\n'))
          .setColor(0x60a5fa)
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral })
        return
      }

      if (commandName === 'economy') {
        const sub = options.getSubcommand(true)
        if (sub === 'leaderboard') {
          const top = await richestUsers(10)
          if (!top.length) {
            await interaction.reply({
              content: 'No economy data yet.',
              flags: MessageFlags.Ephemeral,
            })
            return
          }
          const medals = ['[1ST]', '[2ND]', '[3RD]']
          const lines = top.map((r, i) => {
            const m = medals[i] ?? `**${i + 1}.**`
            return `${m} <@${r.userId}> — **${r.total.toLocaleString()} NDC** (wallet: ${r.balance.toLocaleString()}, bank: ${r.bank.toLocaleString()})`
          })
          const embed = ndEmbed()
            .setTitle('NDC Richest Members')
            .setDescription(lines.join('\n'))
            .setColor(0xf5c542)
          await interaction.reply({ embeds: [embed] })
          return
        }
        if (sub === 'stats') {
          const rec = await getBalance(interaction.user.id)
          const embed = ndEmbed()
            .setTitle('Your Economy Stats')
            .addFields(
              { name: 'Wallet', value: `${rec.balance.toLocaleString()} NDC`, inline: true },
              { name: 'Bank', value: `${rec.bank.toLocaleString()} NDC`, inline: true },
              {
                name: 'Total',
                value: `${(rec.balance + rec.bank).toLocaleString()} NDC`,
                inline: true,
              },
              {
                name: 'Total Earned',
                value: `${rec.totalEarned.toLocaleString()} NDC`,
                inline: true,
              },
              {
                name: 'Last Daily',
                value: rec.lastDaily ? `<t:${Math.floor(rec.lastDaily / 1000)}:R>` : 'Never',
                inline: true,
              },
              {
                name: 'Last Work',
                value: rec.lastWork ? `<t:${Math.floor(rec.lastWork / 1000)}:R>` : 'Never',
                inline: true,
              },
            )
            .setColor(0xf5c542)
          await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral })
          return
        }
        return
      }

      if (commandName === 'stock') {
        const sub = options.getSubcommand(true)
        const { getStocks, getStock, buyStock, sellStock, getUserPortfolio, generateStockChart } =
          await import('../services/stock-market.ts')

        if (sub === 'list') {
          await interaction.deferReply({ flags: MessageFlags.Ephemeral })
          const stocks = getStocks()
          const lines = stocks.map((s) => {
            return `• **${s.symbol}** (${s.name}) — **${s.price.toFixed(2)} NDC** | Volatility: ${(s.volatility * 100).toFixed(0)}%`
          })

          const embed = ndEmbed()
            .setTitle('Nightz Stock Exchange · Market Index')
            .setDescription(lines.join('\n') || 'No stocks listed.')
            .setColor(0x3b82f6)

          await interaction.editReply({ embeds: [embed] })
          return
        }

        if (sub === 'buy') {
          await interaction.deferReply({ flags: MessageFlags.Ephemeral })
          const symbol = options.getString('symbol', true)
          const shares = options.getNumber('shares', true)

          const result = await buyStock(interaction.user.id, symbol, shares)
          if (!result.ok) {
            await interaction.editReply(`[ERROR] ${result.msg}`)
          } else {
            await interaction.editReply(`[SUCCESS] ${result.msg}`)
          }
          return
        }

        if (sub === 'sell') {
          await interaction.deferReply({ flags: MessageFlags.Ephemeral })
          const symbol = options.getString('symbol', true)
          const shares = options.getNumber('shares', true)

          const result = await sellStock(interaction.user.id, symbol, shares)
          if (!result.ok) {
            await interaction.editReply(`[ERROR] ${result.msg}`)
          } else {
            await interaction.editReply(`[SUCCESS] ${result.msg}`)
          }
          return
        }

        if (sub === 'portfolio') {
          await interaction.deferReply({ flags: MessageFlags.Ephemeral })
          const portfolio = getUserPortfolio(interaction.user.id)
          if (portfolio.length === 0) {
            await interaction.editReply('You do not own any stocks currently.')
            return
          }

          let totalVal = 0
          const lines = portfolio.map((p) => {
            totalVal += p.totalValue
            const profit = p.totalValue - p.avgPrice * p.shares
            const profitSign = profit >= 0 ? '+' : ''
            return `• **${p.symbol}**: ${p.shares.toFixed(3)} shares | Avg Cost: ${p.avgPrice.toFixed(2)} NDC | Current: ${p.currentPrice.toFixed(2)} NDC | Value: ${p.totalValue.toLocaleString()} NDC (Profit: ${profitSign}${profit.toFixed(2)} NDC)`
          })

          const embed = ndEmbed()
            .setTitle(`${interaction.user.username}'s Stock Portfolio`)
            .setDescription(lines.join('\n'))
            .addFields({
              name: 'Total Portfolio Value',
              value: `**${totalVal.toLocaleString()} NDC**`,
            })
            .setColor(0x10b981)

          await interaction.editReply({ embeds: [embed] })
          return
        }

        if (sub === 'info') {
          await interaction.deferReply({ flags: MessageFlags.Ephemeral })
          const symbol = options.getString('symbol', true).toUpperCase()
          const stock = getStock(symbol)
          if (!stock) {
            await interaction.editReply(`[ERROR] Stock symbol "${symbol}" not found.`)
            return
          }

          const chartPath = await generateStockChart(symbol)
          if (!chartPath) {
            await interaction.editReply(
              `[ERROR] Insufficient history to generate a performance chart for ${symbol}. Please try again later.`,
            )
            return
          }

          const { AttachmentBuilder } = await import('discord.js')
          const file = new AttachmentBuilder(chartPath, {
            name: `chart-${symbol.toLowerCase()}.png`,
          })

          const embed = ndEmbed()
            .setTitle(`Stock Info: ${stock.symbol} (${stock.name})`)
            .setDescription(
              `**Current Price**: ${stock.price.toFixed(2)} NDC\n**Volatility**: ${(stock.volatility * 100).toFixed(0)}%`,
            )
            .setImage(`attachment://chart-${symbol.toLowerCase()}.png`)
            .setColor(0x3b82f6)

          await interaction.editReply({ embeds: [embed], files: [file] })
          return
        }
        return
      }

      if (commandName === 'blackjack') {
        const bet = options.getInteger('bet', true)
        const { startBlackjack, calculateHandValue } = await import('../services/casino.ts')
        const result = await startBlackjack(interaction.user.id, bet, interaction.channelId)

        if (!result.success) {
          await interaction.reply({
            content: `[ERROR] ${result.msg}`,
            flags: MessageFlags.Ephemeral,
          })
          return
        }

        const session = result.session
        if (session) {
          const pScore = calculateHandValue(session.playerHand)
          let dScore = calculateHandValue(session.dealerHand.slice(0, 1))
          if (session.status !== 'playing') {
            dScore = calculateHandValue(session.dealerHand)
          }

          const { generateBlackjackCard } = await import('../services/casino-card.ts')
          const buffer = await generateBlackjackCard({
            username: interaction.user.username,
            playerHand: session.playerHand,
            dealerHand: session.dealerHand,
            playerScore: pScore,
            dealerScore: dScore,
            bet: session.bet,
            status: session.status,
          })

          const { AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = await import(
            'discord.js'
          )
          const attachment = new AttachmentBuilder(buffer, { name: 'blackjack.png' })

          if (session.status === 'playing') {
            const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
              new ButtonBuilder()
                .setCustomId(`bj_hit_${interaction.user.id}`)
                .setLabel('[Hit]')
                .setStyle(ButtonStyle.Primary),
              new ButtonBuilder()
                .setCustomId(`bj_stand_${interaction.user.id}`)
                .setLabel('[Stand]')
                .setStyle(ButtonStyle.Secondary),
            )
            await interaction.reply({ embeds: [], components: [row], files: [attachment] })
          } else {
            await interaction.reply({
              content: result.msg,
              embeds: [],
              components: [],
              files: [attachment],
            })
          }
        } else {
          await interaction.reply({ content: result.msg, embeds: [], components: [] })
        }
        return
      }

      if (commandName === 'slots') {
        const bet = options.getInteger('bet', true)
        const { playSlots } = await import('../services/casino.ts')
        await interaction.deferReply()

        const result = await playSlots(interaction.user.id, bet)
        if (!result.success) {
          await interaction.editReply(`[ERROR] ${result.msg}`)
          return
        }

        const embed = ndEmbed()
          .setTitle('Slots Machine')
          .setDescription(`**[ ${result.reels.join(' | ')} ]**\n\n${result.msg}`)
          .setColor(result.payout > 0 ? 0x10b981 : 0xef4444)

        await interaction.editReply({ embeds: [embed] })
        return
      }

      if (commandName === 'roulette') {
        const bet = options.getInteger('bet', true)
        const wagerInput = options.getString('wager', true).trim().toLowerCase()
        const { playRoulette } = await import('../services/casino.ts')
        await interaction.deferReply()

        let wager: 'red' | 'black' | 'even' | 'odd' | 'high' | 'low' | number
        const parsedNum = parseInt(wagerInput, 10)
        if (!isNaN(parsedNum) && parsedNum >= 0 && parsedNum <= 36) {
          wager = parsedNum
        } else if (['red', 'black', 'even', 'odd', 'high', 'low'].includes(wagerInput)) {
          wager = wagerInput as any
        } else {
          await interaction.editReply(
            '[ERROR] Invalid wager type. Choose red, black, even, odd, low, high, or specific number (0-36).',
          )
          return
        }

        const result = await playRoulette(interaction.user.id, bet, wager)
        if (!result.success) {
          await interaction.editReply(`[ERROR] ${result.msg}`)
          return
        }

        const embed = ndEmbed()
          .setTitle('Roulette Wheel')
          .setDescription(result.msg)
          .setColor(result.payout > 0 ? 0x10b981 : 0xef4444)

        await interaction.editReply({ embeds: [embed] })
        return
      }

      if (commandName === 'coinflip') {
        const bet = options.getInteger('bet', true)
        const choice = options.getString('choice', true) as 'heads' | 'tails'
        const { playCoinflip } = await import('../services/casino.ts')
        await interaction.deferReply()

        const result = await playCoinflip(interaction.user.id, bet, choice)
        if (!result.success) {
          await interaction.editReply(`[ERROR] ${result.msg}`)
          return
        }

        const embed = ndEmbed()
          .setTitle('Coinflip')
          .setDescription(result.msg)
          .setColor(result.payout > 0 ? 0x10b981 : 0xef4444)

        await interaction.editReply({ embeds: [embed] })
        return
      }

      if (commandName === 'timezone') {
        const sub = options.getSubcommand(true)
        const { setUserTimezone, getUserTimezone } = await import(
          '../services/timezone-scheduler.ts'
        )

        if (sub === 'set') {
          const zone = options.getString('zone', true).trim()
          const result = setUserTimezone(interaction.user.id, zone)
          if (!result.ok) {
            await interaction.reply({
              content: `[ERROR] ${result.msg}`,
              flags: MessageFlags.Ephemeral,
            })
          } else {
            await interaction.reply({
              content: `[SUCCESS] ${result.msg}`,
              flags: MessageFlags.Ephemeral,
            })
          }
          return
        }

        if (sub === 'view') {
          const target = options.getUser('user') ?? interaction.user
          const zone = getUserTimezone(target.id)
          await interaction.reply({
            content: `**${target.username}**'s timezone is set to \`${zone}\`.`,
            flags: MessageFlags.Ephemeral,
          })
          return
        }
        return
      }

      if (commandName === 'quests') {
        const sub = options.getSubcommand(true)
        const { getOrCreateQuests, claimQuestRewards } = await import(
          '../services/quest-manager.ts'
        )

        if (sub === 'view') {
          await interaction.deferReply({ flags: MessageFlags.Ephemeral })
          const quests = getOrCreateQuests(interaction.user.id)
          const lines = quests.map((q) => {
            const status = q.claimed
              ? '[CLAIMED]'
              : q.progress >= q.target
                ? '[READY TO CLAIM]'
                : `[${q.progress}/${q.target}]`
            return `• **${q.description}**\n  Status: ${status} | Rewards: **${q.coinReward} NDC** and **${q.xpReward} XP**`
          })

          const embed = ndEmbed()
            .setTitle(`Your Daily Quests`)
            .setDescription(lines.join('\n\n'))
            .setColor(0x3b82f6)

          await interaction.editReply({ embeds: [embed] })
          return
        }

        if (sub === 'claim') {
          await interaction.deferReply({ flags: MessageFlags.Ephemeral })
          const result = await claimQuestRewards(
            interaction.user.id,
            interaction.guildId ?? 'unknown',
          )
          await interaction.editReply(result.msg)
          return
        }
        return
      }
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e)
      console.error('[interaction]', err)
      const safe = await getPublicAiErrorMessage()
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(safe).catch(() => {})
      } else {
        await interaction.reply({ content: safe, flags: MessageFlags.Ephemeral }).catch(() => {})
      }
    }
  })
}
