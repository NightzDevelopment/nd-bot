/**
 * ND ticket system: panel, private channels, claim/close/reopen/delete, transcripts.
 */
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  type Client,
  EmbedBuilder,
  type Guild,
  type GuildMember,
  type Interaction,
  type Message,
  type MessageActionRowComponentBuilder,
  MessageFlags,
  ModalBuilder,
  type ModalSubmitInteraction,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  type StringSelectMenuInteraction,
  StringSelectMenuOptionBuilder,
  type TextChannel,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js'
import {
  modRoleIds,
  parseTicketReasons,
  parseTicketSlaIgnoreWorkflows,
  parseTicketWorkflowStatuses,
  STAFF_LOG_CHANNEL_ID,
  SYSTEM_PROMPT_GUILD,
  TICKET_CLOSED_CATEGORY_ID,
  TICKET_OPEN_CATEGORY_ID,
  TICKET_PANEL_CHANNEL_ID,
  ticketAutoCloseGraceHours,
  ticketAutoCloseHours,
  ticketDmOnClose,
  ticketFirstReplySlaMs,
  ticketLogChannelId,
  ticketMaxOpenPerUser,
  ticketNamingPrefix,
  ticketOpenCooldownMs,
  ticketSlaSecondNudgeMs,
  ticketSystemEnabled,
  ticketTranscriptEnabled,
  ticketTranscriptHtmlEnabled,
  ticketTranscriptMaxMessages,
} from '../config.ts'
import { ndTicketEmbedOpen, ndTicketEmbedStaff, TICKET_FOOTER_SUPPORT } from '../utils/embed.ts'
import { isGuildMod } from '../utils/permissions.ts'
import { searchFaq } from './faq.ts'
import { generateOnce, getModel } from './gemini.ts'
import { buildTicketProductHintBlock } from './store-catalog.ts'
import { getStoreListingPlaintext } from './store-snapshot.ts'
import { formatSlaTarget, inferPriorityFromCategory, PRIORITY_LABEL } from './ticket-priority.ts'
import {
  addTicketTags,
  deleteTicketRecord,
  getLastOpenedAtForUser,
  getTicketByChannel,
  getTicketStats,
  listAllOpenTickets,
  listOpenTickets,
  listOpenTicketsForUser,
  nextTicketNumericId,
  normalizeTag,
  removeTicketTags,
  saveTicket,
  searchTicketsByTag,
  type TicketRecord,
  updateTicketPartial,
} from './ticket-store.ts'
import {
  buildTranscriptHtml,
  buildTranscriptTxt,
  countUniqueAuthors,
  fetchTicketMessages,
} from './ticket-transcript.ts'

const _triageModel = getModel(SYSTEM_PROMPT_GUILD)

export const TICKET_PREFIX = 'ndticket'

/** Ephemeral reason selection before Open (5 min TTL). */
const pendingReason = new Map<string, { reason: string; at: number }>()
const REASON_TTL_MS = 5 * 60 * 1000

