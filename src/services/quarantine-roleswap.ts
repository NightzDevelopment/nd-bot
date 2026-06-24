/**
 * Quarantine role-swap. Watches role changes on members:
 *   - when the quarantine role is ADDED   -> remove the toggle (member) role
 *   - when the quarantine role is REMOVED -> add the toggle (member) role back
 *
 * Works no matter who changes the role (staff, alt-detection auto-quarantine, or
 * another bot), since it keys off the resulting role diff in GuildMemberUpdate.
 */
import { type Client, Events, type GuildMember, type PartialGuildMember } from 'discord.js'
import { quarantineRoleId, quarantineRoleSwapEnabled, quarantineToggleRoleId } from '../config.ts'
import { childLogger } from '../lib/logger.ts'

const log = childLogger('quarantine')

export function registerQuarantineRoleSwap(client: Client): void {
  if (!quarantineRoleSwapEnabled) return
  const qRole = quarantineRoleId
  const toggleRole = quarantineToggleRoleId
  if (!qRole || !toggleRole) return

  client.on(
    Events.GuildMemberUpdate,
    async (oldMember: GuildMember | PartialGuildMember, newMember: GuildMember) => {
      try {
        const had = oldMember.roles.cache.has(qRole)
        const has = newMember.roles.cache.has(qRole)
        if (had === has) return // quarantine role unchanged

        if (has) {
          // Quarantine applied -> strip the normal member role.
          if (newMember.roles.cache.has(toggleRole)) {
            await newMember.roles
              .remove(toggleRole, 'Quarantine applied: removing member role')
              .catch((e) =>
                log.warn({ err: e, userId: newMember.id }, 'failed to remove toggle role'),
              )
            log.info({ userId: newMember.id }, 'quarantine on: removed member role')
          }
        } else {
          // Quarantine lifted -> restore the normal member role.
          if (!newMember.roles.cache.has(toggleRole)) {
            await newMember.roles
              .add(toggleRole, 'Quarantine lifted: restoring member role')
              .catch((e) => log.warn({ err: e, userId: newMember.id }, 'failed to add toggle role'))
            log.info({ userId: newMember.id }, 'quarantine off: restored member role')
          }
        }
      } catch (e) {
        log.warn({ err: e, userId: newMember.id }, 'quarantine role-swap failed')
      }
    },
  )
}
