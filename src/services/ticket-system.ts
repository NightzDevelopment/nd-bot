/**
 * ND ticket system: panel, private channels, claim/close/reopen/delete, transcripts.
 */
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
  type Client,
  type Guild,
  type GuildMember,
  type Interaction,
  type Message,
  type ModalSubmitInteraction,
  type TextChannel,
} from 'discord.js'
import {
  TICKET_CLOSED_CATEGORY_ID,
  TICKET_OPEN_CATEGORY_ID,
  TICKET_PANEL_CHANNEL_ID,
  modRoleIds,
  parseTicketReasons,
  ticketAutoCloseGraceHours,
  ticketAutoCloseHours,
  ticketDmOnClose,
  ticketLogChannelId,
  ticketMaxOpenPerUser,
  ticketNamingPrefix,
  ticketSystemEnabled,
  ticketTranscriptEnabled,
} from '../config.ts'
import { ndEmbed } from '../utils/embed.ts'
import { isGuildMod } from '../utils/permissions.ts'
import {
  deleteTicketRecord,
  getTicketByChannel,
  getTicketStats,
  listAllOpenTickets,
  listOpenTickets,
  listOpenTicketsForUser,
  nextTicketNumericId,
  saveTicket,
  updateTicketPartial,
  type TicketRecord,
} from './ticket-store.ts'

export const TICKET_PREFIX = 'ndticket'

/** Ephemeral reason selection before Open (5 min TTL). */
const pendingReason = new Map<string, { reason: string; at: number }>()
const REASON_TTL_MS = 5 * 60 * 1000

const REASON_DESCRIPTIONS: Record<string, string> = {
  'buying product': 'Looking to purchase one of our products',
  'technical help': 'Performance, crashes, loading issues',
  'script support': 'Bugs or questions about public ND scripts',
  'account/role issues': 'Discord roles, server permissions, access',
  'billing/refund': 'Payment issues, license transfers, refund requests',
  'commission inquiry': 'Custom work, quotes, project scoping',
  suggestions: 'Feature ideas or quality-of-life improvements',
  'report a problem': 'Report a bug, exploit, or player issue',
  partnership: 'Collaboration, partnerships, business inquiries',
  'partnership/collaboration': 'Collaboration, partnerships, business inquiries',
  other: 'Anything that does not fit the above',
}

function reasonDescription(label: string): string {
  const key = label.trim().toLowerCase()
  return REASON_DESCRIPTIONS[key] ?? 'Support request'
}

function padId(n: number): string {
  return String(n).padStart(4, '0')
}

function sanitizeTopicName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
}

export function buildTicketPanelEmbed(guild: Guild): EmbedBuilder {
  const icon = guild.iconURL({ size: 128 })
  return ndEmbed()
    .setAuthor({ name: 'Nightz Development', iconURL: icon ?? undefined })
    .setTitle('Support Center')
    .setThumbnail(icon ?? null)
    .setDescription(
      [
        'Need help with a product, your account, or have a question?',
        'You are in the right place.',
        '',
        'Select a reason below, then hit **Open Ticket**. A private channel',
        'will be created where our team (and our AI assistant) can help you out.',
      ].join('\n'),
    )
    .addFields(
      {
        name: 'How it works',
        value: [
          '1. Pick a category from the dropdown',
          '2. Click Open Ticket',
          '3. Describe your issue in the new channel',
          '4. A staff member or our AI will respond',
        ].join('\n'),
        inline: false,
      },
      {
        name: 'Quick links',
        value: [
          'Store: https://store.nightz.dev/',
          'Discord: https://discord.gg/KaKCBUkD8M',
        ].join('\n'),
        inline: false,
      },
      {
        name: 'Please note',
        value: [
          '- One topic per ticket. Open a second ticket for a separate issue.',
          '- Include error messages, screenshots, and your framework (ESX/QBCore) if relevant.',
          '- Do not ping staff. We will get to your ticket as soon as possible.',
        ].join('\n'),
        inline: false,
      },
    )
    .setTimestamp(new Date())
}

function buildReasonSelect(): ActionRowBuilder<StringSelectMenuBuilder> {
  const reasons = parseTicketReasons()
  const opts = reasons.slice(0, 25).map((r) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(r.slice(0, 100))
      .setValue(r.slice(0, 100))
      .setDescription(reasonDescription(r).slice(0, 100)),
  )
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`${TICKET_PREFIX}:reason`)
    .setPlaceholder('What do you need help with?')
    .addOptions(opts)
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)
}

function buildOpenRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${TICKET_PREFIX}:open`)
      .setLabel('Open Ticket')
      .setStyle(ButtonStyle.Primary),
  )
}

export async function deployTicketPanel(client: Client): Promise<void> {
  if (!ticketSystemEnabled) return
  const id = TICKET_PANEL_CHANNEL_ID
  if (!id) return
  try {
    const ch = await client.channels.fetch(id)
    if (!ch?.isTextBased() || ch.isDMBased()) {
      console.warn('[tickets] TICKET_PANEL_CHANNEL_ID is not a guild text channel')
      return
    }
    const guild = ch.guild
    const embed = buildTicketPanelEmbed(guild)
    const rowSelect = buildReasonSelect()
    const rowBtn = buildOpenRow()

    const recent = await ch.messages.fetch({ limit: 30 }).catch(() => null)
    if (recent) {
      const existing = recent.find(
        (m) =>
          m.author.id === client.user?.id &&
          m.components.length > 0 &&
          m.components.some((r) =>
            r.components.some(
              (c) => 'customId' in c && c.customId === `${TICKET_PREFIX}:reason`,
            ),
          ),
      )
      if (existing) {
        await existing.edit({ embeds: [embed], components: [rowSelect, rowBtn] })
        console.log('[tickets] Updated ticket panel message')
        return
      }
    }

    await ch.send({ embeds: [embed], components: [rowSelect, rowBtn] })
    console.log('[tickets] Posted ticket panel')
  } catch (e) {
    console.warn('[tickets] deployTicketPanel failed:', e)
  }
}

function ticketOverwriteBase(guild: Guild, userId: string, botId: string) {
  const everyone = guild.roles.everyone.id
  const base: {
    id: string
    allow?: bigint
    deny?: bigint
  }[] = [
    { id: everyone, deny: PermissionFlagsBits.ViewChannel },
    {
      id: userId,
      allow:
        PermissionFlagsBits.ViewChannel |
        PermissionFlagsBits.SendMessages |
        PermissionFlagsBits.ReadMessageHistory |
        PermissionFlagsBits.AttachFiles |
        PermissionFlagsBits.EmbedLinks,
    },
    {
      id: botId,
      allow:
        PermissionFlagsBits.ViewChannel |
        PermissionFlagsBits.SendMessages |
        PermissionFlagsBits.ReadMessageHistory |
        PermissionFlagsBits.ManageMessages |
        PermissionFlagsBits.ManageChannels |
        PermissionFlagsBits.AttachFiles |
        PermissionFlagsBits.EmbedLinks,
    },
  ]
  for (const roleId of modRoleIds) {
    base.push({
      id: roleId,
      allow:
        PermissionFlagsBits.ViewChannel |
        PermissionFlagsBits.SendMessages |
        PermissionFlagsBits.ReadMessageHistory |
        PermissionFlagsBits.AttachFiles |
        PermissionFlagsBits.EmbedLinks |
        PermissionFlagsBits.ManageMessages,
    })
  }
  return base
}

export type CreateTicketOptions = {
  contextSnippet?: string
  contextJumpUrl?: string
}

export async function createTicketChannel(
  guild: Guild,
  member: GuildMember,
  reason: string,
  opts?: CreateTicketOptions,
): Promise<TextChannel> {
  if (!ticketSystemEnabled) {
    throw new Error('Ticket system is disabled')
  }
  const parentId = TICKET_OPEN_CATEGORY_ID
  if (!parentId) throw new Error('TICKET_OPEN_CATEGORY_ID not set')

  const open = await listOpenTicketsForUser(guild.id, member.id)
  if (open.length >= ticketMaxOpenPerUser) {
    throw new Error(
      `You already have ${open.length} open ticket(s). Max ${ticketMaxOpenPerUser}.`,
    )
  }

  const botId = guild.client.user?.id
  if (!botId) throw new Error('Bot user unavailable')

  const numericId = await nextTicketNumericId()
  const slug = `${ticketNamingPrefix}-${padId(numericId)}`
  const name = sanitizeTopicName(slug) || `ticket-${padId(numericId)}`

  const parent = await guild.channels.fetch(parentId).catch(() => null)
  if (!parent || parent.type !== ChannelType.GuildCategory) {
    throw new Error('Open ticket category not found')
  }

  const channel = (await guild.channels.create({
    name,
    type: ChannelType.GuildText,
    parent: parentId,
    permissionOverwrites: ticketOverwriteBase(guild, member.id, botId),
    reason: `Support ticket ${numericId} for ${member.user.tag}`,
  })) as TextChannel

  const openedAt = Date.now()
  const welcomeEmbed = ndEmbed()
    .setTitle(`Support Ticket #${padId(numericId)}`)
    .setDescription(
      [
        'Welcome to your support ticket. A staff member will be with you shortly.',
        'Our AI assistant may respond first to help gather information.',
      ].join('\n'),
    )
    .addFields(
      {
        name: 'User',
        value: `${member} (\`${member.id}\`)`,
        inline: true,
      },
      { name: 'Reason', value: reason.slice(0, 1024), inline: true },
      {
        name: 'Opened',
        value: `<t:${Math.floor(openedAt / 1000)}:F>`,
        inline: true,
      },
      {
        name: 'Ticket ID',
        value: `#${padId(numericId)}`,
        inline: true,
      },
      {
        name: 'Status',
        value: 'Open',
        inline: true,
      },
    )

  if (opts?.contextSnippet) {
    welcomeEmbed.addFields({
      name: 'Context',
      value: opts.contextSnippet.slice(0, 1000),
      inline: false,
    })
  }
  if (opts?.contextJumpUrl) {
    welcomeEmbed.addFields({
      name: 'Original message',
      value: `[Jump](${opts.contextJumpUrl})`,
      inline: false,
    })
  }

  const claimBtn = new ButtonBuilder()
    .setCustomId(`${TICKET_PREFIX}:claim:${channel.id}`)
    .setLabel('Claim')
    .setStyle(ButtonStyle.Success)

  const closeBtn = new ButtonBuilder()
    .setCustomId(`${TICKET_PREFIX}:close:${channel.id}`)
    .setLabel('Close Ticket')
    .setStyle(ButtonStyle.Danger)

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    claimBtn,
    closeBtn,
  )

  const welcomeMsg = await channel.send({
    content: `${member}`,
    embeds: [welcomeEmbed],
    components: [row],
  })

  await channel.send({
    content:
      'Please describe your issue in detail. Include error messages, screenshots, your framework (ESX/QBCore), and artifact version if relevant.',
  })

  const rec: TicketRecord = {
    id: numericId,
    channelId: channel.id,
    guildId: guild.id,
    userId: member.id,
    userTag: member.user.tag,
    reason,
    openedAt,
    status: 'open',
    welcomeMessageId: welcomeMsg.id,
    lastUserMessageAt: openedAt,
    staffEngaged: false,
  }
  await saveTicket(rec)

  await postStaffTicketLog(guild.client, rec, 'opened', channel)
  return channel
}

