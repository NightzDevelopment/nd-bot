/**
 * nd! prefix commands, work instantly, no slash-command registration delay.
 */
import {
  ChannelType,
  type GuildMember,
  type Message,
  type TextChannel,
} from 'discord.js'
import {
  SYSTEM_PROMPT_DM,
  SYSTEM_PROMPT_GUILD,
  WELCOME_TICKET_CHANNEL_ID,
  ticketSystemEnabled,
  aiMonitoringNotice,
  automodPublicBlurb,
  productAliasUrls,
  reportCooldownMs,
  reportMaxBodyLength,
  safetyExtraMarkdown,
  translateCooldownMs,
  translateHourlyMax,
} from '../config.ts'
import { chunkText } from '../utils/chunk.ts'
import { ndEmbed, refusalEmbed } from '../utils/embed.ts'
import { buildAugmentedUserContentAsync } from '../services/context-bundle.ts'
import { generateOnce, getModel } from '../services/gemini.ts'
import { searchFaq } from '../services/faq.ts'
import { clearChannel } from '../services/memory.ts'
import { containsProfanity } from '../services/profanity.ts'
import {
  cmdWarn,
  cmdWarnings,
  cmdClearwarns,
  cmdTimeout,
  cmdKick,
  cmdBan,
  cmdPurge,
  cmdLockdown,
  cmdUnlock,
} from '../services/mod-actions.ts'
import { handleExtraPrefix } from './prefix-extra.ts'
import { BOT_HELP_DESCRIPTION } from '../utils/help-text.ts'
import { isGuildMod } from '../utils/permissions.ts'
import { getEntriesLastMs } from '../services/analytics-store.ts'
import { isComingSoonTopic, randomComingSoonReply } from '../utils/coming-soon.ts'
import { formatModAutomodStatus } from '../utils/automod-status-text.ts'
import { rollDiceSpec } from '../utils/dice.ts'
import { formatSupportLinksMarkdown } from '../utils/support-links.ts'
import { takeReportSlot } from '../utils/report-cooldown.ts'
import { reportUserReport } from '../services/logging.ts'
import { listOpenTickets } from '../services/ticket-store.ts'
import {
  formatOpenTicketsList,
  formatTicketStatsLine,
  ticketAddUser,
  ticketRemoveUser,
} from '../services/ticket-system.ts'

const PREFIX = 'nd!'

const modelDm = getModel(SYSTEM_PROMPT_DM)
const modelGuild = getModel(SYSTEM_PROMPT_GUILD)

const translateLast = new Map<string, number>()
const translateHourBuckets = new Map<string, number[]>()