const REASON_DESCRIPTIONS: Record<string, string> = {
  'pre-sale question': 'Questions about a product before purchase',
  'buying product': 'Looking to purchase one of our products',
  'bug report': 'Report a defect or unexpected behavior in a product',
  'technical help': 'Performance, crashes, loading issues',
  'script support': 'Bugs or questions about public ND scripts',
  'account/role issues': 'Discord roles, server permissions, access',
  'billing/refund': 'Payment issues, license transfers, refund requests',
  'refund request': 'Request a refund for a recent purchase',
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

/** Category-specific bullets used in the "Next step" follow-up message after a ticket opens. */
const REASON_NEXT_STEP: Record<string, string[]> = {
  'pre-sale question': [
    'Name the **product/resource** you are interested in.',
    'Tell us your **framework** (ESX / QBCore / standalone) so we can confirm compatibility.',
    'Ask any specific question about features, pricing, or terms.',
  ],
  'bug report': [
    'Paste the **exact error** (SCRIPT ERROR / stack) or a clear screenshot.',
    'Name the **resource version** and **framework** (ESX / QBCore / standalone).',
    'Describe **steps to reproduce**, minimal repro is best.',
  ],
  'refund request': [
    'Share your **order / invoice ID** (never your payment details).',
    'Name the **product** and how you paid.',
    'Briefly explain the **reason** for the refund (per our policy).',
  ],
  'buying product': [
    'Name the **product/resource** you want to buy.',
    'Share the **framework** you run (ESX / QBCore / standalone / other).',
    'Mention your server build / artifact version if you already know it.',
  ],
  'technical help': [
    'Paste the **exact error** (SCRIPT ERROR / stack) or a short screenshot.',
    'Name the **resource** and **framework** (ESX / QBCore / standalone).',
    'Describe **steps to reproduce** and anything you already tried.',
  ],
  'script support': [
    'Name the **ND resource** (e.g. `ND_DiscordUnified`, `ND_Scenes`).',
    'Paste the **SCRIPT ERROR** lines from F8 / server console.',
    'Share the relevant **config file path** (e.g. `config/modules/automod.lua`).',
  ],
  'account/role issues': [
    'Describe the **role** or **permission** that is wrong.',
    'Share the **channel / category** where it is happening, if relevant.',
    'Tell us if this is a **store account / license** or a **Discord role** issue.',
  ],
  'billing/refund': [
    'Share your **order / invoice ID** (never your payment details).',
    'Name the **product** and how you paid (FaxStore / your store checkout, etc.).',
    'Tell us the **outcome** you want: refund, license transfer, or fix.',
  ],
  'commission inquiry': [
    'Describe the **scope** (features, framework, target server type).',
    'Share a rough **budget range** and **deadline**.',
    'Mention if this is a **new build** or edits to an existing ND / 3rd-party resource.',
  ],
  suggestions: [
    'Name the **product** this suggestion is for.',
    'Describe the **use case**: what are you trying to do today that is awkward?',
    'Optionally, describe how you think it should behave.',
  ],
  'report a problem': [
    'Describe what happened: **bug**, **exploit**, or **player behavior**.',
    'Share **evidence** (logs, screenshots, short clips). Do not share secrets.',
    'Include approximate **time** and **channel / server** if relevant.',
  ],
  partnership: [
    'Tell us briefly **who you are** and **what you propose**.',
    'Share **links** (store, community, portfolio) when relevant.',
    'Mention any **timeline** you are working against.',
  ],
  'partnership/collaboration': [
    'Tell us briefly **who you are** and **what you propose**.',
    'Share **links** (store, community, portfolio) when relevant.',
    'Mention any **timeline** you are working against.',
  ],
  other: [
    'Describe your question or issue in a few sentences.',
    'Attach **screenshots** or **error text** if it helps.',
  ],
}

function formatReasonNextStepCopy(reason: string): string {
  const key = reason.trim().toLowerCase()
  const bullets = REASON_NEXT_STEP[key] ?? [
    'Describe your issue below.',
    'Include **error text**, **screenshots**, **framework** (ESX / QBCore / standalone), and **resource name** if it helps us reproduce the problem.',
  ]
  const lines = bullets.map((b) => `- ${b}`).join('\n')
  let extra = ''
  if (key === 'buying product' || key === 'billing/refund' || key === 'script support') {
    extra = buildTicketProductHintBlock(getStoreListingPlaintext())
  }
  return `**Next step:** please share the details below so staff can help quickly.\n${lines}\n\n**Staff:** Use the **Claim** button on the welcome message above when you take this ticket.${extra}`
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
    .addOptions(
      opts.length > 0
        ? opts
        : [new StringSelectMenuOptionBuilder().setLabel('Open').setValue('Open')],
    )
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
async function syncWelcomeMessageFromTicket(ch: TextChannel, ticket: TicketRecord): Promise<void> {
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

    const noteIdx = fields.findIndex((f) => f.name === 'Staff note')
    const note = ticket.staffNote?.trim() ?? ''
    if (note) {
      const nv = note.slice(0, 1024)
      if (noteIdx >= 0) {
        fields[noteIdx] = { name: 'Staff note', value: nv, inline: false }
      } else {
        fields.push({ name: 'Staff note', value: nv, inline: false })
      }
    } else if (noteIdx >= 0) {
      fields.splice(noteIdx, 1)
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
    .setAuthor({
      name: 'Nightz Network · Live Support',
      ...(icon ? { iconURL: icon } : {}),
    })
    .setTitle('Support Center')
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
          '2. Tap **Open Ticket** and optionally add product/framework details in the form',
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
          '· **One issue per ticket**: open another ticket for a separate topic',
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
  const opts = reasons
    .slice(0, 25)
    .map((r) =>
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
          m.components.some(
            (r) =>
              'components' in r &&
              r.components.some(
                (c: any) => 'customId' in c && c.customId === `${TICKET_PREFIX}:reason`,
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

/** Role that can always see Partnership / Collaboration tickets. */
const PARTNERSHIP_ROLE_ID = '1370250635202531530'

/** Category keywords that trigger partnership role access. */
const PARTNERSHIP_CATEGORIES = new Set([
  'partnership',
  'partnership/collaboration',
  'collaboration',
])

function isPartnershipTicket(reason: string): boolean {
  return PARTNERSHIP_CATEGORIES.has(reason.toLowerCase().trim())
}

/**
 * Category -> role IDs that are pinged ONCE when a ticket in that category opens
 * (so the right team is notified without the bot claiming to "escalate").
 *
 * A category may map to one or more roles. Defaults cover partnership, billing,
 * script/technical support, and problem reports. Override or extend via env
 * TICKET_CATEGORY_ROLE_MAP, where each value is a role ID string OR an array:
 *   TICKET_CATEGORY_ROLE_MAP={"billing/refund":"123","script support":["456","789"]}
 * Keys are matched case-insensitively against the ticket reason/category.
 */
function loadCategoryRoleMap(): Record<string, string[]> {
  const SUPPORT_ROLES = ['1365812069185617960', '1324838642451222702']
  const map: Record<string, string[]> = {
    partnership: [PARTNERSHIP_ROLE_ID],
    'partnership/collaboration': [PARTNERSHIP_ROLE_ID],
    collaboration: [PARTNERSHIP_ROLE_ID],
    'billing/refund': ['1365812068703273062'],
    'refund request': ['1365812068703273062'],
    'script support': SUPPORT_ROLES,
    'technical help': SUPPORT_ROLES,
    'report a problem': ['1258689807853420614'],
  }
  const raw = process.env.TICKET_CATEGORY_ROLE_MAP?.trim()
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      for (const [k, v] of Object.entries(parsed)) {
        const ids = (Array.isArray(v) ? v : [v])
          .filter((x): x is string => typeof x === 'string')
          .map((x) => x.trim())
          .filter(Boolean)
        if (ids.length) map[k.toLowerCase().trim()] = ids
      }
    } catch (e) {
      console.warn('[tickets] TICKET_CATEGORY_ROLE_MAP parse failed:', e)
    }
  }
  return map
}
const CATEGORY_ROLE_MAP = loadCategoryRoleMap()

/** Returns the role IDs to ping for a category (empty if none configured). */
function routeRolesForCategory(reason: string): string[] {
  return CATEGORY_ROLE_MAP[reason.toLowerCase().trim()] ?? []
}

function ticketOverwriteBase(guild: Guild, userId: string, botId: string, reason = '') {
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
  // Grant the routed team role(s) for this category access to the ticket, so
  // the ping is actionable. Covers partnership (partner manager) plus any
  // category mapped in CATEGORY_ROLE_MAP. Dedupe against mod roles already added.
  const alreadyAdded = new Set(modRoleIds)
  for (const roleId of routeRolesForCategory(reason)) {
    if (alreadyAdded.has(roleId)) continue
    alreadyAdded.add(roleId)
    base.push({
      id: roleId,
      allow:
        PermissionFlagsBits.ViewChannel |
        PermissionFlagsBits.SendMessages |
        PermissionFlagsBits.ReadMessageHistory |
        PermissionFlagsBits.AttachFiles |
        PermissionFlagsBits.EmbedLinks,
    })
  }
  return base
}

export type CreateTicketOptions = {
  contextSnippet?: string | undefined
  contextJumpUrl?: string | undefined
  intakeProduct?: string | undefined
  intakeFramework?: string | undefined
  intakeDetails?: string | undefined
}

export type OpenTicketsListOptions = {
  /** Case-insensitive substring match against ticket category/reason. */
  reasonContains?: string
  filter?: 'all' | 'unclaimed' | 'claimed' | 'awaiting_staff'
  sort?: 'oldest_first' | 'newest_first'
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
    throw new Error(`You already have ${open.length} open ticket(s). Max ${ticketMaxOpenPerUser}.`)
  }

  if (ticketOpenCooldownMs > 0) {
    const last = await getLastOpenedAtForUser(guild.id, member.id)
    const wait = last + ticketOpenCooldownMs - Date.now()
    if (wait > 0) {
      throw new Error(
        `Please wait **${formatDuration(wait)}** before opening another ticket (anti-burst cooldown).`,
      )
    }
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
    permissionOverwrites: ticketOverwriteBase(guild, member.id, botId, reason),
    reason: `Support ticket ${numericId} for ${member.user.tag}`,
  })) as TextChannel

  const openedAt = Date.now()
  const initialWorkflow = defaultWorkflowStatus()
  const intakeProduct = opts?.intakeProduct?.trim()
  const intakeFramework = opts?.intakeFramework?.trim()
  const intakeDetails = opts?.intakeDetails?.trim()
  const welcomeEmbed = ndTicketEmbedOpen()
    .setAuthor({
      name: `${guild.name} · Live Support`,
      ...(() => {
        const u = guild.iconURL({ size: 128 })
        return u ? { iconURL: u } : {}
      })(),
    })
    .setTitle(`Support Ticket #${padId(numericId)}`)
    .setDescription(
      [
        'Welcome to **Nightz Network Live Support**. This is a **private channel**: only you and our staff team can see it.',
        '',
        'Our assistant will get things started. A staff member will follow up as soon as possible.',
        'Please share any relevant details (errors, screenshots, framework version) to help us resolve your issue quickly.',
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
        name: 'Priority',
        value: `${PRIORITY_LABEL[inferPriorityFromCategory(reason, intakeDetails)]} · SLA ${formatSlaTarget(inferPriorityFromCategory(reason, intakeDetails))}`,
        inline: true,
      },
      {
        name: 'Status',
        value: initialWorkflow,
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

  if (intakeProduct) {
    welcomeEmbed.addFields({
      name: 'Product / resource',
      value: intakeProduct.slice(0, 1024),
      inline: true,
    })
  }
  if (intakeFramework) {
    welcomeEmbed.addFields({
      name: 'Framework',
      value: intakeFramework.slice(0, 1024),
      inline: true,
    })
  }
  if (intakeDetails) {
    welcomeEmbed.addFields({
      name: 'Details',
      value: intakeDetails.slice(0, 1024),
      inline: false,
    })
  }

  const priority = inferPriorityFromCategory(reason, intakeDetails)
  const tempRec: TicketRecord = {
    id: numericId,
    channelId: channel.id,
    guildId: guild.id,
    userId: member.id,
    userTag: member.user.tag,
    reason,
    priority,
    workflowStatus: initialWorkflow,
    openedAt,
    status: 'open',
    staffEngaged: false,
    ...(intakeProduct ? { intakeProduct } : {}),
    ...(intakeFramework ? { intakeFramework } : {}),
    ...(intakeDetails ? { intakeDetails } : {}),
  }

  const welcomeMsg = await channel.send({
    content: `${member}`,
    embeds: [welcomeEmbed],
    components: buildTicketWelcomeComponents(channel.id, tempRec),
  })

  // Generate an AI greeting/triage message tailored to the user's inputs
  try {
    const normalizedReason = reason.trim().toLowerCase()
    const isPartnership =
      normalizedReason === 'partnership' || normalizedReason === 'partnership/collaboration'

    if (isPartnership) {
      // Special intake message for partnership tickets
      const partnershipMessage = [
        "Thanks for reaching out! We'd love to learn more about your partnership proposal.",
        '',
        '**In the meantime, to help staff understand your inquiry:**',
        '',
        '1. **What type of collaboration or partnership are you proposing?** (e.g., content creator, server partnership, development collaboration, integrations, marketing, etc.)',
        '',
        '2. **Do you have a specific ND product or service in mind, or is this a general inquiry about working together?**',
        '',
        'Share any relevant links to your store, community, portfolio, or website when you respond. Our team will review your proposal and get back to you shortly.',
      ].join('\n')
      await channel.send({ content: partnershipMessage.slice(0, 2000) })
    } else {
      const productLine = intakeProduct ? `\nProduct/resource: ${intakeProduct}` : ''
      const frameworkLine = intakeFramework ? `\nFramework: ${intakeFramework}` : ''
      const detailsLine = intakeDetails ? `\nDetails provided: ${intakeDetails}` : ''
      const aiPrompt = [
        `You are a friendly support assistant for Nightz Network, a FiveM development community.`,
        `A user just opened a support ticket in the category "${reason}".${productLine}${frameworkLine}${detailsLine}`,
        `Write a short, warm, professional greeting (2 to 4 sentences). Acknowledge what they need help with, ask the 1 to 2 most important follow-up questions based on their category, and let them know staff will follow up soon.`,
        `Do NOT use bullet lists. Do NOT mention that you are an AI. Do NOT say "I'll help you". Keep it concise and natural. No emojis.`,
      ].join('\n')
      const aiGreeting = await generateOnce(_triageModel, aiPrompt)
      await channel.send({ content: aiGreeting.slice(0, 2000) })
    }
  } catch {
    // Fallback to static message if AI fails
    await channel.send({ content: formatReasonNextStepCopy(reason).slice(0, 2000) })
  }

  // Seed deterministic tags from category + intake (no AI cost). AI topic tags
  // are merged in at close from the full conversation.
  const seedTags = [reason, intakeProduct ?? '', intakeFramework ?? '']
    .map(normalizeTag)
    .filter(Boolean)

  const rec: TicketRecord = {
    ...tempRec,
    welcomeMessageId: welcomeMsg.id,
    lastUserMessageAt: openedAt,
    lastOpenedAt: openedAt,
    ...(seedTags.length ? { tags: [...new Set(seedTags)] } : {}),
  }

  // Notify the routed team once (e.g. partner manager for partnership tickets).
  // This replaces the bot claiming to "escalate" mid-conversation.
  const routeRoleIds = routeRolesForCategory(reason)
  if (routeRoleIds.length && !rec.routePingedAt) {
    try {
      const mentions = routeRoleIds.map((id) => `<@&${id}>`).join(' ')
      const note = isPartnershipTicket(reason)
        ? `${mentions} a new partnership inquiry just opened. Please take a look when you can.`
        : `${mentions} a new ${reason} ticket just opened.`
      await channel.send({
        content: note,
        allowedMentions: { roles: routeRoleIds },
      })
      rec.routePingedAt = Date.now()
    } catch (e) {
      console.warn('[tickets] route role ping failed:', e)
    }
  }

  await saveTicket(rec)

  // Broadcast to dashboard activity feed
  try {
    const { broadcastActivity } = await import('../dashboard/websocket.ts')
    broadcastActivity('ticket_opened', {
      userId: member.id,
      username: member.user.username,
      displayName: member.displayName,
      ticketId: numericId,
      channelId: channel.id,
      channelName: channel.name,
      reason: reason.slice(0, 80),
    })
  } catch {
    /* ignore */
  }

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
        { name: 'Closed by', value: ticket.closedByTag ?? '-', inline: true },
        { name: 'Duration', value: dur, inline: true },
        {
          name: 'Logged messages',
          value: String(ticket.messageCount ?? '-'),
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

function canManageTicket(interaction: Interaction, ticket: TicketRecord): boolean {
  if (interaction.user.id === ticket.userId) return true
  const m = interaction.member
  if (m && 'permissions' in m) {
    return isGuildMod(m as GuildMember)
  }
  return false
}

export async function tryHandleTicketSystem(interaction: Interaction): Promise<boolean> {
  if (!ticketSystemEnabled) return false

  // Execute copilot handlers first
  try {
    const { tryHandleCopilotButton, tryHandleCopilotModal } = await import('./ticket-copilot.ts')
    if (interaction.isButton()) {
      const handled = await tryHandleCopilotButton(interaction)
      if (handled) return true
    }
    if (interaction.isModalSubmit()) {
      const handled = await tryHandleCopilotModal(interaction)
      if (handled) return true
    }
  } catch (err) {
    console.error('[copilot] error in tryHandleTicketSystem delegation:', err)
  }

  if (interaction.isStringSelectMenu()) {
    if (interaction.customId.startsWith(`${TICKET_PREFIX}:workflow:`)) {
      const channelId = interaction.customId.slice(`${TICKET_PREFIX}:workflow:`.length)
      await handleWorkflowStatus(interaction, channelId)
      return true
    }
    if (interaction.customId !== `${TICKET_PREFIX}:reason`) return false
    const reason = interaction.values[0] ?? 'Other'
    pendingReason.set(interaction.user.id, { reason, at: Date.now() })
    await interaction.reply({
      content: 'Category saved. Now tap **Open Ticket** to create your private channel.',
      flags: MessageFlags.Ephemeral,
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
    if (parts[1] === 'txch') {
      await handleTranscriptChannel(interaction, channelId)
      return true
    }
    if (parts[1] === 'csat') {
      const rating = Number(parts[3])
      await handleCsatButton(interaction, channelId, rating)
      return true
    }
    return false
  }

  if (interaction.isModalSubmit()) {
    const id = interaction.customId
    if (id === `${TICKET_PREFIX}:intake_modal`) {
      await handleIntakeModal(interaction)
      return true
    }
    if (!id.startsWith(`${TICKET_PREFIX}:close_modal:`)) return false
    const channelId = id.slice(`${TICKET_PREFIX}:close_modal:`.length)
    await handleCloseModal(interaction, channelId)
    return true
  }

  return false
}

function buildIntakeModal(reason: string = 'other'): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(`${TICKET_PREFIX}:intake_modal`)
    .setTitle('Open ticket: extra details')

  const normalizedReason = reason.trim().toLowerCase()
  const isPartnership =
    normalizedReason === 'partnership' || normalizedReason === 'partnership/collaboration'
  const isBugReport = normalizedReason === 'bug report'
  const isRefund = normalizedReason === 'refund request' || normalizedReason === 'billing/refund'
  const isCommission = normalizedReason === 'commission inquiry'

  const components: ActionRowBuilder<TextInputBuilder>[] = []

  if (isPartnership) {
    // Partnership ticket fields
    const company = new TextInputBuilder()
      .setCustomId('intake_product')
      .setLabel('Your name / company')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(100)

    const partnershipType = new TextInputBuilder()
      .setCustomId('intake_framework')
      .setLabel('Partnership type')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Creator, server, development, integration, etc.')
      .setRequired(false)
      .setMaxLength(100)

    const details = new TextInputBuilder()
      .setCustomId('intake_details')
      .setLabel('Tell us about your proposal')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Share relevant links and timeline if you have one')
      .setRequired(false)
      .setMaxLength(900)

    components.push(
      new ActionRowBuilder<TextInputBuilder>().addComponents(company),
      new ActionRowBuilder<TextInputBuilder>().addComponents(partnershipType),
      new ActionRowBuilder<TextInputBuilder>().addComponents(details),
    )
  } else if (isBugReport) {
    // Bug report ticket fields
    const product = new TextInputBuilder()
      .setCustomId('intake_product')
      .setLabel('Product / resource')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(80)

    const version = new TextInputBuilder()
      .setCustomId('intake_framework')
      .setLabel('Version & framework')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('e.g., v2.3.1, ESX v1.2')
      .setRequired(false)
      .setMaxLength(100)

    const error = new TextInputBuilder()
      .setCustomId('intake_details')
      .setLabel('Error or steps to reproduce')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setMaxLength(900)

    components.push(
      new ActionRowBuilder<TextInputBuilder>().addComponents(product),
      new ActionRowBuilder<TextInputBuilder>().addComponents(version),
      new ActionRowBuilder<TextInputBuilder>().addComponents(error),
    )
  } else if (isRefund) {
    // Refund request fields
    const orderInfo = new TextInputBuilder()
      .setCustomId('intake_product')
      .setLabel('Order / Invoice ID')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(100)

    const product = new TextInputBuilder()
      .setCustomId('intake_framework')
      .setLabel('Product purchased')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(80)

    const reason_text = new TextInputBuilder()
      .setCustomId('intake_details')
      .setLabel('Reason for refund')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setMaxLength(900)

    components.push(
      new ActionRowBuilder<TextInputBuilder>().addComponents(orderInfo),
      new ActionRowBuilder<TextInputBuilder>().addComponents(product),
      new ActionRowBuilder<TextInputBuilder>().addComponents(reason_text),
    )
  } else if (isCommission) {
    // Commission inquiry fields
    const scope = new TextInputBuilder()
      .setCustomId('intake_product')
      .setLabel('Scope of work')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('UI, vehicle script, module, etc.')
      .setRequired(false)
      .setMaxLength(100)

    const budget = new TextInputBuilder()
      .setCustomId('intake_framework')
      .setLabel('Budget & timeline')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(100)

    const details = new TextInputBuilder()
      .setCustomId('intake_details')
      .setLabel('Project details')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setMaxLength(900)

    components.push(
      new ActionRowBuilder<TextInputBuilder>().addComponents(scope),
      new ActionRowBuilder<TextInputBuilder>().addComponents(budget),
      new ActionRowBuilder<TextInputBuilder>().addComponents(details),
    )
  } else {
    // Default/generic fields for all other categories
    const product = new TextInputBuilder()
      .setCustomId('intake_product')
      .setLabel('Product / resource')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(80)

    const framework = new TextInputBuilder()
      .setCustomId('intake_framework')
      .setLabel('Framework / version')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('ESX / QBCore / etc.')
      .setRequired(false)
      .setMaxLength(80)

    const details = new TextInputBuilder()
      .setCustomId('intake_details')
      .setLabel('Details / question')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setMaxLength(900)

    components.push(
      new ActionRowBuilder<TextInputBuilder>().addComponents(product),
      new ActionRowBuilder<TextInputBuilder>().addComponents(framework),
      new ActionRowBuilder<TextInputBuilder>().addComponents(details),
    )
  }

  modal.addComponents(...components)
  return modal
}

async function handleIntakeModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({
      content: 'Use the support panel in the **server**, not in DMs.',
      flags: MessageFlags.Ephemeral,
    })
    return
  }

  let reason = 'Other'
  const pend = pendingReason.get(interaction.user.id)
  if (pend && Date.now() - pend.at < REASON_TTL_MS) {
    reason = pend.reason
  } else {
    await interaction.reply({
      content:
        'Your category choice expired. Select a **category** on the panel again, then tap **Open Ticket**.',
      flags: MessageFlags.Ephemeral,
    })
    return
  }
  pendingReason.delete(interaction.user.id)

  const intakeProduct = interaction.fields.getTextInputValue('intake_product')?.trim() || ''
  const intakeFramework = interaction.fields.getTextInputValue('intake_framework')?.trim() || ''
  const intakeDetails = interaction.fields.getTextInputValue('intake_details')?.trim() || ''

  // FAQ auto-suggest: search before creating the ticket channel
  const faqQuery = [intakeDetails, intakeProduct, reason].filter(Boolean).join(' ')
  const faqMatches = faqQuery.length >= 5 ? searchFaq(faqQuery).slice(0, 2) : []

  await interaction.deferReply({ flags: MessageFlags.Ephemeral })
  try {
    const member = await interaction.guild.members.fetch(interaction.user.id)
    const ch = await createTicketChannel(interaction.guild, member, reason, {
      intakeProduct: intakeProduct || undefined,
      intakeFramework: intakeFramework || undefined,
      intakeDetails: intakeDetails || undefined,
    })

    let reply = `**Ticket created.** Continue in ${ch}, only you and staff can see it.`
    if (faqMatches.length > 0) {
      reply += '\n\n**While you wait, these FAQ answers may help:**\n'
      reply += faqMatches.map((m) => `> ${m.slice(0, 300)}`).join('\n\n')
    }

    await interaction.editReply({ content: reply.slice(0, 2000) })
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e)
    await interaction.editReply({ content: err.slice(0, 2000) })
  }
}

async function handleOpenButton(interaction: Interaction): Promise<void> {
  if (!interaction.isButton() || !interaction.guild) {
    if (interaction.isRepliable()) {
      await interaction.reply({
        content: 'Use the support panel in the **server**, not in DMs.',
        flags: MessageFlags.Ephemeral,
      })
    }
    return
  }

  const pend = pendingReason.get(interaction.user.id)
  if (!pend || Date.now() - pend.at >= REASON_TTL_MS) {
    await interaction.reply({
      content:
        'Choose a **category** from the dropdown on the panel first, then tap **Open Ticket**.',
      flags: MessageFlags.Ephemeral,
    })
    return
  }

  await interaction.showModal(buildIntakeModal(pend.reason))
}

async function handleWorkflowStatus(
  interaction: StringSelectMenuInteraction,
  channelId: string,
): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({
      content: 'Use this in the **server**.',
      flags: MessageFlags.Ephemeral,
    })
    return
  }
  const member = await interaction.guild.members.fetch(interaction.user.id)
  if (!isGuildMod(member)) {
    await interaction.reply({
      content: 'Only **staff** can update ticket status.',
      flags: MessageFlags.Ephemeral,
    })
    return
  }

  const ticket = await getTicketByChannel(channelId)
  if (!ticket || ticket.status !== 'open') {
    await interaction.reply({
      content: 'This ticket is not open or could not be found.',
      flags: MessageFlags.Ephemeral,
    })
    return
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral })

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
    await postTicketWorkflowStaffLog(interaction.client, t2, ch, newStatus, interaction.user.tag)
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e)
    await interaction.editReply({ content: err.slice(0, 500) })
  }
}

