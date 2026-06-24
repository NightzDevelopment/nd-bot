/**
 * Community Commands Handler
 * /reputation, /profile, /leaderboard commands
 * Formatted under strict brand enforcement, utilizing a Zero-Emoji Mandate.
 */

import { type ChatInputCommandInteraction, MessageFlags, type User } from 'discord.js'
import { checkAndAwardAchievements, getAllBadges, getUserBadges } from '../services/achievements.ts'
import { getLevelRecord, xpForLevel } from '../services/levels-store.ts'
import { getProfile, updateBio } from '../services/member-profile.ts'
import { awardReputation, getReputation, getTopByReputation } from '../services/reputation.ts'
import { ndEmbed } from '../utils/embed.ts'

/**
 * Handle /reputation command
 */
export async function handleReputationSlash(
  interaction: ChatInputCommandInteraction,
): Promise<boolean> {
  const subcommand = interaction.options.getSubcommand()

  if (subcommand === 'view') {
    const user = interaction.options.getUser('user') ?? interaction.user
    const rep = await getReputation(user.id)
    const embed = ndEmbed()
      .setTitle(`${user.username}'s Reputation`)
      .setThumbnail(user.displayAvatarURL())

    if (!rep) {
      embed.setDescription('No reputation yet. Help the community to earn some!')
    } else {
      let desc = `**Total Points**: ${rep.points}\n\n`
      if (rep.history.length > 0) {
        const recent = rep.history.slice(-5).reverse()
        desc += '**Recent Awards**:\n'
        for (const award of recent) {
          const date = new Date(award.at).toLocaleDateString()
          desc += `• from <@${award.from}>: ${award.reason} (${date})\n`
        }
      }
      embed.setDescription(desc)
    }

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral })
    return true
  }

  if (subcommand === 'give') {
    const targetUser = interaction.options.getUser('user')
    const points = interaction.options.getInteger('points') ?? 1
    const reason = interaction.options.getString('reason') ?? 'Community contribution'

    if (!targetUser) {
      await interaction.reply({ content: 'User not found.', flags: MessageFlags.Ephemeral })
      return true
    }

    if (points <= 0) {
      await interaction.reply({
        content: 'Points must be positive.',
        flags: MessageFlags.Ephemeral,
      })
      return true
    }

    await awardReputation(targetUser.id, points, interaction.user.id, reason)

    // Check for reputation achievements
    const rep = await getReputation(targetUser.id)
    if (rep) {
      const awarded = await checkAndAwardAchievements(targetUser.id, {
        reputation: rep.points,
      })
      if (awarded.length > 0) {
        const badges = await getUserBadges(targetUser.id)
        const badgeNames = badges.map((b) => b.icon).join(' ')
        await interaction.reply({
          content: `[SUCCESS] Gave ${points} reputation to ${targetUser}! ${badgeNames.trim() ? `\n[ACHIEVEMENT] New badges: ${badgeNames}` : ''}`,
          flags: MessageFlags.Ephemeral,
        })
        return true
      }
    }

    await interaction.reply({
      content: `[SUCCESS] Gave ${points} reputation to ${targetUser}!`,
      flags: MessageFlags.Ephemeral,
    })
    return true
  }

  if (subcommand === 'leaderboard') {
    const topUsers = await getTopByReputation(10)

    const embed = ndEmbed()
      .setTitle('[LEADERBOARD] Reputation Leaderboard')
      .setDescription(
        topUsers.length === 0
          ? 'No reputation awarded yet.'
          : topUsers
              .map((entry, idx) => `${idx + 1}. <@${entry.userId}> - **${entry.points}** points`)
              .join('\n'),
      )

    await interaction.reply({ embeds: [embed] })
    return true
  }

  return false
}

/**
 * Handle /profile command
 */
export async function handleProfileSlash(
  interaction: ChatInputCommandInteraction,
): Promise<boolean> {
  const subcommand = interaction.options.getSubcommand()
  const user = interaction.options.getUser('user') ?? interaction.user

  if (subcommand === 'view') {
    await interaction.deferReply()

    try {
      const guildId = interaction.guildId ?? 'unknown'
      const levelRec = await getLevelRecord(guildId, user.id)
      const profile = await getProfile(user.id)
      const badges = await getUserBadges(user.id)

      const repPoints = profile?.stats.reputation ?? 0
      const totalMessages = levelRec.messageCount ?? profile?.stats.messages ?? 0
      const currentLevel = levelRec.level ?? profile?.stats.level ?? 0
      const currentXp = levelRec.xp ?? 0
      const nextLevel = currentLevel + 1
      const nextLevelXp = xpForLevel(nextLevel)

      const avatarUrl = user.displayAvatarURL({ extension: 'png', size: 256 })

      const { generateProfileCard } = await import('../services/profile-card.ts')
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
      console.error('[profile] Error rendering card:', err)
      await interaction.editReply({
        content: '[ERROR] Failed to generate profile rank card. Please try again.',
      })
    }
    return true
  }

  if (subcommand === 'edit') {
    if (user.id !== interaction.user.id) {
      await interaction.reply({
        content: 'You can only edit your own profile.',
        flags: MessageFlags.Ephemeral,
      })
      return true
    }

    const bio = interaction.options.getString('bio')
    if (!bio) {
      await interaction.reply({
        content: 'Please provide a bio (max 200 characters).',
        flags: MessageFlags.Ephemeral,
      })
      return true
    }

    await updateBio(user.id, bio)
    await interaction.reply({
      content: `[SUCCESS] Bio updated!`,
      flags: MessageFlags.Ephemeral,
    })
    return true
  }

  return false
}

/**
 * Handle /achievements command
 */
export async function handleAchievementsSlash(
  interaction: ChatInputCommandInteraction,
): Promise<boolean> {
  const subcommand = interaction.options.getSubcommand()
  const user = interaction.options.getUser('user') ?? interaction.user

  if (subcommand === 'view') {
    const badges = await getUserBadges(user.id)

    const embed = ndEmbed()
      .setTitle(`${user.username}'s Achievements`)
      .setThumbnail(user.displayAvatarURL())

    if (badges.length === 0) {
      embed.setDescription('No achievements yet. Start participating to earn badges!')
    } else {
      const categories = ['milestone', 'activity', 'social', 'special'] as const
      let desc = ''
      for (const category of categories) {
        const badgesInCategory = badges.filter((b) => b.category === category)
        if (badgesInCategory.length > 0) {
          const catTitle = category.charAt(0).toUpperCase() + category.slice(1)
          desc += `\n**${catTitle}** (${badgesInCategory.length})\n`
          for (const badge of badgesInCategory) {
            desc += `${badge.icon} **${badge.name}** - ${badge.description}\n`
          }
        }
      }
      embed.setDescription(desc)
    }

    await interaction.reply({ embeds: [embed] })
    return true
  }

  if (subcommand === 'all') {
    const allBadges = await getAllBadges()
    const categories = ['milestone', 'activity', 'social', 'special'] as const

    const embed = ndEmbed().setTitle('[ACHIEVEMENTS] All Available Achievements')

    let desc = ''
    for (const category of categories) {
      const badgesInCategory = allBadges.filter((b) => b.category === category)
      if (badgesInCategory.length > 0) {
        const catTitle = category.charAt(0).toUpperCase() + category.slice(1)
        desc += `\n**${catTitle}** (${badgesInCategory.length})\n`
        for (const badge of badgesInCategory) {
          desc += `${badge.icon} **${badge.name}** - ${badge.description}\n`
        }
      }
    }
    embed.setDescription(desc)

    await interaction.reply({ embeds: [embed] })
    return true
  }

  return false
}
