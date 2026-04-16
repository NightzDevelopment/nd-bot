import { ChannelType, type GuildMember, type Message, type TextChannel, type User } from 'discord.js'
import {
  WARN_KICK_THRESHOLD,
  WARN_TIMEOUT_THRESHOLD,
} from '../config.ts'
import { addWarning, clearWarnings, getWarnings } from './moderation.ts'
import { reportAutomod } from './logging.ts'
import { isGuildMod } from '../utils/permissions.ts'
import { parseDuration } from '../utils/time.ts'

function modReply(msg: Message, text: string): Promise<Message> {
  return msg.reply(text.slice(0, 1900))
}

export async function requireMod(msg: Message): Promise<boolean> {
  if (msg.channel.type === ChannelType.DM) {
    await modReply(msg, 'Moderation commands work in servers only.')
    return false
  }
  const m = msg.member
  if (!m || !isGuildMod(m)) {
    await modReply(msg, 'You need moderator permissions.')
    return false
  }
  return true
}

async function parseUser(msg: Message, raw: string): Promise<User | null> {
  const idMatch = raw.match(/^<@!?(\d+)>/)?.[1] ?? raw.match(/^(\d{17,20})$/)?.[1]
  if (idMatch) {
    try {
      return await msg.client.users.fetch(idMatch)
    } catch {
      return null
    }
  }
  return null
}

export async function cmdWarn(msg: Message, args: string): Promise<void> {
  if (!(await requireMod(msg))) return
  const guild = msg.guild!
  const parts = args.trim().split(/\s+/)
  const userRaw = parts[0]
  const reason = parts.slice(1).join(' ') || 'No reason given'
  if (!userRaw) {
    await modReply(msg, 'Usage: `nd!warn @user [reason]`')
    return
  }
  const user = await parseUser(msg, userRaw)
  if (!user) {
    await modReply(msg, 'User not found.')
    return
  }
  let member: GuildMember | null = null
  try {
    member = await guild.members.fetch(user.id)
  } catch {
    /* may be left */
  }
  const list = await addWarning(guild.id, user.id, {
    at: Date.now(),
    reason,
    moderatorId: msg.author.id,
  })
  await modReply(
    msg,
    `Warned **${user.tag}** (${list.length} total warns). Reason: ${reason}`,
  )
  try {
    await user.send(
      `You received a warning in **${guild.name}**: ${reason}`,
    )
  } catch {
    /* ignore */
  }
  if (member) {
    if (list.length >= WARN_KICK_THRESHOLD && member.kickable) {
      try {
        await member.kick(`AutoMod: ${list.length} warnings`)
        await modReply(msg, 'User kicked automatically (warning threshold).')
      } catch {
        /* ignore */
      }
    } else if (
      list.length >= WARN_TIMEOUT_THRESHOLD &&
      member.moderatable
    ) {
      try {
        await member.timeout(60 * 60 * 1000, `AutoMod: ${list.length} warnings`)
        await modReply(msg, 'User timed out automatically (warning threshold).')
      } catch {
        /* ignore */
      }
    }
  }
}

export async function cmdWarnings(msg: Message, args: string): Promise<void> {
  if (!(await requireMod(msg))) return
  const guild = msg.guild!
  const user = await parseUser(msg, args.trim())
  if (!user) {
    await modReply(msg, 'Usage: `nd!warnings @user`')
    return
  }
  const list = await getWarnings(guild.id, user.id)
  if (list.length === 0) {
    await modReply(msg, 'No warnings for this user.')
    return
  }
  const body = list
    .map(
      (w, i) =>
        `${i + 1}. <t:${Math.floor(w.at / 1000)}:f>, ${w.reason} (by <@${w.moderatorId}>)`,
    )
    .join('\n')
  await modReply(msg, `Warnings for **${user.tag}**:\n${body.slice(0, 1800)}`)
}

export async function cmdClearwarns(msg: Message, args: string): Promise<void> {
  if (!(await requireMod(msg))) return
  const guild = msg.guild!
  const user = await parseUser(msg, args.trim())
  if (!user) {
    await modReply(msg, 'Usage: `nd!clearwarns @user`')
    return
  }
  await clearWarnings(guild.id, user.id)
  await modReply(msg, `Cleared warnings for **${user.tag}**.`)
}

