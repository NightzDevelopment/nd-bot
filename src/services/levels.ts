import {
  ChannelType,
  type ChatInputCommandInteraction,
  type Client,
  type Message,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js'
import {
  levelsAlertChannelId,
  levelsCooldownMs,
  levelsDmEnabled,
  levelsIgnoredCategories,
  levelsIgnoredChannels,
  levelsRemovePreviousRoles,
  levelsRoleMilestonesJson,
  levelsXpMax,
  levelsXpMin,
} from '../config.ts'
import { ndEmbed } from '../utils/embed.ts'
import { isFeatureEnabled } from './feature-gates.ts'
import {
  applyLevelRoles,
  backfillLevelRole,
  getLevelRoles,
  removeLevelRole,
  setLevelRole,
} from './level-roles.ts'
import {
  addLevelXp,
  getLevelRecord,
  resetLevelRecord,
  topLevelRecords,
  xpForLevel,
} from './levels-store.ts'

type RoleMilestone = {
  level: number
  roleId: string
}

function parseRoleMilestones(): RoleMilestone[] {
  if (!levelsRoleMilestonesJson) return []
  try {
    const raw = JSON.parse(levelsRoleMilestonesJson) as unknown
    if (!Array.isArray(raw)) return []
    return raw
      .map((x) => {
        const o = x as Record<string, unknown>
        return {
          level: Math.max(1, Number(o.level) || 0),
          roleId: typeof o.roleId === 'string' ? o.roleId.trim() : '',
        }
      })
      .filter((x) => x.level > 0 && x.roleId)
      .sort((a, b) => a.level - b.level)
  } catch {
    console.warn('[levels] invalid LEVELS_ROLE_MILESTONES_JSON')
    return []
  }
}

function randomXp(): number {
  const span = Math.max(0, levelsXpMax - levelsXpMin)
  return levelsXpMin + Math.floor(Math.random() * (span + 1))
}

function shouldIgnoreMessage(msg: Message): boolean {
  if (!msg.guild || msg.author.bot) return true
  if (msg.channel.type === ChannelType.DM) return true
  if (!msg.content?.trim()) return true
  if (levelsIgnoredChannels.has(msg.channel.id)) return true
  const parentId = msg.channel.isThread() ? msg.channel.parentId : null
  if (parentId && levelsIgnoredChannels.has(parentId)) return true
  const categoryId =
    'parentId' in msg.channel && typeof msg.channel.parentId === 'string'
      ? msg.channel.parentId
      : null
  if (categoryId && levelsIgnoredCategories.has(categoryId)) return true
  return false
}

async function maybeApplyLevelRoles(msg: Message, level: number): Promise<void> {
  if (!msg.guild || !msg.member) return
  const milestones = parseRoleMilestones()
  if (milestones.length === 0) return
  const earned = milestones.filter((x) => level >= x.level)
  const latest = earned.at(-1)
  if (!latest) return

  const me = msg.guild.members.me
  if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) return

  try {
    await msg.member.roles.add(latest.roleId, `Levelled Roles: reached level ${level}`)
    if (levelsRemovePreviousRoles) {
      const previous = earned.slice(0, -1).map((x) => x.roleId)
      for (const roleId of previous) {
        if (msg.member.roles.cache.has(roleId)) {
          await msg.member.roles.remove(roleId, 'Levelled Roles: higher milestone reached')
        }
      }
    }
  } catch (e) {
    console.warn('[levels] failed to apply level role:', msg.author.id, e)
  }
}

async function sendLevelUp(msg: Message, level: number): Promise<void> {
  if (!msg.guild) return
  const embed = ndEmbed()
    .setTitle('Level up')
    .setDescription(`<@${msg.author.id}> reached **Level ${level}**.`)
    .setTimestamp()

  const targetChannel = levelsAlertChannelId
    ? await msg.client.channels.fetch(levelsAlertChannelId).catch(() => null)
    : msg.channel

  if (targetChannel?.isTextBased() && !targetChannel.isDMBased()) {
    await targetChannel.send({ embeds: [embed] }).catch(() => {})
  }

  if (levelsDmEnabled) {
    await msg.author
      .send({
        embeds: [
          ndEmbed()
            .setTitle('Nightz Development level up')
            .setDescription(`You reached **Level ${level}** in **${msg.guild.name}**.`),
        ],
      })
      .catch(() => {})
  }
}