async function handleClaim(interaction: Interaction, channelId: string): Promise<void> {
  if (!interaction.isButton() || !interaction.guild) return
  const member = await interaction.guild.members.fetch(interaction.user.id)
  if (!isGuildMod(member)) {
    await interaction.reply({
      content: 'Only **Nightz staff** can claim tickets.',
      flags: MessageFlags.Ephemeral,
    })
    return
  }

  const ticket = await getTicketByChannel(channelId)
  if (!ticket || ticket.status !== 'open') {
    await interaction.reply({
      content: 'This ticket is missing or is no longer open.',
      flags: MessageFlags.Ephemeral,
    })
    return
  }

  const ch = await interaction.guild.channels.fetch(channelId).catch(() => null)
  if (!ch?.isTextBased() || ch.isDMBased()) {
    await interaction.reply({
      content: 'Could not load this channel. Try again or ask an admin.',
      flags: MessageFlags.Ephemeral,
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
        `**Claimed** by ${interaction.user} · \`${interaction.user.tag}\`. Staff is handling this ticket.`,
      ),
    ],
  })
  await postStaffTicketLog(interaction.client, t2, 'claimed', ch as TextChannel)
}

async function handleCloseButton(interaction: Interaction, channelId: string): Promise<void> {
  if (!interaction.isButton() || !interaction.guild) return
  const ticket = await getTicketByChannel(channelId)
  if (!ticket) {
    await interaction.reply({
      content: 'This channel is not linked to a support ticket.',
      flags: MessageFlags.Ephemeral,
    })
    return
  }
  if (!canManageTicket(interaction, ticket)) {
    await interaction.reply({
      content: 'You are not allowed to close this ticket (must be the opener or staff).',
      flags: MessageFlags.Ephemeral,
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

  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input))

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
      flags: MessageFlags.Ephemeral,
    })
    return
  }
  if (!canManageTicket(interaction, ticket)) {
    await interaction.reply({
      content: 'You cannot close this ticket.',
      flags: MessageFlags.Ephemeral,
    })
    return
  }

  const notes = interaction.fields.getTextInputValue('close_notes')?.trim() || ''

  await interaction.deferReply({ flags: MessageFlags.Ephemeral })

  const ch = (await interaction.guild.channels
    .fetch(channelId)
    .catch(() => null)) as TextChannel | null
  if (!ch?.isTextBased()) {
    await interaction.editReply('Channel could not be loaded. Try again.')
    return
  }

  try {
    await runCloseTicket(interaction.client, ch, ticket, interaction.user, notes)
    await interaction.editReply(
      '**Ticket closed.** A summary and attachments were posted in this channel.',
    )
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e)
    await interaction.editReply(err.slice(0, 500))
  }
}

