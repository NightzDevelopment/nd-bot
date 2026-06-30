import { randomBytes } from 'node:crypto'
import { ChannelType, EmbedBuilder, type Message, PermissionFlagsBits } from 'discord.js'
import { SUGGESTION_CHANNEL_ID, TEMPVC_CATEGORY_ID, TEMPVC_LOBBY_ID } from '../config.ts'
import {
  type GiveawayEntry,
  getByMessageId,
  getGiveawayById,
  listGiveaways,
  saveGiveaway,
} from '../services/giveaways-store.ts'
import { handleMassRoleCommand } from '../services/mass-role.ts'
import { handlePollsPrefix } from '../services/polls-slash.ts'
import { addReactionRole } from '../services/roles-config.ts'
import {
  addSchedule,
  listSchedules,
  removeSchedule,
  updateSchedule,
} from '../services/scheduler-store.ts'
import { addSuggestion, findById, listOpen, setStatus } from '../services/suggestions-store.ts'
import { ndEmbed } from '../utils/embed.ts'
import { isGuildMod } from '../utils/permissions.ts'
import { buildServerInfoEmbed } from '../utils/server-info.ts'
import { parseDuration, parseScheduleDelay } from '../utils/time.ts'
import { buildUserInfoEmbed } from '../utils/user-info.ts'

/** Discord reaction emojis as Unicode escapes (no emoji literals in source). */
const E_PARTY = '\u{1F389}'
const E_RADIO = '\u{1F518}'
const E_KEYCAP_10 = '\u{1F51F}'
const E_YES = '\u2705'
const E_NO = '\u274C'

function keycapDigit(n: number): string {
  if (n >= 1 && n <= 9) return `${String.fromCharCode(0x30 + n)}\uFE0F\u20E3`
  if (n === 10) return E_KEYCAP_10
  return E_RADIO
}

const POLL_REACTS: readonly string[] = [
  keycapDigit(1),
  keycapDigit(2),
  keycapDigit(3),
  keycapDigit(4),
  keycapDigit(5),
  keycapDigit(6),
  keycapDigit(7),
  keycapDigit(8),
  keycapDigit(9),
  keycapDigit(10),
]

const tempVcOwners = new Map<string, string>()