async function postStaffTicketLog(
  client: Client,
  ticket: TicketRecord,
  kind: 'opened' | 'claimed' | 'closed' | 'reopened' | 'deleted',
  channel?: TextChannel,
): Promise<void> {
  const logId = ticketLogChannelId
  if (!logId) return
  try {
    const logCh = await client.channels.fetch(logId)
    if (!logCh?.isTextBased() || logCh.isDMBased()) return

    const jump =
      channel &&
      `https://discord.com/channels/${ticket.guildId}/${channel.id}/${ticket.welcomeMessageId ?? channel.id}`

    const title =
      kind === 'opened'
        ? 'Ticket opened'
        : kind === 'claimed'
          ? 'Ticket claimed'
          : kind === 'closed'
            ? 'Ticket closed'
            : kind === 'reopened'
              ? 'Ticket reopened'
              : 'Ticket deleted'

    const embed = ndEmbed()
      .setTitle(title)
      .addFields(
        { name: 'Ticket', value: `#${padId(ticket.id)}`, inline: true },
        { name: 'User', value: `${ticket.userTag} (\`${ticket.userId}\`)`, inline: true },
        { name: 'Reason', value: ticket.reason.slice(0, 1024), inline: false },
      )

    if (ticket.claimedByTag) {
      embed.addFields({
        name: 'Claimed by',
        value: ticket.claimedByTag,
        inline: true,
      })
    }
    if (jump) embed.setDescription(`[Open ticket](${jump})`)

    if (ticket.logMessageId) {
      try {
        const prev = await logCh.messages.fetch(ticket.logMessageId)
        await prev.edit({ embeds: [embed] })
        return
      } catch {
        /* fall through to new message */
      }
    }

    const msg = await logCh.send({ embeds: [embed] })
    await updateTicketPartial(ticket.channelId, { logMessageId: msg.id })
  } catch (e) {
    console.warn('[tickets] staff log failed:', e)
  }
}

function canManageTicket(
  interaction: Interaction,
  ticket: TicketRecord,
): boolean {
  if (interaction.user.id === ticket.userId) return true
  const m = interaction.member
  if (m && 'permissions' in m) {
    return isGuildMod(m as GuildMember)
  }
  return false
}

