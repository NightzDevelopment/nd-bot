/**
 * Quarantine tickets: a private support/appeal channel for quarantined members.
 *
 * A quarantined member has all roles stripped, so they can only see the
 * quarantine channels. Staff post the panel there with nd!qticketpanel; a
 * quarantined member clicks "Open Quarantine Ticket" to get a private channel
 * only they and staff can see, where they can appeal or ask for help. Staff can
 * Close the ticket or Release the member (removes the quarantine role, which
 * restores their previous roles via the role-swap).
 *
 * Interaction customIds:
 *   ndqticket:open              member  -> create their private ticket
 *   ndqticket:close             staff   -> delete the ticket channel
 *   ndqticket:release:<userId>  staff   -> lift quarantine + close
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  type GuildMember,
  type Interaction,
  type Message,
  MessageFlags,
  OverwriteType,
  PermissionFlagsBits,
  type TextChannel,
} from 'discord.js'
import { modRoleIds, quarantineRoleId } from '../config.ts'
import { ndEmbed } from '../utils/embed.ts'
import { isGuildMod } from '../utils/permissions.ts'

const TOPIC_PREFIX = 'qticket:'

function panelEmbed() {
  return ndEmbed()
    .setTitle('Quarantine support')
    .setDescription(
      'You have been placed in quarantine, which limits your access while staff review the situation.\n\n' +
        'If you believe this was a mistake or want to explain, open a private ticket below. Only you and the staff team can see it.',
    )
}

function panelRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('ndqticket:open')
      .setLabel('Open Quarantine Ticket')
      .setStyle(ButtonStyle.Primary),
  )
}

/** Staff command: post the quarantine ticket panel in the current channel. */
export async function handleQuarantineTicketPanelCommand(
  msg: Message,
  cmd: string,
  _args: string,
): Promise<boolean> {
  if (cmd !== 'qticketpanel' && cmd !== 'quarantineticketpanel') return false
  if (!msg.guild) {
    await msg.reply('Use this in a server.')
    return true
  }
  const member =
    msg.member ?? (await msg.guild.members.fetch(msg.author.id).catch(() => null)) ?? null
  if (!isGuildMod(member)) {
    await msg.reply('Staff only.')
    return true
  }
  const channel = msg.channel
  if (!channel.isTextBased() || !('send' in channel)) {
    await msg.reply('Run this in a text channel (the quarantine channel).')
    return true
  }
  await channel.send({ embeds: [panelEmbed()], components: [panelRow()] })
  await msg.reply('Quarantine ticket panel posted.')
  return true
}

async function openTicket(interaction: Interaction & { isButton: () => true }): Promise<void> {
  if (!interaction.isButton() || !interaction.guild) return
  const guild = interaction.guild
  const opener = interaction.member as GuildMember | null
  if (!opener) {
    await interaction.reply({ content: 'Could not resolve your membership.', flags: MessageFlags.Ephemeral })
    return
  }
  if (!quarantineRoleId || !opener.roles.cache.has(quarantineRoleId)) {
    await interaction.reply({
      content: 'This is only for members currently in quarantine.',
      flags: MessageFlags.Ephemeral,
    })
    return
  }

  // One open ticket per member.
  const existing = guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildText && c.topic?.startsWith(`${TOPIC_PREFIX}${opener.id}`),
  ) as TextChannel | undefined
  if (existing) {
    await interaction.reply({
      content: `You already have an open quarantine ticket: ${existing}`,
      flags: MessageFlags.Ephemeral,
    })
    return
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral })

  const parentId =
    interaction.channel && 'parentId' in interaction.channel
      ? ((interaction.channel as { parentId?: string | null }).parentId ?? undefined)
      : undefined

  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel], type: OverwriteType.Role },
    {
      id: opener.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
      ],
      type: OverwriteType.Member,
    },
    ...[...modRoleIds].map((id) => ({
      id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageMessages,
      ],
      type: OverwriteType.Role as const,
    })),
  ]

  const safeName = opener.user.username.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24) || 'member'
  const channel = await guild.channels
    .create({
      name: `quarantine-${safeName}`,
      type: ChannelType.GuildText,
      ...(parentId ? { parent: parentId } : {}),
      topic: `${TOPIC_PREFIX}${opener.id}`,
      permissionOverwrites: overwrites,
    })
    .catch(() => null)

  if (!channel) {
    await interaction.editReply('Could not create your ticket. Please wait for staff.')
    return
  }

  const controls = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`ndqticket:release:${opener.id}`)
      .setLabel('Release from quarantine')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('ndqticket:close').setLabel('Close').setStyle(ButtonStyle.Danger),
  )
  const staffPing = [...modRoleIds].map((id) => `<@&${id}>`).join(' ')
  await channel.send({
    content: `${opener} ${staffPing}`.trim(),
    embeds: [
      ndEmbed()
        .setTitle('Quarantine ticket')
        .setDescription(
          `${opener}, explain your situation here and staff will review.\n\n**Staff:** use **Release** to lift the quarantine, or **Close** to end this ticket.`,
        ),
    ],
    components: [controls],
  })
  await interaction.editReply(`Your quarantine ticket is open: ${channel}`)
}

export async function tryHandleQuarantineTicketInteraction(interaction: Interaction): Promise<boolean> {
  if (!interaction.isButton()) return false
  const id = interaction.customId
  if (!id.startsWith('ndqticket:')) return false
  const [, action, arg] = id.split(':')

  if (action === 'open') {
    await openTicket(interaction as Interaction & { isButton: () => true })
    return true
  }

  // close / release are staff-only.
  const member = interaction.member as GuildMember | null
  if (!isGuildMod(member)) {
    await interaction.reply({ content: 'Only staff can do that.', flags: MessageFlags.Ephemeral })
    return true
  }

  if (action === 'release') {
    const userId = arg ?? ''
    const guild = interaction.guild
    if (guild && quarantineRoleId && userId) {
      const target = await guild.members.fetch(userId).catch(() => null)
      if (target?.roles.cache.has(quarantineRoleId)) {
        await target.roles
          .remove(quarantineRoleId, `Quarantine lifted via ticket by ${interaction.user.tag}`)
          .catch(() => undefined)
      }
    }
    await interaction.reply({ content: 'Quarantine lifted. Roles restored. Closing ticket...' })
    scheduleClose(interaction)
    return true
  }

  if (action === 'close') {
    await interaction.reply({ content: 'Closing ticket...' })
    scheduleClose(interaction)
    return true
  }

  return false
}

function scheduleClose(interaction: Interaction): void {
  const channel = interaction.channel
  if (!channel || channel.type !== ChannelType.GuildText) return
  setTimeout(() => {
    void (channel as TextChannel).delete('Quarantine ticket closed').catch(() => undefined)
  }, 5000)
}
