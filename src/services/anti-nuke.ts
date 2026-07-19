/**
 * Anti-nuke: detect a rogue or compromised admin performing destructive actions
 * in bulk (mass channel/role deletes or creates, mass bans/kicks, webhook spam)
 * and stop them automatically.
 *
 * Uses GuildAuditLogEntryCreate to attribute each action to an executor, counts
 * dangerous actions per executor of the same type in a rolling window, and on a
 * threshold breach takes the configured action (strip the actor's roles,
 * quarantine, or ban) and alerts the owner + staff. The guild owner, the bot,
 * and ANTINUKE_WHITELIST_IDS are always exempt.
 *
 * IMPORTANT: the bot can only stop an actor whose highest role is BELOW the
 * bot's. Keep the bot's role near the top of the hierarchy, or it can only
 * alert. Requires the View Audit Log permission (GuildModeration intent is on).
 */
import {
  AuditLogEvent,
  type Client,
  Events,
  type Guild,
  type GuildAuditLogsEntry,
} from 'discord.js'
import {
  antiNukeAction,
  antiNukeEnabled,
  antiNukeThreshold,
  antiNukeWhitelistIds,
  antiNukeWindowMs,
  quarantineRoleId,
  safeguardChannelId,
} from '../config.ts'
import { quarantineMember } from './profile-scan.ts'
import { ndEmbed } from '../utils/embed.ts'

/** Dangerous audit actions we watch, with a human label. */
const WATCHED: Partial<Record<number, string>> = {
  [AuditLogEvent.ChannelDelete]: 'channel deletions',
  [AuditLogEvent.ChannelCreate]: 'channel creations',
  [AuditLogEvent.RoleDelete]: 'role deletions',
  [AuditLogEvent.RoleCreate]: 'role creations',
  [AuditLogEvent.MemberBanAdd]: 'member bans',
  [AuditLogEvent.MemberKick]: 'member kicks',
  [AuditLogEvent.WebhookCreate]: 'webhook creations',
}

// executorId -> actionType -> timestamps within the window
const activity = new Map<string, Map<number, number[]>>()
// actors already punished in the current burst (avoid repeat actions on the same nuke)
const punished = new Set<string>()

function record(executorId: string, action: number, now: number): number {
  let byAction = activity.get(executorId)
  if (!byAction) {
    byAction = new Map()
    activity.set(executorId, byAction)
  }
  const arr = (byAction.get(action) ?? []).filter((t) => now - t < antiNukeWindowMs)
  arr.push(now)
  byAction.set(action, arr)
  return arr.length
}

async function alert(guild: Guild, embed: ReturnType<typeof ndEmbed>): Promise<void> {
  if (safeguardChannelId) {
    const ch = await guild.channels.fetch(safeguardChannelId).catch(() => null)
    if (ch?.isTextBased() && 'send' in ch) {
      await ch.send({ content: `<@${guild.ownerId}>`, embeds: [embed] }).catch(() => undefined)
    }
  }
  const owner = await guild.members.fetch(guild.ownerId).catch(() => null)
  await owner?.send({ embeds: [embed] }).catch(() => undefined)
}

async function punish(
  guild: Guild,
  executorId: string,
  label: string,
  count: number,
): Promise<void> {
  if (punished.has(executorId)) return
  punished.add(executorId)
  setTimeout(() => punished.delete(executorId), 60_000)

  const me = guild.members.me
  const member = await guild.members.fetch(executorId).catch(() => null)
  let taken = 'alerted only (could not resolve the member)'

  if (member && me) {
    const canManage =
      member.id !== guild.ownerId && member.roles.highest.position < me.roles.highest.position
    if (!canManage) {
      taken = 'COULD NOT ACT: their role is above the bot (or they are the owner). Move the bot higher.'
    } else if (antiNukeAction === 'ban') {
      taken = member.bannable
        ? await member
            .ban({ reason: `Anti-nuke: ${label} x${count}` })
            .then(() => 'banned')
            .catch(() => 'ban failed (check permissions)')
        : 'not bannable'
    } else if (antiNukeAction === 'quarantine' && quarantineRoleId) {
      taken = await quarantineMember(member, `Anti-nuke: ${label} x${count}`)
    } else {
      // strip: remove every role the bot can manage so they lose dangerous perms
      const ids = member.roles.cache
        .filter((r) => r.id !== guild.id && !r.managed && r.position < me.roles.highest.position)
        .map((r) => r.id)
      taken = ids.length
        ? await member.roles
            .remove(ids, `Anti-nuke: ${label} x${count}`)
            .then(() => `stripped ${ids.length} role(s)`)
            .catch(() => 'strip failed (check permissions)')
        : 'no removable roles'
    }
  }

  const embed = ndEmbed()
    .setColor(0xff0000)
    .setTitle('ANTI-NUKE TRIGGERED')
    .setDescription(
      `<@${executorId}> \`${executorId}\` performed **${count} ${label}** within ` +
        `${Math.round(antiNukeWindowMs / 1000)}s.\n\nAction taken: **${taken}**`,
    )
    .setTimestamp()
  await alert(guild, embed)
}

export function registerAntiNuke(client: Client): void {
  if (!antiNukeEnabled) return
  client.on(
    Events.GuildAuditLogEntryCreate,
    async (entry: GuildAuditLogsEntry, guild: Guild) => {
      try {
        const label = WATCHED[entry.action as number]
        if (!label) return
        const executorId = entry.executorId
        if (!executorId) return
        if (executorId === client.user?.id) return
        if (executorId === guild.ownerId) return
        if (antiNukeWhitelistIds.has(executorId)) return

        const count = record(executorId, entry.action as number, Date.now())
        if (count >= antiNukeThreshold) {
          await punish(guild, executorId, label, count)
        }
      } catch (e) {
        console.error('[anti-nuke]', e)
      }
    },
  )
}