export function registerLevels(client: Client): void {
  if (!isFeatureEnabled('levels')) return
  client.on('messageCreate', async (msg) => {
    // A throw here (e.g. a transient SQLite read error on a hot path) would become
    // an unhandled rejection, so the whole body is guarded.
    try {
      if (shouldIgnoreMessage(msg)) return
      const current = await getLevelRecord(msg.guild!.id, msg.author.id)
      const now = Date.now()
      if (now - current.lastXpAt < levelsCooldownMs) return

      const { currentSeasonalMultipliers } = await import('./seasonal-events.ts')
      const xpAward = Math.round(randomXp() * currentSeasonalMultipliers().xp)
      const { after, leveledUp } = await addLevelXp(msg.guild!.id, msg.author.id, xpAward, now)
      if (!leveledUp) return
      await maybeApplyLevelRoles(msg, after.level)
      // Also apply roles from the command-configured store
      void applyLevelRoles(msg.client, msg.guild!.id, msg.author.id, after.level).catch(() => {})
      await sendLevelUp(msg, after.level)
      // Broadcast level-up to dashboard activity feed
      try {
        const { broadcastActivity } = await import('../dashboard/websocket.ts')
        broadcastActivity('level_up', {
          userId: msg.author.id,
          username: msg.author.username,
          displayName: msg.member?.displayName || msg.author.username,
          level: after.level,
          channelName: 'name' in msg.channel ? (msg.channel as any).name : undefined,
        })
      } catch {
        /* ignore */
      }
    } catch (e) {
      console.warn('[levels] messageCreate handler error:', e)
    }
  })
}

export async function buildRankEmbed(guildId: string, userId: string, tag: string) {
  const record = await getLevelRecord(guildId, userId)
  const nextXp = xpForLevel(record.level + 1)
  const needed = Math.max(0, nextXp - record.xp)
  return ndEmbed()
    .setTitle('Community rank')
    .setDescription(`**${tag}** is Level **${record.level}** with **${record.xp} XP**.`)
    .addFields(
      { name: 'Next level', value: `${needed} XP remaining`, inline: true },
      { name: 'Messages counted', value: `${record.messageCount}`, inline: true },
    )
}

export async function buildLeaderboardEmbed(
  guildId: string,
  window: 'all' | 'week' | 'month' = 'all',
) {
  if (window === 'all') {
    const rows = await topLevelRecords(guildId, 10)
    return ndEmbed()
      .setTitle('Community leaderboard · all time')
      .setDescription(
        rows.length
          ? rows
              .map(
                (x, i) =>
                  `**${i + 1}.** <@${x.userId}> - Level **${x.record.level}**, ${x.record.xp} XP`,
              )
              .join('\n')
          : 'No XP has been recorded yet.',
      )
  }
  const days = window === 'week' ? 7 : 30
  const { getXpWindowLeaderboard } = await import('./leaderboard-snapshots.ts')
  const rows = await getXpWindowLeaderboard(guildId, days, 10)
  return ndEmbed()
    .setTitle(`Community leaderboard · ${window === 'week' ? 'this week' : 'this month'}`)
    .setDescription(
      rows.length
        ? rows
            .map((x, i) => `**${i + 1}.** <@${x.userId}> - +${x.gained.toLocaleString()} XP`)
            .join('\n')
        : 'Not enough history yet for this window. XP snapshots are still building up, check back in a few days.',
    )
}

export async function handleRankSlash(interaction: ChatInputCommandInteraction): Promise<boolean> {
  if (interaction.commandName !== 'rank') return false
  if (!interaction.guild) {
    await interaction.reply({ content: 'Use this in a server.', flags: MessageFlags.Ephemeral })
    return true
  }
  const user = interaction.options.getUser('user') ?? interaction.user

  await interaction.deferReply({ flags: MessageFlags.Ephemeral })

  try {
    const guildId = interaction.guildId ?? 'unknown'
    const levelRec = await getLevelRecord(guildId, user.id)
    const { getProfile } = await import('./member-profile.ts')
    const { getUserBadges } = await import('./achievements.ts')
    const profile = await getProfile(user.id)
    const badges = await getUserBadges(user.id)

    const repPoints = profile?.stats.reputation ?? 0
    const totalMessages = levelRec.messageCount ?? profile?.stats.messages ?? 0
    const currentLevel = levelRec.level ?? profile?.stats.level ?? 0
    const currentXp = levelRec.xp ?? 0
    const nextLevel = currentLevel + 1
    const nextLevelXp = xpForLevel(nextLevel)

    const avatarUrl = user.displayAvatarURL({ extension: 'png', size: 256 })

    const { generateProfileCard } = await import('./profile-card.ts')
    const buffer = await generateProfileCard({
      userId: user.id,
      username: user.username,
      avatarUrl,
      level: currentLevel,
      xp: currentXp,
      nextLevelXp,
      messages: totalMessages,
      reputation: repPoints,
      bio: profile?.bio || 'Nightz Development Associate',
      badges: badges.map((b) => ({ name: b.name, icon: b.icon })),
    })

    const { AttachmentBuilder } = await import('discord.js')
    const file = new AttachmentBuilder(buffer, { name: `profile-${user.id}.png` })

    await interaction.editReply({ files: [file] })
  } catch (err) {
    console.error('[rank] Error rendering card, falling back to embed:', err)
    try {
      await interaction.editReply({
        embeds: [await buildRankEmbed(interaction.guild.id, user.id, user.tag)],
      })
    } catch {
      /* ignore */
    }
  }
  return true
}

