import {
  ChannelType,
  Events,
  type Client,
  type Interaction,
  type TextChannel,
} from 'discord.js'
import { tryHandleTicketButton } from '../services/ticket-handoff.ts'
import {
  formatOpenTicketsList,
  formatTicketStatsLine,
  tryHandleTicketSystem,
} from '../services/ticket-system.ts'
import {
  MODEL_ID,
  SYSTEM_PROMPT_DM,
  SYSTEM_PROMPT_GUILD,
  geminiFallbackModels,
  openaiEnabled,
  openaiFallbackModels,
  openaiModel,
  WELCOME_TICKET_CHANNEL_ID,
  ticketSystemEnabled,
  aiMonitoringNotice,
  automodPublicBlurb,
  productAliasUrls,
  reportCooldownMs,
  reportMaxBodyLength,
  safetyExtraMarkdown,
  scamCheckExtraTrustedHosts,
} from '../config.ts'
import { buildHealthSummary } from '../services/health.ts'
import { getMacroBody, listMacroKeys, setMacro } from '../services/macros-store.ts'
import { addCase, listCasesForGuild } from '../services/mod-cases-store.ts'
import { formatModAutomodStatus } from '../utils/automod-status-text.ts'
import { rollDiceSpec } from '../utils/dice.ts'
import { formatSupportLinksMarkdown } from '../utils/support-links.ts'
import { takeReportSlot } from '../utils/report-cooldown.ts'
import { consumeTranslateSlot } from '../handlers/prefix.ts'
import { chunkText } from '../utils/chunk.ts'
import { ndEmbed, refusalEmbed } from '../utils/embed.ts'
import { buildServerInfoEmbed } from '../utils/server-info.ts'
import { buildUserInfoEmbed } from '../utils/user-info.ts'
import { buildAugmentedUserContentAsync } from '../services/context-bundle.ts'
import {
  checkOpenAiAvailability,
  generateOnce,
  getModel,
  getPublicAiErrorMessage,
} from '../services/gemini.ts'
import { searchFaq } from '../services/faq.ts'
import { clearChannel } from '../services/memory.ts'
import { containsProfanity } from '../services/profanity.ts'
import { addWarning } from '../services/moderation.ts'
import { isGuildMod } from '../utils/permissions.ts'
import { slashCommands } from './definitions.ts'
import { buildHelpEmbed } from '../utils/help-text.ts'
import { isComingSoonTopic, randomComingSoonReply } from '../utils/coming-soon.ts'
import { reportUserReport } from '../services/logging.ts'
import { listOpenTickets } from '../services/ticket-store.ts'
import {
  getAiProviderState,
  setAiProviderMode,
  type AiProviderMode,
} from '../services/ai-provider.ts'
import { handlePollsSlash } from '../services/polls-slash.ts'

const modelDm = getModel(SYSTEM_PROMPT_DM)
const modelGuild = getModel(SYSTEM_PROMPT_GUILD)

export async function registerSlashCommands(client: Client): Promise<void> {
  const app = client.application
  if (!app) return
  await app.commands.set(slashCommands)
  console.log(`[commands] registered ${slashCommands.length} slash commands`)
}

