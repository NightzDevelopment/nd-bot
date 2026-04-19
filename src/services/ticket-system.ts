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
  type MessageActionRowComponentBuilder,
  type StringSelectMenuInteraction,
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
  ticketTranscriptHtmlEnabled,
  ticketTranscriptMaxMessages,
  parseTicketWorkflowStatuses,
} from '../config.ts'
import {
  ndTicketEmbedOpen,
  ndTicketEmbedStaff,
  TICKET_FOOTER_SUPPORT,
} from '../utils/embed.ts'
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
import {
  buildTranscriptHtml,
  buildTranscriptTxt,
  countUniqueAuthors,
  fetchTicketMessages,
} from './ticket-transcript.ts'

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

function defaultWorkflowStatus(): string {
  const s = parseTicketWorkflowStatuses()
  return s[0] ?? 'Open'
}

/** Prefer "Claimed" from the workflow list when staff hits Claim. */
function pickClaimedWorkflowStatus(): string {
  const s = parseTicketWorkflowStatuses()
  if (s.includes('Claimed')) return 'Claimed'
  if (s.includes('In progress')) return 'In progress'
  return s[1] ?? s[0] ?? 'Open'
}

function buildClaimCloseRow(
  channelId: string,
  ticket: TicketRecord,
): ActionRowBuilder<ButtonBuilder> {
  const claimed = Boolean(ticket.claimedBy)
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${TICKET_PREFIX}:claim:${channelId}`)
      .setLabel(claimed ? 'Claimed' : 'Claim')
      .setStyle(ButtonStyle.Success)
      .setDisabled(claimed),
    new ButtonBuilder()
      .setCustomId(`${TICKET_PREFIX}:close:${channelId}`)
      .setLabel('Close Ticket')
      .setStyle(ButtonStyle.Danger),
  )
}

function buildWorkflowStatusRow(
  channelId: string,
  ticket: TicketRecord,
): ActionRowBuilder<StringSelectMenuBuilder> {
  const statuses = parseTicketWorkflowStatuses()
  const cur = ticket.workflowStatus ?? defaultWorkflowStatus()
  const opts = statuses.map((label) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(label.slice(0, 100))
      .setValue(label.slice(0, 100))
      .setDefault(label === cur),
  )
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`${TICKET_PREFIX}:workflow:${channelId}`)
    .setPlaceholder('Set ticket status (staff)')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(opts.length > 0 ? opts : [new StringSelectMenuOptionBuilder().setLabel('Open').setValue('Open')])
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)
}

function buildTicketWelcomeComponents(
  channelId: string,
  ticket: TicketRecord,
): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  return [
    buildClaimCloseRow(channelId, ticket) as ActionRowBuilder<MessageActionRowComponentBuilder>,
    buildWorkflowStatusRow(channelId, ticket) as ActionRowBuilder<MessageActionRowComponentBuilder>,
  ]
}

/** Refresh welcome embed + buttons/status menu from DB (after claim, status change, reopen). */
async function syncWelcomeMessageFromTicket(
  ch: TextChannel,
  ticket: TicketRecord,
): Promise<void> {
  if (!ticket.welcomeMessageId) return
  try {
    const msg = await ch.messages.fetch(ticket.welcomeMessageId)
    if (!msg.embeds[0]) return
    const eb = EmbedBuilder.from(msg.embeds[0])
    const fields = [...(eb.data.fields ?? [])]
    const statusVal = ticket.workflowStatus ?? defaultWorkflowStatus()
    const statusIdx = fields.findIndex((f) => f.name === 'Status')
    if (statusIdx >= 0) {
      fields[statusIdx] = {
        name: 'Status',
        value: statusVal,
        inline: fields[statusIdx]!.inline ?? true,
      }
    }
    const claimIdx = fields.findIndex((f) => f.name === 'Claimed by')
    if (ticket.claimedBy && ticket.claimedByTag) {
      const cv = `<@${ticket.claimedBy}> · \`${ticket.claimedBy}\``
      if (claimIdx >= 0) {
        fields[claimIdx] = {
          name: 'Claimed by',
          value: cv,
          inline: true,
        }
      } else {
        fields.push({ name: 'Claimed by', value: cv, inline: true })
      }
    } else if (claimIdx >= 0) {
      fields.splice(claimIdx, 1)
    }
    eb.setFields(fields)
    await msg.edit({
      embeds: [eb],
      components: buildTicketWelcomeComponents(ch.id, ticket),
    })
  } catch (e) {
    console.warn('[tickets] sync welcome failed:', e)
  }
}