export async function handleExtraPrefix(msg: Message, cmd: string, args: string): Promise<boolean> {
  if (cmd === 'polls') {
    return handlePollsPrefix(msg, args)
  }

  if (cmd === 'mass-role' || cmd === 'massrole') {
    return handleMassRoleCommand(msg, args)
  }

  if (cmd === 'serverinfo') {
    if (!msg.guild) return true
    const embed = await buildServerInfoEmbed(msg.guild)
    await msg.reply({ embeds: [embed] })
    return true
  }

  if (cmd === 'userinfo') {
    const user =
      msg.mentions.users.first() ??
      (args.trim() ? await msg.client.users.fetch(args.trim()).catch(() => null) : msg.author)
    if (!user) {
      await msg.reply('User not found.')
      return true
    }
    let member = msg.guild?.members.cache.get(user.id) ?? null
    if (msg.guild) {
      member = await msg.guild.members.fetch(user.id).catch(() => member)
    }
    const embed = await buildUserInfoEmbed(user, member)
    await msg.reply({ embeds: [embed] })
    return true
  }

  if (cmd === 'avatar') {
    const user = msg.mentions.users.first() ?? msg.author
    await msg.reply(user.displayAvatarURL({ size: 512 }))
    return true
  }

  if (cmd === 'poll') {
    const parts = args
      .split('|')
      .map((s) => s.trim())
      .filter(Boolean)
    if (parts.length < 2) {
      await msg.reply('Usage: `nd!poll question | option1 | option2`')
      return true
    }
    const question = parts[0]!
    const opts = parts.slice(1, 11)
    const embed = ndEmbed().setTitle('Poll').setDescription(`**${question}**`)
    const p = await msg.reply({ embeds: [embed] })
    for (let i = 0; i < opts.length; i++) {
      await p.react(POLL_REACTS[i] ?? E_RADIO).catch(() => {})
    }
    return true
  }

  if (cmd === 'announce') {
    if (!msg.guild || !isGuildMod(msg.member)) {
      await msg.reply('Moderator only.')
      return true
    }
    const chM = args.match(/^<#(\d+)>\s+([\s\S]+)/)
    if (!chM) {
      await msg.reply('Usage: `nd!announce #channel message`')
      return true
    }
    const ch = await msg.guild.channels.fetch(chM[1]!).catch(() => null)
    if (!ch?.isTextBased()) {
      await msg.reply('Invalid channel.')
      return true
    }
    await ch.send({ embeds: [ndEmbed().setDescription(chM[2]!)] })
    await msg.reply('Posted.')
    return true
  }

  if (cmd === 'say') {
    if (!msg.guild || !isGuildMod(msg.member)) {
      await msg.reply('Moderator only.')
      return true
    }
    const chM = args.match(/^<#(\d+)>\s+([\s\S]+)/)
    if (!chM) {
      await msg.reply('Usage: `nd!say #channel message`')
      return true
    }
    const ch = await msg.guild.channels.fetch(chM[1]!).catch(() => null)
    if (!ch?.isTextBased()) {
      await msg.reply('Invalid channel.')
      return true
    }
    await ch.send(chM[2]!)
    await msg.reply('Sent.')
    return true
  }

  if (cmd === 'reminder') {
    const m = args.match(/^(\S+)\s+([\s\S]+)/)
    if (!m) {
      await msg.reply('Usage: `nd!reminder 10m text`')
      return true
    }
    const ms = parseDuration(m[1]!)
    if (!ms) {
      await msg.reply('Invalid duration.')
      return true
    }
    await msg.reply(`Reminder set for ${m[1]}.`)
    setTimeout(() => {
      msg.reply(`Reminder: ${m[2]}`).catch(() => {})
    }, ms)
    return true
  }

  if (cmd === 'rolereact') {
    if (!msg.guild || !isGuildMod(msg.member)) {
      await msg.reply('Moderator only.')
      return true
    }
    const parts = args.trim().split(/\s+/)
    const chId = parts[0]?.match(/^<#(\d+)>$/)?.[1]
    const messageId = parts[1]
    const roleId = parts[2]?.match(/^<@&(\d+)>$/)?.[1]
    const emoji = parts[3]
    if (!chId || !messageId || !roleId || !emoji) {
      await msg.reply('Usage: `nd!rolereact #channel messageId @Role emoji`')
      return true
    }
    const ch = await msg.guild.channels.fetch(chId).catch(() => null)
    if (!ch?.isTextBased()) {
      await msg.reply('Bad channel.')
      return true
    }
    const m = await ch.messages.fetch(messageId).catch(() => null)
    if (!m) {
      await msg.reply('Message not found.')
      return true
    }
    await m.react(emoji).catch(() => {})
    await addReactionRole({
      guildId: msg.guild.id,
      channelId: ch.id,
      messageId: m.id,
      emoji,
      roleId,
    })
    await msg.reply('Reaction role added.')
    return true
  }

  if (cmd === 'giveaway') {
    if (!msg.guild || !isGuildMod(msg.member)) {
      await msg.reply('Moderator only.')
      return true
    }
    const m = args.match(/^<#(\d+)>\s+(\S+)\s+(\d+)\s+([\s\S]+)/)
    if (!m) {
      await msg.reply('Usage: `nd!giveaway #channel 24h 1 Prize name`')
      return true
    }
    const ms = parseDuration(m[2]!)
    if (!ms) {
      await msg.reply('Bad duration.')
      return true
    }
    const ch = await msg.guild.channels.fetch(m[1]!).catch(() => null)
    if (!ch?.isTextBased()) {
      await msg.reply('Bad channel.')
      return true
    }
    const id = randomBytes(8).toString('hex')
    const endsAt = Date.now() + ms
    const embed = ndEmbed()
      .setTitle('Giveaway')
      .setDescription(
        `**Prize:** ${m[4]}\n**Winners:** ${m[3]}\n**Ends:** <t:${Math.floor(endsAt / 1000)}:R>\n\nUse the reaction on this message to enter.`,
      )
      .setFooter({ text: `ID: ${id}` })
    const gMsg = await ch.send({ embeds: [embed] })
    await gMsg.react(E_PARTY)
    const entry: GiveawayEntry = {
      id,
      guildId: msg.guild.id,
      channelId: ch.id,
      messageId: gMsg.id,
      prize: m[4]!,
      endsAt,
      winnerCount: parseInt(m[3]!, 10) || 1,
      hostId: msg.author.id,
      ended: false,
    }
    await saveGiveaway(entry)
    setTimeout(() => void endGiveawayDraw(msg.client, id), ms)
    await msg.reply('Giveaway started.')
    return true
  }

  if (cmd === 'giveaway-end') {
    if (!isGuildMod(msg.member)) {
      await msg.reply('Moderator only.')
      return true
    }
    const raw = args.trim()
    const g = (await getGiveawayById(raw)) ?? (await getByMessageId(raw))
    if (!g) {
      await msg.reply('Giveaway not found (use message ID or giveaway ID).')
      return true
    }
    await endGiveawayDraw(msg.client, g.id)
    return true
  }

  if (cmd === 'giveaway-list') {
    const list = await listGiveaways()
    await msg.reply(
      list.length
        ? list
            .map((g) => `• ${g.prize}, <t:${Math.floor(g.endsAt / 1000)}:R>`)
            .join('\n')
            .slice(0, 1900)
        : 'No active giveaways.',
    )
    return true
  }

  if (cmd === 'suggest') {
    if (!msg.guild || !SUGGESTION_CHANNEL_ID) {
      await msg.reply('Set `SUGGESTION_CHANNEL_ID` in .env.')
      return true
    }
    const text = args.trim()
    if (!text) {
      await msg.reply('Usage: `nd!suggest your idea`')
      return true
    }
    const ch = await msg.guild.channels.fetch(SUGGESTION_CHANNEL_ID).catch(() => null)
    if (!ch?.isTextBased()) {
      await msg.reply('Suggestion channel invalid.')
      return true
    }
    const id = randomBytes(4).toString('hex')
    const embed = ndEmbed()
      .setTitle(`Suggestion ${id}`)
      .setDescription(text)
      .setFooter({ text: `From ${msg.author.tag}` })
    const sm = await ch.send({ embeds: [embed] })
    await sm.react(E_YES).catch(() => {})
    await sm.react(E_NO).catch(() => {})
    await addSuggestion({
      id,
      guildId: msg.guild.id,
      channelId: ch.id,
      messageId: sm.id,
      authorId: msg.author.id,
      content: text,
      status: 'open',
    })
    await msg.reply('Suggestion posted.')
    return true
  }

  if (cmd === 'approve' || cmd === 'deny') {
    if (!msg.guild || !isGuildMod(msg.member)) {
      await msg.reply('Moderator only.')
      return true
    }
    const parts = args.trim().split(/\s+/)
    const sid = parts[0]
    const reason = parts.slice(1).join(' ')
    if (!sid) {
      await msg.reply(`Usage: \`nd!${cmd} <id> [note]\``)
      return true
    }
    const s = await findById(sid)
    if (!s) {
      await msg.reply('Suggestion not found.')
      return true
    }
    await setStatus(sid, cmd === 'approve' ? 'approved' : 'denied')
    const ch = await msg.guild.channels.fetch(s.channelId).catch(() => null)
    if (ch?.isTextBased()) {
      const m = await ch.messages.fetch(s.messageId).catch(() => null)
      if (m) {
        const e = EmbedBuilder.from(m.embeds[0] ?? new EmbedBuilder())
        e.setColor(cmd === 'approve' ? 0x57f287 : 0xed4245)
        e.addFields({
          name: cmd === 'approve' ? 'Approved' : 'Denied',
          value: reason || '(no note)',
        })
        await m.edit({ embeds: [e] })
      }
    }
    await msg.reply('Updated.')
    return true
  }

  if (cmd === 'suggestions') {
    if (!msg.guild || !isGuildMod(msg.member)) {
      await msg.reply('Moderator only.')
      return true
    }
    const open = await listOpen(msg.guild.id)
    await msg.reply(
      open.length
        ? open
            .map((s) => `• \`${s.id}\`, ${s.content.slice(0, 80)}`)
            .join('\n')
            .slice(0, 1900)
        : 'No open suggestions.',
    )
    return true
  }

  if (cmd === 'schedule') {
    if (!msg.guild || !isGuildMod(msg.member)) {
      await msg.reply('Moderator only.')
      return true
    }
    const m = args.match(/^<#(\d+)>\s+(\S+)\s+([\s\S]+)/)
    if (!m) {
      await msg.reply('Usage: `nd!schedule #channel 2h message`')
      return true
    }
    const delay = parseScheduleDelay(m[2]!)
    if (!delay) {
      await msg.reply('Bad time.')
      return true
    }
    const id = randomBytes(6).toString('hex')
    const runAt = Date.now() + delay
    await addSchedule({
      id,
      guildId: msg.guild.id,
      channelId: m[1]!,
      content: m[3]!,
      runAt,
      repeatMs: null,
      authorId: msg.author.id,
    })
    await msg.reply(`Scheduled \`${id}\` for <t:${Math.floor(runAt / 1000)}:R>.`)
    return true
  }

  if (cmd === 'schedule-list') {
    const list = await listSchedules()
    await msg.reply(
      list.length
        ? list
            .map((s) => `• \`${s.id}\` <#${s.channelId}> <t:${Math.floor(s.runAt / 1000)}:R>`)
            .join('\n')
            .slice(0, 1900)
        : 'No schedules.',
    )
    return true
  }

  if (cmd === 'schedule-cancel') {
    const id = args.trim()
    if (!id) {
      await msg.reply('Usage: `nd!schedule-cancel id`')
      return true
    }
    await removeSchedule(id)
    await msg.reply('Cancelled.')
    return true
  }

  if (cmd === 'vc-limit' || cmd === 'vc-name' || cmd === 'vc-lock' || cmd === 'vc-unlock') {
    if (!msg.guild) return true
    const cid = msg.member?.voice.channelId
    if (!cid) {
      await msg.reply('Join a temp VC first.')
      return true
    }
    const owner = tempVcOwners.get(cid)
    if (owner !== msg.author.id && !isGuildMod(msg.member)) {
      await msg.reply('Not your channel.')
      return true
    }
    const vch = msg.guild.channels.cache.get(cid)
    if (!vch?.isVoiceBased()) return true
    if (cmd === 'vc-limit') {
      const n = parseInt(args.trim(), 10)
      await vch.setUserLimit(n).catch(() => {})
      await msg.reply(`Limit set to ${n}.`)
    } else if (cmd === 'vc-name') {
      await vch.setName(args.trim().slice(0, 90)).catch(() => {})
      await msg.reply('Renamed.')
    } else if (cmd === 'vc-lock') {
      await vch.permissionOverwrites.edit(msg.guild.id, { Connect: false }).catch(() => {})
      await msg.reply('Locked.')
    } else {
      await vch.permissionOverwrites.edit(msg.guild.id, { Connect: null }).catch(() => {})
      await msg.reply('Unlocked.')
    }
    return true
  }

  return false
}

/**
 * Create a giveaway from the dashboard. Posts the announcement, saves the entry,
 * and schedules the draw.
 */
export async function createGiveawayFromDashboard(
  client: import('discord.js').Client,
  opts: {
    guildId: string
    channelId: string
    prize: string
    durationMs: number
    winnerCount: number
    hostId: string
  },
): Promise<{ ok: boolean; data?: GiveawayEntry; error?: string }> {
  const guild = await client.guilds.fetch(opts.guildId).catch(() => null)
  if (!guild) return { ok: false, error: 'Guild not found' }
  const ch = await guild.channels.fetch(opts.channelId).catch(() => null)
  if (!ch?.isTextBased()) return { ok: false, error: 'Channel not text-based' }
  const id = randomBytes(8).toString('hex')
  const endsAt = Date.now() + opts.durationMs
  const embed = ndEmbed()
    .setTitle('Giveaway')
    .setDescription(
      `**Prize:** ${opts.prize}\n**Winners:** ${opts.winnerCount}\n**Ends:** <t:${Math.floor(endsAt / 1000)}:R>\n\nUse the reaction on this message to enter.`,
    )
    .setFooter({ text: `ID: ${id}` })
  const gMsg = await ch.send({ embeds: [embed] })
  await gMsg.react(E_PARTY)
  const entry: GiveawayEntry = {
    id,
    guildId: guild.id,
    channelId: ch.id,
    messageId: gMsg.id,
    prize: opts.prize,
    endsAt,
    winnerCount: opts.winnerCount,
    hostId: opts.hostId,
    ended: false,
  }
  await saveGiveaway(entry)
  setTimeout(() => void endGiveawayDraw(client, id), opts.durationMs)
  return { ok: true, data: entry }
}

export async function endGiveawayDraw(
  client: import('discord.js').Client,
  id: string,
): Promise<{ ok: boolean; winners: string[]; prize?: string }> {
  const {
    getGiveawayById,
    getByMessageId,
    endGiveaway: endG,
  } = await import('../services/giveaways-store.ts')
  const g = (await getGiveawayById(id)) ?? (await getByMessageId(id))
  if (!g || g.ended) return { ok: false, winners: [] }
  const ch = await client.channels.fetch(g.channelId).catch(() => null)
  if (!ch?.isTextBased()) return { ok: false, winners: [] }
  const message = await ch.messages.fetch(g.messageId).catch(() => null)
  if (!message) return { ok: false, winners: [] }
  let react = message.reactions.cache.get(E_PARTY)
  if (!react) {
    await message.fetch().catch(() => {})
    react = message.reactions.cache.get(E_PARTY)
  }
  const users = react ? await react.users.fetch().catch(() => null) : null
  const entrants = users ? [...users.values()].filter((u) => !u.bot) : []
  const winners: string[] = []
  for (let i = 0; i < g.winnerCount && entrants.length > 0; i++) {
    const idx = Math.floor(Math.random() * entrants.length)
    const w = entrants.splice(idx, 1)[0]!
    winners.push(w.toString())
  }
  await endG(g.id)
  const embed = EmbedBuilder.from(message.embeds[0] ?? new EmbedBuilder()).setDescription(
    (message.embeds[0]?.description ?? '') +
      `\n\n**Ended.** Winners: ${winners.length ? winners.join(', ') : 'none'}`,
  )
  await message.edit({ embeds: [embed] })

  // Broadcast to dashboard
  try {
    const { broadcastActivity } = await import('../dashboard/websocket.ts')
    broadcastActivity('giveaway_ended', {
      giveawayId: g.id,
      prize: g.prize,
      winnerCount: winners.length,
      winners: winners.slice(0, 5),
    })
  } catch {
    /* ignore */
  }

  return { ok: true, winners, prize: g.prize }
}

export async function rerollGiveawayDraw(
  client: import('discord.js').Client,
  id: string,
): Promise<{ ok: boolean; winners: string[]; error?: string }> {
  const { getGiveawayById } = await import('../services/giveaways-store.ts')
  const g = await getGiveawayById(id)
  if (!g) return { ok: false, winners: [], error: 'Not found' }
  if (!g.ended) return { ok: false, winners: [], error: 'Giveaway is still active, end it first' }
  const ch = await client.channels.fetch(g.channelId).catch(() => null)
  if (!ch?.isTextBased()) return { ok: false, winners: [], error: 'Channel not accessible' }
  const message = await ch.messages.fetch(g.messageId).catch(() => null)
  if (!message) return { ok: false, winners: [], error: 'Original message gone' }
  let react = message.reactions.cache.get(E_PARTY)
  if (!react) {
    await message.fetch().catch(() => {})
    react = message.reactions.cache.get(E_PARTY)
  }
  const users = react ? await react.users.fetch().catch(() => null) : null
  const entrants = users ? [...users.values()].filter((u) => !u.bot) : []
  const winners: string[] = []
  for (let i = 0; i < g.winnerCount && entrants.length > 0; i++) {
    const idx = Math.floor(Math.random() * entrants.length)
    const w = entrants.splice(idx, 1)[0]!
    winners.push(w.toString())
  }
  if (winners.length > 0 && 'send' in ch) {
    await ch.send(`**Reroll for ${g.prize}**: ${winners.join(', ')}`).catch(() => {})
  }
  return { ok: true, winners }
}

export function registerTempVc(client: import('discord.js').Client): void {
  if (!TEMPVC_LOBBY_ID || !TEMPVC_CATEGORY_ID) return
  client.on('voiceStateUpdate', async (oldS, newS) => {
    try {
      const lobbyId = TEMPVC_LOBBY_ID!
      const catId = TEMPVC_CATEGORY_ID!
      const guild = newS.guild ?? oldS.guild
      if (!guild) return
      if (newS.channelId === lobbyId && newS.member) {
        const name = `${newS.member.displayName}'s channel`
        const vc = await guild.channels.create({
          name: name.slice(0, 90),
          type: ChannelType.GuildVoice,
          parent: catId,
          permissionOverwrites: [
            {
              id: guild.id,
              deny: [PermissionFlagsBits.Connect],
            },
            {
              id: newS.member.id,
              allow: [
                PermissionFlagsBits.Connect,
                PermissionFlagsBits.Speak,
                PermissionFlagsBits.ManageChannels,
              ],
            },
          ],
        })
        tempVcOwners.set(vc.id, newS.member.id)
        await newS.setChannel(vc)
      }
      if (oldS.channelId && oldS.channelId !== lobbyId) {
        const ch = guild.channels.cache.get(oldS.channelId)
        if (ch?.isVoiceBased() && tempVcOwners.has(ch.id) && ch.members.size === 0) {
          setTimeout(async () => {
            const c = guild.channels.cache.get(oldS.channelId!)
            if (c?.isVoiceBased() && c.members.size === 0) {
              tempVcOwners.delete(c.id)
              await c.delete().catch(() => {})
            }
          }, 10_000)
        }
      }
    } catch (e) {
      console.error('[tempvc]', e)
    }
  })
}

export function startScheduleLoop(client: import('discord.js').Client): void {
  setInterval(async () => {
    const { listSchedules, updateSchedule, removeSchedule } = await import(
      '../services/scheduler-store.ts'
    )
    const list = await listSchedules()
    const now = Date.now()
    for (const s of list) {
      if (s.runAt > now) continue
      const ch = await client.channels.fetch(s.channelId).catch(() => null)
      if (ch?.isTextBased() && 'send' in ch) await ch.send(s.content)
      if (s.repeatMs && s.repeatMs > 0) {
        s.runAt = now + s.repeatMs
        await updateSchedule(s)
      } else {
        await removeSchedule(s.id)
      }
    }
  }, 15_000).unref?.()
}

// Resume giveaways across restarts. The per-giveaway setTimeout is in-memory only,
// so a restart (PM2) would otherwise leave any pending giveaway un-drawn forever.
// This polls persisted open giveaways and draws any whose end time has passed.
// endGiveawayDraw guards on `ended`, so it is safe against the surviving timers.
export function startGiveawayLoop(client: import('discord.js').Client): void {
  setInterval(async () => {
    const list = await listGiveaways()
    const now = Date.now()
    for (const g of list) {
      if (g.endsAt > now) continue
      await endGiveawayDraw(client, g.id).catch(() => {})
    }
  }, 15_000).unref?.()
}
