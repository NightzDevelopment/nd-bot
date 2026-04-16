/**
 * Audit logging, message edits/deletes, member join/leave, bans, voice moves.
 */
import {
  ChannelType,
  EmbedBuilder,
  Events,
  type Client,
  type GuildChannel,
  type PartialMessage,
  type VoiceState,
} from 'discord.js'
import { AUDIT_LOG_CHANNEL_ID } from '../config.ts'
import {
  isIgnoredChannelOrCategory,
  isIgnoredChannelOrCategoryById,
  shouldIgnoreMessageAudit,
} from '../utils/channel-ignore.ts'

let auditChannel: import('discord.js').TextChannel | null = null

async function sendAudit(embed: EmbedBuilder): Promise<void> {
  if (!auditChannel) return
  try {
    await auditChannel.send({ embeds: [embed] })
  } catch (e) {
    console.error('[audit] send failed:', e)
  }
}

export async function initAuditChannel(client: Client): Promise<void> {
  if (!AUDIT_LOG_CHANNEL_ID) return
  try {
    const ch = await client.channels.fetch(AUDIT_LOG_CHANNEL_ID)
    if (ch?.isTextBased() && !ch.isDMBased()) {
      auditChannel = ch as import('discord.js').TextChannel
      console.log(`[audit] logging to #${auditChannel.name}`)
    }
  } catch (e) {
    console.error('[audit] failed to fetch channel:', e)
  }
}

export function registerAuditHandler(client: Client): void {
  client.on(Events.MessageUpdate, async (oldM, newM) => {
    if (!auditChannel || newM.author?.bot) return
    if (isIgnoredChannelOrCategory(newM.channel)) return
    if (oldM.content === newM.content) return
    const embed = new EmbedBuilder()
      .setColor(0xfee75c)
      .setTitle('Message edited')
      .addFields(
        { name: 'Author', value: `${newM.author?.tag ?? '?'}`, inline: true },
        { name: 'Channel', value: `<#${newM.channel.id}>`, inline: true },
        {
          name: 'Before',
          value: (oldM.content ?? '(unknown)').slice(0, 900),
        },
        { name: 'After', value: (newM.content ?? '').slice(0, 900) },
      )
      .setTimestamp()
    await sendAudit(embed)
  })

  client.on(Events.MessageDelete, async (msg: PartialMessage) => {
    if (!auditChannel || msg.author?.bot) return
    if (shouldIgnoreMessageAudit(msg)) return
    const embed = new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle('Message deleted')
      .addFields(
        {
          name: 'Author',
          value: msg.author ? `${msg.author.tag}` : 'Unknown',
          inline: true,
        },
        {
          name: 'Channel',
          value: msg.channel ? `<#${msg.channel.id}>` : '?',
          inline: true,
        },
        { name: 'Content', value: (msg.content ?? '(unknown)').slice(0, 900) },
      )
      .setTimestamp()
    await sendAudit(embed)
  })

  client.on(Events.GuildMemberAdd, async (member) => {
    if (!auditChannel) return
    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle('Member joined')
      .setDescription(`${member.user.tag} (\`${member.id}\`)`)
      .setThumbnail(member.user.displayAvatarURL({ size: 128 }))
      .setTimestamp()
    await sendAudit(embed)
  })

  client.on(Events.GuildMemberRemove, async (member) => {
    if (!auditChannel) return
    const embed = new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle('Member left')
      .setDescription(`${member.user.tag} (\`${member.id}\`)`)
      .setTimestamp()
    await sendAudit(embed)
  })

  client.on(Events.GuildBanAdd, async (ban) => {
    if (!auditChannel) return
    const embed = new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle('Member banned')
      .setDescription(`${ban.user.tag} (\`${ban.user.id}\`)`)
      .addFields({ name: 'Reason', value: ban.reason ?? '(none)' })
      .setTimestamp()
    await sendAudit(embed)
  })

  client.on(Events.GuildBanRemove, async (ban) => {
    if (!auditChannel) return
    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle('Member unbanned')
      .setDescription(`${ban.user.tag} (\`${ban.user.id}\`)`)
      .setTimestamp()
    await sendAudit(embed)
  })

  client.on(Events.ChannelCreate, async (ch) => {
    if (!auditChannel || ch.type === ChannelType.DM) return
    const gch = ch as GuildChannel
    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle('Channel created')
      .setDescription(`<#${gch.id}> (${gch.name})`)
      .setTimestamp()
    await sendAudit(embed)
  })

  client.on(Events.ChannelDelete, async (ch) => {
    if (!auditChannel) return
    const embed = new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle('Channel deleted')
      .setDescription(`${ch.name} (\`${ch.id}\`)`)
      .setTimestamp()
    await sendAudit(embed)
  })

  client.on(
    Events.VoiceStateUpdate,
    async (oldS: VoiceState, newS: VoiceState) => {
      if (!auditChannel) return
      const m = newS.member ?? oldS.member
      if (!m || m.user.bot) return
      if (oldS.channelId === newS.channelId) return
      const guild = newS.guild ?? oldS.guild
      if (guild) {
        const fromIgn = oldS.channelId
          ? isIgnoredChannelOrCategoryById(guild, oldS.channelId)
          : false
        const toIgn = newS.channelId
          ? isIgnoredChannelOrCategoryById(guild, newS.channelId)
          : false
        if (fromIgn || toIgn) return
      }
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('Voice move')
        .setDescription(`${m.user.tag}`)
        .addFields(
          {
            name: 'From',
            value: oldS.channelId ? `<#${oldS.channelId}>` : '(none)',
            inline: true,
          },
          {
            name: 'To',
            value: newS.channelId ? `<#${newS.channelId}>` : '(disconnected)',
            inline: true,
          },
        )
        .setTimestamp()
      await sendAudit(embed)
    },
  )
}