export async function tryHandleTicketSystem(
  interaction: Interaction,
): Promise<boolean> {
  if (!ticketSystemEnabled) return false

  if (interaction.isStringSelectMenu()) {
    if (interaction.customId !== `${TICKET_PREFIX}:reason`) return false
    const reason = interaction.values[0] ?? 'Other'
    pendingReason.set(interaction.user.id, { reason, at: Date.now() })
    await interaction.reply({
      content: 'Category selected. Click **Open Ticket**.',
      ephemeral: true,
    })
    return true
  }

  if (interaction.isButton()) {
    const id = interaction.customId
    if (!id.startsWith(`${TICKET_PREFIX}:`)) return false

    const parts = id.split(':')
    if (parts[1] === 'open') {
      await handleOpenButton(interaction)
      return true
    }
    const channelId = parts[2]
    if (!channelId) return true

    if (parts[1] === 'claim') {
      await handleClaim(interaction, channelId)
      return true
    }
    if (parts[1] === 'close') {
      await handleCloseButton(interaction, channelId)
      return true
    }
    if (parts[1] === 'reopen') {
      await handleReopen(interaction, channelId)
      return true
    }
    if (parts[1] === 'delete') {
      await handleDeletePrompt(interaction, channelId)
      return true
    }
    if (parts[1] === 'delconf') {
      await handleDeleteConfirm(interaction, channelId)
      return true
    }
    if (parts[1] === 'delcancel') {
      await interaction
        .update({ content: 'Delete cancelled.', components: [] })
        .catch(() => {})
      return true
    }
    if (parts[1] === 'txdm') {
      await handleTranscriptDm(interaction, channelId)
      return true
    }
    return false
  }

  if (interaction.isModalSubmit()) {
    const id = interaction.customId
    if (!id.startsWith(`${TICKET_PREFIX}:close_modal:`)) return false
    const channelId = id.slice(`${TICKET_PREFIX}:close_modal:`.length)
    await handleCloseModal(interaction, channelId)
    return true
  }

  return false
}

async function handleOpenButton(interaction: Interaction): Promise<void> {
  if (!interaction.isButton() || !interaction.guild) {
    await interaction.reply({ content: 'Use this in the server.', ephemeral: true })
    return
  }

  let reason = 'Other'
  const pend = pendingReason.get(interaction.user.id)
  if (pend && Date.now() - pend.at < REASON_TTL_MS) {
    reason = pend.reason
  }
  pendingReason.delete(interaction.user.id)

  await interaction.deferReply({ ephemeral: true })
  try {
    const member = await interaction.guild.members.fetch(interaction.user.id)
    const ch = await createTicketChannel(interaction.guild, member, reason)
    await interaction.editReply(`Created ${ch}`)
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e)
    await interaction.editReply({ content: err.slice(0, 2000) })
  }
}

async function handleClaim(
  interaction: Interaction,
  channelId: string,
): Promise<void> {
  if (!interaction.isButton() || !interaction.guild) return
  const member = await interaction.guild.members.fetch(interaction.user.id)
  if (!isGuildMod(member)) {
    await interaction.reply({
      content: 'Only staff can claim tickets.',
      ephemeral: true,
    })
    return
  }

  const ticket = await getTicketByChannel(channelId)
  if (!ticket || ticket.status !== 'open') {
    await interaction.reply({ content: 'Ticket not found or not open.', ephemeral: true })
    return
  }

  const ch = await interaction.guild.channels.fetch(channelId).catch(() => null)
  if (!ch?.isTextBased() || ch.isDMBased()) {
    await interaction.reply({ content: 'Channel not found.', ephemeral: true })
    return
  }

  await interaction.deferUpdate()

  await updateTicketPartial(channelId, {
    claimedBy: interaction.user.id,
    claimedByTag: interaction.user.tag,
    staffEngaged: true,
  })

  const t2 = (await getTicketByChannel(channelId))!

  if (ticket.welcomeMessageId) {
    try {
      const msg = await ch.messages.fetch(ticket.welcomeMessageId)
      const old = msg.embeds[0]
        ? EmbedBuilder.from(msg.embeds[0])
        : ndEmbed()
      old.addFields({
        name: 'Claimed by',
        value: `${interaction.user} (\`${interaction.user.id}\`)`,
        inline: true,
      })
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`${TICKET_PREFIX}:claim:${channelId}`)
          .setLabel('Claimed')
          .setStyle(ButtonStyle.Success)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId(`${TICKET_PREFIX}:close:${channelId}`)
          .setLabel('Close Ticket')
          .setStyle(ButtonStyle.Danger),
      )
      await msg.edit({ embeds: [old], components: [row] })
    } catch (e) {
      console.warn('[tickets] claim edit failed:', e)
    }
  }

  await ch.send(
    `This ticket has been claimed by **${interaction.user.tag}**.`,
  )
  await postStaffTicketLog(interaction.client, t2, 'claimed', ch as TextChannel)
}

