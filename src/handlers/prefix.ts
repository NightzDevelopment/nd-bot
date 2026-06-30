/**
 * nd! prefix commands, work instantly, no slash-command registration delay.
 */
import { ChannelType, type GuildMember, type Message, type TextChannel } from 'discord.js'
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
  quarantineNameExemptUserIds,
  reportCooldownMs,
  reportMaxBodyLength,
  SYSTEM_PROMPT_DM,
  SYSTEM_PROMPT_GUILD,
  safetyExtraMarkdown,
  scamCheckExtraTrustedHosts,
  ticketSystemEnabled,
  translateCooldownMs,
  translateHourlyMax,
  WELCOME_TICKET_CHANNEL_ID,
} from '../config.ts'
import { setAfk } from '../services/afk-store.ts'
import {
  type AiProviderMode,
  getAiProviderState,
  setAiProviderMode,
} from '../services/ai-provider.ts'
import { getEntriesLastMs } from '../services/analytics-store.ts'
import { checkClaudeAvailability } from '../services/claude-client.ts'
import { buildAugmentedUserContentAsync } from '../services/context-bundle.ts'
import { searchFaq } from '../services/faq.ts'
import {
  checkOpenAiAvailability,
  generateOnce,
  getModel,
  getPublicAiErrorMessage,
} from '../services/gemini.ts'
import { buildHealthSummary } from '../services/health.ts'
import { buildLeaderboardEmbed, buildRankEmbed } from '../services/levels.ts'
import { reportUserReport } from '../services/logging.ts'
import { getMacroBody, listMacroKeys, setMacro } from '../services/macros-store.ts'
import { clearChannel } from '../services/memory.ts'
import {
  cmdBan,
  cmdClearwarns,
  cmdKick,
  cmdLockdown,
  cmdPurge,
  cmdTimeout,
  cmdUnlock,
  cmdWarn,
  cmdWarnings,
} from '../services/mod-actions.ts'
import { addCase, listCasesForGuild } from '../services/mod-cases-store.ts'
import { containsProfanity } from '../services/profanity.ts'
import {
  applyNameQuarantine,
  AVATAR_SCAN_CAP,
  collectProfileFlags,
} from '../services/profile-scan.ts'
import { formatProductLookupReply } from '../services/store-catalog.ts'
import {
  buildStoreCommandBody,
  formatStoreHealthOneLiner,
  lookupProductsFromSnapshot,
} from '../services/store-snapshot.ts'
import { listOpenTickets } from '../services/ticket-store.ts'
import {
  formatOpenTicketsList,
  formatTicketStatsLine,
  formatTicketTagSearch,
  handleTicketTagCommand,
  parseOpenTicketsListPrefixArgs,
  setTicketStaffNote,
  ticketAddUser,
  ticketRemoveUser,
} from '../services/ticket-system.ts'
import { formatModAutomodStatus } from '../utils/automod-status-text.ts'
import { chunkText } from '../utils/chunk.ts'
import { isComingSoonTopic, randomComingSoonReply } from '../utils/coming-soon.ts'
import { rollDiceSpec } from '../utils/dice.ts'
import { ndEmbed, refusalEmbed } from '../utils/embed.ts'
import { buildHelpEmbed } from '../utils/help-text.ts'
import { isGuildMod } from '../utils/permissions.ts'
import { takeReportSlot } from '../utils/report-cooldown.ts'
import { formatSupportLinksMarkdown } from '../utils/support-links.ts'
import { handleEconomyPrefix } from './prefix-economy.ts'
import { handleExtraPrefix } from './prefix-extra.ts'

const PREFIX = 'nd!'

const modelDm = getModel(SYSTEM_PROMPT_DM)
const modelGuild = getModel(SYSTEM_PROMPT_GUILD)

const translateLast = new Map<string, number>()
const translateHourBuckets = new Map<string, number[]>()

export function consumeTranslateSlot(userId: string): string | null {
  const now = Date.now()
  const bucket = (translateHourBuckets.get(userId) ?? []).filter((t) => now - t < 3_600_000)
  if (bucket.length >= translateHourlyMax) {
    return 'You have reached the hourly translation limit. Try again later.'
  }
  const last = translateLast.get(userId) ?? 0
  if (now - last < translateCooldownMs) {
    const s = Math.ceil((translateCooldownMs - (now - last)) / 1000)
    return `Please wait ${s}s before using translate again.`
  }
  translateLast.set(userId, now)
  bucket.push(now)
  translateHourBuckets.set(userId, bucket)
  return null
}

export function isPrefixCommand(content: string): boolean {
  return content.toLowerCase().startsWith(PREFIX)
}

function parseCommand(content: string): { cmd: string; args: string } {
  const after = content.slice(PREFIX.length).trim()
  const spaceIdx = after.indexOf(' ')
  if (spaceIdx === -1) return { cmd: after.toLowerCase(), args: '' }
  return {
    cmd: after.slice(0, spaceIdx).toLowerCase(),
    args: after.slice(spaceIdx + 1).trim(),
  }
}