export function registerInteractionHandler(client: Client): void {
  client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    if (
      interaction.isButton() ||
      interaction.isStringSelectMenu() ||
      interaction.isModalSubmit()
    ) {
      const handled = await tryHandleTicketSystem(interaction)
      if (handled) return
    }

    if (interaction.isButton()) {
      const handled = await tryHandleTicketButton(interaction)
      if (handled) return
    }

    if (!interaction.isChatInputCommand()) return

    const { commandName, options } = interaction

    try {
      if (commandName === 'polls') {
        await handlePollsSlash(interaction)
        return
      }

      if (commandName === 'help') {
        await interaction.reply({ embeds: [buildHelpEmbed()], ephemeral: true })
        return
      }

      if (commandName === 'clear') {
        clearChannel(interaction.channelId)
        await interaction.reply({
          content: 'Conversation memory cleared for this channel.',
          ephemeral: true,
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
            ephemeral: true,
          })
          return
        }
        const body = matches.slice(0, 10).join('\n\n---\n\n').slice(0, 3500)
        const embed = ndEmbed().setTitle('FAQ').setDescription(body || '(empty)')
        await interaction.reply({ embeds: [embed], ephemeral: true })
        return
      }

      if (commandName === 'serverinfo') {
        if (!interaction.guild) {
          await interaction.reply({ content: 'Use in a server.', ephemeral: true })
          return
        }
        const embed = await buildServerInfoEmbed(interaction.guild)
        await interaction.reply({ embeds: [embed], ephemeral: true })
        return
      }

      if (commandName === 'userinfo') {
        const user =
          options.getUser('user') ?? interaction.user
        let member = interaction.guild?.members.cache.get(user.id) ?? null
        if (interaction.guild) {
          member = await interaction.guild.members.fetch(user.id).catch(
            () => member,
          )
        }
        const embed = await buildUserInfoEmbed(user, member)
        await interaction.reply({ embeds: [embed], ephemeral: true })
        return
      }

      if (commandName === 'warn') {
        if (!interaction.guild || !interaction.member) {
          await interaction.reply({ content: 'Use in a server.', ephemeral: true })
          return
        }
        const m = await interaction.guild.members.fetch(interaction.user.id)
        if (!isGuildMod(m)) {
          await interaction.reply({ content: 'No permission.', ephemeral: true })
          return
        }
        const target = options.getUser('user', true)
        const reason =
          options.getString('reason')?.trim() || 'No reason given'
        const list = await addWarning(interaction.guild.id, target.id, {
          at: Date.now(),
          reason,
          moderatorId: interaction.user.id,
        })
        await interaction.reply({
          content: `Warned **${target.tag}** (${list.length} total).`,
          ephemeral: true,
        })
        return
      }

      if (commandName === 'purge') {
        if (!interaction.guild || !interaction.channel?.isTextBased()) {
          await interaction.reply({ content: 'Use in a text channel.', ephemeral: true })
          return
        }
        const m = await interaction.guild.members.fetch(interaction.user.id)
        if (!isGuildMod(m)) {
          await interaction.reply({ content: 'No permission.', ephemeral: true })
          return
        }
        const n = options.getInteger('amount', true)
        const deleted = await interaction.channel.bulkDelete(n, true).catch(() => null)
        await interaction.reply({
          content: deleted ? `Deleted ${deleted.size} message(s).` : 'Failed.',
          ephemeral: true,
        })
        return
      }

      if (commandName === 'translate') {
        const text = options.getString('text', true).trim()
        const limitMsg = consumeTranslateSlot(interaction.user.id)
        if (limitMsg) {
          await interaction.reply({ content: limitMsg, ephemeral: true })
          return
        }
        await interaction.deferReply({ ephemeral: true })
        const prompt = `Translate to natural English. Output ONLY the translation, no quotes.\n\n${text.slice(0, 3500)}`
        const mini = getModel('You only output direct translations.')
        const out = await generateOnce(mini, prompt)
        await interaction.editReply(`**English:** ${out.slice(0, 3800)}`)
        return
      }

      if (commandName === 'ping') {
        const t0 = Date.now()
        await interaction.reply({ content: 'Pong…', fetchReply: true, ephemeral: true })
        const ws = interaction.client.ws.ping
        await interaction.editReply(
          `Pong. ~${Date.now() - t0}ms · gateway ${ws}ms`,
        )
        return
      }

      if (commandName === 'links') {
        const body = formatSupportLinksMarkdown()
        await interaction.reply({
          embeds: [ndEmbed().setTitle('Support links').setDescription(body)],
          ephemeral: true,
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
        await interaction.reply({ content: line.slice(0, 2000), ephemeral: true })
        return
      }

      if (commandName === 'tickets') {
        if (!interaction.guild) {
          await interaction.reply({ content: 'Use in a server.', ephemeral: true })
          return
        }
        const m = await interaction.guild.members.fetch(interaction.user.id)
        if (!isGuildMod(m)) {
          await interaction.reply({ content: 'Moderator only.', ephemeral: true })
          return
        }
        const body = await formatOpenTicketsList(interaction.guild.id)
        await interaction.reply({
          content: body.slice(0, 2000),
          ephemeral: true,
        })
        return
      }

      if (commandName === 'ticketstats') {
        if (!interaction.guild) {
          await interaction.reply({ content: 'Use in a server.', ephemeral: true })
          return
        }
        const m = await interaction.guild.members.fetch(interaction.user.id)
        if (!isGuildMod(m)) {
          await interaction.reply({ content: 'Moderator only.', ephemeral: true })
          return
        }
        const line = await formatTicketStatsLine(interaction.guild.id)
        await interaction.reply({ content: line.slice(0, 2000), ephemeral: true })
        return
      }

      if (commandName === 'search') {
        const q = options.getString('query')
        const matches = searchFaq(q)
        if (matches.length === 0) {
          await interaction.reply({
            content: q
              ? `No FAQ entries matching "${q}".`
              : 'No FAQ loaded. Set `FAQ_CHANNEL_ID`.',
            ephemeral: true,
          })
          return
        }
        const body = matches.slice(0, 10).join('\n\n---\n\n').slice(0, 3500)
        await interaction.reply({
          embeds: [ndEmbed().setTitle('FAQ search').setDescription(body || '(empty)')],
          ephemeral: true,
        })
        return
      }

      if (commandName === 'product') {
        const name = options.getString('name', true).trim()
        const key = name.toUpperCase().replace(/[^A-Z0-9_]/g, '')
        const url = productAliasUrls.get(key)
        if (!url) {
          await interaction.reply({
            content: `No configured link for "${name}". Set \`PRODUCT_ALIAS_URLS\` in .env (e.g. ND_DU:https://...).`,
            ephemeral: true,
          })
          return
        }
        await interaction.reply({ content: `**${name}** maps to ${url}`, ephemeral: true })
        return
      }

      if (commandName === 'roll') {
        const spec = options.getString('dice')?.trim() || '1d20'
        await interaction.reply({ content: rollDiceSpec(spec), ephemeral: true })
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
            ephemeral: true,
          })
          return
        }
        const pick = opts[Math.floor(Math.random() * opts.length)]!
        await interaction.reply({ content: `I choose: **${pick}**`, ephemeral: true })
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
          embeds: [ndEmbed().setTitle('Safety').setDescription(base + extra)],
          ephemeral: true,
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
          ephemeral: true,
        })
        return
      }

      if (commandName === 'privacy') {
        await interaction.reply({
          content:
            'This bot may log **support conversations** and **moderation flags** in channels configured by the server owner (e.g. staff log). Do not send passwords or secrets in chat.\n\n' +
            aiMonitoringNotice,
          ephemeral: true,
        })
        return
      }

      if (commandName === 'report') {
        if (!interaction.guild) {
          await interaction.reply({ content: 'Use this in a server.', ephemeral: true })
          return
        }
        const details = options.getString('details', true).trim()
        if (details.length > reportMaxBodyLength) {
          await interaction.reply({ content: 'Details too long.', ephemeral: true })
          return
        }
        if (!takeReportSlot(interaction.user.id, reportCooldownMs)) {
          await interaction.reply({
            content: 'You can submit another report after a cooldown.',
            ephemeral: true,
          })
          return
        }
        const category = options.getString('category', true)
        await interaction.reply({
          content: 'Report sent to staff. Thank you.',
          ephemeral: true,
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
          embeds: [
            ndEmbed().setTitle('Automated moderation').setDescription(automodPublicBlurb),
          ],
          ephemeral: true,
        })
        return
      }

      if (commandName === 'scam_check') {
        const text = options.getString('text', true).trim().slice(0, 2000)
        if (containsProfanity(text)) {
          await interaction.reply({ embeds: [refusalEmbed()], ephemeral: true })
          return
        }
        const hostMatch = text.match(/https?:\/\/([^/\s]+)/i)
        if (hostMatch) {
          const host = hostMatch[1]!.toLowerCase().split(':')[0]!
          if (scamCheckExtraTrustedHosts.has(host)) {
            await interaction.reply({
              content:
                'That hostname is on **SCAM_CHECK_EXTRA_TRUSTED_HOSTS** for this bot (treated as a known-good domain for checks).',
              ephemeral: true,
            })
            return
          }
        }
        await interaction.deferReply({ ephemeral: true })
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
          await interaction.reply({ embeds: [refusalEmbed()], ephemeral: true })
          return
        }
        await interaction.deferReply({ ephemeral: true })
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
          await interaction.reply({ content: 'Use in a server.', ephemeral: true })
          return
        }
        const m = await interaction.guild.members.fetch(interaction.user.id)
        if (!isGuildMod(m)) {
          await interaction.reply({ content: 'Moderator only.', ephemeral: true })
          return
        }
        await interaction.reply({
          content: formatModAutomodStatus().slice(0, 3900),
          ephemeral: true,
        })
        return
      }

      if (commandName === 'ai_model') {
        const selected = options.getString('provider') as AiProviderMode | null
        const state = await getAiProviderState()
        const openaiHealth = openaiEnabled
          ? await checkOpenAiAvailability()
          : {
              ok: false,
              reason: 'disabled' as const,
              detail: 'OpenAI is disabled (`OPENAI_API_KEY` is not set).',
            }
        const available = [
          `Current mode: **${state.mode}**`,
          `Gemini primary: \`${MODEL_ID}\``,
          `Gemini fallbacks: ${geminiFallbackModels.length ? geminiFallbackModels.map((m) => `\`${m}\``).join(', ') : '(none)'}`,
          `OpenAI provider: ${openaiEnabled ? `enabled (\`${openaiModel}\`)` : 'disabled'}`,
          `OpenAI fallbacks: ${openaiFallbackModels.length ? openaiFallbackModels.map((m) => `\`${m}\``).join(', ') : '(none)'}`,
          `OpenAI status: ${openaiHealth.ok ? 'online' : 'offline'}`,
          `OpenAI details: ${openaiHealth.detail}`,
        ].join('\n')

        if (!selected) {
          await interaction.reply({ content: available.slice(0, 1900), ephemeral: true })
          return
        }
        if (!interaction.guild) {
          await interaction.reply({
            content: 'Use this command in a server (moderator only).',
            ephemeral: true,
          })
          return
        }
        const m = await interaction.guild.members.fetch(interaction.user.id)
        if (!isGuildMod(m)) {
          await interaction.reply({ content: 'Moderator only.', ephemeral: true })
          return
        }
        if (selected === 'openai' && !openaiEnabled) {
          await interaction.reply({
            content: 'OpenAI provider is disabled in `.env` (`OPENAI_API_KEY` not set).',
            ephemeral: true,
          })
          return
        }
        if (selected === 'openai' && !openaiHealth.ok) {
          await interaction.reply({
            content: `Cannot switch to **openai** right now.\n${openaiHealth.detail}`.slice(
              0,
              1900,
            ),
            ephemeral: true,
          })
          return
        }
        const next = await setAiProviderMode(selected, interaction.user.id)
        const after = [
          `Current mode: **${next.mode}**`,
          `Gemini primary: \`${MODEL_ID}\``,
          `Gemini fallbacks: ${geminiFallbackModels.length ? geminiFallbackModels.map((m) => `\`${m}\``).join(', ') : '(none)'}`,
          `OpenAI provider: ${openaiEnabled ? `enabled (\`${openaiModel}\`)` : 'disabled'}`,
          `OpenAI fallbacks: ${openaiFallbackModels.length ? openaiFallbackModels.map((m) => `\`${m}\``).join(', ') : '(none)'}`,
        ].join('\n')
        await interaction.reply({
          content: `AI provider mode set to **${selected}**.\n\n${after}`.slice(
            0,
            1900,
          ),
          ephemeral: true,
        })
        return
      }

      if (commandName === 'status') {
        await interaction.deferReply({ ephemeral: true })
        await interaction.editReply(
          (await buildHealthSummary(interaction.client)).slice(0, 1900),
        )
        return
      }

      if (commandName === 'macro') {
        if (!interaction.guild) {
          await interaction.reply({ content: 'Use in a server.', ephemeral: true })
          return
        }
        const mem = await interaction.guild.members.fetch(interaction.user.id)
        if (!isGuildMod(mem)) {
          await interaction.reply({ content: 'Moderator only.', ephemeral: true })
          return
        }
        const sub = options.getSubcommand(true)
        if (sub === 'list') {
          const keys = await listMacroKeys()
          await interaction.reply({
            content: keys.length
              ? `**Macros:** ${keys.map((k) => `\`${k}\``).join(', ')}`
              : 'No macros yet. Use `/macro set`.',
            ephemeral: true,
          })
          return
        }
        if (sub === 'run') {
          const name = options.getString('name', true).trim().toLowerCase()
          const body = await getMacroBody(name)
          if (!body) {
            await interaction.reply({ content: 'Unknown macro.', ephemeral: true })
            return
          }
          if (!interaction.channel?.isTextBased()) {
            await interaction.reply({ content: 'Use in a text channel.', ephemeral: true })
            return
          }
          await interaction.deferReply({ ephemeral: true })
          await (interaction.channel as TextChannel).send(body.slice(0, 2000))
          await interaction.editReply('Posted.')
          return
        }
        if (sub === 'set') {
          const name = options.getString('name', true).trim().toLowerCase()
          const text = options.getString('text', true)
          await setMacro(name, text)
          await interaction.reply({ content: `Saved macro \`${name}\`.`, ephemeral: true })
        }
        return
      }

      if (commandName === 'case') {
        if (!interaction.guild) {
          await interaction.reply({ content: 'Use in a server.', ephemeral: true })
          return
        }
        const mem = await interaction.guild.members.fetch(interaction.user.id)
        if (!isGuildMod(mem)) {
          await interaction.reply({ content: 'Moderator only.', ephemeral: true })
          return
        }
        const sub = options.getSubcommand(true)
        if (sub === 'list') {
          const list = await listCasesForGuild(interaction.guild.id, 15)
          if (list.length === 0) {
            await interaction.reply({ content: 'No cases logged.', ephemeral: true })
            return
          }
          const lines = list.map(
            (c) =>
              `**#${c.id}** · <@${c.targetId}> · ${c.action} · _${c.reason.slice(0, 80)}_`,
          )
          await interaction.reply({ content: lines.join('\n').slice(0, 1900), ephemeral: true })
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
          await interaction.reply({ content: `Logged case **#${c.id}**.`, ephemeral: true })
        }
        return
      }

      if (commandName === 'slowmode') {
        if (!interaction.guild) {
          await interaction.reply({ content: 'Use in a server.', ephemeral: true })
          return
        }
        const mem = await interaction.guild.members.fetch(interaction.user.id)
        if (!isGuildMod(mem)) {
          await interaction.reply({ content: 'Moderator only.', ephemeral: true })
          return
        }
        const seconds = options.getInteger('seconds', true)
        const chOpt = options.getChannel('channel')
        const ch = (chOpt?.isTextBased() ? chOpt : interaction.channel) as TextChannel | null
        if (!ch?.isTextBased()) {
          await interaction.reply({ content: 'Invalid channel.', ephemeral: true })
          return
        }
        await ch.setRateLimitPerUser(seconds)
        await interaction.reply({
          content: `Slowmode set to **${seconds}s** in ${ch}.`,
          ephemeral: true,
        })
        return
      }

      if (commandName === 'ask') {
        const question = options.getString('question', true).trim()
        if (containsProfanity(question)) {
          await interaction.reply({ embeds: [refusalEmbed()], ephemeral: true })
          return
        }

        if (isComingSoonTopic(question)) {
          const scope =
            interaction.channel?.id ?? `dm:${interaction.user.id}`
          await interaction.reply({
            content: randomComingSoonReply(scope),
            ephemeral: true,
          })
          return
        }

        await interaction.deferReply({ ephemeral: true })

        const prompt = await buildAugmentedUserContentAsync(
          question,
          question,
          'Question',
        )

        const model =
          interaction.channel?.type === ChannelType.DM
            ? modelDm
            : modelGuild
        const text = await generateOnce(model, prompt)
        const chunks = chunkText(text)
        await interaction.editReply({ content: chunks[0] ?? '(empty)' })
        for (let i = 1; i < chunks.length; i++) {
          await interaction.followUp({ content: chunks[i], ephemeral: true })
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
        await interaction.reply({ content: safe, ephemeral: true }).catch(() => {})
      }
    }
  })
}
