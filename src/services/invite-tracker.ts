/**
 * Invite tracking + rewards + live invite logging.
 *
 * Caches each guild's invite uses, then on member join diffs the counts to find
 * which invite was used and credits the inviter. Milestone roles are granted at
 * counts configured in INVITE_REWARD_ROLES. Fake-invite protection: a credit is
 * reversed if the invited member later leaves.
 *
 * Live logging posts an embed to the configured log channel for every join
 * (who invited whom, account age, invite code), leave (inviter credit reversed,
 * how long they stayed), and invite create/delete.
 *
 * Uses the Server Invites gateway intent (always on) and needs the bot's Manage
 * Server permission to read invites. Gated on a runtime flag (nd!invitelb on|off)
 * that defaults to INVITE_TRACKING_ENABLED. Commands: nd!invites [@user],
 * nd!invitelb, nd!invitelb log [#channel|off].
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
  /** Runtime log channel (nd!invitelb log). Falls back to INVITE_LOG_CHANNEL_ID when unset. */
  logChannelId?: string
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
async function setLogChannel(id: string | null): Promise<void> {
  const d = await load()
  if (id) d.logChannelId = id
  else delete d.logChannelId
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

// ---- logging --------------------------------------------------------------

async function resolveLogChannel(guild: Guild) {
  const d = await load()
  const id = d.logChannelId ?? inviteLogChannelId
  if (!id) return null
  const ch = await guild.channels.fetch(id).catch(() => null)
  if (!ch?.isTextBased() || !('send' in ch)) return null
  return ch
}

async function sendLog(guild: Guild, embed: ReturnType<typeof ndEmbed>): Promise<void> {
  const ch = await resolveLogChannel(guild)
  if (ch) await ch.send({ embeds: [embed] }).catch(() => undefined)
}

function humanDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const d = Math.floor(s / 86_400)
  const h = Math.floor((s % 86_400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d) return `${d}d ${h}h`
  if (h) return `${h}h ${m}m`
  if (m) return `${m}m`
  return `${s}s`
}

async function logJoin(
  guild: Guild,
  member: GuildMember,
  inviterId: string | null,
  count: number,
  code: string | null,
): Promise<void> {
  const embed = ndEmbed()
    .setColor(0x2ecc71)
    .setTitle('Member joined')
    .setThumbnail(member.user.displayAvatarURL({ size: 64 }))
    .setDescription(`<@${member.id}> (${member.user.tag})`)
    .addFields(
      {
        name: 'Invited by',
        value: inviterId ? `<@${inviterId}> (**${count}** total)` : 'Unknown',
        inline: true,
      },
      {
        name: 'Account age',
        value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`,
        inline: true,
      },
    )
  if (code) embed.addFields({ name: 'Invite', value: `\`${code}\``, inline: true })
  await sendLog(guild, embed)
}

async function logLeave(
  member: GuildMember | PartialGuildMember,
  inviterId: string | null,
  newTotal: number | null,
): Promise<void> {
  const tag = member.user ? ` (${member.user.tag})` : ''
  const embed = ndEmbed()
    .setColor(0xe74c3c)
    .setTitle('Member left')
    .setDescription(`<@${member.id}>${tag}`)
  if (member.joinedTimestamp) {
    embed.addFields({ name: 'Stayed', value: humanDuration(Date.now() - member.joinedTimestamp), inline: true })
  }
  if (inviterId) {
    embed.addFields({
      name: 'Was invited by',
      value: `<@${inviterId}> (now **${newTotal ?? 0}**)`,
      inline: true,
    })
  }
  await sendLog(member.guild, embed)
}

// ---- registration ---------------------------------------------------------

export function registerInviteTracker(client: Client): void {
  // Listeners always attach; each no-ops unless tracking is enabled at runtime.
  client.once(Events.ClientReady, async () => {
    if (!(await isEnabled())) return
    for (const guild of client.guilds.cache.values()) await snapshotGuild(guild)
  })

  client.on(Events.InviteCreate, async (inv) => {
    const guildId = inv.guild?.id
    if (!guildId) return
    const m = cache.get(guildId) ?? new Map<string, number>()
    m.set(inv.code, inv.uses ?? 0)
    cache.set(guildId, m)
    if (!(await isEnabled())) return
    const guild = client.guilds.cache.get(guildId)
    if (!guild) return
    const parts = [`Code \`${inv.code}\``]
    if (inv.inviter) parts.push(`by <@${inv.inviter.id}>`)
    if (inv.maxUses) parts.push(`max uses ${inv.maxUses}`)
    if (inv.expiresTimestamp) parts.push(`expires <t:${Math.floor(inv.expiresTimestamp / 1000)}:R>`)
    await sendLog(guild, ndEmbed().setColor(0x3498db).setTitle('Invite created').setDescription(parts.join(' · ')))
  })

  client.on(Events.InviteDelete, async (inv) => {
    const guildId = inv.guild?.id
    if (!guildId) return
    cache.get(guildId)?.delete(inv.code)
    if (!(await isEnabled())) return
    const guild = client.guilds.cache.get(guildId)
    if (!guild) return
    await sendLog(guild, ndEmbed().setColor(0x95a5a6).setTitle('Invite deleted').setDescription(`Code \`${inv.code}\``))
  })

  client.on(Events.GuildMemberAdd, async (member: GuildMember) => {
    try {
      if (!(await isEnabled())) return
      const guild = member.guild
      const before = cache.get(guild.id) ?? new Map<string, number>()
      let inviterId: string | null = null
      let usedCode: string | null = null
      try {
        const current = await guild.invites.fetch()
        for (const inv of current.values()) {
          if ((inv.uses ?? 0) > (before.get(inv.code) ?? 0)) {
            inviterId = inv.inviterId ?? inv.inviter?.id ?? null
            usedCode = inv.code
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
        await logJoin(guild, member, inviterId, total, usedCode)
      } else {
        await logJoin(guild, member, null, 0, usedCode)
      }
    } catch (e) {
      console.error('[invites] join', e)
    }
  })

  client.on(Events.GuildMemberRemove, async (member: GuildMember | PartialGuildMember) => {
    try {
      if (!(await isEnabled())) return
      const d = await load()
      const inviter = d.joinedBy[member.id] ?? null
      let newTotal: number | null = null
      if (inviter) {
        // Leaves subtract past zero: a net-negative score means more of this
        // inviter's joins have left than stayed.
        newTotal = (d.inviters[inviter] ?? 0) - 1
        d.inviters[inviter] = newTotal
        delete d.joinedBy[member.id]
        await save()
      }
      await logLeave(member, inviter, newTotal)
    } catch (e) {
      console.error('[invites] leave', e)
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

// ---- commands -------------------------------------------------------------

export async function handleInviteCommand(msg: Message, cmd: string, args: string): Promise<boolean> {
  if (cmd !== 'invites' && cmd !== 'invitelb' && cmd !== 'inviteleaderboard') return false
  if (!msg.guild) {
    await msg.reply('Use this in a server.')
    return true
  }
  const guild = msg.guild
  const parts = args.trim().split(/\s+/).filter(Boolean)
  const sub = (parts[0] ?? '').toLowerCase()

  // Staff: set/clear the live log channel.
  if (sub === 'log') {
    const member = msg.member ?? (await guild.members.fetch(msg.author.id).catch(() => null))
    if (!isGuildMod(member)) {
      await msg.reply('Staff only.')
      return true
    }
    const arg = (parts[1] ?? '').toLowerCase()
    if (arg === 'off' || arg === 'none' || arg === 'clear') {
      await setLogChannel(null)
      await msg.reply('Invite logging channel cleared.')
      return true
    }
    const mentioned = msg.mentions.channels.first()
    const byId = parts[1] ? guild.channels.cache.get(parts[1].replace(/\D/g, '')) : undefined
    const target = mentioned ?? byId ?? msg.channel
    if (!target || !('id' in target) || !target.isTextBased()) {
      await msg.reply('Usage: `nd!invitelb log [#channel]` (or `nd!invitelb log off`)')
      return true
    }
    await setLogChannel(target.id)
    await msg.reply(`Invite events will now be logged to <#${target.id}>.`)
    return true
  }

  // Staff toggle: nd!invitelb on|off|status (also enable|disable).
  if (['on', 'off', 'enable', 'disable', 'status'].includes(sub)) {
    const member = msg.member ?? (await guild.members.fetch(msg.author.id).catch(() => null))
    if (!isGuildMod(member)) {
      await msg.reply('Staff only.')
      return true
    }
    if (sub === 'status') {
      const d = await load()
      const logId = d.logChannelId ?? inviteLogChannelId
      await msg.reply(
        `Invite tracking is **${(await isEnabled()) ? 'on' : 'off'}**. ` +
          (logId ? `Logging to <#${logId}>.` : 'No log channel set (use `nd!invitelb log #channel`).'),
      )
      return true
    }
    const on = sub === 'on' || sub === 'enable'
    await setEnabled(on)
    if (!on) {
      await msg.reply('Invite tracking is now **off**.')
      return true
    }
    await snapshotGuild(guild) // seed the cache now so the next join is credited
    const canRead = guild.members.me?.permissions.has(PermissionFlagsBits.ManageGuild) ?? false
    await msg.reply(
      canRead
        ? 'Invite tracking is now **on**. I will credit inviters and log joins/leaves.'
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