async function postTicketWorkflowStaffLog(
  client: Client,
  ticket: TicketRecord,
  channel: TextChannel,
  newStatus: string,
  actorTag: string,
): Promise<void> {
  const logId = ticketLogChannelId
  if (!logId) return
  try {
    const logCh = await client.channels.fetch(logId)
    if (!logCh?.isTextBased() || logCh.isDMBased()) return
    const jump = `https://discord.com/channels/${ticket.guildId}/${channel.id}/${ticket.welcomeMessageId ?? channel.id}`
    await logCh.send({
      embeds: [
        ndTicketEmbedStaff()
          .setTitle('Support · Ticket status updated')
          .setDescription(`[Open ticket channel](${jump})`)
          .addFields(
            { name: 'Ticket ID', value: `\`#${padId(ticket.id)}\``, inline: true },
            { name: 'New status', value: newStatus.slice(0, 1024), inline: true },
            { name: 'Updated by', value: actorTag.slice(0, 256), inline: true },
          ),
      ],
    })
  } catch (e) {
    console.warn('[tickets] workflow log failed:', e)
  }
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
  return ndTicketEmbedOpen()
    .setAuthor({ name: 'Nightz Network · Live Support', iconURL: icon ?? undefined })
    .setTitle('Support center')
    .setThumbnail(icon ?? null)
    .setDescription(
      [
        'Need help with a **product**, your **account**, or have a **question**? You are in the right place.',
        '',
        'Choose a **category**, then tap **Open Ticket**. We will create a **private channel** only you and staff can see.',
      ].join('\n'),
    )
    .addFields(
      {
        name: 'How it works',
        value: [
          '1. Select the category that best matches your issue',
          '2. Tap **Open Ticket**',
          '3. Describe the problem in the new channel (errors, screenshots, framework)',
          '4. Staff or our assistant will reply when available',
        ].join('\n'),
        inline: false,
      },
      {
        name: 'Links',
        value: [
          '**Store:** https://store.nightz.dev/',
          '**Community:** https://discord.gg/KaKCBUkD8M',
        ].join('\n'),
        inline: false,
      },
      {
        name: 'Guidelines',
        value: [
          '· **One issue per ticket** — open another ticket for a separate topic',
          '· Include **artifact**, **framework** (ESX / QBCore), and **steps to reproduce** when relevant',
          '· **Do not ping** staff; tickets are handled in queue order',
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
    .setPlaceholder('Choose a category…')
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
  const initialWorkflow = defaultWorkflowStatus()
  const welcomeEmbed = ndTicketEmbedOpen()
    .setAuthor({
      name: `${guild.name} · Live Support`,
      iconURL: guild.iconURL({ size: 128 }) ?? undefined,
    })
    .setTitle(`Support Ticket #${padId(numericId)}`)
    .setDescription(
      [
        'This is your **private** support channel. Only you, **Nightz staff**, and the **bot** can see it.',
        '',
        'A team member will assist you when possible. Our **assistant** may reply first to collect details (errors, framework, steps).',
      ].join('\n'),
    )
    .addFields(
      {
        name: 'User',
        value: `${member} · \`${member.id}\``,
        inline: true,
      },
      {
        name: 'Category',
        value: reason.slice(0, 1024),
        inline: true,
      },
      {
        name: 'Opened',
        value: `<t:${Math.floor(openedAt / 1000)}:F>`,
        inline: true,
      },
      {
        name: 'Ticket ID',
        value: `\`#${padId(numericId)}\``,
        inline: true,
      },
      {
        name: 'Status',
        value: initialWorkflow,
        inline: true,
      },
    )

  if (ticketTranscriptEnabled) {
    welcomeEmbed.addFields({
      name: 'After we close',
      value: ticketTranscriptHtmlEnabled
        ? 'Closing this ticket attaches a **.txt** log and a styled **.html** transcript to this channel.'
        : 'Closing this ticket attaches a **.txt** transcript to this channel.',
      inline: false,
    })
  }

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

  const tempRec: TicketRecord = {
    id: numericId,
    channelId: channel.id,
    guildId: guild.id,
    userId: member.id,
    userTag: member.user.tag,
    reason,
    workflowStatus: initialWorkflow,
    openedAt,
    status: 'open',
    staffEngaged: false,
  }

  const welcomeMsg = await channel.send({
    content: `${member}`,
    embeds: [welcomeEmbed],
    components: buildTicketWelcomeComponents(channel.id, tempRec),
  })

  await channel.send({
    content:
      '**Next step:** Describe your issue below. Include **error text**, **screenshots**, **framework** (ESX / QBCore / standalone), and **resource name** if it helps us reproduce the problem.',
  })

  const rec: TicketRecord = {
    ...tempRec,
    welcomeMessageId: welcomeMsg.id,
    lastUserMessageAt: openedAt,
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
        ? 'Support · Ticket opened'
        : kind === 'claimed'
          ? 'Support · Ticket claimed'
          : kind === 'closed'
            ? 'Support · Ticket closed'
            : kind === 'reopened'
              ? 'Support · Ticket reopened'
              : 'Support · Ticket deleted'

    const embed = ndTicketEmbedStaff()
      .setTitle(title)
      .addFields(
        {
          name: 'Ticket ID',
          value: `\`#${padId(ticket.id)}\``,
          inline: true,
        },
        {
          name: 'Requester',
          value: `${ticket.userTag} · \`${ticket.userId}\``,
          inline: true,
        },
        { name: 'Category', value: ticket.reason.slice(0, 1024), inline: false },
      )

    if (ticket.workflowStatus) {
      embed.addFields({
        name: 'Workflow status',
        value: ticket.workflowStatus.slice(0, 1024),
        inline: true,
      })
    }

    if (ticket.claimedByTag && kind !== 'closed') {
      embed.addFields({
        name: 'Claimed by',
        value: ticket.claimedByTag,
        inline: true,
      })
    }
    if (jump) embed.setDescription(`[Open ticket channel](${jump})`)

    if (kind === 'closed' && ticket.closedAt) {
      const dur = formatDuration(ticket.closedAt - ticket.openedAt)
      embed.addFields(
        { name: 'Closed by', value: ticket.closedByTag ?? '—', inline: true },
        { name: 'Duration', value: dur, inline: true },
        {
          name: 'Logged messages',
          value: String(ticket.messageCount ?? '—'),
          inline: true,
        },
      )
      if (ticket.claimedByTag) {
        embed.addFields({
          name: 'Claimed by',
          value: ticket.claimedByTag,
          inline: true,
        })
      }
      if (ticket.closeReason) {
        embed.addFields({
          name: 'Staff notes',
          value: ticket.closeReason.slice(0, 1024),
          inline: false,
        })
      }
      embed.setFooter({
        text: !ticketTranscriptEnabled
          ? `${TICKET_FOOTER_SUPPORT} · Transcripts off`
          : ticketTranscriptHtmlEnabled
            ? `${TICKET_FOOTER_SUPPORT} · Files: .txt + .html in ticket channel`
            : `${TICKET_FOOTER_SUPPORT} · File: .txt in ticket channel`,
      })
    }

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
    if (interaction.customId.startsWith(`${TICKET_PREFIX}:workflow:`)) {
      const channelId = interaction.customId.slice(
        `${TICKET_PREFIX}:workflow:`.length,
      )
      await handleWorkflowStatus(interaction, channelId)
      return true
    }
    if (interaction.customId !== `${TICKET_PREFIX}:reason`) return false
    const reason = interaction.values[0] ?? 'Other'
    pendingReason.set(interaction.user.id, { reason, at: Date.now() })
    await interaction.reply({
      content: 'Category saved. Now tap **Open Ticket** to create your private channel.',
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
        .update({ content: 'Channel delete cancelled. Nothing was removed.', components: [] })
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
    await interaction.reply({
      content: 'Use the support panel in the **server**, not in DMs.',
      ephemeral: true,
    })
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
    await interaction.editReply({
      content: `**Ticket created.** Continue in ${ch} — only you and staff can see it.`,
    })
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e)
    await interaction.editReply({ content: err.slice(0, 2000) })
  }
}

async function handleWorkflowStatus(
  interaction: StringSelectMenuInteraction,
  channelId: string,
): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({
      content: 'Use this in the **server**.',
      ephemeral: true,
    })
    return
  }
  const member = await interaction.guild.members.fetch(interaction.user.id)
  if (!isGuildMod(member)) {
    await interaction.reply({
      content: 'Only **staff** can update ticket status.',
      ephemeral: true,
    })
    return
  }

  const ticket = await getTicketByChannel(channelId)
  if (!ticket || ticket.status !== 'open') {
    await interaction.reply({
      content: 'This ticket is not open or could not be found.',
      ephemeral: true,
    })
    return
  }

  await interaction.deferReply({ ephemeral: true })

  const newStatus = interaction.values[0] ?? defaultWorkflowStatus()
  await updateTicketPartial(channelId, {
    workflowStatus: newStatus,
    staffEngaged: true,
  })

  const t2 = (await getTicketByChannel(channelId))!
  const ch = (await interaction.guild.channels
    .fetch(channelId)
    .catch(() => null)) as TextChannel | null
  if (!ch?.isTextBased() || ch.isDMBased()) {
    await interaction.editReply({
      content: 'Could not load this channel.',
    })
    return
  }

  try {
    await syncWelcomeMessageFromTicket(ch, t2)
    await interaction.editReply({
      content: `**Ticket status** updated to **${newStatus}**.`,
    })
    await postTicketWorkflowStaffLog(
      interaction.client,
      t2,
      ch,
      newStatus,
      interaction.user.tag,
    )
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e)
    await interaction.editReply({ content: err.slice(0, 500) })
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
      content: 'Only **Nightz staff** can claim tickets.',
      ephemeral: true,
    })
    return
  }

  const ticket = await getTicketByChannel(channelId)
  if (!ticket || ticket.status !== 'open') {
    await interaction.reply({
      content: 'This ticket is missing or is no longer open.',
      ephemeral: true,
    })
    return
  }

  const ch = await interaction.guild.channels.fetch(channelId).catch(() => null)
  if (!ch?.isTextBased() || ch.isDMBased()) {
    await interaction.reply({
      content: 'Could not load this channel. Try again or ask an admin.',
      ephemeral: true,
    })
    return
  }

  await interaction.deferUpdate()

  const claimedStatus = pickClaimedWorkflowStatus()
  await updateTicketPartial(channelId, {
    claimedBy: interaction.user.id,
    claimedByTag: interaction.user.tag,
    staffEngaged: true,
    workflowStatus: claimedStatus,
  })

  const t2 = (await getTicketByChannel(channelId))!
  await syncWelcomeMessageFromTicket(ch as TextChannel, t2)

  await ch.send({
    embeds: [
      ndTicketEmbedStaff().setDescription(
        `**Claimed** by ${interaction.user} · \`${interaction.user.tag}\` — staff is handling this ticket.`,
      ),
    ],
  })
  await postStaffTicketLog(interaction.client, t2, 'claimed', ch as TextChannel)
}