async function handleCloseButton(
  interaction: Interaction,
  channelId: string,
): Promise<void> {
  if (!interaction.isButton() || !interaction.guild) return
  const ticket = await getTicketByChannel(channelId)
  if (!ticket) {
    await interaction.reply({ content: 'Not a ticket channel.', ephemeral: true })
    return
  }
  if (!canManageTicket(interaction, ticket)) {
    await interaction.reply({ content: 'You cannot close this ticket.', ephemeral: true })
    return
  }

  const modal = new ModalBuilder()
    .setCustomId(`${TICKET_PREFIX}:close_modal:${channelId}`)
    .setTitle('Close ticket')

  const input = new TextInputBuilder()
    .setCustomId('close_notes')
    .setLabel('Reason or notes (optional)')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(1000)

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(input),
  )

  await interaction.showModal(modal)
}

async function handleCloseModal(
  interaction: ModalSubmitInteraction,
  channelId: string,
): Promise<void> {
  if (!interaction.guild) return
  const ticket = await getTicketByChannel(channelId)
  if (!ticket || ticket.status !== 'open') {
    await interaction.reply({
      content: 'Ticket not open.',
      ephemeral: true,
    })
    return
  }
  if (!canManageTicket(interaction, ticket)) {
    await interaction.reply({ content: 'Not allowed.', ephemeral: true })
    return
  }

  const notes =
    interaction.fields.getTextInputValue('close_notes')?.trim() || ''

  await interaction.deferReply({ ephemeral: true })

  const ch = (await interaction.guild.channels
    .fetch(channelId)
    .catch(() => null)) as TextChannel | null
  if (!ch?.isTextBased()) {
    await interaction.editReply('Channel missing.')
    return
  }

  try {
    await runCloseTicket(
      interaction.client,
      ch,
      ticket,
      interaction.user,
      notes,
    )
    await interaction.editReply('Ticket closed.')
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e)
    await interaction.editReply(err.slice(0, 500))
  }
}

async function runCloseTicket(
  client: Client,
  channel: TextChannel,
  ticket: TicketRecord,
  closedBy: { id: string; tag: string },
  closeNotes: string,
): Promise<void> {
  const closedId = TICKET_CLOSED_CATEGORY_ID
  if (!closedId) throw new Error('TICKET_CLOSED_CATEGORY_ID not set')

  let buf: Buffer | null = null
  let msgCount = 0
  if (ticketTranscriptEnabled) {
    const { buffer, count } = await buildTranscriptBuffer(channel, ticket)
    buf = buffer
    msgCount = count
  } else {
    const msgs = await channel.messages.fetch({ limit: 100 })
    msgCount = msgs.size
  }

  const closedAt = Date.now()
  await updateTicketPartial(channel.id, {
    status: 'closed',
    closedAt,
    closedBy: closedBy.id,
    closedByTag: closedBy.tag,
    closeReason: closeNotes || undefined,
    messageCount: msgCount,
  })
  const t = (await getTicketByChannel(channel.id))!

  await channel.permissionOverwrites.edit(ticket.userId, {
    SendMessages: false,
  })

  await channel.setParent(closedId, { lockPermissions: false }).catch(() => {})
  await channel
    .setName(`closed-${padId(ticket.id)}`.slice(0, 100))
    .catch(() => {})

  const durationMs = closedAt - ticket.openedAt
  const durationStr = formatDuration(durationMs)

  const closingEmbed = ndEmbed()
    .setColor(0xed4245)
    .setTitle(`Ticket #${padId(ticket.id)} closed`)
    .addFields(
      { name: 'Closed by', value: closedBy.tag, inline: true },
      {
        name: 'Notes',
        value: closeNotes.slice(0, 1024) || '(none)',
        inline: true,
      },
      { name: 'Duration', value: durationStr, inline: true },
      { name: 'Messages', value: String(msgCount), inline: true },
    )

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${TICKET_PREFIX}:reopen:${channel.id}`)
      .setLabel('Reopen')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`${TICKET_PREFIX}:delete:${channel.id}`)
      .setLabel('Delete')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`${TICKET_PREFIX}:txdm:${channel.id}`)
      .setLabel('Save transcript')
      .setStyle(ButtonStyle.Secondary),
  )

  const payload: {
    embeds: EmbedBuilder[]
    components: ActionRowBuilder<ButtonBuilder>[]
    files?: AttachmentBuilder[]
  } = { embeds: [closingEmbed], components: [row] }

  if (buf && ticketTranscriptEnabled) {
    payload.files = [
      new AttachmentBuilder(buf, {
        name: `transcript-${padId(ticket.id)}.txt`,
      }),
    ]
  }

  await channel.send(payload)

  await postStaffTicketLog(client, t, 'closed', channel)

  if (ticketDmOnClose) {
    try {
      const u = await client.users.fetch(ticket.userId)
      await u.send({
        content: `Your support ticket #${padId(ticket.id)} was closed by **${closedBy.tag}**.${closeNotes ? ` Notes: ${closeNotes.slice(0, 1500)}` : ''}`,
      })
    } catch {
      /* DMs closed */
    }
  }
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  const d = Math.floor(h / 24)
  if (d > 0) return `${d}d ${h % 24}h`
  if (h > 0) return `${h}h ${m % 60}m`
  if (m > 0) return `${m}m`
  return `${s}s`
}

