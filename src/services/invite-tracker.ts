/**
 * Invite tracking + rewards.
 *
 * Caches each guild's invite uses, then on member join diffs the counts to find
 * which invite was used and credits the inviter. Milestone roles are granted at
 * counts configured in INVITE_REWARD_ROLES. Fake-invite protection: a credit is
 * reversed if the invited member later leaves.
 *
 * Requires the Manage Server permission (to read invites) and the Server Invites
 * gateway intent. Off by default (INVITE_TRACKING_ENABLED). Commands: nd!invites
 * [@user], nd!invitelb.
 */
import {
  type Client,
  Events,
  type Guild,
  type GuildMember,
  type Message,
  type PartialGuildMember,
  PermissionFlagsBits,
} from 'discord.js'
import { inviteLogChannelId, inviteRewardRoles, inviteTrackingEnabled } from '../config.ts'
import { readJson, writeJson } from './data-store.ts'
import { ndEmbed } from '../utils/embed.ts'
import { isGuildMod } from '../utils/permissions.ts'

const FILE = 'invites.json'
interface InviteData {
  /** inviterId -> net credited invites */
  inviters: Record<string, number>
  /** joinedMemberId -> inviterId, so a leave can reverse the credit */
  joinedBy: Record<string, string>
  /** Runtime on/off toggle (nd!invitelb on|off). Falls back to the env default when unset. */
  enabled?: boolean
}
let data: InviteData | null = null

async function load(): Promise<InviteData> {
  if (!data) data = await readJson<InviteData>(FILE, { inviters: {}, joinedBy: {} })
  return data
}
async function save(): Promise<void> {
  await writeJson(FILE, await load())
}

/** Whether tracking is active: runtime override if set, otherwise the env default. */
async function isEnabled(): Promise<boolean> {
  const d = await load()
  return typeof d.enabled === 'boolean' ? d.enabled : inviteTrackingEnabled
}
async function setEnabled(on: boolean): Promise<void> {
  const d = await load()
  d.enabled = on
  await save()
}

// guildId -> (inviteCode -> uses)
const cache = new Map<string, Map<string, number>>()

async function snapshotGuild(guild: Guild): Promise<Map<string, number>> {
  const m = new Map<string, number>()
  try {
    const invites = await guild.invites.fetch()
    for (const inv of invites.values()) m.set(inv.code, inv.uses ?? 0)
  } catch {
    // Missing Manage Server permission, or invites unavailable. Leave empty.
  }
  cache.set(guild.id, m)
  return m
}

export function registerInviteTracker(client: Client): void {
  // Listeners always attach; each no-ops unless tracking is enabled at runtime.
  client.once(Events.ClientReady, async () => {
    if (!(await isEnabled())) return
    for (const guild of client.guilds.cache.values()) await snapshotGuild(guild)
  })

  client.on(Events.InviteCreate, (inv) => {
    if (!inv.guild) return
    const m = cache.get(inv.guild.id) ?? new Map<string, number>()
    m.set(inv.code, inv.uses ?? 0)
    cache.set(inv.guild.id, m)
  })
  client.on(Events.InviteDelete, (inv) => {
    if (inv.guild) cache.get(inv.guild.id)?.delete(inv.code)
  })

  client.on(Events.GuildMemberAdd, async (member: GuildMember) => {
    try {
      if (!(await isEnabled())) return
      const guild = member.guild
      const before = cache.get(guild.id) ?? new Map<string, number>()
      let inviterId: string | null = null
      try {
        const current = await guild.invites.fetch()
        for (const inv of current.values()) {
          if ((inv.uses ?? 0) > (before.get(inv.code) ?? 0)) {
            inviterId = inv.inviterId ?? inv.inviter?.id ?? null
            break
          }
        }
        const next = new Map<string, number>()
        for (const inv of current.values()) next.set(inv.code, inv.uses ?? 0)
        cache.set(guild.id, next)
      } catch {
        // could not read invites this time; fall through to "unknown"
      }

      if (inviterId && inviterId !== member.id) {
        const d = await load()
        const total = (d.inviters[inviterId] ?? 0) + 1
        d.inviters[inviterId] = total
        d.joinedBy[member.id] = inviterId
        await save()
        await maybeReward(guild, inviterId, total)
        await logJoin(guild, member, inviterId, total)
      } else {
        await logJoin(guild, member, null, 0)
      }
    } catch (e) {
      console.error('[invites] join', e)
    }
  })

  client.on(Events.GuildMemberRemove, async (member: GuildMember | PartialGuildMember) => {
    try {
      if (!(await isEnabled())) return
      const d = await load()
      const inviter = d.joinedBy[member.id]
      if (inviter) {
        d.inviters[inviter] = Math.max(0, (d.inviters[inviter] ?? 0) - 1)
        delete d.joinedBy[member.id]
        await save()
      }
    } catch {
      // ignore
    }
  })
}