export async function cmdTimeout(msg: Message, args: string): Promise<void> {
  if (!(await requireMod(msg))) return
  const guild = msg.guild!
  const parts = args.trim().split(/\s+/)
  const userRaw = parts[0]
  const durRaw = parts[1]
  const reason = parts.slice(2).join(' ') || 'Timed out by moderator'
  if (!userRaw || !durRaw) {
    await modReply(msg, 'Usage: `nd!timeout @user 10m [reason]`')
    return
  }
  const ms = parseDuration(durRaw)
  if (!ms || ms > 28 * 24 * 60 * 60 * 1000) {
    await modReply(msg, 'Invalid duration. Use e.g. `10m`, `2h`, `1d`.')
    return
  }
  const user = await parseUser(msg, userRaw)
  if (!user) {
    await modReply(msg, 'User not found.')
    return
  }
  const member = await guild.members.fetch(user.id).catch(() => null)
  if (!member?.moderatable) {
    await modReply(msg, 'Cannot timeout this user.')
    return
  }
  await member.timeout(ms, reason)
  await modReply(msg, `**${user.tag}** timed out for ${durRaw}.`)
}

export async function cmdKick(msg: Message, args: string): Promise<void> {
  if (!(await requireMod(msg))) return
  const guild = msg.guild!
  const parts = args.trim().split(/\s+/)
  const userRaw = parts[0]
  const reason = parts.slice(1).join(' ') || 'Kicked by moderator'
  if (!userRaw) {
    await modReply(msg, 'Usage: `nd!kick @user [reason]`')
    return
  }
  const user = await parseUser(msg, userRaw)
  if (!user) {
    await modReply(msg, 'User not found.')
    return
  }
  const member = await guild.members.fetch(user.id).catch(() => null)
  if (!member?.kickable) {
    await modReply(msg, 'Cannot kick this user.')
    return
  }
  await member.kick(reason)
  await modReply(msg, `Kicked **${user.tag}**.`)
}

export async function cmdBan(msg: Message, args: string): Promise<void> {
  if (!(await requireMod(msg))) return
  const guild = msg.guild!
  const parts = args.trim().split(/\s+/)
  const userRaw = parts[0]
  const reason = parts.slice(1).join(' ') || 'Banned by moderator'
  if (!userRaw) {
    await modReply(msg, 'Usage: `nd!ban @user [reason]`')
    return
  }
  const user = await parseUser(msg, userRaw)
  if (!user) {
    await modReply(msg, 'User not found.')
    return
  }
  await guild.members.ban(user, { reason })
  await modReply(msg, `Banned **${user.tag}**.`)
}

export async function cmdPurge(msg: Message, args: string): Promise<void> {
  if (!(await requireMod(msg))) return
  const ch = msg.channel
  if (!ch.isTextBased() || ch.isDMBased()) {
    await modReply(msg, 'Use purge in a text channel.')
    return
  }
  const n = Math.min(100, Math.max(1, parseInt(args.trim(), 10) || 0))
  if (!n) {
    await modReply(msg, 'Usage: `nd!purge 1-100`')
    return
  }
  const textCh = ch as TextChannel
  const deleted = await textCh.bulkDelete(n, true).catch(() => null)
  if (!deleted) {
    await modReply(msg, 'Bulk delete failed (messages may be too old).')
    return
  }
  const reply = await modReply(msg, `Deleted ${deleted.size} message(s).`)
  setTimeout(() => reply.delete().catch(() => {}), 5000)
}

export async function cmdLockdown(msg: Message): Promise<void> {
  if (!(await requireMod(msg))) return
  const { lockdownGuilds } = await import('./lockdown.ts')
  lockdownGuilds.add(msg.guild!.id)
  await modReply(
    msg,
    'Lockdown enabled, non-moderator messages will be deleted. Use `nd!unlock`.',
  )
  await reportAutomod(msg, 'Lockdown enabled', 'manual')
}

export async function cmdUnlock(msg: Message): Promise<void> {
  if (!(await requireMod(msg))) return
  const { lockdownGuilds } = await import('./lockdown.ts')
  lockdownGuilds.delete(msg.guild!.id)
  await modReply(msg, 'Lockdown disabled.')
}