async function buildTranscriptBuffer(
  channel: TextChannel,
  ticket: TicketRecord,
): Promise<{ buffer: Buffer; count: number }> {
  const header: string[] = [
    `Ticket #${padId(ticket.id)}`,
    `User: ${ticket.userTag} (${ticket.userId})`,
    `Reason: ${ticket.reason}`,
    `Opened: ${new Date(ticket.openedAt).toISOString()}`,
    '---',
  ]

  const collected: Message[] = []
  let lastId: string | undefined
  for (let i = 0; i < 6; i++) {
    const batch = await channel.messages.fetch({ limit: 100, before: lastId })
    if (batch.size === 0) break
    collected.push(...batch.values())
    lastId = batch.last()?.id
    if (batch.size < 100) break
  }

  collected.sort((a, b) => a.createdTimestamp - b.createdTimestamp)

  const lines: string[] = [...header]
  for (const m of collected) {
    const ts = new Date(m.createdTimestamp).toISOString()
    const body = m.content || '(no text)'
    const att =
      m.attachments.size > 0
        ? ` [attachments: ${[...m.attachments.values()].map((a) => a.url).join(', ')}]`
        : ''
    lines.push(`[${ts}] ${m.author.tag}: ${body}${att}`)
  }

  return {
    buffer: Buffer.from(lines.join('\n'), 'utf8'),
    count: collected.length,
  }
}

async function handleReopen(
  interaction: Interaction,
  channelId: string,
): Promise<void> {
  if (!interaction.isButton() || !interaction.guild) return
  const member = await interaction.guild.members.fetch(interaction.user.id)
  if (!isGuildMod(member)) {
    await interaction.reply({ content: 'Staff only.', ephemeral: true })
    return
  }

  const ticket = await getTicketByChannel(channelId)
  if (!ticket || ticket.status !== 'closed') {
    await interaction.reply({ content: 'Ticket not in closed state.', ephemeral: true })
    return
  }

  const ch = (await interaction.guild.channels
    .fetch(channelId)
    .catch(() => null)) as TextChannel | null
  if (!ch?.isTextBased()) {
    await interaction.reply({ content: 'Channel not found.', ephemeral: true })
    return
  }

  await interaction.deferUpdate()

  const openCat = TICKET_OPEN_CATEGORY_ID
  if (!openCat) return

  await ch.setParent(openCat, { lockPermissions: false }).catch(() => {})
  await ch.setName(`${ticketNamingPrefix}-${padId(ticket.id)}`.slice(0, 100)).catch(() => {})

  await ch.permissionOverwrites.edit(ticket.userId, {
    SendMessages: true,
  })

  await updateTicketPartial(channelId, {
    status: 'open',
    closedAt: undefined,
    closedBy: undefined,
    closedByTag: undefined,
    closeReason: undefined,
    claimedBy: undefined,
    claimedByTag: undefined,
    staffEngaged: false,
  })

  const claimBtn = new ButtonBuilder()
    .setCustomId(`${TICKET_PREFIX}:claim:${channelId}`)
    .setLabel('Claim')
    .setStyle(ButtonStyle.Success)
  const closeBtn = new ButtonBuilder()
    .setCustomId(`${TICKET_PREFIX}:close:${channelId}`)
    .setLabel('Close Ticket')
    .setStyle(ButtonStyle.Danger)
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    claimBtn,
    closeBtn,
  )

  await ch.send({
    embeds: [
      ndEmbed().setDescription(
        `Ticket reopened by **${interaction.user.tag}**.`,
      ),
    ],
    components: [row],
  })

  const t2 = (await getTicketByChannel(channelId))!
  await postStaffTicketLog(interaction.client, t2, 'reopened', ch)
}

