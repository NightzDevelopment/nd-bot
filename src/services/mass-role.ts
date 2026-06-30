/**
 * nd!mass-role: bulk add or remove a role across all members, all members in a
 * role, or a single member.
 *
 * Mass role edits are paced to stay within Discord's rate limits, so each run is
 * a cancellable background job (one per guild) that posts live progress and a
 * final summary. status/cancel read or stop the running job.
 *
 *   nd!mass-role add everyone Member
 *   nd!mass-role add @user VIP
 *   nd!mass-role remove @role Staff
 *   nd!mass-role status
 *   nd!mass-role cancel
 */
import {
  type Guild,
  type GuildMember,
  type Message,
  PermissionFlagsBits,
  type Role,
} from 'discord.js'
import { ndEmbed } from '../utils/embed.ts'

interface MassRoleJob {
  guildId: string
  action: 'add' | 'remove'
  roleName: string
  targetDesc: string
  total: number
  processed: number
  changed: number
  skipped: number
  failed: number
  startedById: string
  cancelled: boolean
  done: boolean
}

const jobs = new Map<string, MassRoleJob>()

/** Pause between role edits. Sequential awaits already pace this; the small gap
 * keeps bursts well under the per-route limit on large guilds. */
const PACE_MS = 300
/** Do not edit the status message more often than this. */
const EDIT_THROTTLE_MS = 2500
/** Keep a finished job readable via `status` for a minute, then drop it. */
const JOB_RETAIN_MS = 60_000

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function resolveRoleByMentionOrName(guild: Guild, query: string): Role | null {
  const mention = query.match(/<@&(\d+)>/)
  if (mention) return guild.roles.cache.get(mention[1] as string) ?? null
  const q = query.trim().toLowerCase()
  if (!q) return null
  return (
    guild.roles.cache.find((r) => r.name.toLowerCase() === q) ??
    guild.roles.cache.find((r) => r.name.toLowerCase().includes(q) && q.length >= 2) ??
    null
  )
}

function memberIdFromToken(token: string): string | null {
  const m = token.match(/^<@!?(\d+)>$/)
  return m ? (m[1] as string) : null
}

function roleIdFromToken(token: string): string | null {
  const m = token.match(/^<@&(\d+)>$/)
  return m ? (m[1] as string) : null
}

function progressEmbed(job: MassRoleJob) {
  const pct = job.total > 0 ? Math.floor((job.processed / job.total) * 100) : 0
  const verb = job.action === 'add' ? 'Adding' : 'Removing'
  const prep = job.action === 'add' ? 'to' : 'from'
  const title = job.done
    ? job.cancelled
      ? 'Mass-role cancelled'
      : 'Mass-role complete'
    : 'Mass-role in progress'
  return ndEmbed()
    .setTitle(title)
    .setDescription(
      `${verb} **${job.roleName}** ${prep} ${job.targetDesc}.\n` +
        `Progress: ${job.processed}/${job.total} (${pct}%)\n` +
        `Changed: ${job.changed}, Skipped: ${job.skipped}, Failed: ${job.failed}`,
    )
}

async function runJob(
  job: MassRoleJob,
  members: GuildMember[],
  role: Role,
  statusMsg: Message,
): Promise<void> {
  const reason = `mass-role ${job.action} by ${job.startedById}`
  let lastEdit = Date.now()
  for (const member of members) {
    if (job.cancelled) break
    try {
      const has = member.roles.cache.has(role.id)
      if (job.action === 'add' && has) {
        job.skipped++
      } else if (job.action === 'remove' && !has) {
        job.skipped++
      } else {
        if (job.action === 'add') await member.roles.add(role, reason)
        else await member.roles.remove(role, reason)
        job.changed++
      }
    } catch {
      job.failed++
    }
    job.processed++
    if (Date.now() - lastEdit > EDIT_THROTTLE_MS) {
      lastEdit = Date.now()
      await statusMsg.edit({ embeds: [progressEmbed(job)] }).catch(() => undefined)
    }
    await sleep(PACE_MS)
  }
  job.done = true
  await statusMsg.edit({ embeds: [progressEmbed(job)] }).catch(() => undefined)
  setTimeout(() => {
    if (jobs.get(job.guildId) === job) jobs.delete(job.guildId)
  }, JOB_RETAIN_MS)
}

const USAGE =
  'Usage: `nd!mass-role <add|remove|status|cancel> <everyone|@member|@role|roleName> <role>`'