/** Prefix commands sometimes lack `member`; fetch so mod checks work. */
async function guildMemberForModCheck(msg: Message): Promise<GuildMember | null> {
  if (!msg.guild) return null
  if (msg.member) return msg.member
  try {
    return await msg.guild.members.fetch(msg.author.id)
  } catch {
    return null
  }
}

export async function handlePrefixCommand(msg: Message): Promise<void> {
  const { cmd, args } = parseCommand(msg.content)

  const modHandled = await handleModPrefix(msg, cmd, args)
  if (modHandled) return

  const extra = await handleExtraPrefix(msg, cmd, args)
  if (extra) return

  const economyHandled = await handleEconomyPrefix(msg, cmd, args)
  if (economyHandled) return

  if (cmd === 'help') {
    await msg.reply({ embeds: [buildHelpEmbed()] })
    return
  }

  if (cmd === 'rank' || cmd === 'level') {
    if (!msg.guild) {
      await msg.reply('Use this in a server.')
      return
    }
    const target = msg.mentions.users.first() ?? msg.author

    try {
      const { getLevelRecord, xpForLevel } = await import('../services/levels-store.ts')
      const levelRec = await getLevelRecord(msg.guild.id, target.id)
      const { getProfile } = await import('../services/member-profile.ts')
      const { getUserBadges } = await import('../services/achievements.ts')
      const profile = await getProfile(target.id)
      const badges = await getUserBadges(target.id)

      const repPoints = profile?.stats.reputation ?? 0
      const totalMessages = levelRec.messageCount ?? profile?.stats.messages ?? 0
      const currentLevel = levelRec.level ?? profile?.stats.level ?? 0
      const currentXp = levelRec.xp ?? 0
      const nextLevel = currentLevel + 1
      const nextLevelXp = xpForLevel(nextLevel)

      const avatarUrl = target.displayAvatarURL({ extension: 'png', size: 256 })

      const { generateProfileCard } = await import('../services/profile-card.ts')
      const buffer = await generateProfileCard({
        userId: target.id,
        username: target.username,
        avatarUrl,
        level: currentLevel,
        xp: currentXp,
        nextLevelXp,
        messages: totalMessages,
        reputation: repPoints,
        bio: profile?.bio || 'Nightz Development Associate',
        badges: badges.map((b) => ({ name: b.name, icon: b.icon })),
      })

      const { AttachmentBuilder } = await import('discord.js')
      const file = new AttachmentBuilder(buffer, { name: `profile-${target.id}.png` })

      await msg.reply({ files: [file] })
    } catch (err) {
      console.error('[prefix rank] Error rendering card, falling back to embed:', err)
      await msg.reply({ embeds: [await buildRankEmbed(msg.guild.id, target.id, target.tag)] })
    }
    return
  }

  if (cmd === 'leaderboard' || cmd === 'levels') {
    if (!msg.guild) {
      await msg.reply('Use this in a server.')
      return
    }
    await msg.reply({ embeds: [await buildLeaderboardEmbed(msg.guild.id)] })
    return
  }

  if (cmd === 'afk') {
    if (!msg.guild) {
      await msg.reply('Use this in a server.')
      return
    }
    const reason = args || 'AFK'
    await setAfk(msg.guild.id, msg.author.id, reason.slice(0, 200))
    await msg.reply({
      embeds: [
        ndEmbed()
          .setTitle('AFK set')
          .setDescription(`Reason: **${reason.slice(0, 200)}**`),
      ],
    })
    return
  }

  if (cmd === 'model' || cmd === 'aimodel' || cmd === 'aiprovider') {
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
            detail: 'Claude is disabled (`CLAUDE_API_KEY` is not set).',
          }),
    ])

    const details = [
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

    const wanted = args.split(/\s+/)[0]?.trim().toLowerCase()
    if (!wanted) {
      await msg.reply(details.slice(0, 1900))
      return
    }
    if (!['auto', 'gemini', 'openai', 'claude'].includes(wanted)) {
      await msg.reply(
        'Usage: `nd!model <auto|gemini|openai|claude>` (or no arg to view current mode).',
      )
      return
    }
    if (!msg.guild) {
      await msg.reply('Use this in a server (moderator only).')
      return
    }
    const member = await guildMemberForModCheck(msg)
    if (!member || !isGuildMod(member)) {
      await msg.reply('Moderator only.')
      return
    }
    if (wanted === 'openai' && !openaiEnabled) {
      await msg.reply('OpenAI provider is disabled in `.env` (`OPENAI_API_KEY` not set).')
      return
    }
    if (wanted === 'openai' && !openaiHealth.ok) {
      await msg.reply(
        `Cannot switch to **openai** right now.\n${openaiHealth.detail}`.slice(0, 1900),
      )
      return
    }
    if (wanted === 'claude' && !claudeEnabled) {
      await msg.reply('Claude provider is disabled in `.env` (`CLAUDE_API_KEY` not set).')
      return
    }
    if (wanted === 'claude' && !claudeHealth.ok) {
      await msg.reply(
        `Cannot switch to **claude** right now.\n${claudeHealth.detail}`.slice(0, 1900),
      )
      return
    }
    const next = await setAiProviderMode(wanted as AiProviderMode, msg.author.id)
    await msg.reply(
      `AI provider mode set to **${next.mode}**.\n\nUse \`nd!model\` to see full status.`.slice(
        0,
        1900,
      ),
    )
    return
  }

  if (cmd === 'clear') {
    clearChannel(msg.channel.id)
    await msg.reply('Conversation memory cleared for this channel.')
    return
  }

  if (cmd === 'faq') {
    const matches = searchFaq(args || null)
    if (matches.length === 0) {
      await msg.reply(
        args
          ? `No FAQ entries matching "${args}".`
          : 'No FAQ loaded. Set `FAQ_CHANNEL_ID` and pin messages in that channel.',
      )
      return
    }
    const body = matches.slice(0, 10).join('\n\n---\n\n').slice(0, 3500)
    const embed = ndEmbed()
      .setTitle('FAQ')
      .setDescription(body || '(empty)')
    await msg.reply({ embeds: [embed] })
    return
  }

  if (cmd === 'summarize' || cmd === 'appealsum') {
    if (!msg.guild || !isGuildMod(msg.member)) {
      await msg.reply('Moderator only.')
      return
    }
    const ref = msg.reference
    if (!ref?.messageId) {
      await msg.reply('Reply to the ticket/appeal message you want summarized.')
      return
    }
    const parent = await msg.channel.messages.fetch(ref.messageId).catch(() => null)
    const text = parent?.content?.trim() ?? ''
    if (!text) {
      await msg.reply('That message has no text to summarize.')
      return
    }
    if ('sendTyping' in msg.channel) await msg.channel.sendTyping()
    const prompt = `Summarize this user message for staff. Output exactly 5 concise bullet points using "- " prefix. No title or preamble.\n\n${text.slice(0, 3500)}`
    const mini = getModel('You output only bullet points.')
    try {
      const out = await generateOnce(mini, prompt)
      await msg.reply(out.slice(0, 3900))
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e)
      console.error('[prefix summarize]', err)
      await msg.reply(await getPublicAiErrorMessage()).catch(() => {})
    }
    return
  }

  if (cmd === 'digest') {
    if (!msg.guild || !isGuildMod(msg.member)) {
      await msg.reply('Moderator only.')
      return
    }
    if ('sendTyping' in msg.channel) await msg.channel.sendTyping()
    const entries = await getEntriesLastMs(7 * 24 * 60 * 60 * 1000)
    if (entries.length === 0) {
      await msg.reply('No support analytics yet, the bot needs a few AI replies first.')
      return
    }
    const lines = entries
      .slice(-500)
      .map(
        (e) =>
          `[${new Date(e.t).toISOString().slice(0, 10)}] #${e.channelId} ticketCue=${e.ticketCue}\nU: ${e.userSnippet}\nB: ${e.botSnippet}`,
      )
    const blob = lines.join('\n---\n').slice(0, 14_000)
    const prompt = `Write a concise weekly-style digest for support staff from these user/bot exchanges (U=user, B=bot).\n\nSections:\n1) Recurring themes\n2) Common products or errors\n3) Gaps (many ticketCue=true means bot sent people to tickets)\n4) Suggested FAQ lines (if any)\n\nKeep under 3000 characters. Plain text.\n\n---\n${blob}`
    const mini = getModel('You write clear internal digests only.')
    try {
      const out = await generateOnce(mini, prompt)
      await msg.reply(out.slice(0, 3900))
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e)
      console.error('[prefix digest]', err)
      await msg.reply(await getPublicAiErrorMessage()).catch(() => {})
    }
    return
  }

  if (cmd === 'translate' || cmd === 'en') {
    if (!args) {
      await msg.reply('Usage: `nd!translate <text>`, translates to English.')
      return
    }
    const limitMsg = consumeTranslateSlot(msg.author.id)
    if (limitMsg) {
      await msg.reply(limitMsg)
      return
    }
    if ('sendTyping' in msg.channel) await msg.channel.sendTyping()
    const prompt = `Translate to natural English. Output ONLY the translation, no quotes.\n\n${args.slice(0, 3500)}`
    const mini = getModel('You only output direct translations.')
    try {
      const out = await generateOnce(mini, prompt)
      await msg.reply(`**English:** ${out.slice(0, 3800)}`)
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e)
      console.error('[prefix translate]', err)
      await msg.reply(await getPublicAiErrorMessage()).catch(() => {})
    }
    return
  }

  if (cmd === 'ask') {
    if (!args) {
      await msg.reply('Usage: `nd!ask <your question>`')
      return
    }
    if (containsProfanity(args, msg)) {
      await msg.reply({ embeds: [refusalEmbed()] })
      return
    }

    if (isComingSoonTopic(args)) {
      await msg.reply(randomComingSoonReply(msg.channel.id))
      return
    }

    if ('sendTyping' in msg.channel) await msg.channel.sendTyping()

    const prompt = await buildAugmentedUserContentAsync(args, args, 'Question')

    const model = msg.channel.type === ChannelType.DM ? modelDm : modelGuild

    try {
      const text = await generateOnce(model, prompt)
      const chunks = chunkText(text)
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i] ?? ''
        if (i === 0) await msg.reply({ content: chunk })
        else if (msg.channel.isTextBased() && 'send' in msg.channel)
          await msg.channel.send({ content: chunk })
      }
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e)
      console.error('[prefix ask]', err)
      await msg.reply(await getPublicAiErrorMessage()).catch(() => {})
    }
    return
  }

  if (cmd === 'ping') {
    const t0 = Date.now()
    const m = await msg.reply('Pong…')
    const ms = Date.now() - t0
    await m.edit(`Pong. ~${ms}ms · gateway ${msg.client.ws.ping}ms\n${formatStoreHealthOneLiner()}`)
    return
  }

  if (cmd === 'status') {
    await msg.reply((await buildHealthSummary(msg.client)).slice(0, 1900))
    return
  }

  if (cmd === 'macro') {
    const member = await guildMemberForModCheck(msg)
    if (!msg.guild || !member || !isGuildMod(member)) {
      await msg.reply('Moderator only.')
      return
    }
    const sub = args.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
    const rest = args.replace(/^\S+\s*/, '').trim()
    if (sub === 'list' || !sub) {
      const keys = await listMacroKeys()
      await msg.reply(
        keys.length
          ? `**Macros:** ${keys.map((k) => `\`${k}\``).join(', ')}`
          : 'No macros yet. `nd!macro set <key> <text>`',
      )
      return
    }
    if (sub === 'run') {
      const name = rest.split(/\s+/)[0]?.toLowerCase()
      if (!name) {
        await msg.reply('Usage: `nd!macro run <key>`')
        return
      }
      const body = await getMacroBody(name)
      if (!body) {
        await msg.reply('Unknown macro.')
        return
      }
      if (msg.channel.isTextBased() && 'send' in msg.channel)
        await msg.channel.send(body.slice(0, 2000))
      return
    }
    if (sub === 'set') {
      const m = rest.match(/^(\S+)\s+([\s\S]+)/)
      if (!m) {
        await msg.reply('Usage: `nd!macro set <key> <text>`')
        return
      }
      await setMacro(m[1]!, m[2]!.trim())
      await msg.reply(`Saved macro \`${m[1]!.toLowerCase()}\`.`)
      return
    }
    await msg.reply('Usage: `nd!macro list` · `nd!macro run <key>` · `nd!macro set <key> <text>`')
    return
  }

  if (cmd === 'case' || cmd === 'cases') {
    const member = await guildMemberForModCheck(msg)
    if (!msg.guild || !member || !isGuildMod(member)) {
      await msg.reply('Moderator only.')
      return
    }
    const sub = args.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
    const rest = args.replace(/^\S+\s*/, '').trim()
    if (sub === 'list' || sub === 'ls' || !sub) {
      const list = await listCasesForGuild(msg.guild.id, 12)
      if (list.length === 0) {
        await msg.reply('No cases logged yet.')
        return
      }
      const lines = list.map(
        (c) =>
          `**#${c.id}** · <@${c.targetId}> · ${c.action} · _${c.reason.slice(0, 80)}_ · <t:${Math.floor(c.at / 1000)}:R>`,
      )
      await msg.reply(lines.join('\n').slice(0, 1900))
      return
    }
    if (sub === 'add') {
      const user = msg.mentions.users.first()
      const tail = rest.replace(/<@!?\d+>\s*/, '').trim()
      const parts = tail.split(/\s+/)
      const action = parts[0]
      const reason = parts.slice(1).join(' ').trim() || 'No reason'
      if (!user || !action) {
        await msg.reply('Usage: `nd!case add @user <action> <reason>`')
        return
      }
      const c = await addCase({
        guildId: msg.guild.id,
        targetId: user.id,
        targetTag: user.tag,
        moderatorId: msg.author.id,
        moderatorTag: msg.author.tag,
        action,
        reason,
        at: Date.now(),
      })
      await msg.reply(`Logged case **#${c.id}**.`)
      return
    }
    await msg.reply('Usage: `nd!case list` · `nd!case add @user action reason`')
    return
  }

  if (cmd === 'slowmode') {
    const member = await guildMemberForModCheck(msg)
    if (!msg.guild || !member || !isGuildMod(member)) {
      await msg.reply('Moderator only.')
      return
    }
    const chM = args.match(/^<#(\d+)>\s+(\d+)$/)
    const plain = args.trim().match(/^(\d+)$/)
    let seconds = 0
    let ch = msg.channel
    if (chM) {
      const raw = await msg.guild.channels.fetch(chM[1]!).catch(() => null)
      if (raw?.isTextBased()) ch = raw as typeof ch
      seconds = parseInt(chM[2]!, 10)
    } else if (plain) {
      seconds = parseInt(plain[1]!, 10)
    } else {
      await msg.reply(
        'Usage: `nd!slowmode <seconds>` or `nd!slowmode #channel <seconds>` (0-21600)',
      )
      return
    }
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 21600) {
      await msg.reply('Seconds must be 0-21600.')
      return
    }
    if (!('setRateLimitPerUser' in ch) || !ch.isTextBased()) {
      await msg.reply('Invalid channel.')
      return
    }
    await (ch as TextChannel).setRateLimitPerUser(seconds)
    await msg.reply(`Slowmode set to **${seconds}s** in ${ch}.`)
    return
  }

  if (cmd === 'scan_names' || cmd === 'scannames') {
    const member = await guildMemberForModCheck(msg)
    if (!msg.guild || !member || !isGuildMod(member)) {
      await msg.reply('Moderator only.')
      return
    }
    const tokens = args.trim().toLowerCase().split(/\s+/)
    const apply = tokens.includes('apply')
    const includeAvatars = tokens.includes('avatars') || tokens.includes('full')
    const sent = await msg.reply('Scanning all member profiles...')

    const all = await msg.guild.members.fetch()
    let scanned = 0
    let avatarBudget = includeAvatars ? AVATAR_SCAN_CAP : 0
    let avatarChecks = 0
    let avatarCapped = false
    const flagged: { tag: string; id: string; reasons: string[]; status: string }[] = []
    for (const gm of all.values()) {
      if (gm.user.bot) continue
      if (isGuildMod(gm)) continue
      if (quarantineNameExemptUserIds.has(gm.user.id)) continue
      scanned++
      const tryAvatar = includeAvatars && avatarBudget > 0
      if (includeAvatars && avatarBudget === 0 && gm.user.avatar) avatarCapped = true
      const { reasons, checkedAvatar } = await collectProfileFlags(gm, { tryAvatar })
      if (checkedAvatar) {
        avatarBudget--
        avatarChecks++
      }
      if (reasons.length === 0) continue
      let status = 'reported (no action)'
      if (apply) status = await applyNameQuarantine(gm)
      flagged.push({ tag: gm.user.tag, id: gm.user.id, reasons, status })
    }

    const quarantinedCount = apply
      ? flagged.filter((f) => f.status === 'quarantined' || f.status === 'already quarantined')
          .length
      : 0
    const scopeNote = includeAvatars
      ? ` Avatar checks: ${avatarChecks}${avatarCapped ? ` (capped at ${AVATAR_SCAN_CAP})` : ''}.`
      : ' (names + status only; add `avatars` to also scan avatars.)'
    const header = apply
      ? `Scanned ${scanned} member(s). Flagged ${flagged.length}. Quarantined ${quarantinedCount}.${scopeNote}`
      : `Scanned ${scanned} member(s). Flagged ${flagged.length}. (Report only - run \`nd!scan_names apply\` to quarantine.)${scopeNote}`

    if (flagged.length === 0) {
      await sent.edit(`${header}\n\nNo flagged names found.`)
      return
    }
    const lines = flagged.map(
      (f) => `- <@${f.id}> (${f.tag}): ${f.reasons.join('; ')} [${f.status}]`,
    )
    const full = `${header}\n\n${lines.join('\n')}`
    if (full.length <= 1900) {
      await sent.edit(full)
    } else {
      const { AttachmentBuilder } = await import('discord.js')
      const file = new AttachmentBuilder(Buffer.from(full, 'utf8'), { name: 'flagged-names.txt' })
      await sent.edit({
        content: `${header}\nFull list attached (${flagged.length} flagged).`,
        files: [file],
      })
    }
    return
  }

  if (cmd === 'links') {
    await msg.reply({
      embeds: [ndEmbed().setTitle('Support links').setDescription(formatSupportLinksMarkdown())],
    })
    return
  }

  if (cmd === 'ticket') {
    const sub = args.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
    if (sub === 'list' || sub === 'ls' || sub === 'open') {
      const member = await guildMemberForModCheck(msg)
      if (!msg.guild || !member || !isGuildMod(member)) {
        await msg.reply(
          'Moderator only. Same as `/tickets`: list open tickets. Use `nd!tickets` or `nd!ticket list`.',
        )
        return
      }
      const listArgs = args.replace(/^\S+\s*/, '').trim()
      const listOpts = parseOpenTicketsListPrefixArgs(listArgs)
      const body = await formatOpenTicketsList(msg.guild.id, listOpts)
      await msg.reply(body.slice(0, 2000))
      return
    }
    if (sub === 'stats' || sub === 'stat') {
      const member = await guildMemberForModCheck(msg)
      if (!msg.guild || !member || !isGuildMod(member)) {
        await msg.reply(
          'Moderator only. Same as `/ticketstats`. Use `nd!ticketstats` or `nd!ticket stats`.',
        )
        return
      }
      const line = await formatTicketStatsLine(msg.guild.id)
      await msg.reply(line.slice(0, 2000))
      return
    }

    let line = WELCOME_TICKET_CHANNEL_ID
      ? `**Tickets:** <#${WELCOME_TICKET_CHANNEL_ID}> → category → **Open Ticket**.`
      : '**Support:** ask staff where the ticket panel is.'
    if (ticketSystemEnabled && msg.guildId) {
      const n = (await listOpenTickets(msg.guildId)).length
      line += `\n\n**Open tickets:** ${n}`
    }
    line +=
      '\n\n**Staff:** `nd!tickets` / `nd!ticket list` (= `/tickets`) · `nd!ticketstats` (= `/ticketstats`)'
    await msg.reply(line.slice(0, 2000))
    return
  }

  if (cmd === 'tickets' || cmd === 'ticket-list' || cmd === 'ticketlist') {
    const member = await guildMemberForModCheck(msg)
    if (!msg.guild || !member || !isGuildMod(member)) {
      await msg.reply('Moderator only. This is the prefix for `/tickets` (list open tickets).')
      return
    }
    const listOpts = parseOpenTicketsListPrefixArgs(args)
    const body = await formatOpenTicketsList(msg.guild.id, listOpts)
    await msg.reply(body.slice(0, 2000))
    return
  }

  if (cmd === 'ticketstats') {
    const member = await guildMemberForModCheck(msg)
    if (!msg.guild || !member || !isGuildMod(member)) {
      await msg.reply('Moderator only. This is the prefix for `/ticketstats`.')
      return
    }
    const line = await formatTicketStatsLine(msg.guild.id)
    await msg.reply(line.slice(0, 2000))
    return
  }

  if (cmd === 'ticketnote') {
    if (!msg.guild || !msg.channel.isTextBased() || msg.channel.isDMBased()) {
      await msg.reply('Use this in a **ticket channel**.')
      return
    }
    const member = await guildMemberForModCheck(msg)
    if (!member || !isGuildMod(member)) {
      await msg.reply('Moderator only. Usage: `nd!ticketnote <text>` (empty to clear).')
      return
    }
    const out = await setTicketStaffNote(msg.channel as TextChannel, member, args.trim())
    await msg.reply(out.slice(0, 2000))
    return
  }

  if (cmd === 'tickettag') {
    if (!msg.guild || !msg.channel.isTextBased() || msg.channel.isDMBased()) {
      await msg.reply('Use this in a **ticket channel**.')
      return
    }
    const member = await guildMemberForModCheck(msg)
    if (!member) {
      await msg.reply('Moderator only. Usage: `nd!tickettag add|remove|list <tags>`')
      return
    }
    const out = await handleTicketTagCommand(msg.channel as TextChannel, member, args.trim())
    await msg.reply(out.slice(0, 2000))
    return
  }

  if (cmd === 'ticketsearch') {
    if (!msg.guild) {
      await msg.reply('Use this in a server.')
      return
    }
    const member = await guildMemberForModCheck(msg)
    if (!member || !isGuildMod(member)) {
      await msg.reply('Moderator only. Usage: `nd!ticketsearch <tag>`')
      return
    }
    const out = await formatTicketTagSearch(msg.guild.id, args.trim())
    await msg.reply(out.slice(0, 3900))
    return
  }

  if (cmd === 'season') {
    const { getActiveSeasonalEvent, setSeasonalEvent } = await import(
      '../services/seasonal-events.ts'
    )
    const parts = args.trim().split(/\s+/).filter(Boolean)
    const sub = (parts.shift() ?? 'status').toLowerCase()

    if (sub === 'status' || sub === '') {
      const ev = getActiveSeasonalEvent()
      if (!ev) {
        await msg.reply('No seasonal event is active.')
        return
      }
      await msg.reply(
        `**${ev.name}** active until <t:${Math.floor(ev.endsAt / 1000)}:R>: XP x${ev.xpMultiplier}, NDC x${ev.currencyMultiplier}.`,
      )
      return
    }

    const member = await guildMemberForModCheck(msg)
    if (!member || !isGuildMod(member)) {
      await msg.reply(
        'Moderator only. Usage: `nd!season start <xpMult> <ndcMult> <duration> <name>`',
      )
      return
    }

    if (sub === 'end' || sub === 'stop') {
      await setSeasonalEvent(null)
      await msg.reply('Seasonal event ended.')
      return
    }

    if (sub === 'start') {
      const xpMult = parseFloat(parts.shift() ?? '')
      const ndcMult = parseFloat(parts.shift() ?? '')
      const durRaw = parts.shift() ?? ''
      const { parseDuration } = await import('../utils/time.ts')
      const dur = parseDuration(durRaw)
      const name = parts.join(' ') || 'Seasonal Event'
      if (!isFinite(xpMult) || !isFinite(ndcMult) || !dur) {
        await msg.reply(
          'Usage: `nd!season start <xpMult> <ndcMult> <duration> <name>`, e.g. `nd!season start 2 2 2d Double Weekend`',
        )
        return
      }
      const now = Date.now()
      await setSeasonalEvent({
        name: name.slice(0, 80),
        startsAt: now,
        endsAt: now + dur,
        xpMultiplier: Math.max(0.1, Math.min(10, xpMult)),
        currencyMultiplier: Math.max(0.1, Math.min(10, ndcMult)),
      })
      await msg.reply(
        `Seasonal event **${name}** started: XP x${xpMult}, NDC x${ndcMult} for ${durRaw}.`,
      )
      return
    }

    await msg.reply('Usage: `nd!season start|end|status`')
    return
  }

  if (cmd === 'verifypanel') {
    if (!msg.guild || !msg.channel.isTextBased() || msg.channel.isDMBased()) {
      await msg.reply('Use this in a server text channel.')
      return
    }
    const member = await guildMemberForModCheck(msg)
    if (!member || !isGuildMod(member)) {
      await msg.reply('Moderator only. Posts the verification panel in this channel.')
      return
    }
    const { verifyEnabled, verifyRoleId } = await import('../config.ts')
    if (!verifyEnabled || !verifyRoleId) {
      await msg.reply('Verification is not configured (set VERIFY_ENABLED=1 and VERIFY_ROLE_ID).')
      return
    }
    const { buildVerifyPanel } = await import('../services/verification.ts')
    await (msg.channel as TextChannel).send(buildVerifyPanel())
    await msg.reply('Verification panel posted.')
    return
  }

  if (cmd === 'modmail') {
    if (msg.channel.type !== ChannelType.DM) {
      await msg.reply(
        'DM me `nd!modmail <your message>` to start a private conversation with staff.',
      )
      return
    }
    const { modmailEnabled } = await import('../config.ts')
    if (!modmailEnabled) {
      await msg.reply('Modmail is not enabled on this bot.')
      return
    }
    const { startModmail } = await import('../services/modmail.ts')
    const res = await startModmail(msg.client, msg.author, args.trim())
    await msg.reply(res.msg)
    return
  }

  if (cmd === 'copilotdrafts' || cmd === 'aidrafts') {
    const member = await guildMemberForModCheck(msg)
    if (!member || !isGuildMod(member)) {
      await msg.reply('Moderator only. Usage: `nd!copilotdrafts on|off|status`')
      return
    }
    const { getCopilotDraftsEnabled, setCopilotDraftsEnabled } = await import(
      '../services/ticket-copilot.ts'
    )
    const sub = args.trim().toLowerCase()
    if (sub === 'on' || sub === 'enable') {
      await setCopilotDraftsEnabled(true, msg.author.tag)
      await msg.reply(
        'AI Draft Suggestions are now **ON**. Staff will see draft-for-approval posts.',
      )
      return
    }
    if (sub === 'off' || sub === 'disable' || sub === 'stop') {
      await setCopilotDraftsEnabled(false, msg.author.tag)
      await msg.reply(
        'AI Draft Suggestions are now **OFF**. The bot will only send its normal in-ticket messages.',
      )
      return
    }
    const on = await getCopilotDraftsEnabled()
    await msg.reply(
      `AI Draft Suggestions are currently **${on ? 'ON' : 'OFF'}**. Use \`nd!copilotdrafts on\` or \`nd!copilotdrafts off\`.`,
    )
    return
  }

  if (cmd === 'adduser' || cmd === 'removeuser') {
    if (!msg.guild || !msg.channel.isTextBased() || msg.channel.isDMBased()) {
      await msg.reply('Use this in a server ticket channel.')
      return
    }
    if (!isGuildMod(msg.member)) {
      await msg.reply('Moderator only.')
      return
    }
    const uid =
      msg.mentions.users.first()?.id ?? args.split(/\s+/)[0]?.replace(/\D/g, '')?.slice(0, 20)
    if (!uid || uid.length < 17) {
      await msg.reply('Usage: `nd!adduser @user` or `nd!removeuser @user`')
      return
    }
    const guild = msg.guild
    const ch = msg.channel
    const out =
      cmd === 'adduser'
        ? await ticketAddUser(guild, ch as TextChannel, msg.member!, uid)
        : await ticketRemoveUser(guild, ch as TextChannel, msg.member!, uid)
    await msg.reply(out)
    return
  }

  if (cmd === 'search' || cmd === 'searchfaq') {
    const matches = searchFaq(args || null)
    if (matches.length === 0) {
      await msg.reply(args ? `No FAQ entries matching "${args}".` : 'No FAQ loaded.')
      return
    }
    const body = matches.slice(0, 10).join('\n\n---\n\n').slice(0, 3500)
    await msg.reply({ embeds: [ndEmbed().setTitle('FAQ search').setDescription(body)] })
    return
  }

  if (cmd === 'store') {
    await msg.reply(buildStoreCommandBody().slice(0, 3900))
    return
  }

  if (cmd === 'product') {
    if (!args) {
      await msg.reply(
        'Usage: `nd!product <name>`, matches the cached store listing, or manual aliases in `PRODUCT_ALIAS_URLS`.',
      )
      return
    }
    const key = args.toUpperCase().replace(/[^A-Z0-9_]/g, '')
    const aliasUrl = productAliasUrls.get(key)
    if (aliasUrl) {
      await msg.reply(`**${args}** (manual alias) → ${aliasUrl}`)
      return
    }
    const hits = lookupProductsFromSnapshot(args)
    await msg.reply(formatProductLookupReply(args, hits).slice(0, 3900))
    return
  }

  if (cmd === 'roll') {
    await msg.reply(rollDiceSpec(args || '1d20'))
    return
  }

  if (cmd === 'choose') {
    if (!args) {
      await msg.reply('Usage: `nd!choose option1 | option2 | option3`')
      return
    }
    const opts = args
      .split(/[|,]/g)
      .map((s) => s.trim())
      .filter(Boolean)
    if (opts.length < 2) {
      await msg.reply('Give at least two options separated by commas or |.')
      return
    }
    await msg.reply(`I choose: **${opts[Math.floor(Math.random() * opts.length)]}**`)
    return
  }

  if (cmd === 'safety') {
    const base =
      '• Use Discord’s **Safety** tools.\n' +
      '• Staff will **never** ask for your password or 2FA.\n' +
      '• https://discord.com/safety'
    const extra = safetyExtraMarkdown ? `\n\n${safetyExtraMarkdown.slice(0, 1500)}` : ''
    await msg.reply({
      embeds: [
        ndEmbed()
          .setTitle('Safety')
          .setDescription(base + extra),
      ],
    })
    return
  }

  if (cmd === 'scam' || cmd === 'scamtips') {
    await msg.reply({
      embeds: [
        ndEmbed()
          .setTitle('Scam awareness')
          .setDescription(
            'Fake Nitro/Steam links, “verify account” DMs, and fake staff are common. When in doubt, don’t click; open a ticket.',
          ),
      ],
    })
    return
  }

  if (cmd === 'privacy') {
    await msg.reply(
      'This bot may log support and moderation events in configured staff channels. Do not send secrets in chat.\n\n' +
        aiMonitoringNotice,
    )
    return
  }

  if (cmd === 'report') {
    if (!msg.guild) {
      await msg.reply('Use in a server.')
      return
    }
    if (!args) {
      await msg.reply(
        'Usage: `nd!report <category> | <details>` (e.g. harassment | they DMed me a fake link)',
      )
      return
    }
    const bar = args.indexOf('|')
    const category = bar >= 0 ? args.slice(0, bar).trim() : 'other'
    const details = bar >= 0 ? args.slice(bar + 1).trim() : args
    if (details.length > reportMaxBodyLength) {
      await msg.reply('Details too long.')
      return
    }
    if (!takeReportSlot(msg.author.id, reportCooldownMs)) {
      await msg.reply('Report cooldown. Try again later.')
      return
    }
    await reportUserReport(
      { tag: msg.author.tag, id: msg.author.id },
      category,
      details,
      msg.guild.name,
      msg.guild.id,
      `https://discord.com/channels/${msg.guild.id}/${msg.channel.id}/${msg.id}`,
    )
    await msg.reply('Report sent to staff. Thank you.')
    return
  }

  if (cmd === 'automodpublic' || cmd === 'automod-public') {
    await msg.reply({
      embeds: [ndEmbed().setTitle('Automated moderation').setDescription(automodPublicBlurb)],
    })
    return
  }

  if (cmd === 'modautomod' || cmd === 'automod') {
    if (!msg.guild || !isGuildMod(msg.member)) {
      await msg.reply('Moderator only.')
      return
    }
    await msg.reply(formatModAutomodStatus().slice(0, 3900))
    return
  }

  if (cmd === 'scamcheck' || cmd === 'is-this-a-scam') {
    if (!args) {
      await msg.reply('Usage: `nd!scamcheck <paste suspicious text>`')
      return
    }
    if (containsProfanity(args, msg)) {
      await msg.reply({ embeds: [refusalEmbed()] })
      return
    }
    const hostMatch = args.match(/https?:\/\/([^/\s]+)/i)
    if (hostMatch) {
      const host = hostMatch[1]!.toLowerCase().split(':')[0]!
      if (scamCheckExtraTrustedHosts.has(host)) {
        await msg.reply('That hostname is on **SCAM_CHECK_EXTRA_TRUSTED_HOSTS** for this bot.')
        return
      }
    }
    if ('sendTyping' in msg.channel) await msg.channel.sendTyping()
    const mini = getModel('You only output short risk assessments.')
    const out = await generateOnce(
      mini,
      `Is this message likely a scam or safe? 2-4 sentences. Not legal advice.\n\n${args.slice(0, 2000)}`,
    )
    await msg.reply(`${out.slice(0, 3500)}\n\n_When in doubt, don’t click; ask staff._`)
    return
  }

  if (cmd === 'tldr') {
    if (!args) {
      await msg.reply('Usage: `nd!tldr <text to summarize>`')
      return
    }
    if (containsProfanity(args, msg)) {
      await msg.reply({ embeds: [refusalEmbed()] })
      return
    }
    if ('sendTyping' in msg.channel) await msg.channel.sendTyping()
    const mini = getModel('You write short neutral summaries.')
    const out = await generateOnce(mini, `One short paragraph summary:\n\n${args.slice(0, 4000)}`)
    await msg.reply(out.slice(0, 3900))
    return
  }

  await msg.reply(`Unknown command: \`nd!${cmd}\`. Type \`nd!help\` for a list.`)
}

async function handleModPrefix(msg: Message, cmd: string, args: string): Promise<boolean> {
  switch (cmd) {
    case 'warn':
      await cmdWarn(msg, args)
      return true
    case 'warnings':
      await cmdWarnings(msg, args)
      return true
    case 'clearwarns':
      await cmdClearwarns(msg, args)
      return true
    case 'timeout':
      await cmdTimeout(msg, args)
      return true
    case 'kick':
      await cmdKick(msg, args)
      return true
    case 'ban':
      await cmdBan(msg, args)
      return true
    case 'purge':
      await cmdPurge(msg, args)
      return true
    case 'lockdown':
      await cmdLockdown(msg)
      return true
    case 'unlock':
      await cmdUnlock(msg)
      return true
    default:
      return false
  }
}