async function maybeReward(guild: Guild, inviterId: string, count: number): Promise<void> {
  const roleId = inviteRewardRoles[count]
  if (!roleId) return
  const role = guild.roles.cache.get(roleId)
  const me = guild.members.me
  if (!role || !me || me.roles.highest.position <= role.position || role.managed) return
  const inviter = await guild.members.fetch(inviterId).catch(() => null)
  if (inviter && !inviter.roles.cache.has(role.id)) {
    await inviter.roles.add(role, `Invite reward: ${count} invites`).catch(() => undefined)
  }
}

async function logJoin(
  guild: Guild,
  member: GuildMember,
  inviterId: string | null,
  count: number,
): Promise<void> {
  if (!inviteLogChannelId) return
  const ch = await guild.channels.fetch(inviteLogChannelId).catch(() => null)
  if (!ch?.isTextBased() || !('send' in ch)) return
  const desc = inviterId
    ? `${member} was invited by <@${inviterId}> (now **${count}** invite${count === 1 ? '' : 's'})`
    : `${member} joined (inviter unknown)`
  await ch.send({ embeds: [ndEmbed().setDescription(desc)] }).catch(() => undefined)
}

export async function handleInviteCommand(msg: Message, cmd: string, args: string): Promise<boolean> {
  if (cmd !== 'invites' && cmd !== 'invitelb' && cmd !== 'inviteleaderboard') return false
  if (!msg.guild) {
    await msg.reply('Use this in a server.')
    return true
  }

  // Staff toggle: nd!invitelb on|off|status (also enable|disable).
  const action = args.trim().toLowerCase()
  if (['on', 'off', 'enable', 'disable', 'status'].includes(action)) {
    const member = msg.member ?? (await msg.guild.members.fetch(msg.author.id).catch(() => null))
    if (!isGuildMod(member)) {
      await msg.reply('Staff only.')
      return true
    }
    if (action === 'status') {
      await msg.reply(`Invite tracking is **${(await isEnabled()) ? 'on' : 'off'}**.`)
      return true
    }
    const on = action === 'on' || action === 'enable'
    await setEnabled(on)
    if (!on) {
      await msg.reply('Invite tracking is now **off**.')
      return true
    }
    await snapshotGuild(msg.guild) // seed the cache now so the next join is credited
    const canRead = msg.guild.members.me?.permissions.has(PermissionFlagsBits.ManageGuild) ?? false
    await msg.reply(
      canRead
        ? 'Invite tracking is now **on**. I will credit inviters when members join.'
        : 'Invite tracking is now **on**, but I am missing the **Manage Server** permission, so I cannot read invites. Grant it and joins will be credited.',
    )
    return true
  }

  if (!(await isEnabled())) {
    await msg.reply('Invite tracking is off. Staff can turn it on with `nd!invitelb on`.')
    return true
  }
  const d = await load()

  if (cmd === 'invites') {
    const target = msg.mentions.users.first() ?? msg.author
    const n = d.inviters[target.id] ?? 0
    await msg.reply(`${target} has **${n}** invite${n === 1 ? '' : 's'}.`)
    return true
  }

  const top = Object.entries(d.inviters)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
  if (top.length === 0) {
    await msg.reply('No invites tracked yet.')
    return true
  }
  const lines = top.map(([id, n], i) => `**${i + 1}.** <@${id}> - ${n} invite${n === 1 ? '' : 's'}`)
  await msg.reply({
    embeds: [ndEmbed().setTitle('Invite leaderboard').setDescription(lines.join('\n'))],
  })
  return true
}