export function consumeTranslateSlot(userId: string): string | null {
  const now = Date.now()
  let bucket = (translateHourBuckets.get(userId) ?? []).filter((t) => now - t < 3_600_000)
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

  if (cmd === 'help') {
    const embed = ndEmbed()
      .setTitle('[ND] Nightz Development Bot')
      .setDescription(BOT_HELP_DESCRIPTION)
    await msg.reply({ embeds: [embed] })
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
    const embed = ndEmbed().setTitle('FAQ').setDescription(body || '(empty)')
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
      await msg.reply(`Error: ${err.slice(0, 350)}`).catch(() => {})
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
      await msg.reply(`Error: ${err.slice(0, 350)}`).catch(() => {})
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
      await msg.reply(`Error: ${err.slice(0, 350)}`).catch(() => {})
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

    const model =
      msg.channel.type === ChannelType.DM ? modelDm : modelGuild

    try {
      const text = await generateOnce(model, prompt)
      const chunks = chunkText(text)
      for (let i = 0; i < chunks.length; i++) {
        if (i === 0) await msg.reply({ content: chunks[i] })
        else await msg.channel.send({ content: chunks[i] })
      }
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e)
      await msg.reply(`Error: ${err.slice(0, 350)}`).catch(() => {})
    }
    return
  }

  if (cmd === 'ping') {
    const t0 = Date.now()
    const m = await msg.reply('Pong…')
    const ms = Date.now() - t0
    await m.edit(
      `Pong. ~${ms}ms · gateway ${msg.client.ws.ping}ms`,
    )
    return
  }

  if (cmd === 'links') {
    await msg.reply({
      embeds: [
        ndEmbed()
          .setTitle('Support links')
          .setDescription(formatSupportLinksMarkdown()),
      ],
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
      const body = await formatOpenTicketsList(msg.guild.id)
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
      ? `Open a ticket from <#${WELCOME_TICKET_CHANNEL_ID}>.`
      : 'Ask staff where the ticket channel is.'
    if (ticketSystemEnabled && msg.guildId) {
      const n = (await listOpenTickets(msg.guildId)).length
      line += `\n\nOpen tickets in this server: **${n}**`
    }
    line +=
      '\n\nStaff: `nd!tickets` or `nd!ticket list` (same as `/tickets`). `nd!ticketstats` or `nd!ticket stats` (same as `/ticketstats`).'
    await msg.reply(line.slice(0, 2000))
    return
  }

  if (cmd === 'tickets' || cmd === 'ticket-list' || cmd === 'ticketlist') {
    const member = await guildMemberForModCheck(msg)
    if (!msg.guild || !member || !isGuildMod(member)) {
      await msg.reply(
        'Moderator only. This is the prefix for `/tickets` (list open tickets).',
      )
      return
    }
    const body = await formatOpenTicketsList(msg.guild.id)
    await msg.reply(body.slice(0, 2000))
    return
  }

  if (cmd === 'ticketstats') {
    const member = await guildMemberForModCheck(msg)
    if (!msg.guild || !member || !isGuildMod(member)) {
      await msg.reply(
        'Moderator only. This is the prefix for `/ticketstats`.',
      )
      return
    }
    const line = await formatTicketStatsLine(msg.guild.id)
    await msg.reply(line.slice(0, 2000))
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
      msg.mentions.users.first()?.id ??
      args
        .split(/\s+/)[0]
        ?.replace(/\D/g, '')
        ?.slice(0, 20)
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
      await msg.reply(
        args
          ? `No FAQ entries matching "${args}".`
          : 'No FAQ loaded.',
      )
      return
    }
    const body = matches.slice(0, 10).join('\n\n---\n\n').slice(0, 3500)
    await msg.reply({ embeds: [ndEmbed().setTitle('FAQ search').setDescription(body)] })
    return
  }

  if (cmd === 'product') {
    if (!args) {
      await msg.reply('Usage: `nd!product <name>`')
      return
    }
    const key = args.toUpperCase().replace(/[^A-Z0-9_]/g, '')
    const url = productAliasUrls.get(key)
    if (!url) {
      await msg.reply(`No link for "${args}". Set \`PRODUCT_ALIAS_URLS\` in .env.`)
      return
    }
    await msg.reply(`**${args}** maps to ${url}`)
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
    await msg.reply({ embeds: [ndEmbed().setTitle('Safety').setDescription(base + extra)] })
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
    if ('sendTyping' in msg.channel) await msg.channel.sendTyping()
    const mini = getModel('You only output short risk assessments.')
    const out = await generateOnce(
      mini,
      `Is this message likely a scam or safe? 2-4 sentences. Not legal advice.\n\n${args.slice(0, 2000)}`,
    )
    await msg.reply(
      `${out.slice(0, 3500)}\n\n_When in doubt, don’t click; ask staff._`,
    )
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
    const out = await generateOnce(
      mini,
      `One short paragraph summary:\n\n${args.slice(0, 4000)}`,
    )
    await msg.reply(out.slice(0, 3900))
    return
  }

  await msg.reply(
    `Unknown command: \`nd!${cmd}\`. Type \`nd!help\` for a list.`,
  )
}

async function handleModPrefix(
  msg: Message,
  cmd: string,
  args: string,
): Promise<boolean> {
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
