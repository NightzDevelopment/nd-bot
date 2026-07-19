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
} from 'discord.js'
import { inviteLogChannelId, inviteRewardRoles, inviteTrackingEnabled } from '../config.ts'
import { readJson, writeJson } from './data-store.ts'
import { ndEmbed } from '../utils/embed.ts'

const FILE = 'invites.json'
interface InviteData {
  /** inviterId -> net credited invites */
  inviters: Record<string, number>
  /** joinedMemberId -> inviterId, so a leave can reverse the credit */
  joinedBy: Record<string, string>
}
let data: InviteData | null = null

async function load(): Promise<InviteData> {
  if (!data) data = await readJson<InviteData>(FILE, { inviters: {}, joinedBy: {} })
  return data
}
async function save(): Promise<void> {
  await writeJson(FILE, await load())
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
  if (!inviteTrackingEnabled) return

  client.once(Events.ClientReady, async () => {
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
  if (!inviteTrackingEnabled) {
    await msg.reply('Invite tracking is off. An admin can enable it with `INVITE_TRACKING_ENABLED=1`.')
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