export async function handleLeaderboardSlash(
  interaction: ChatInputCommandInteraction,
): Promise<boolean> {
  if (interaction.commandName !== 'leaderboard') return false
  if (!interaction.guild) {
    await interaction.reply({ content: 'Use this in a server.', flags: MessageFlags.Ephemeral })
    return true
  }
  const window = (interaction.options.getString('window', false) ?? 'all') as
    | 'all'
    | 'week'
    | 'month'
  await interaction.reply({ embeds: [await buildLeaderboardEmbed(interaction.guild.id, window)] })
  return true
}

export async function handleLevelResetSlash(
  interaction: ChatInputCommandInteraction,
): Promise<boolean> {
  if (interaction.commandName !== 'levelreset') return false
  if (!interaction.guild) {
    await interaction.reply({ content: 'Use this in a server.', flags: MessageFlags.Ephemeral })
    return true
  }
  const member = await interaction.guild.members.fetch(interaction.user.id)
  if (!member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({ content: 'Manage Server required.', flags: MessageFlags.Ephemeral })
    return true
  }
  const user = interaction.options.getUser('user', true)
  await resetLevelRecord(interaction.guild.id, user.id)
  await interaction.reply({
    content: `Reset level data for ${user.tag}.`,
    flags: MessageFlags.Ephemeral,
  })
  return true
}

export async function handleLevelRoleSlash(
  interaction: ChatInputCommandInteraction,
): Promise<boolean> {
  if (interaction.commandName !== 'levelrole') return false
  if (!interaction.guild) {
    await interaction.reply({ content: 'Use this in a server.', flags: MessageFlags.Ephemeral })
    return true
  }
  const member = await interaction.guild.members.fetch(interaction.user.id)
  if (!member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({ content: 'Manage Server required.', flags: MessageFlags.Ephemeral })
    return true
  }

  const sub = interaction.options.getSubcommand(true)
  const guildId = interaction.guild.id

  if (sub === 'set') {
    const level = interaction.options.getInteger('level', true)
    const role = interaction.options.getRole('role', true)
    await setLevelRole(guildId, level, role.id)
    await interaction.reply({
      content: `✅ Members who reach **Level ${level}** will now receive <@&${role.id}>.\n⏳ Granting role to existing members in the background…`,
      flags: MessageFlags.Ephemeral,
    })
    // Fire backfill after replying, never block the command response
    backfillLevelRole(interaction.client, guildId, level, role.id)
      .then(({ granted, errors }) => {
        if (granted > 0) {
          console.log(
            `[levelrole] backfill level ${level}: granted to ${granted} member(s), ${errors} error(s)`,
          )
        }
      })
      .catch((e) => console.error('[levelrole] backfill error:', e))
    return true
  }

  if (sub === 'remove') {
    const level = interaction.options.getInteger('level', true)
    const removed = await removeLevelRole(guildId, level)
    await interaction.reply({
      content: removed
        ? `Removed level role reward for Level ${level}.`
        : `No role was set for Level ${level}.`,
      flags: MessageFlags.Ephemeral,
    })
    return true
  }

  if (sub === 'list') {
    const roles = await getLevelRoles(guildId)
    if (!roles.length) {
      await interaction.reply({
        content: 'No level role rewards configured. Use `/levelrole set` to add one.',
        flags: MessageFlags.Ephemeral,
      })
      return true
    }
    const lines = roles.map((r) => `**Level ${r.level}** → <@&${r.roleId}>`)
    await interaction.reply({
      content: `**Level role rewards:**\n${lines.join('\n')}`,
      flags: MessageFlags.Ephemeral,
    })
    return true
  }

  return true
}
