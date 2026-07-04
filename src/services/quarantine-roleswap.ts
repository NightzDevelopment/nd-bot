/**
 * Quarantine role-swap. Watches role changes on members:
 *   - when the quarantine role is ADDED:
 *       - strip-all mode (default): save then remove ALL of the member's other
 *         roles, so they lose access to every channel.
 *       - toggle mode: remove just the configured member (toggle) role.
 *   - when the quarantine role is REMOVED:
 *       - strip-all mode: restore the saved roles.
 *       - toggle mode: add the toggle role back.
 *
 * Works no matter who changes the role (staff, automod/safeguard auto-quarantine,
 * or another bot), since it keys off the role diff in GuildMemberUpdate.
 * Managed roles (bot/booster/integration) and roles above the bot cannot be
 * removed, so they are left in place.
 */
import { type Client, Events, type GuildMember, type PartialGuildMember } from 'discord.js'
import {
  quarantineRoleId,
  quarantineRoleSwapEnabled,
  quarantineStripAllRoles,
  quarantineToggleRoleId,
} from '../config.ts'
import { childLogger } from '../lib/logger.ts'
import {
  clearQuarantineRoles,
  getQuarantineRoles,
  saveQuarantineRoles,
} from './quarantine-roles-store.ts'

const log = childLogger('quarantine')

/** Roles the bot can actually remove: not @everyone, not the quarantine role,
 *  not managed, and below the bot's highest role. */
function removableRoleIds(member: GuildMember, qRoleId: string): string[] {
  const botTop = member.guild.members.me?.roles.highest.position ?? 0
  return member.roles.cache
    .filter(
      (r) =>
        r.id !== member.guild.id &&
        r.id !== qRoleId &&
        !r.managed &&
        r.position < botTop,
    )
    .map((r) => r.id)
}

async function stripAllRoles(member: GuildMember, qRoleId: string): Promise<void> {
  const ids = removableRoleIds(member, qRoleId)
  if (ids.length === 0) return
  // Save first, so a failed/partial removal still leaves a record to restore.
  await saveQuarantineRoles(member.guild.id, member.id, ids)
  await member.roles
    .remove(ids, 'Quarantine applied: stripping all roles')
    .catch((e) => log.warn({ err: e, userId: member.id }, 'failed to strip roles'))
  log.info({ userId: member.id, count: ids.length }, 'quarantine on: stripped all roles')
}

async function restoreAllRoles(member: GuildMember): Promise<void> {
  const saved = await getQuarantineRoles(member.guild.id, member.id)
  if (saved.length === 0) return
  const botTop = member.guild.members.me?.roles.highest.position ?? 0
  const restorable = saved.filter((id) => {
    const r = member.guild.roles.cache.get(id)
    return r && !r.managed && r.position < botTop
  })
  if (restorable.length > 0) {
    await member.roles
      .add(restorable, 'Quarantine lifted: restoring previous roles')
      .catch((e) => log.warn({ err: e, userId: member.id }, 'failed to restore roles'))
  }
  await clearQuarantineRoles(member.guild.id, member.id)
  log.info({ userId: member.id, count: restorable.length }, 'quarantine off: restored roles')
}

export function registerQuarantineRoleSwap(client: Client): void {
  if (!quarantineRoleSwapEnabled) return
  const qRole = quarantineRoleId
  if (!qRole) return
  const toggleRole = quarantineToggleRoleId

  client.on(
    Events.GuildMemberUpdate,
    async (oldMember: GuildMember | PartialGuildMember, newMember: GuildMember) => {
      try {
        const had = oldMember.roles.cache.has(qRole)
        const has = newMember.roles.cache.has(qRole)
        if (had === has) return // quarantine role unchanged

        if (has) {
          // Quarantine applied.
          if (quarantineStripAllRoles) {
            await stripAllRoles(newMember, qRole)
          } else if (toggleRole && newMember.roles.cache.has(toggleRole)) {
            await newMember.roles
              .remove(toggleRole, 'Quarantine applied: removing member role')
              .catch((e) => log.warn({ err: e, userId: newMember.id }, 'failed to remove toggle role'))
          }
        } else {
          // Quarantine lifted.
          if (quarantineStripAllRoles) {
            await restoreAllRoles(newMember)
          } else if (toggleRole && !newMember.roles.cache.has(toggleRole)) {
            await newMember.roles
              .add(toggleRole, 'Quarantine lifted: restoring member role')
              .catch((e) => log.warn({ err: e, userId: newMember.id }, 'failed to add toggle role'))
          }
        }
      } catch (e) {
        log.warn({ err: e, userId: newMember.id }, 'quarantine role-swap failed')
      }
    },
  )
}
