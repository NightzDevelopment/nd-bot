/**
 * Slash `/polls` and prefix `nd!polls` — native Discord polls in configured channel(s).
 */
import {
  type ChatInputCommandInteraction,
  type GuildMember,
  type Message,
  MessageFlags,
} from 'discord.js'
import { isGuildMod } from '../utils/permissions.ts'
import { addPollPin, removePollPin } from './poll-pins.ts'
import {
  botCanPostPolls,
  buildActivePollsEmbed,
  endPollInPollChannels,
  findPollMessageInPollChannels,
  POLLS_ANSWER_MAX,
  POLLS_FETCH_LIMIT,
  POLLS_QUESTION_MAX,
  pollsChannelsConfigured,
  resolvePollsTargetChannel,
  sendNativePoll,
} from './polls-native.ts'

async function memberForAuthor(msg: Message): Promise<GuildMember | null> {
  if (!msg.guild) return null
  if (msg.member) return msg.member
  try {
    return await msg.guild.members.fetch(msg.author.id)
  } catch {
    return null
  }
}

export async function handlePollsSlash(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand(true)

  if (!pollsChannelsConfigured()) {
    await interaction.reply({
      content:
        'No polls channel is configured. Set `POLL_REMINDER_CHANNEL_IDS` in `.env` to your Polls channel ID.',
      flags: MessageFlags.Ephemeral,
    })
    return
  }

  if (!interaction.guild) {
    await interaction.reply({
      content: 'Use this command in a server.',
      flags: MessageFlags.Ephemeral,
    })
    return
  }

  if (sub === 'list') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral })
    const r = await buildActivePollsEmbed(interaction.guild)
    if (r === 'not_configured') {
      await interaction.editReply({
        content: 'No polls channel is configured. Set `POLL_REMINDER_CHANNEL_IDS` in `.env`.',
      })
      return
    }
    if ('empty' in r && r.empty) {
      await interaction.editReply({
        content:
          'No active native polls found in the configured polls channel(s) (deep scan: several message pages per channel + staff bookmarks).',
      })
      return
    }
    if ('embed' in r) {
      await interaction.editReply({ embeds: [r.embed] })
    }
    return
  }

  const member = await interaction.guild.members.fetch(interaction.user.id)
  if (!isGuildMod(member)) {
    await interaction.reply({ content: 'Moderator only.', flags: MessageFlags.Ephemeral })
    return
  }

  if (sub === 'create') {
    const question = interaction.options
      .getString('question', true)
      .trim()
      .slice(0, POLLS_QUESTION_MAX)
    const answersRaw = interaction.options.getString('answers', true)
    const parts = answersRaw
      .split('|')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 10)
      .map((s) => s.slice(0, POLLS_ANSWER_MAX))
    if (parts.length < 2) {
      await interaction.reply({
        content: 'Need at least **2** options. Use `Option A | Option B | Option C`.',
        flags: MessageFlags.Ephemeral,
      })
      return
    }
    const duration = interaction.options.getInteger('duration_hours') ?? 24
    const allowMultiselect = interaction.options.getBoolean('multiselect') ?? false

    const chOpt = interaction.options.getChannel('channel')
    const channelId = chOpt?.id ?? null
    const resolved = await resolvePollsTargetChannel(interaction.guild, channelId)
    if (!resolved.ok) {
      await interaction.reply({ content: resolved.error, flags: MessageFlags.Ephemeral })
      return
    }
    const target = resolved.channel

    const me = interaction.guild.members.me
    const permErr = botCanPostPolls(me, target)
    if (permErr) {
      await interaction.reply({ content: permErr, flags: MessageFlags.Ephemeral })
      return
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral })
    const out = await sendNativePoll({
      question,
      answers: parts,
      durationHours: duration,
      allowMultiselect,
      target,
    })
    if (out.ok) {
      await interaction.editReply({
        content: `Posted native poll in ${target}: ${out.url}`,
      })
    } else {
      await interaction.editReply(`Failed to post poll: ${out.error}`)
    }
    return
  }

  if (sub === 'end') {
    const messageId = interaction.options.getString('message_id', true).trim()
    if (!/^\d{17,20}$/.test(messageId)) {
      await interaction.reply({
        content: 'Invalid message ID (numeric snowflake).',
        flags: MessageFlags.Ephemeral,
      })
      return
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral })
    const result = await endPollInPollChannels(interaction.guild, messageId)
    if (result.ok) {
      await interaction.editReply(
        `Poll ended: https://discord.com/channels/${interaction.guild.id}/${result.channelId}/${messageId}`,
      )
      return
    }
    if (result.error === 'not_found') {
      await interaction.editReply(
        'No poll message with that ID in your configured polls channel(s), or it is not a native poll.',
      )
      return
    }
    await interaction.editReply(`Could not end poll: ${result.detail ?? 'unknown error'}`)
    return
  }

  if (sub === 'pin' || sub === 'unpin') {
    const messageId = interaction.options.getString('message_id', true).trim()
    if (!/^\d{17,20}$/.test(messageId)) {
      await interaction.reply({ content: 'Invalid message ID.', flags: MessageFlags.Ephemeral })
      return
    }
    const found = await findPollMessageInPollChannels(interaction.guild, messageId)
    if (!found?.poll) {
      await interaction.reply({
        content: 'Poll not found in configured polls channel(s).',
        flags: MessageFlags.Ephemeral,
      })
      return
    }
    if (sub === 'pin') {
      await addPollPin(interaction.guild.id, messageId)
      await interaction.reply({
        content: `Bookmarked poll ${found.url} (shown in \`/polls list\`).`,
        flags: MessageFlags.Ephemeral,
      })
    } else {
      await removePollPin(interaction.guild.id, messageId)
      await interaction.reply({ content: 'Removed bookmark.', flags: MessageFlags.Ephemeral })
    }
    return
  }

  if (sub === 'stats') {
    const messageId = interaction.options.getString('message_id', true).trim()
    if (!/^\d{17,20}$/.test(messageId)) {
      await interaction.reply({ content: 'Invalid message ID.', flags: MessageFlags.Ephemeral })
      return
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral })
    const found = await findPollMessageInPollChannels(interaction.guild, messageId)
    if (!found?.poll) {
      await interaction.editReply('Poll not found in configured polls channel(s).')
      return
    }
    const p = found.poll
    const q = p.question.text?.trim() || 'Poll'
    const lines: string[] = [`**${q.slice(0, 500)}**`]
    for (const ans of p.answers.values()) {
      const n = 'voteCount' in ans && typeof ans.voteCount === 'number' ? ans.voteCount : 0
      const label = ans.text?.trim() ?? `Answer ${ans.id}`
      lines.push(`• ${label}: **${n}**`)
    }
    await interaction.editReply(lines.join('\n').slice(0, 1900))
  }
}

