import {
  ChannelType,
  type EmbedBuilder,
  type Guild,
  GuildDefaultMessageNotifications,
  GuildExplicitContentFilter,
  GuildVerificationLevel,
} from 'discord.js'
import { ndEmbed } from './embed.ts'

const VERIFICATION_LABELS: Record<GuildVerificationLevel, string> = {
  [GuildVerificationLevel.None]: 'None',
  [GuildVerificationLevel.Low]: 'Low',
  [GuildVerificationLevel.Medium]: 'Medium',
  [GuildVerificationLevel.High]: 'High',
  [GuildVerificationLevel.VeryHigh]: 'Highest',
}

const CONTENT_FILTER_LABELS: Record<GuildExplicitContentFilter, string> = {
  [GuildExplicitContentFilter.Disabled]: 'Off',
  [GuildExplicitContentFilter.MembersWithoutRoles]: 'Scan members without roles',
  [GuildExplicitContentFilter.AllMembers]: 'Scan everyone',
}

function boostTierLabel(tier: number): string {
  if (tier <= 0) return 'None'
  if (tier === 1) return 'Tier 1'
  if (tier === 2) return 'Tier 2'
  return 'Tier 3'
}

/**
 * Rich server statistics embed (shared by /serverinfo and nd!serverinfo).
 */
export async function buildServerInfoEmbed(guild: Guild): Promise<EmbedBuilder> {
  await guild.fetch().catch(() => {})

  const ch = guild.channels.cache
  const textCount = ch.filter(
    (c) =>
      c.type === ChannelType.GuildText ||
      c.type === ChannelType.GuildAnnouncement ||
      c.type === ChannelType.GuildForum,
  ).size
  const voiceCount = ch.filter(
    (c) => c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice,
  ).size
  const categoryCount = ch.filter((c) => c.type === ChannelType.GuildCategory).size
  const cachedThreads = ch.filter((c) => c.isThread()).size

  const boosts = guild.premiumSubscriptionCount ?? 0
  const tier = boostTierLabel(guild.premiumTier)

  const notifications =
    guild.defaultMessageNotifications === GuildDefaultMessageNotifications.AllMessages
      ? 'All messages'
      : 'Only @mentions'

  const afk =
    guild.afkChannelId && guild.afkChannel
      ? `${guild.afkChannel} (${guild.afkTimeout / 60} min)`
      : 'None'

  const vanity = guild.vanityURLCode ? `discord.gg/${guild.vanityURLCode}` : 'None'

  const community =
    guild.features.includes('COMMUNITY') || guild.features.includes('DISCOVERABLE') ? 'Yes' : 'No'

  const verification =
    VERIFICATION_LABELS[guild.verificationLevel] ?? String(guild.verificationLevel)
  const contentFilter =
    CONTENT_FILTER_LABELS[guild.explicitContentFilter] ?? String(guild.explicitContentFilter)

  const channelLines = [
    `Text / news / forums: ${textCount}`,
    `Voice / stage: ${voiceCount}`,
    `Categories: ${categoryCount}`,
  ]
  if (cachedThreads > 0) {
    channelLines.push(`Threads (cached): ${cachedThreads}`)
  }

  const embed = ndEmbed()
    .setTitle(guild.name)
    .setThumbnail(guild.iconURL({ size: 256 }))
  if (guild.description) {
    const d = guild.description
    embed.setDescription(d.slice(0, 400) + (d.length > 400 ? '…' : ''))
  }
  embed.addFields(
    { name: 'Server ID', value: guild.id, inline: true },
    { name: 'Owner', value: `<@${guild.ownerId}>`, inline: true },
    { name: 'Members', value: String(guild.memberCount), inline: true },
    {
      name: 'Channels',
      value: channelLines.join('\n').slice(0, 1024),
      inline: true,
    },
    {
      name: 'Roles',
      value: String(guild.roles.cache.size),
      inline: true,
    },
    {
      name: 'Emojis & stickers',
      value: `${guild.emojis.cache.size} emojis, ${guild.stickers.cache.size} stickers`,
      inline: true,
    },
    {
      name: 'Boosts',
      value: `${boosts} boosts (${tier})`,
      inline: true,
    },
    {
      name: 'Created',
      value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`,
      inline: true,
    },
    {
      name: 'Verification',
      value: verification,
      inline: true,
    },
    {
      name: 'Content filter',
      value: contentFilter,
      inline: true,
    },
    {
      name: 'Default notifications',
      value: notifications,
      inline: true,
    },
    {
      name: 'Locale',
      value: guild.preferredLocale || 'Default',
      inline: true,
    },
    {
      name: 'AFK',
      value: afk.slice(0, 1024),
      inline: true,
    },
    {
      name: 'Vanity URL',
      value: vanity,
      inline: true,
    },
    {
      name: 'Community',
      value: community,
      inline: true,
    },
  )

  const bannerUrl = guild.bannerURL({ size: 1024 })
  if (bannerUrl) {
    embed.setImage(bannerUrl)
  }

  return embed
}