async function handleDeletePrompt(
  interaction: Interaction,
  channelId: string,
): Promise<void> {
  if (!interaction.isButton() || !interaction.guild) return
  const member = await interaction.guild.members.fetch(interaction.user.id)
  if (!isGuildMod(member)) {
    await interaction.reply({ content: 'Staff only.', ephemeral: true })
    return
  }

  const embed = ndEmbed()
    .setTitle('Delete ticket channel?')
    .setDescription('This cannot be undone. All messages will be lost.')

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${TICKET_PREFIX}:delconf:${channelId}`)
      .setLabel('Confirm delete')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`${TICKET_PREFIX}:delcancel:${channelId}`)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary),
  )

  await interaction.reply({ embeds: [embed], components: [row], ephemeral: true })
}

async function handleDeleteConfirm(
  interaction: Interaction,
  channelId: string,
): Promise<void> {
  if (!interaction.isButton() || !interaction.guild) return
  const member = await interaction.guild.members.fetch(interaction.user.id)
  if (!isGuildMod(member)) {
    await interaction.reply({ content: 'Staff only.', ephemeral: true })
    return
  }

  const ticket = await getTicketByChannel(channelId)

  await interaction.deferUpdate()
  await interaction.message.edit({ components: [] }).catch(() => {})

  const ch = await interaction.guild.channels.fetch(channelId).catch(() => null)
  if (ch?.isTextBased()) {
    await ch.delete('Ticket deleted by staff').catch(() => {})
  }

  if (ticket) {
    await updateTicketPartial(channelId, { status: 'deleted' })
    await deleteTicketRecord(channelId)
    try {
      const logId = ticketLogChannelId
      if (logId) {
        const logCh = await interaction.client.channels.fetch(logId)
        if (logCh?.isTextBased() && !logCh.isDMBased()) {
          await logCh.send({
            embeds: [
              ndEmbed()
                .setTitle('Ticket channel deleted')
                .setDescription(
                  `Ticket #${padId(ticket.id)} for ${ticket.userTag} removed by **${interaction.user.tag}**.`,
                ),
            ],
          })
        }
      }
    } catch {
      /* ignore */
    }
  }
}

async function handleTranscriptDm(
  interaction: Interaction,
  channelId: string,
): Promise<void> {
  if (!interaction.isButton() || !interaction.guild) return
  const ticket = await getTicketByChannel(channelId)
  if (!ticket) {
    await interaction.reply({ content: 'Not a ticket.', ephemeral: true })
    return
  }

  const allowed =
    interaction.user.id === ticket.userId ||
    (await interaction.guild.members.fetch(interaction.user.id).then((m) =>
      isGuildMod(m),
    ))

  if (!allowed) {
    await interaction.reply({ content: 'Not allowed.', ephemeral: true })
    return
  }

  const ch = (await interaction.guild.channels
    .fetch(channelId)
    .catch(() => null)) as TextChannel | null
  if (!ch?.isTextBased()) {
    await interaction.reply({ content: 'Channel not found.', ephemeral: true })
    return
  }

  await interaction.deferReply({ ephemeral: true })

  const { buffer } = await buildTranscriptBuffer(ch, ticket)
  try {
    await interaction.user.send({
      files: [
        new AttachmentBuilder(buffer, {
          name: `transcript-${padId(ticket.id)}.txt`,
        }),
      ],
    })
    await interaction.editReply('Sent transcript to your DMs.')
  } catch {
    await interaction.editReply(
      'Could not DM you. Enable DMs from server members.',
    )
  }
}

export async function touchTicketUserActivity(message: Message): Promise<void> {
  if (!message.guild || message.author.bot) return
  const t = await getTicketByChannel(message.channel.id)
  if (!t || t.status !== 'open') return
  if (message.author.id !== t.userId) return
  await updateTicketPartial(message.channel.id, {
    lastUserMessageAt: Date.now(),
    warnedAutoCloseAt: undefined,
  })
}

/**
 * When a moderator (not the ticket opener) posts, stop automatic AI triage so staff can lead.
 */
export async function markTicketStaffEngagedFromModMessage(
  msg: Message,
): Promise<void> {
  if (!msg.guild || msg.author.bot) return
  const ticket = await getTicketByChannel(msg.channel.id)
  if (!ticket || ticket.status !== 'open') return
  if (msg.author.id === ticket.userId) return
  let member = msg.member
  if (!member) {
    try {
      member = await msg.guild.members.fetch(msg.author.id)
    } catch {
      return
    }
  }
  if (!isGuildMod(member)) return
  if (ticket.staffEngaged) return
  await updateTicketPartial(msg.channel.id, { staffEngaged: true })
}