/** Prefix `nd!polls` — returns true if handled. */
export async function handlePollsPrefix(msg: Message, args: string): Promise<boolean> {
  if (!msg.guild) {
    await msg.reply('Use this command in a server.')
    return true
  }

  if (!pollsChannelsConfigured()) {
    await msg.reply(
      'No polls channel is configured. Set `POLL_REMINDER_CHANNEL_IDS` in `.env` to your Polls channel ID.',
    )
    return true
  }

  const trimmed = args.trim()
  const first = trimmed.split(/\s+/)[0]?.toLowerCase() ?? ''

  if (!trimmed || first === 'list') {
    const r = await buildActivePollsEmbed(msg.guild)
    if (r === 'not_configured') {
      await msg.reply('No polls channel is configured. Set `POLL_REMINDER_CHANNEL_IDS` in `.env`.')
      return true
    }
    if ('empty' in r && r.empty) {
      await msg.reply(
        'No active native polls found (deep scan + bookmarks). Use `/polls create` or `nd!polls create` to add one.',
      )
      return true
    }
    if ('embed' in r) {
      await msg.reply({ embeds: [r.embed] })
    }
    return true
  }

  const member = await memberForAuthor(msg)
  if (!member || !isGuildMod(member)) {
    await msg.reply('Moderator only.')
    return true
  }

  if (first === 'end') {
    const id = trimmed
      .replace(/^end\s+/i, '')
      .trim()
      .split(/\s+/)[0]
    if (!id || !/^\d{17,20}$/.test(id)) {
      await msg.reply('Usage: `nd!polls end <message_id>` (right-click poll → Copy ID)')
      return true
    }
    const result = await endPollInPollChannels(msg.guild, id)
    if (result.ok) {
      await msg.reply(
        `Poll ended: https://discord.com/channels/${msg.guild.id}/${result.channelId}/${id}`,
      )
      return true
    }
    if (result.error === 'not_found') {
      await msg.reply(
        'No poll message with that ID in your configured polls channel(s), or it is not a native poll.',
      )
      return true
    }
    await msg.reply(`Could not end poll: ${result.detail ?? 'unknown error'}`)
    return true
  }

  if (first === 'pin' || first === 'unpin' || first === 'stats') {
    const id = trimmed.split(/\s+/)[1]
    if (!id || !/^\d{17,20}$/.test(id)) {
      await msg.reply(
        'Usage: `nd!polls pin <message_id>` · `nd!polls unpin <message_id>` · `nd!polls stats <message_id>`',
      )
      return true
    }
    const found = await findPollMessageInPollChannels(msg.guild, id)
    if (!found?.poll) {
      await msg.reply('Poll not found in configured polls channel(s).')
      return true
    }
    if (first === 'stats') {
      const p = found.poll
      const q = p.question.text?.trim() || 'Poll'
      const lines: string[] = [`**${q.slice(0, 500)}**`]
      for (const ans of p.answers.values()) {
        const n = 'voteCount' in ans && typeof ans.voteCount === 'number' ? ans.voteCount : 0
        const label = ans.text?.trim() ?? `Answer ${ans.id}`
        lines.push(`• ${label}: **${n}**`)
      }
      await msg.reply(lines.join('\n').slice(0, 1900))
      return true
    }
    if (first === 'pin') {
      await addPollPin(msg.guild.id, id)
      await msg.reply(`Bookmarked poll ${found.url}`)
      return true
    }
    await removePollPin(msg.guild.id, id)
    await msg.reply('Removed bookmark.')
    return true
  }

  if (first === 'create') {
    let body = trimmed.replace(/^create\s+/i, '').trim()
    if (!body.includes('|')) {
      await msg.reply(
        'Usage: `nd!polls create [48h] [--multi] [#channel] question | option1 | option2`\n' +
          'Example: `nd!polls create What map next? | Los Santos | Paleto | Sandy`',
      )
      return true
    }

    let allowMultiselect = false
    if (/\b--multi\b/i.test(body)) {
      allowMultiselect = true
      body = body.replace(/\s*--multi\s*/gi, ' ').trim()
    }

    let durationHours = 24
    const hM = body.match(/^(\d{1,3})h\s+/i)
    if (hM) {
      const h = parseInt(hM[1]!, 10)
      if (h >= 1 && h <= 168) {
        durationHours = h
        body = body.slice(hM[0]!.length)
      }
    }

    let channelId: string | null = null
    const chM = body.match(/^<#(\d+)>\s+/)
    if (chM) {
      channelId = chM[1]!
      body = body.slice(chM[0]!.length)
    }

    const parts = body
      .split('|')
      .map((s) => s.trim())
      .filter(Boolean)
    if (parts.length < 2) {
      await msg.reply('Need at least **2** options separated by `|`.')
      return true
    }

    const question = parts[0]!.slice(0, POLLS_QUESTION_MAX)
    const answers = parts.slice(1, 11).map((s) => s.slice(0, POLLS_ANSWER_MAX))
    if (answers.length < 2) {
      await msg.reply('Need at least **2** options after the first `|`.')
      return true
    }

    const resolved = await resolvePollsTargetChannel(msg.guild, channelId)
    if (!resolved.ok) {
      await msg.reply(resolved.error)
      return true
    }
    const target = resolved.channel

    const me = msg.guild.members.me
    const permErr = botCanPostPolls(me, target)
    if (permErr) {
      await msg.reply(permErr)
      return true
    }

    const out = await sendNativePoll({
      question,
      answers,
      durationHours,
      allowMultiselect,
      target,
    })
    if (out.ok) {
      await msg.reply(`Posted native poll in ${target}: ${out.url}`)
    } else {
      await msg.reply(`Failed to post poll: ${out.error}`)
    }
    return true
  }

  await msg.reply(
    'Usage:\n' +
      '• `nd!polls` / `nd!polls list` — active native polls\n' +
      '• `nd!polls create …` · `nd!polls end <id>` · `nd!polls pin|unpin|stats <id>` (mods)\n' +
      '• Reaction polls: `nd!poll` (separate from native polls)',
  )
  return true
}