/** 1-5 satisfaction rating buttons shown to the opener after a ticket closes. */
function buildCsatRow(channelId: string): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>()
  for (let n = 1; n <= 5; n++) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${TICKET_PREFIX}:csat:${channelId}:${n}`)
        .setLabel(String(n))
        .setStyle(
          n >= 4 ? ButtonStyle.Success : n <= 2 ? ButtonStyle.Danger : ButtonStyle.Secondary,
        ),
    )
  }
  return row
}

const CSAT_PROMPT = 'How would you rate the support you received? (1 = poor, 5 = great)'

/** Record an opener's CSAT rating and disable the buttons they clicked. */
async function handleCsatButton(
  interaction: Interaction,
  channelId: string,
  rating: number,
): Promise<void> {
  if (!interaction.isButton()) return
  const ticket = await getTicketByChannel(channelId)
  if (!ticket) {
    await interaction
      .reply({ content: 'This ticket is no longer available.', flags: MessageFlags.Ephemeral })
      .catch(() => {})
    return
  }
  if (interaction.user.id !== ticket.userId) {
    await interaction
      .reply({
        content: 'Only the person who opened this ticket can rate it.',
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => {})
    return
  }
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    await interaction
      .reply({ content: 'Invalid rating.', flags: MessageFlags.Ephemeral })
      .catch(() => {})
    return
  }

  await updateTicketPartial(channelId, { csatRating: rating, csatAt: Date.now() })

  const disabledRow = buildCsatRow(channelId)
  for (const c of disabledRow.components) c.setDisabled(true)
  try {
    await interaction.update({
      content: `Thanks for your feedback. You rated this ${rating}/5.`,
      components: [disabledRow],
    })
  } catch {
    await interaction
      .reply({ content: `Thanks. You rated this ${rating}/5.`, flags: MessageFlags.Ephemeral })
      .catch(() => {})
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
  const transcriptBuffers: { name: string; data: Buffer }[] = []

  let fetchedMessages: any[] = []
  if (ticketTranscriptEnabled) {
    const messages = await fetchTicketMessages(channel, ticketTranscriptMaxMessages)
    fetchedMessages = messages
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
    transcriptBuffers.push({
      name: `transcript-${padId(ticket.id)}.txt`,
      data: buildTranscriptTxt(ticket, messages, meta),
    })
    if (ticketTranscriptHtmlEnabled) {
      transcriptBuffers.push({
        name: `transcript-${padId(ticket.id)}.html`,
        data: buildTranscriptHtml(channel.guild, channel, ticket, messages, meta),
      })
    }
  } else {
    const messages = await fetchTicketMessages(channel, 100)
    fetchedMessages = messages
    msgCount = messages.length
    participantCount = countUniqueAuthors(messages)
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

  // Broadcast to dashboard activity feed
  try {
    const { broadcastActivity } = await import('../dashboard/websocket.ts')
    broadcastActivity('ticket_closed', {
      userId: ticket.userId,
      username: closedBy.tag,
      displayName: closedBy.tag,
      ticketId: ticket.id,
      channelId: channel.id,
      channelName: channel.name,
      closedBy: closedBy.tag,
    })
  } catch {
    /* ignore */
  }

  // Generate and save AI post-mortem report
  try {
    const { generateAndSavePostMortem } = await import('./ticket-copilot.ts')
    const postMortemMsgs = fetchedMessages.map((m) => ({
      authorId: m.author.id,
      authorTag: m.author.tag,
      content: m.content || '',
    }))
    generateAndSavePostMortem(client, t, postMortemMsgs, closedBy.tag, closeNotes).catch((err) => {
      console.error('[copilot] failed to generate postmortem:', err)
    })
  } catch (err) {
    console.error('[copilot] failed to import ticket copilot:', err)
  }

  // AI topic tags from the conversation, merged into the seed tags. Fire and
  // forget so it never blocks closing. Enables "find past tickets like this".
  void (async () => {
    try {
      const convo = fetchedMessages
        .map((m) => `${m.author?.bot ? 'bot' : 'user'}: ${m.content || ''}`)
        .filter((l) => l.length > 6)
        .join('\n')
        .slice(0, 4000)
      if (!convo.trim()) return
      const prompt = [
        'Read this support ticket conversation and output 2 to 5 short topic tags that describe what it was about.',
        'Tags should be lowercase, 1 to 3 words, hyphenated, no emojis. Think product names, error types, frameworks, or themes.',
        'Output ONLY the tags as a comma separated list, nothing else.',
        '',
        convo,
      ].join('\n')
      const raw = await generateOnce(_triageModel, prompt)
      const aiTags = raw.split(/[,\n]/).map(normalizeTag).filter(Boolean).slice(0, 5)
      if (aiTags.length) await addTicketTags(channel.id, aiTags)
    } catch (e) {
      console.warn('[tickets] AI tagging failed:', e)
    }
  })()

  await channel.permissionOverwrites.edit(ticket.userId, {
    SendMessages: false,
  })

  await channel.setParent(closedId, { lockPermissions: false }).catch(() => {})
  await channel.setName(`closed-${padId(ticket.id)}`.slice(0, 100)).catch(() => {})

  const durationMs = closedAt - ticket.openedAt
  const durationStr = formatDuration(durationMs)
  const guild = channel.guild
  const channelJump = `https://discord.com/channels/${guild.id}/${channel.id}`
  const icon = guild.iconURL({ size: 128 })

  const transcriptHint = ticketTranscriptEnabled
    ? 'Use the buttons below to save or download a transcript of this conversation.'
    : 'This ticket is now closed.'

  const closingEmbed = ndTicketEmbedStaff()
    .setColor(0xed4245)
    .setAuthor({
      name: 'Nightz Network · Ticket closed',
      ...(icon ? { iconURL: icon } : {}),
    })
    .setTitle(`Support Ticket #${padId(ticket.id)}: Closed`)
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
        value: ticket.claimedByTag ?? '- *(unclaimed)*',
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
      text: `${TICKET_FOOTER_SUPPORT} · Reopen · Delete · Transcript`,
    })

  if (ticket.staffNote?.trim()) {
    closingEmbed.addFields({
      name: 'Staff note',
      value: ticket.staffNote.trim().slice(0, 1024),
      inline: false,
    })
  }

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
      .setLabel('Save transcript (DM)')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${TICKET_PREFIX}:txch:${channel.id}`)
      .setLabel('Download transcript (here)')
      .setStyle(ButtonStyle.Secondary),
  )

  const payload: {
    embeds: EmbedBuilder[]
    components: ActionRowBuilder<ButtonBuilder>[]
  } = { embeds: [closingEmbed], components: [row] }

  const closingMsg = await channel.send(payload)
  const closingJumpUrl = closingMsg.url

  // Ask the opener to rate the support (in-channel). Buttons still work even
  // though their send access was just removed.
  try {
    await channel.send({
      content: `<@${ticket.userId}> ${CSAT_PROMPT}`,
      components: [buildCsatRow(channel.id)],
      allowedMentions: { users: [ticket.userId] },
    })
  } catch (e) {
    console.warn('[tickets] CSAT channel prompt failed:', e)
  }

  await postStaffTicketLog(client, t, 'closed', channel)

  // Auto-award reputation to the staff member who claimed and resolved the ticket
  if (ticket.claimedBy) {
    try {
      const { awardReputation } = await import('./reputation.ts')
      const { checkAndAwardAchievements } = await import('./achievements.ts')
      await awardReputation(ticket.claimedBy, 5, 'system', `Resolved ticket #${padId(ticket.id)}`)
      const profile = await import('./member-profile.ts').then((m) =>
        m.getProfile(ticket.claimedBy!),
      )
      await checkAndAwardAchievements(ticket.claimedBy, {
        ticketsHelped: (profile?.stats.ticketsHelped ?? 0) + 1,
      })
    } catch {
      // Non-critical: don't fail close on reputation error
    }
  }

  if (ticketDmOnClose) {
    try {
      const u = await client.users.fetch(ticket.userId)
      const dmEmbed = ndTicketEmbedStaff()
        .setColor(0xed4245)
        .setTitle(`Support Ticket #${padId(ticket.id)}: Closed`)
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
      if (ticketTranscriptEnabled && transcriptBuffers.length > 0) {
        dmEmbed.addFields({
          name: 'Transcript',
          value: `[Closing message in ticket channel](${closingJumpUrl}). Full logs are attached below.`,
          inline: false,
        })
      } else if (!ticketTranscriptEnabled) {
        dmEmbed.addFields({
          name: 'Transcript',
          value: `Transcripts are not enabled on this bot. You can still read the channel: [open channel](${closingJumpUrl}).`,
          inline: false,
        })
      }

      const dmPayload: {
        embeds: EmbedBuilder[]
        files?: AttachmentBuilder[]
      } = { embeds: [dmEmbed] }
      if (ticketTranscriptEnabled && transcriptBuffers.length > 0) {
        dmPayload.files = transcriptBuffers.map(
          (p) => new AttachmentBuilder(p.data, { name: p.name }),
        )
      }

      await u.send(dmPayload)

      // CSAT prompt via DM (separate message so rating buttons can be disabled
      // cleanly without touching the transcript message).
      await u.send({ content: CSAT_PROMPT, components: [buildCsatRow(channel.id)] }).catch(() => {})
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

async function handleReopen(interaction: Interaction, channelId: string): Promise<void> {
  if (!interaction.isButton() || !interaction.guild) return
  const member = await interaction.guild.members.fetch(interaction.user.id)
  if (!isGuildMod(member)) {
    await interaction.reply({
      content: 'Only **staff** can reopen tickets.',
      flags: MessageFlags.Ephemeral,
    })
    return
  }

  const ticket = await getTicketByChannel(channelId)
  if (!ticket || ticket.status !== 'closed') {
    await interaction.reply({
      content: 'This ticket is not closed or could not be found.',
      flags: MessageFlags.Ephemeral,
    })
    return
  }

  const ch = (await interaction.guild.channels
    .fetch(channelId)
    .catch(() => null)) as TextChannel | null
  if (!ch?.isTextBased()) {
    await interaction.reply({
      content: 'Could not load the channel. Try again.',
      flags: MessageFlags.Ephemeral,
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
    firstStaffReplyAt: undefined,
    slaBreachedAt: undefined,
    slaSecondNudgeAt: undefined,
    reopenCount: (ticket.reopenCount ?? 0) + 1,
  })

  const tFresh = (await getTicketByChannel(channelId))!
  await syncWelcomeMessageFromTicket(ch, tFresh)

  await ch.send({
    embeds: [
      ndTicketEmbedStaff().setDescription(
        `**Support Ticket #${padId(ticket.id)}: Reopened** by ${interaction.user} · \`${interaction.user.tag}\`.\nThe requester can send messages again. **Status** was reset to **${defaultWorkflowStatus()}** on the pinned welcome message, use **Claim** or the status menu as needed.`,
      ),
    ],
  })

  await postStaffTicketLog(interaction.client, tFresh, 'reopened', ch)
}

async function handleDeletePrompt(interaction: Interaction, channelId: string): Promise<void> {
  if (!interaction.isButton() || !interaction.guild) return
  const member = await interaction.guild.members.fetch(interaction.user.id)
  if (!isGuildMod(member)) {
    await interaction.reply({
      content: 'Only **staff** can delete ticket channels.',
      flags: MessageFlags.Ephemeral,
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

  await interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral })
}

async function handleDeleteConfirm(interaction: Interaction, channelId: string): Promise<void> {
  if (!interaction.isButton() || !interaction.guild) return
  const member = await interaction.guild.members.fetch(interaction.user.id)
  if (!isGuildMod(member)) {
    await interaction.reply({
      content: 'Only **staff** can delete ticket channels.',
      flags: MessageFlags.Ephemeral,
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

async function handleTranscriptDm(interaction: Interaction, channelId: string): Promise<void> {
  if (!interaction.isButton() || !interaction.guild) return
  const ticket = await getTicketByChannel(channelId)
  if (!ticket) {
    await interaction.reply({
      content: 'This is not a valid support ticket.',
      flags: MessageFlags.Ephemeral,
    })
    return
  }

  const allowed =
    interaction.user.id === ticket.userId ||
    (await interaction.guild.members.fetch(interaction.user.id).then((m) => isGuildMod(m)))

  if (!allowed) {
    await interaction.reply({
      content: 'Only the **ticket opener** or **staff** can request a transcript.',
      flags: MessageFlags.Ephemeral,
    })
    return
  }

  const ch = (await interaction.guild.channels
    .fetch(channelId)
    .catch(() => null)) as TextChannel | null
  if (!ch?.isTextBased()) {
    await interaction.reply({
      content: 'Could not load this channel.',
      flags: MessageFlags.Ephemeral,
    })
    return
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral })

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
      new AttachmentBuilder(buildTranscriptHtml(interaction.guild!, ch, ticket, messages, meta), {
        name: `transcript-${padId(ticket.id)}.html`,
      }),
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

/** Post a fresh transcript file bundle in the ticket channel itself. */
async function handleTranscriptChannel(interaction: Interaction, channelId: string): Promise<void> {
  if (!interaction.isButton() || !interaction.guild) return
  const ticket = await getTicketByChannel(channelId)
  if (!ticket) {
    await interaction.reply({
      content: 'This is not a valid support ticket.',
      flags: MessageFlags.Ephemeral,
    })
    return
  }

  const allowed =
    interaction.user.id === ticket.userId ||
    (await interaction.guild.members.fetch(interaction.user.id).then((m) => isGuildMod(m)))
  if (!allowed) {
    await interaction.reply({
      content: 'Only the **ticket opener** or **staff** can download the transcript here.',
      flags: MessageFlags.Ephemeral,
    })
    return
  }

  const ch = (await interaction.guild.channels
    .fetch(channelId)
    .catch(() => null)) as TextChannel | null
  if (!ch?.isTextBased()) {
    await interaction.reply({
      content: 'Could not load this channel.',
      flags: MessageFlags.Ephemeral,
    })
    return
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral })

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
  const files: AttachmentBuilder[] = [
    new AttachmentBuilder(buildTranscriptTxt(ticket, messages, meta), {
      name: `transcript-${padId(ticket.id)}.txt`,
    }),
  ]
  if (ticketTranscriptHtmlEnabled) {
    files.push(
      new AttachmentBuilder(buildTranscriptHtml(interaction.guild, ch, ticket, messages, meta), {
        name: `transcript-${padId(ticket.id)}.html`,
      }),
    )
  }

  await ch.send({
    content: `**Transcript exported by ${interaction.user}** · ${messages.length} message(s).`,
    files,
  })
  await interaction.editReply(
    ticketTranscriptHtmlEnabled
      ? '**Done.** Posted **.txt** and **.html** transcript files in this channel.'
      : '**Done.** Posted the **.txt** transcript in this channel.',
  )
}

export async function touchTicketUserActivity(message: Message): Promise<void> {
  if (!message.guild || message.author.bot) return
  const t = await getTicketByChannel(message.channel.id)
  if (!t || t.status !== 'open') return
  if (message.author.id !== t.userId) return
  await updateTicketPartial(message.channel.id, {
    lastUserMessageAt: Date.now(),
    warnedAutoCloseAt: undefined,
    // Re-arm the soft check-in so a future quiet stretch nudges again.
    awaitingUserNudgedAt: undefined,
  })
}

/**
 * Role IDs that trigger auto-claim when the holder replies in a ticket channel.
 * Staff / Moderator / Admin roles.
 */
const AUTO_CLAIM_ROLE_IDS = new Set([
  '1258689807853420614',
  '1365812069185617960',
  '1324838642451222702',
])

/**
 * When a moderator (not the ticket opener) posts, stop automatic AI triage so staff can lead.
 * If the poster has a staff/mod role and the ticket is unclaimed, auto-claim it for them.
 */
export async function markTicketStaffEngagedFromModMessage(msg: Message): Promise<void> {
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

  const patch: Partial<TicketRecord> = {}
  if (!ticket.staffEngaged) patch.staffEngaged = true
  if (!ticket.firstStaffReplyAt) patch.firstStaffReplyAt = Date.now()

  // Auto-claim: if the replying member has a staff/mod role and ticket is unclaimed
  const hasStaffRole =
    AUTO_CLAIM_ROLE_IDS.size > 0 &&
    [...AUTO_CLAIM_ROLE_IDS].some((id) => member!.roles.cache.has(id))
  if (hasStaffRole && !ticket.claimedBy) {
    patch.claimedBy = msg.author.id
    patch.claimedByTag = msg.author.tag
    patch.workflowStatus = pickClaimedWorkflowStatus()
    console.log(`[tickets] Auto-claimed ticket #${ticket.id} by ${msg.author.tag} (role match)`)
  }

  if (Object.keys(patch).length) await updateTicketPartial(msg.channel.id, patch)
}

/**
 * Extra instruction while the ticket is still in AI triage (staff not engaged).
 */
export async function getTicketTriagePromptSuffix(msg: Message): Promise<string> {
  if (!msg.guild) return ''
  const ticket = await getTicketByChannel(msg.channel.id)
  if (!ticket || ticket.status !== 'open' || ticket.staffEngaged) return ''
  if (msg.author.id !== ticket.userId) return ''
  const priority = ticket.priority ?? 'normal'
  const category = ticket.reason || 'General'
  const tone =
    priority === 'critical'
      ? 'Critical priority: be concise and direct. Acknowledge urgency, gather only the most essential details.'
      : priority === 'high'
        ? 'High priority: be efficient. Acknowledge the issue, then ask the most useful 1 to 2 follow-up questions.'
        : 'Standard triage: collect framework, errors, resource name, reproduction steps in 1 to 2 short questions.'
  return `\n\n[Support ticket triage · category: "${category}" · priority: ${priority} · ${tone} Staff has not claimed yet. Do not promise a human response time. No emojis.]`
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
      const sinceLast = now - last

      // Soft check-in before the hard auto-close window: once staff or the bot
      // has engaged and the opener has gone quiet for half the inactivity
      // window, nudge them once. Avoids silently closing someone who stepped
      // away mid-conversation.
      const nudgeMs = Math.floor(autoMs / 2)
      if (
        !ticket.awaitingUserNudgedAt &&
        !ticket.warnedAutoCloseAt &&
        ticket.firstStaffReplyAt &&
        sinceLast >= nudgeMs &&
        sinceLast < autoMs
      ) {
        const nch = (await client.channels
          .fetch(ticket.channelId)
          .catch(() => null)) as TextChannel | null
        if (nch?.isTextBased()) {
          await updateTicketPartial(ticket.channelId, { awaitingUserNudgedAt: now })
          await nch
            .send({
              content: `<@${ticket.userId}> just checking in. Do you still need help here? Reply any time and we will pick it right back up. If we do not hear back, this ticket will close itself after a while.`,
              allowedMentions: { users: [ticket.userId] },
            })
            .catch(() => {})
        }
        continue
      }

      if (sinceLast < autoMs) continue

      const ch = (await client.channels
        .fetch(ticket.channelId)
        .catch(() => null)) as TextChannel | null
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

function workflowSkipsTicketSla(workflow: string | undefined): boolean {
  const w = (workflow ?? '').trim().toLowerCase()
  if (!w) return false
  const ignore = parseTicketSlaIgnoreWorkflows()
  return ignore.includes(w)
}

/** Warn staff log if a ticket has no staff reply after TICKET_FIRST_REPLY_SLA_MS. */
export function startTicketSlaWatchLoop(client: Client): void {
  if (!ticketSystemEnabled || ticketFirstReplySlaMs <= 0 || !STAFF_LOG_CHANNEL_ID) return

  const tick = async (): Promise<void> => {
    const open = await listAllOpenTickets()
    const now = Date.now()
    const sla = ticketFirstReplySlaMs
    const logCh = (await client.channels
      .fetch(STAFF_LOG_CHANNEL_ID!)
      .catch(() => null)) as TextChannel | null
    if (!logCh?.isTextBased()) return

    for (const t of open) {
      if (t.firstStaffReplyAt) continue
      if (workflowSkipsTicketSla(t.workflowStatus)) continue

      if (
        t.slaBreachedAt &&
        ticketSlaSecondNudgeMs > 0 &&
        !t.slaSecondNudgeAt &&
        now - t.slaBreachedAt >= ticketSlaSecondNudgeMs
      ) {
        await logCh
          .send({
            content: `**Ticket SLA (reminder):** still no staff reply for <#${t.channelId}> (${t.userTag}) · opened <t:${Math.floor(t.openedAt / 1000)}:R>.`,
          })
          .catch(() => {})
        await updateTicketPartial(t.channelId, { slaSecondNudgeAt: now })
        continue
      }

      if (t.slaBreachedAt) continue
      if (now - t.openedAt < sla) continue

      await logCh
        .send({
          content: `**Ticket SLA:** no staff reply yet for <#${t.channelId}> (${t.userTag}) · opened <t:${Math.floor(t.openedAt / 1000)}:R>.`,
        })
        .catch(() => {})
      await updateTicketPartial(t.channelId, { slaBreachedAt: now })
    }
  }

  setInterval(() => void tick(), 5 * 60 * 1000).unref()
  void tick()
}

export async function formatOpenTicketsList(
  guildId: string,
  opts: OpenTicketsListOptions = {},
): Promise<string> {
  let open = await listOpenTickets(guildId)
  const filter = opts.filter ?? 'all'
  if (filter === 'unclaimed') open = open.filter((t) => !t.claimedBy)
  if (filter === 'claimed') open = open.filter((t) => Boolean(t.claimedBy))
  if (filter === 'awaiting_staff') open = open.filter((t) => !t.firstStaffReplyAt)
  const q = opts.reasonContains?.trim().toLowerCase()
  if (q) {
    open = open.filter((t) => t.reason.toLowerCase().includes(q))
  }

  const sort = opts.sort ?? 'oldest_first'
  open.sort((a, b) => (sort === 'newest_first' ? b.openedAt - a.openedAt : a.openedAt - b.openedAt))

  const hasFilters =
    filter !== 'all' || Boolean(opts.reasonContains?.trim()) || sort !== 'oldest_first'

  if (open.length === 0) {
    return hasFilters
      ? '**No open tickets** match these filters.'
      : '**No open tickets** in this server right now.'
  }

  const lines = open.map((t) => {
    const age = formatDuration(Date.now() - t.openedAt)
    const claim = t.claimedByTag ? `claimed · **${t.claimedByTag}**` : '*unclaimed*'
    const wf = t.workflowStatus ?? 'Open'
    const staff = t.firstStaffReplyAt ? 'staff replied' : '*awaiting staff*'
    return `**#${padId(t.id)}** · <#${t.channelId}> · ${t.userTag} · ${t.reason.slice(0, 36)}${t.reason.length > 36 ? '…' : ''}\n · **${wf}** · ${claim} · ${staff} · open ${age}`
  })

  const header = hasFilters
    ? `**Open tickets** · _${filterLabel(filter)}${opts.reasonContains?.trim() ? ` · category contains “${opts.reasonContains.trim()}”` : ''} · sort: ${sort === 'newest_first' ? 'newest first' : 'oldest first'}_\n\n`
    : ''

  return (header + lines.join('\n\n')).slice(0, 3500)
}

function filterLabel(f: OpenTicketsListOptions['filter']): string {
  if (f === 'unclaimed') return 'unclaimed only'
  if (f === 'claimed') return 'claimed only'
  if (f === 'awaiting_staff') return 'no staff reply yet'
  return 'all'
}

/** Parse `nd!tickets …` / `nd!ticket list …` args: keywords `unclaimed`, `claimed`, `awaiting`, `newest`, `oldest`, plus extra words as category substring. */
export function parseOpenTicketsListPrefixArgs(raw: string): OpenTicketsListOptions {
  const parts = raw.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const opts: OpenTicketsListOptions = { sort: 'oldest_first' }
  const extra: string[] = []
  for (const p of parts) {
    if (p === 'unclaimed') opts.filter = 'unclaimed'
    else if (p === 'claimed') opts.filter = 'claimed'
    else if (p === 'awaiting') opts.filter = 'awaiting_staff'
    else if (p === 'newest' || p === 'new') opts.sort = 'newest_first'
    else if (p === 'oldest') opts.sort = 'oldest_first'
    else extra.push(p)
  }
  if (extra.length) opts.reasonContains = extra.join(' ')
  return opts
}

export async function formatTicketStatsLine(guildId: string): Promise<string> {
  const s = await getTicketStats(guildId)
  const avgMin =
    s.avgResolutionMs != null
      ? `~**${Math.round(s.avgResolutionMs / 60000)}** min avg. resolution`
      : '*n/a*'
  const medRes =
    s.medianResolutionMs != null
      ? `~**${Math.round(s.medianResolutionMs / 60000)}** min median resolution`
      : '*n/a*'
  const medFirst =
    s.medianMsToFirstStaffReply != null
      ? `~**${Math.round(s.medianMsToFirstStaffReply / 60000)}** min median to first staff reply`
      : '*n/a*'
  const reasons = Object.entries(s.byReason)
    .map(([k, v]) => `**${k}:** ${v}`)
    .join(' · ')
  const reopenRate =
    s.reopenRate != null
      ? `**Reopen rate:** ${(s.reopenRate * 100).toFixed(1)}% (${s.reopenedTickets}/${s.totalClosed})`
      : '**Reopen rate:** *n/a*'
  const csat =
    s.avgCsat != null
      ? `**CSAT:** ${s.avgCsat.toFixed(1)}/5 (${s.csatCount} rated)`
      : '**CSAT:** *no ratings yet*'
  return `**Open:** ${s.totalOpen} · **Closed (tracked):** ${s.totalClosed} · ${avgMin} · ${medRes} · ${medFirst} · ${reopenRate} · ${csat}${
    reasons ? `\n**By category:** ${reasons}` : ''
  }`
}

/** Staff command: add/remove/list tags on the current ticket. */
export async function handleTicketTagCommand(
  channel: TextChannel,
  member: GuildMember,
  rawArgs: string,
): Promise<string> {
  if (!isGuildMod(member)) return 'Moderator only.'
  const ticket = await getTicketByChannel(channel.id)
  if (!ticket) return 'This is not a ticket channel.'
  const parts = rawArgs.trim().split(/\s+/).filter(Boolean)
  const sub = (parts.shift() ?? 'list').toLowerCase()
  const fmt = (tags: string[]): string =>
    tags.length ? tags.map((t) => `\`${t}\``).join(', ') : '*(none)*'
  if (sub === 'list') {
    return `Tags on this ticket: ${fmt(ticket.tags ?? [])}`
  }
  if (sub === 'add') {
    if (!parts.length) return 'Usage: `nd!tickettag add <tag> [tag2 ...]`'
    return `Tags updated: ${fmt(await addTicketTags(channel.id, parts))}`
  }
  if (sub === 'remove' || sub === 'rm') {
    if (!parts.length) return 'Usage: `nd!tickettag remove <tag> [tag2 ...]`'
    return `Tags updated: ${fmt(await removeTicketTags(channel.id, parts))}`
  }
  return 'Usage: `nd!tickettag add|remove|list <tags>`'
}

/** Staff command / copilot helper: find past closed tickets by tag. */
export async function formatTicketTagSearch(guildId: string, query: string): Promise<string> {
  const q = query.trim()
  if (!q) return 'Usage: `nd!ticketsearch <tag>` finds past closed tickets with that tag.'
  const matches = await searchTicketsByTag(q, { guildId, limit: 10 })
  if (!matches.length) return `No closed tickets found with a tag matching "${q}".`
  const lines = matches.map((t) => {
    const when = t.closedAt ? `<t:${Math.floor(t.closedAt / 1000)}:R>` : ''
    const tags = (t.tags ?? []).map((x) => `\`${x}\``).join(' ')
    return `**#${padId(t.id)}** · ${t.reason.slice(0, 40)} · <#${t.channelId}> · closed ${when}\n${tags}`
  })
  return `**Past tickets matching "${q}":**\n\n${lines.join('\n\n')}`.slice(0, 3500)
}

/**
 * Set or clear the staff-visible note on the ticket in `channel`. Staff-only.
 * Returns a short result message to show the actor.
 */
export async function setTicketStaffNote(
  channel: TextChannel,
  actor: GuildMember,
  note: string,
): Promise<string> {
  if (!isGuildMod(actor)) {
    return '**Staff only**: you need a moderator role to set a ticket note.'
  }
  const ticket = await getTicketByChannel(channel.id)
  if (!ticket) {
    return 'Run this inside a **support ticket channel**.'
  }
  const trimmed = note.trim().slice(0, 500)
  const next = await updateTicketPartial(channel.id, {
    staffNote: trimmed || undefined,
  })
  if (!next) return 'Could not save note (ticket missing).'
  try {
    await syncWelcomeMessageFromTicket(channel, next)
  } catch (e) {
    console.warn('[tickets] staff note sync failed:', e)
  }
  return trimmed
    ? `**Staff note saved.** Shown on the welcome embed above.\n> ${trimmed.replace(/\n+/g, ' / ').slice(0, 500)}`
    : '**Staff note cleared.**'
}

export async function ticketAddUser(
  _guild: Guild,
  channel: TextChannel,
  actor: GuildMember,
  targetId: string,
): Promise<string> {
  if (!isGuildMod(actor)) {
    return '**Staff only**: you need a moderator role to add people to tickets.'
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
    return '**Staff only**: you need a moderator role to remove people from tickets.'
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