/**
 * Extra instruction while the ticket is still in AI triage (staff not engaged).
 */
export async function getTicketTriagePromptSuffix(msg: Message): Promise<string> {
  if (!msg.guild) return ''
  const ticket = await getTicketByChannel(msg.channel.id)
  if (!ticket || ticket.status !== 'open' || ticket.staffEngaged) return ''
  if (msg.author.id !== ticket.userId) return ''
  return '\n\n[Support ticket triage: Staff has not claimed or taken this ticket yet. Ask short follow-up questions to gather framework (ESX/QBCore/standalone), errors, resource name, and reproduction steps. Do not promise a human response time. No emojis.]'
}

export function startTicketAutoCloseLoop(client: Client): void {
  if (!ticketSystemEnabled || ticketAutoCloseHours <= 0) return

  const tick = async (): Promise<void> => {
    const autoMs = ticketAutoCloseHours * 3600 * 1000
    const graceMs = ticketAutoCloseGraceHours * 3600 * 1000
    const now = Date.now()

    const openList = await listAllOpenTickets()
    for (const ticket of openList) {
      if (ticket.status !== 'open') continue
      const last = ticket.lastUserMessageAt ?? ticket.openedAt
      if (now - last < autoMs) continue

      const ch = (await client.channels.fetch(ticket.channelId).catch(() => null)) as
        | TextChannel
        | null
      if (!ch?.isTextBased()) continue

      if (!ticket.warnedAutoCloseAt) {
        await updateTicketPartial(ticket.channelId, { warnedAutoCloseAt: now })
        await ch
          .send(
            `This ticket will be closed automatically in ${ticketAutoCloseGraceHours} hours if there is no response from the ticket opener.`,
          )
          .catch(() => {})
        continue
      }

      if (now - ticket.warnedAutoCloseAt < graceMs) continue

      try {
        const fresh = await getTicketByChannel(ticket.channelId)
        if (!fresh || fresh.status !== 'open') continue
        await runCloseTicket(
          client,
          ch,
          fresh,
          { id: client.user!.id, tag: client.user!.tag },
          'Inactivity (auto-close)',
        )
      } catch (e) {
        console.warn('[tickets] auto-close failed:', e)
      }
    }
  }

  setInterval(() => void tick(), 30 * 60 * 1000).unref()
  void tick()
}

export async function formatOpenTicketsList(guildId: string): Promise<string> {
  const open = await listOpenTickets(guildId)
  if (open.length === 0) return 'No open tickets.'
  const lines = open
    .sort((a, b) => a.openedAt - b.openedAt)
    .map((t) => {
      const age = formatDuration(Date.now() - t.openedAt)
      const claim = t.claimedByTag ? `claimed by ${t.claimedByTag}` : 'unclaimed'
      return `- #${padId(t.id)} <#${t.channelId}> ${t.userTag} ${t.reason.slice(0, 40)} (${age}, ${claim})`
    })
  return lines.join('\n').slice(0, 3500)
}

export async function formatTicketStatsLine(guildId: string): Promise<string> {
  const s = await getTicketStats(guildId)
  const avgMin =
    s.avgResolutionMs != null
      ? `${Math.round(s.avgResolutionMs / 60000)} min avg resolution`
      : 'n/a'
  const reasons = Object.entries(s.byReason)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ')
  return `Open: ${s.totalOpen} | Closed (recorded): ${s.totalClosed} | ${avgMin}${reasons ? ` | By reason: ${reasons}` : ''}`
}

export async function ticketAddUser(
  _guild: Guild,
  channel: TextChannel,
  actor: GuildMember,
  targetId: string,
): Promise<string> {
  if (!isGuildMod(actor)) return 'Moderator only.'
  const ticket = await getTicketByChannel(channel.id)
  if (!ticket || ticket.status !== 'open') return 'Use this in an open ticket channel.'
  await channel.permissionOverwrites.create(targetId, {
    ViewChannel: true,
    SendMessages: true,
    ReadMessageHistory: true,
    AttachFiles: true,
    EmbedLinks: true,
  })
  return `Added <@${targetId}> to this ticket.`
}

export async function ticketRemoveUser(
  _guild: Guild,
  channel: TextChannel,
  actor: GuildMember,
  targetId: string,
): Promise<string> {
  if (!isGuildMod(actor)) return 'Moderator only.'
  const ticket = await getTicketByChannel(channel.id)
  if (!ticket || ticket.status !== 'open') return 'Use this in an open ticket channel.'
  if (targetId === ticket.userId) return 'Cannot remove the ticket opener.'
  await channel.permissionOverwrites.delete(targetId).catch(() => {})
  return `Removed <@${targetId}> from this ticket.`
}
