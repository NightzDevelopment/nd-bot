import { type EmbedBuilder, type GuildMember, PermissionFlagsBits, type User } from 'discord.js'
import { ndEmbed } from './embed.ts'

function formatRoles(member: GuildMember): string {
  const roles = member.roles.cache
    .filter((r) => r.id !== member.guild.id)
    .sort((a, b) => b.position - a.position)
  if (roles.size === 0) return 'None'
  return roles
    .map((r) => r.toString())
    .join(' ')
    .slice(0, 900)
}

function summarizeKeyPermissions(member: GuildMember): string {
  const p = member.permissions
  if (p.has(PermissionFlagsBits.Administrator)) {
    return 'Administrator (full access)'
  }
  const parts: string[] = []
  const add = (flag: bigint, label: string) => {
    if (p.has(flag)) parts.push(label)
  }
  add(PermissionFlagsBits.ManageGuild, 'Manage Server')
  add(PermissionFlagsBits.ManageRoles, 'Manage Roles')
  add(PermissionFlagsBits.ManageChannels, 'Manage Channels')
  add(PermissionFlagsBits.ModerateMembers, 'Moderate Members')
  add(PermissionFlagsBits.KickMembers, 'Kick')
  add(PermissionFlagsBits.BanMembers, 'Ban')
  add(PermissionFlagsBits.ManageMessages, 'Manage Messages')
  add(PermissionFlagsBits.MentionEveryone, 'Mention Everyone')
  add(PermissionFlagsBits.ManageWebhooks, 'Manage Webhooks')
  return parts.length > 0 ? parts.join(', ') : 'Standard member'
}

/**
 * Rich user card for /userinfo and nd!userinfo.
 */
export async function buildUserInfoEmbed(
  user: User,
  member: GuildMember | null,
): Promise<EmbedBuilder> {
  const displayTitle = member?.displayName ?? user.globalName ?? user.username

  const embed = ndEmbed()
    .setTitle(displayTitle)
    .setThumbnail(user.displayAvatarURL({ size: 256 }))

  const created = `<t:${Math.floor(user.createdTimestamp / 1000)}:R> (<t:${Math.floor(user.createdTimestamp / 1000)}:D>)`

  embed.addFields({
    name: 'Account',
    value: [
      `**ID:** ${user.id}`,
      `**Created:** ${created}`,
      `**Bot:** ${user.bot ? 'Yes' : 'No'}`,
      user.globalName ? `**Display name:** ${user.globalName}` : null,
    ]
      .filter(Boolean)
      .join('\n'),
    inline: false,
  })

  if (member) {
    const nick =
      member.nickname != null && member.nickname.length > 0 ? member.nickname : 'None set'
    const joined = member.joinedTimestamp
      ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R> (<t:${Math.floor(member.joinedTimestamp / 1000)}:D>)`
      : 'Unknown'

    const boost =
      member.premiumSince != null
        ? `<t:${Math.floor(member.premiumSince.getTime() / 1000)}:R>`
        : 'Not boosting'

    let timeoutLine: string | null = null
    const until = member.communicationDisabledUntil
    if (until && until.getTime() > Date.now()) {
      timeoutLine = `**Timeout:** until <t:${Math.floor(until.getTime() / 1000)}:R>`
    }

    const presence = member.presence
    const statusLine = presence ? `**Status:** ${presence.status}` : null

    const serverBlock = [
      `**Nickname:** ${nick}`,
      `**Joined server:** ${joined}`,
      `**Server boost:** ${boost}`,
      timeoutLine,
      statusLine,
    ]
      .filter(Boolean)
      .join('\n')

    embed.addFields(
      {
        name: 'In this server',
        value: serverBlock,
        inline: false,
      },
      {
        name: 'Roles',
        value: formatRoles(member) || 'None',
        inline: false,
      },
      {
        name: 'Key permissions',
        value: summarizeKeyPermissions(member).slice(0, 1024),
        inline: false,
      },
    )

    const hex = member.displayHexColor
    if (hex && hex !== '#000000') {
      embed.setColor(parseInt(hex.replace('#', ''), 16))
    }
  } else {
    embed.addFields({
      name: 'In this server',
      value: 'Member data not loaded. Try again, or ensure the user is in this server.',
      inline: false,
    })
  }

  return embed
}