export async function handleMassRoleCommand(msg: Message, args: string): Promise<boolean> {
  if (!msg.guild || !msg.member) {
    await msg.reply('Use this in a server.')
    return true
  }
  const guild = msg.guild
  const tokens = args.trim().split(/\s+/).filter(Boolean)
  const sub = (tokens[0] ?? '').toLowerCase()

  if (sub === 'status') {
    const job = jobs.get(guild.id)
    if (!job) {
      await msg.reply('No mass-role job is running.')
      return true
    }
    await msg.reply({ embeds: [progressEmbed(job)] })
    return true
  }

  if (sub === 'cancel') {
    const job = jobs.get(guild.id)
    if (job && !job.done) {
      job.cancelled = true
      await msg.reply('Cancelling the running mass-role job.')
    } else {
      await msg.reply('No mass-role job to cancel.')
    }
    return true
  }

  if (sub !== 'add' && sub !== 'remove') {
    await msg.reply(USAGE)
    return true
  }
  const action: 'add' | 'remove' = sub

  if (!msg.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
    await msg.reply('You need the Manage Roles permission to use this.')
    return true
  }
  const me = guild.members.me
  if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
    await msg.reply('I need the Manage Roles permission to do this.')
    return true
  }

  const existing = jobs.get(guild.id)
  if (existing && !existing.done) {
    await msg.reply(
      'A mass-role job is already running. Use `nd!mass-role status` or `nd!mass-role cancel`.',
    )
    return true
  }

  const targetToken = tokens[1] ?? ''
  const roleQuery = tokens.slice(2).join(' ')
  if (!targetToken || !roleQuery) {
    await msg.reply(USAGE)
    return true
  }

  const role = resolveRoleByMentionOrName(guild, roleQuery)
  if (!role) {
    await msg.reply(`Could not find a role matching "${roleQuery}".`)
    return true
  }
  if (role.managed || role.id === guild.id) {
    await msg.reply('That role cannot be assigned manually (managed by an integration or @everyone).')
    return true
  }
  if (me.roles.highest.position <= role.position) {
    await msg.reply(`My highest role must be above **${role.name}**. Move my role up and try again.`)
    return true
  }
  const isOwner = guild.ownerId === msg.author.id
  const actorIsAdmin = msg.member.permissions.has(PermissionFlagsBits.Administrator)
  if (!isOwner && !actorIsAdmin && msg.member.roles.highest.position <= role.position) {
    await msg.reply('You can only mass-assign roles below your own highest role.')
    return true
  }

  let members: GuildMember[]
  let targetDesc: string
  const memberId = memberIdFromToken(targetToken)
  const roleTargetId = roleIdFromToken(targetToken)
  try {
    if (targetToken.toLowerCase() === 'everyone' || targetToken.toLowerCase() === '@everyone') {
      members = [...(await guild.members.fetch()).values()]
      targetDesc = 'all members'
    } else if (memberId) {
      const m = await guild.members.fetch(memberId).catch(() => null)
      if (!m) {
        await msg.reply('Could not find that member.')
        return true
      }
      members = [m]
      targetDesc = m.user.tag
    } else {
      const targetRole = roleTargetId
        ? (guild.roles.cache.get(roleTargetId) ?? null)
        : resolveRoleByMentionOrName(guild, targetToken)
      if (!targetRole) {
        await msg.reply(`Could not find a target role or member matching "${targetToken}".`)
        return true
      }
      await guild.members.fetch()
      members = [...targetRole.members.values()]
      targetDesc = `members with @${targetRole.name}`
    }
  } catch {
    await msg.reply('Failed to fetch members. Make sure the Server Members intent is enabled.')
    return true
  }

  if (members.length === 0) {
    await msg.reply('No members matched that target.')
    return true
  }

  const job: MassRoleJob = {
    guildId: guild.id,
    action,
    roleName: role.name,
    targetDesc,
    total: members.length,
    processed: 0,
    changed: 0,
    skipped: 0,
    failed: 0,
    startedById: msg.author.id,
    cancelled: false,
    done: false,
  }
  jobs.set(guild.id, job)
  const statusMsg = await msg.reply({ embeds: [progressEmbed(job)] })
  // Fire and forget: the job runs in the background and edits the status message.
  // Guard so a crash still marks it done (otherwise it would block future jobs).
  void runJob(job, members, role, statusMsg).catch(() => {
    job.done = true
  })
  return true
}