async function handleCloseButton(
  interaction: Interaction,
  channelId: string,
): Promise<void> {
  if (!interaction.isButton() || !interaction.guild) return
  const ticket = await getTicketByChannel(channelId)
  if (!ticket) {
    await interaction.reply({
      content: 'This channel is not linked to a support ticket.',
      ephemeral: true,
    })
    return
  }
  if (!canManageTicket(interaction, ticket)) {
    await interaction.reply({
      content: 'You are not allowed to close this ticket (must be the opener or staff).',
      ephemeral: true,
    })
    return
  }

  const modal = new ModalBuilder()
    .setCustomId(`${TICKET_PREFIX}:close_modal:${channelId}`)
    .setTitle('Close support ticket')

  const input = new TextInputBuilder()
    .setCustomId('close_notes')
    .setLabel('Staff notes (optional, shown in log)')
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
      content: 'This ticket is already closed or no longer exists.',
      ephemeral: true,
    })
    return
  }
  if (!canManageTicket(interaction, ticket)) {
    await interaction.reply({
      content: 'You cannot close this ticket.',
      ephemeral: true,
    })
    return
  }

  const notes =
    interaction.fields.getTextInputValue('close_notes')?.trim() || ''

  await interaction.deferReply({ ephemeral: true })

  const ch = (await interaction.guild.channels
    .fetch(channelId)
    .catch(() => null)) as TextChannel | null
  if (!ch?.isTextBased()) {
    await interaction.editReply('Channel could not be loaded. Try again.')
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
    await interaction.editReply(
      '**Ticket closed.** A summary and attachments were posted in this channel.',
    )
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

  const closedAt = Date.now()
  let msgCount = 0
  let participantCount = 0
  let transcriptFiles: AttachmentBuilder[] | undefined

  if (ticketTranscriptEnabled) {
    const messages = await fetchTicketMessages(channel, ticketTranscriptMaxMessages)
    msgCount = messages.length
    participantCount = countUniqueAuthors(messages)
    const meta = {
      kind: 'close' as const,
      closedAt,
      closedByTag: closedBy.tag,
      staffNotes: closeNotes,
      messageCount: msgCount,
      participantCount,
    }
    transcriptFiles = [
      new AttachmentBuilder(buildTranscriptTxt(ticket, messages, meta), {
        name: `transcript-${padId(ticket.id)}.txt`,
      }),
    ]
    if (ticketTranscriptHtmlEnabled) {
      transcriptFiles.push(
        new AttachmentBuilder(
          buildTranscriptHtml(channel.guild, channel, ticket, messages, meta),
          { name: `transcript-${padId(ticket.id)}.html` },
        ),
      )
    }
  } else {
    const msgs = await channel.messages.fetch({ limit: 100 })
    msgCount = msgs.size
    participantCount = countUniqueAuthors([...msgs.values()])
  }

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
  const guild = channel.guild
  const channelJump = `https://discord.com/channels/${guild.id}/${channel.id}`
  const icon = guild.iconURL({ size: 128 })

  const transcriptHint = ticketTranscriptEnabled
    ? ticketTranscriptHtmlEnabled
      ? `**Attachments:** \`transcript-${padId(ticket.id)}.txt\` (plain log) and \`transcript-${padId(ticket.id)}.html\` (styled archive). Download or open in a browser.`
      : `**Attachment:** \`transcript-${padId(ticket.id)}.txt\` — full message log.`
    : '**Note:** Transcripts are turned off in bot settings (`TICKET_TRANSCRIPT_ENABLED=0`).'

  const closingEmbed = ndTicketEmbedStaff()
    .setColor(0xed4245)
    .setAuthor({
      name: 'Nightz Network · Ticket closed',
      iconURL: icon ?? undefined,
    })
    .setTitle(`Support Ticket #${padId(ticket.id)} — Closed`)
    .setDescription(transcriptHint)
    .addFields(
      {
        name: 'Requester',
        value: `<@${ticket.userId}> · \`${ticket.userId}\``,
        inline: false,
      },
      {
        name: 'Category',
        value: ticket.reason.slice(0, 1024),
        inline: true,
      },
      {
        name: 'Workflow status',
        value: ticket.workflowStatus ?? defaultWorkflowStatus(),
        inline: true,
      },
      {
        name: 'Channel',
        value: `[Open channel](${channelJump})`,
        inline: true,
      },
      {
        name: 'Opened',
        value: `<t:${Math.floor(ticket.openedAt / 1000)}:F>`,
        inline: true,
      },
      {
        name: 'Closed',
        value: `<t:${Math.floor(closedAt / 1000)}:F>`,
        inline: true,
      },
      {
        name: 'Claimed by',
        value: ticket.claimedByTag ?? '— *(unclaimed)*',
        inline: true,
      },
      {
        name: 'Closed by',
        value: closedBy.tag,
        inline: true,
      },
      {
        name: 'Duration',
        value: durationStr,
        inline: true,
      },
      {
        name: 'Messages logged',
        value: String(msgCount),
        inline: true,
      },
      {
        name: 'Participants',
        value: String(participantCount),
        inline: true,
      },
      {
        name: 'Staff notes',
        value: closeNotes.slice(0, 1024) || '*(none)*',
        inline: false,
      },
    )
    .setFooter({
      text: `${TICKET_FOOTER_SUPPORT} · Reopen · Delete · Transcript (DM)`,
    })

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

  if (transcriptFiles?.length) {
    payload.files = transcriptFiles
  }

  await channel.send(payload)

  await postStaffTicketLog(client, t, 'closed', channel)

  if (ticketDmOnClose) {
    try {
      const u = await client.users.fetch(ticket.userId)
      const dmEmbed = ndTicketEmbedStaff()
        .setColor(0xed4245)
        .setTitle(`Support Ticket #${padId(ticket.id)} — Closed`)
        .setDescription(
          `Thanks for contacting **${guild.name}**. This ticket was closed by **${closedBy.tag}**.`,
        )
        .addFields(
          { name: 'Category', value: ticket.reason.slice(0, 256), inline: true },
          { name: 'Duration', value: durationStr, inline: true },
          {
            name: 'Staff notes',
            value: closeNotes.slice(0, 1024) || '*(none)*',
            inline: false,
          },
        )
        .setFooter({
          text: `${TICKET_FOOTER_SUPPORT} · Need more help? Open a new ticket from the server panel.`,
        })
      await u.send({ embeds: [dmEmbed] })
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

async function handleReopen(
  interaction: Interaction,
  channelId: string,
): Promise<void> {
  if (!interaction.isButton() || !interaction.guild) return
  const member = await interaction.guild.members.fetch(interaction.user.id)
  if (!isGuildMod(member)) {
    await interaction.reply({
      content: 'Only **staff** can reopen tickets.',
      ephemeral: true,
    })
    return
  }

  const ticket = await getTicketByChannel(channelId)
  if (!ticket || ticket.status !== 'closed') {
    await interaction.reply({
      content: 'This ticket is not closed or could not be found.',
      ephemeral: true,
    })
    return
  }

  const ch = (await interaction.guild.channels
    .fetch(channelId)
    .catch(() => null)) as TextChannel | null
  if (!ch?.isTextBased()) {
    await interaction.reply({
      content: 'Could not load the channel. Try again.',
      ephemeral: true,
    })
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
    workflowStatus: defaultWorkflowStatus(),
  })

  const tFresh = (await getTicketByChannel(channelId))!
  await syncWelcomeMessageFromTicket(ch, tFresh)

  await ch.send({
    embeds: [
      ndTicketEmbedStaff().setDescription(
        `**Support Ticket #${padId(ticket.id)} — Reopened** by ${interaction.user} · \`${interaction.user.tag}\`.\nThe requester can send messages again. **Status** was reset to **${defaultWorkflowStatus()}** on the pinned welcome message — use **Claim** or the status menu as needed.`,
      ),
    ],
  })

  await postStaffTicketLog(interaction.client, tFresh, 'reopened', ch)
}

async function handleDeletePrompt(
  interaction: Interaction,
  channelId: string,
): Promise<void> {
  if (!interaction.isButton() || !interaction.guild) return
  const member = await interaction.guild.members.fetch(interaction.user.id)
  if (!isGuildMod(member)) {
    await interaction.reply({
      content: 'Only **staff** can delete ticket channels.',
      ephemeral: true,
    })
    return
  }

  const embed = ndTicketEmbedStaff()
    .setColor(0xed4245)
    .setTitle('Delete this ticket channel?')
    .setDescription(
      '**Permanent.** The channel and all messages will be removed. Download a transcript first if you still need it.',
    )

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
    await interaction.reply({
      content: 'Only **staff** can delete ticket channels.',
      ephemeral: true,
    })
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
              ndTicketEmbedStaff()
                .setTitle('Support · Channel deleted')
                .setDescription(
                  `**Ticket \`#${padId(ticket.id)}\`** for **${ticket.userTag}** was **permanently deleted** by ${interaction.user.tag}.`,
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
    await interaction.reply({
      content: 'This is not a valid support ticket.',
      ephemeral: true,
    })
    return
  }

  const allowed =
    interaction.user.id === ticket.userId ||
    (await interaction.guild.members.fetch(interaction.user.id).then((m) =>
      isGuildMod(m),
    ))

  if (!allowed) {
    await interaction.reply({
      content: 'Only the **ticket opener** or **staff** can request a transcript.',
      ephemeral: true,
    })
    return
  }

  const ch = (await interaction.guild.channels
    .fetch(channelId)
    .catch(() => null)) as TextChannel | null
  if (!ch?.isTextBased()) {
    await interaction.reply({
      content: 'Could not load this channel.',
      ephemeral: true,
    })
    return
  }

  await interaction.deferReply({ ephemeral: true })

  if (!ticketTranscriptEnabled) {
    await interaction.editReply('Transcripts are disabled in bot settings for this bot.')
    return
  }

  const messages = await fetchTicketMessages(ch, ticketTranscriptMaxMessages)
  const participantCount = countUniqueAuthors(messages)
  const meta = {
    kind: 'manual' as const,
    exportedAt: Date.now(),
    exportedByTag: interaction.user.tag,
    messageCount: messages.length,
    participantCount,
  }
  const files = [
    new AttachmentBuilder(buildTranscriptTxt(ticket, messages, meta), {
      name: `transcript-${padId(ticket.id)}.txt`,
    }),
  ]
  if (ticketTranscriptHtmlEnabled) {
    files.push(
      new AttachmentBuilder(
        buildTranscriptHtml(interaction.guild!, ch, ticket, messages, meta),
        { name: `transcript-${padId(ticket.id)}.html` },
      ),
    )
  }

  try {
    await interaction.user.send({ files })
    await interaction.editReply(
      ticketTranscriptHtmlEnabled
        ? '**Done.** Check your DMs for **.txt** and **.html** transcript files.'
        : '**Done.** Check your DMs for the **.txt** transcript file.',
    )
  } catch {
    await interaction.editReply(
      'Could not DM you. Enable **Allow direct messages from server members** for this server, then try again.',
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
            `**Auto-close:** This ticket will be closed in **${ticketAutoCloseGraceHours} hours** if the **ticket opener** does not reply.`,
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
  if (open.length === 0) return '**No open tickets** in this server right now.'
  const lines = open
    .sort((a, b) => a.openedAt - b.openedAt)
    .map((t) => {
      const age = formatDuration(Date.now() - t.openedAt)
      const claim = t.claimedByTag
        ? `claimed · **${t.claimedByTag}**`
        : '*unclaimed*'
      const wf = t.workflowStatus ?? 'Open'
      return `**#${padId(t.id)}** · <#${t.channelId}> · ${t.userTag} · ${t.reason.slice(0, 36)}${t.reason.length > 36 ? '…' : ''}\n · **${wf}** · ${claim} · open ${age}`
    })
  return lines.join('\n\n').slice(0, 3500)
}

export async function formatTicketStatsLine(guildId: string): Promise<string> {
  const s = await getTicketStats(guildId)
  const avgMin =
    s.avgResolutionMs != null
      ? `~**${Math.round(s.avgResolutionMs / 60000)}** min avg. resolution`
      : '*n/a*'
  const reasons = Object.entries(s.byReason)
    .map(([k, v]) => `**${k}:** ${v}`)
    .join(' · ')
  return `**Open:** ${s.totalOpen} · **Closed (tracked):** ${s.totalClosed} · ${avgMin}${reasons ? `\n**By category:** ${reasons}` : ''}`
}

export async function ticketAddUser(
  _guild: Guild,
  channel: TextChannel,
  actor: GuildMember,
  targetId: string,
): Promise<string> {
  if (!isGuildMod(actor)) {
    return '**Staff only** — you need a moderator role to add people to tickets.'
  }
  const ticket = await getTicketByChannel(channel.id)
  if (!ticket || ticket.status !== 'open') {
    return 'Run **`nd!adduser`** only in an **open** support ticket channel.'
  }
  await channel.permissionOverwrites.create(targetId, {
    ViewChannel: true,
    SendMessages: true,
    ReadMessageHistory: true,
    AttachFiles: true,
    EmbedLinks: true,
  })
  return `**Done.** <@${targetId}> can now see and send messages in this ticket.`
}

export async function ticketRemoveUser(
  _guild: Guild,
  channel: TextChannel,
  actor: GuildMember,
  targetId: string,
): Promise<string> {
  if (!isGuildMod(actor)) {
    return '**Staff only** — you need a moderator role to remove people from tickets.'
  }
  const ticket = await getTicketByChannel(channel.id)
  if (!ticket || ticket.status !== 'open') {
    return 'Run **`nd!removeuser`** only in an **open** support ticket channel.'
  }
  if (targetId === ticket.userId) {
    return 'You **cannot remove** the **ticket opener** from their own ticket.'
  }
  await channel.permissionOverwrites.delete(targetId).catch(() => {})
  return `**Done.** <@${targetId}> no longer has access to this ticket channel.`
}
