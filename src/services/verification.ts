/**
 * Verification gate. New members are optionally given a holding role and must
 * click a Verify button to gain the member role. Optionally kicks members who
 * never verify (via the scheduled-actions loop).
 *
 * Interaction customId: ndverify:go
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type Client,
  EmbedBuilder,
  Events,
  type GuildMember,
  type Interaction,
  MessageFlags,
} from 'discord.js'
import {
  verifyChannelId,
  verifyEnabled,
  verifyKickAfterMs,
  verifyRoleId,
  verifyUnverifiedRoleId,
} from '../config.ts'
import { childLogger } from '../lib/logger.ts'
import { cancelActions, scheduleAction } from './scheduled-actions-store.ts'

const log = childLogger('verify')
const PREFIX = 'ndverify'

/** A member counts as unverified if they lack the verify role (or still hold the holding role). */
export function isStillUnverified(member: GuildMember): boolean {
  if (verifyRoleId && member.roles.cache.has(verifyRoleId)) return false
  if (verifyUnverifiedRoleId) return member.roles.cache.has(verifyUnverifiedRoleId)
  // No holding role configured: unverified == lacking the verify role.
  return verifyRoleId ? !member.roles.cache.has(verifyRoleId) : false
}

/** Panel embed + Verify button for the verification channel. */
export function buildVerifyPanel(): {
  embeds: EmbedBuilder[]
  components: ActionRowBuilder<ButtonBuilder>[]
} {
  const embed = new EmbedBuilder()
    .setColor(0x60a5fa)
    .setTitle('Verify to gain access')
    .setDescription('Click the button below to verify and unlock the rest of the server.')
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}:go`).setLabel('Verify').setStyle(ButtonStyle.Success),
  )
  return { embeds: [embed], components: [row] }
}

export function registerVerification(client: Client): void {
  if (!verifyEnabled) return
  if (!verifyRoleId) {
    log.warn('VERIFY_ENABLED but VERIFY_ROLE_ID is not set: verification disabled')
    return
  }

  client.on(Events.GuildMemberAdd, async (member: GuildMember) => {
    try {
      if (member.user.bot) return
      if (verifyUnverifiedRoleId) {
        const role = await member.guild.roles.fetch(verifyUnverifiedRoleId).catch(() => null)
        if (role) await member.roles.add(role, 'Verification gate: awaiting verify').catch(() => {})
      }
      if (verifyKickAfterMs > 0) {
        await scheduleAction({
          type: 'verify_kick',
          guildId: member.guild.id,
          userId: member.id,
          userTag: member.user.tag,
          dueAt: Date.now() + verifyKickAfterMs,
          reason: 'Did not verify in time',
        })
      }
    } catch (e) {
      log.warn({ err: e, userId: member.id }, 'on-join verification setup failed')
    }
  })
}

export async function tryHandleVerifyInteraction(interaction: Interaction): Promise<boolean> {
  if (!interaction.isButton()) return false
  if (interaction.customId !== `${PREFIX}:go`) return false
  if (!interaction.guild) {
    await interaction.reply({ content: 'Use this in the server.', flags: MessageFlags.Ephemeral })
    return true
  }
  const member = interaction.member as GuildMember | null
  if (!member) {
    await interaction.reply({ content: 'Could not resolve your membership.', flags: MessageFlags.Ephemeral })
    return true
  }
  try {
    if (verifyRoleId) {
      const role = await interaction.guild.roles.fetch(verifyRoleId).catch(() => null)
      if (role) await member.roles.add(role, 'Verified').catch(() => {})
    }
    if (verifyUnverifiedRoleId && member.roles.cache.has(verifyUnverifiedRoleId)) {
      await member.roles.remove(verifyUnverifiedRoleId, 'Verified').catch(() => {})
    }
    // Drop any pending verify-kick for this member.
    await cancelActions((a) => a.type === 'verify_kick' && a.userId === member.id)
    await interaction.reply({
      content: 'You are verified. Welcome aboard!',
      flags: MessageFlags.Ephemeral,
    })
  } catch (e) {
    log.warn({ err: e, userId: member.id }, 'verify failed')
    await interaction.reply({
      content: 'Verification failed. Please contact staff.',
      flags: MessageFlags.Ephemeral,
    })
  }
  return true
}

/** True if a channel id is the configured verify channel (for the panel command). */
export function isVerifyConfigured(): boolean {
  return verifyEnabled && Boolean(verifyRoleId) && Boolean(verifyChannelId)
}
