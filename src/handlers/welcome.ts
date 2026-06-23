import { type Client, Events, type GuildMember, type PartialGuildMember } from 'discord.js'
import {
  WELCOME_CHANNEL_ID,
  WELCOME_GENERAL_CHANNEL_ID,
  WELCOME_NEW_PRODUCTS_CHANNEL_ID,
  WELCOME_ROLE_ID,
  WELCOME_RULES_CHANNEL_ID,
  WELCOME_SUPPORT_CHANNEL_ID,
  WELCOME_TICKET_CHANNEL_ID,
  WELCOME_UPDATES_CHANNEL_ID,
} from '../config.ts'
import { broadcastActivity } from '../dashboard/websocket.ts'
import { ndEmbed } from '../utils/embed.ts'

function channelRef(id: string | undefined, plain: string): string {
  return id ? `<#${id}>` : plain
}

export function registerWelcomeHandler(client: Client): void {
  // Always register activity-feed broadcasts even if welcome features are disabled
  client.on(Events.GuildMemberAdd, async (member: GuildMember) => {
    try {
      broadcastActivity('member_joined', {
        userId: member.id,
        username: member.user.username,
        displayName: member.displayName,
        avatarUrl: member.user.displayAvatarURL({ size: 32 }),
        memberCount: member.guild.memberCount,
      })
    } catch (e) {
      console.error('[welcome] member_joined broadcast:', e)
    }
  })

  client.on(Events.GuildMemberRemove, async (member: GuildMember | PartialGuildMember) => {
    try {
      broadcastActivity('member_left', {
        userId: member.id,
        username: member.user?.username || 'unknown',
        displayName: member.displayName || member.user?.username || 'unknown',
        avatarUrl: member.user?.displayAvatarURL({ size: 32 }),
        memberCount: member.guild.memberCount,
      })
    } catch (e) {
      console.error('[welcome] member_left broadcast:', e)
    }
  })

  if (!WELCOME_CHANNEL_ID && !WELCOME_ROLE_ID) return

  client.on(Events.GuildMemberAdd, async (member: GuildMember) => {
    try {
      if (WELCOME_ROLE_ID) {
        const role = await member.guild.roles.fetch(WELCOME_ROLE_ID).catch(() => null)
        if (role) await member.roles.add(role).catch((e) => console.error('[welcome] role add:', e))
      }

      if (WELCOME_CHANNEL_ID) {
        const welcomeCh = await member.guild.channels.fetch(WELCOME_CHANNEL_ID).catch(() => null)
        if (welcomeCh?.isTextBased() && !welcomeCh.isDMBased()) {
          const n = member.guild.memberCount.toLocaleString()
          const icon = member.guild.iconURL({ size: 256 })
          const embed = ndEmbed()
            .setFooter({ text: 'Nightz Development' })
            .setTitle('Welcome to Nightz Development')
            .setDescription(`Welcome aboard!\n*${n} members, thanks for joining ND.*`)
            .addFields(
              {
                name: 'Start here',
                value: `Review ${channelRef(WELCOME_RULES_CHANNEL_ID, 'rules')} for community rules and developer licensing.`,
              },
              {
                name: 'Explore',
                value: [
                  `• Announcement, ${channelRef(WELCOME_NEW_PRODUCTS_CHANNEL_ID, '#announcement')}`,
                  `• Stay informed through ${channelRef(WELCOME_UPDATES_CHANNEL_ID, 'updates')}`,
                  `• Join the discussion in ${channelRef(WELCOME_GENERAL_CHANNEL_ID, '#general')}`,
                ].join('\n'),
              },
              {
                name: 'Need help?',
                value: `${channelRef(WELCOME_SUPPORT_CHANNEL_ID, 'tech-support')}, or open a ticket in ${channelRef(WELCOME_TICKET_CHANNEL_ID, 'open-a-ticket')}.`,
              },
              {
                name: 'About us',
                value:
                  'Optimized, innovative FiveM resources, built by developers who care about performance and community.\n\n' +
                  '*Built by Developers. Driven by Passion.*\n\n' +
                  'Have fun and build something incredible.',
              },
            )
          if (icon) embed.setThumbnail(icon)
          await welcomeCh.send({ content: `${member}`, embeds: [embed] })
        }
      }
    } catch (e) {
      console.error('[welcome]', e)
    }
  })
}
