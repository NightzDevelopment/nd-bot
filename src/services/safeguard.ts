/**
 * Safeguard: local blacklist join-screening + community user reports.
 *
 * - On join, a blacklisted member is banned/quarantined/alerted per
 *   SAFEGUARD_JOIN_ACTION, and staff are notified.
 * - Members report a bad actor with nd!reportuser; the report lands in the
 *   safeguard channel with Approve/Deny buttons. Approving adds the target to
 *   the blacklist (and actions them if they are currently in the server).
 * - Staff manage the list directly with nd!blacklist add|remove|check|list.
 *
 * Ban appeals (services/appeals.ts) remove a user from the blacklist when
 * approved, closing the loop.
 *
 * Interaction customIds:
 *   ndsgreport:approve:<id>   staff -> blacklist the target
 *   ndsgreport:deny:<id>      staff -> dismiss the report
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type Client,
  EmbedBuilder,
  Events,
  type Guild,
  type GuildMember,
  type Interaction,
  type Message,
  MessageFlags,
} from 'discord.js'
import { safeguardChannelId, safeguardEnabled, safeguardJoinAction } from '../config.ts'
import { readJson, writeJson } from './data-store.ts'
import {
  addToBlacklist,
  BLACKLIST_CATEGORIES,
  type BlacklistEntry,
  checkBlacklist,
  listBlacklist,
  normalizeCategory,
  removeFromBlacklist,
} from './blacklist-store.ts'
import { quarantineMember } from './profile-scan.ts'
import { ndEmbed } from '../utils/embed.ts'
import { isGuildMod } from '../utils/permissions.ts'

// ---- reports store --------------------------------------------------------

interface UserReport {
  id: number
  guildId: string
  targetId: string
  targetTag: string
  reporterId: string
  reason: string
  status: 'open' | 'approved' | 'denied'
  createdAt: number
}

const REPORTS_FILE = 'safeguard-reports.json'
let reports: UserReport[] | null = null

async function loadReports(): Promise<UserReport[]> {
  if (!reports) reports = await readJson<UserReport[]>(REPORTS_FILE, [])
  return reports
}
async function addReport(
  r: Omit<UserReport, 'id' | 'status' | 'createdAt'>,
): Promise<UserReport> {
  const list = await loadReports()
  const id = list.reduce((m, x) => Math.max(m, x.id), 0) + 1
  const rec: UserReport = { ...r, id, status: 'open', createdAt: Date.now() }
  list.push(rec)
  await writeJson(REPORTS_FILE, list)
  return rec
}
async function getReport(id: number): Promise<UserReport | null> {
  return (await loadReports()).find((r) => r.id === id) ?? null
}
async function setReportStatus(id: number, status: UserReport['status']): Promise<void> {
  const list = await loadReports()
  const r = list.find((x) => x.id === id)
  if (r) {
    r.status = status
    await writeJson(REPORTS_FILE, list)
  }
}

// ---- helpers --------------------------------------------------------------

function extractUserId(token: string | undefined): string | null {
  if (!token) return null
  const m = token.match(/^<@!?(\d+)>$/)
  if (m) return m[1] as string
  return /^\d+$/.test(token) ? token : null
}

async function postToSafeguard(
  client: Client,
  payload: { embeds: EmbedBuilder[]; components?: ActionRowBuilder<ButtonBuilder>[] },
): Promise<Message | null> {
  if (!safeguardChannelId) return null
  try {
    const ch = await client.channels.fetch(safeguardChannelId)
    if (ch?.isTextBased() && 'send' in ch) {
      return await ch.send(payload)
    }
  } catch {
    /* ignore */
  }
  return null
}

/** Apply the configured join action to a blacklisted member and log it. */
async function applyJoinAction(member: GuildMember, entry: BlacklistEntry): Promise<string> {
  if (safeguardJoinAction === 'ban') {
    if (member.bannable) {
      try {
        await member.ban({ reason: `Safeguard blacklist: ${entry.category}`, deleteMessageSeconds: 86_400 })
        return 'banned'
      } catch {
        /* fall through to quarantine */
      }
    }
    const status = await quarantineMember(member, `Safeguard blacklist: ${entry.category} (ban not possible)`)
    return `ban not possible, ${status}`
  }
  if (safeguardJoinAction === 'quarantine') {
    return quarantineMember(member, `Safeguard blacklist: ${entry.category}`)
  }
  return 'alert only'
}

function blacklistAlertEmbed(entry: BlacklistEntry, action: string, joined = true): EmbedBuilder {
  return ndEmbed()
    .setTitle(joined ? 'Blacklisted user joined' : 'User blacklisted')
    .setColor(0xff4444)
    .setDescription(
      `<@${entry.userId}> \`${entry.userId}\`\n` +
        `Category: **${entry.category}**\n` +
        `Reason: ${entry.reason}\n` +
        `Action: **${action}**\n` +
        `Added by: <@${entry.addedBy}>`,
    )
    .setTimestamp()
}

// ---- join screening -------------------------------------------------------

export function registerSafeguard(client: Client): void {
  if (!safeguardEnabled) return
  client.on(Events.GuildMemberAdd, async (member: GuildMember) => {
    try {
      const entry = await checkBlacklist(member.id)
      if (!entry) return
      const action = await applyJoinAction(member, entry)
      await postToSafeguard(client, { embeds: [blacklistAlertEmbed(entry, action, true)] })
    } catch (e) {
      console.error('[safeguard] join screen:', e)
    }
  })
}

// ---- nd!blacklist (staff) -------------------------------------------------

export async function handleBlacklistCommand(
  msg: Message,
  cmd: string,
  args: string,
): Promise<boolean> {
  if (cmd !== 'blacklist' && cmd !== 'bl') return false
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

  const tokens = args.trim().split(/\s+/).filter(Boolean)
  const action = (tokens[0] ?? 'list').toLowerCase()

  if (action === 'list') {
    const all = await listBlacklist()
    if (all.length === 0) {
      await msg.reply({ embeds: [ndEmbed().setTitle('Blacklist').setDescription('Empty.')] })
      return true
    }
    const lines = all
      .slice(0, 30)
      .map((e) => `- <@${e.userId}> \`${e.userId}\` [${e.category}] ${e.reason.slice(0, 80)}`)
    const extra = all.length > 30 ? `\n...and ${all.length - 30} more` : ''
    await msg.reply({
      embeds: [
        ndEmbed()
          .setTitle(`Blacklist (${all.length})`)
          .setDescription(`${lines.join('\n')}${extra}`.slice(0, 4000)),
      ],
    })
    return true
  }

  if (action === 'check') {
    const userId = extractUserId(tokens[1])
    if (!userId) {
      await msg.reply('Usage: `nd!blacklist check <@user|id>`')
      return true
    }
    const entry = await checkBlacklist(userId)
    await msg.reply({
      embeds: [
        ndEmbed()
          .setTitle('Blacklist check')
          .setColor(entry ? 0xff4444 : 0x34d399)
          .setDescription(
            entry
              ? `<@${userId}> is **blacklisted**.\nCategory: **${entry.category}**\nReason: ${entry.reason}\nAdded by: <@${entry.addedBy}>`
              : `<@${userId}> is not on the blacklist.`,
          ),
      ],
    })
    return true
  }

  if (action === 'remove') {
    const userId = extractUserId(tokens[1])
    if (!userId) {
      await msg.reply('Usage: `nd!blacklist remove <@user|id>`')
      return true
    }
    const ok = await removeFromBlacklist(userId)
    await msg.reply(ok ? `Removed <@${userId}> from the blacklist.` : `<@${userId}> was not on the blacklist.`)
    return true
  }

  if (action === 'add') {
    const userId = extractUserId(tokens[1])
    if (!userId) {
      await msg.reply(
        `Usage: \`nd!blacklist add <@user|id> <category> <reason>\`\nCategories: ${BLACKLIST_CATEGORIES.join(', ')}`,
      )
      return true
    }
    const category = normalizeCategory(tokens[2] ?? 'other')
    const reason = tokens.slice(3).join(' ').slice(0, 500) || 'No reason given'
    const ok = await addToBlacklist({
      userId,
      category,
      reason,
      addedBy: msg.author.id,
      addedByTag: msg.author.tag,
      addedAt: Date.now(),
    })
    if (!ok) {
      await msg.reply(`<@${userId}> is already blacklisted. Use \`nd!blacklist remove\` first to re-add.`)
      return true
    }
    // If they are currently in the server, action them now too.
    let actionNote = ''
    const inGuild = await msg.guild.members.fetch(userId).catch(() => null)
    if (inGuild) {
      const status = await applyJoinAction(inGuild, {
        userId,
        category,
        reason,
        addedBy: msg.author.id,
        addedByTag: msg.author.tag,
        addedAt: Date.now(),
      })
      actionNote = ` They are in the server: ${status}.`
    }
    await msg.reply(`Blacklisted <@${userId}> as **${category}**.${actionNote}`)
    return true
  }

  await msg.reply(
    `Usage: \`nd!blacklist <add|remove|check|list>\`\nCategories: ${BLACKLIST_CATEGORIES.join(', ')}`,
  )
  return true
}

// ---- nd!reportuser (members) ----------------------------------------------

const reportCooldown = new Map<string, number>()
const REPORT_COOLDOWN_MS = 30_000

export async function handleReportUserCommand(
  msg: Message,
  cmd: string,
  args: string,
): Promise<boolean> {
  if (cmd !== 'reportuser' && cmd !== 'report-user') return false
  if (!msg.guild) {
    await msg.reply('Use this in a server.')
    return true
  }
  if (!safeguardEnabled) {
    await msg.reply('User reporting is disabled.')
    return true
  }

  const now = Date.now()
  const last = reportCooldown.get(msg.author.id) ?? 0
  if (now - last < REPORT_COOLDOWN_MS) {
    await msg.reply('Please wait a moment before submitting another report.')
    return true
  }

  const tokens = args.trim().split(/\s+/).filter(Boolean)
  const targetId = extractUserId(tokens[0]) ?? msg.mentions.users.first()?.id ?? null
  const reason = tokens.slice(1).join(' ').trim()
  if (!targetId || !reason) {
    await msg.reply('Usage: `nd!reportuser @user <reason>`')
    return true
  }
  if (targetId === msg.author.id) {
    await msg.reply('You cannot report yourself.')
    return true
  }
  const targetMember = await msg.guild.members.fetch(targetId).catch(() => null)
  if (targetMember?.user.bot) {
    await msg.reply('You cannot report a bot.')
    return true
  }
  if (targetMember && isGuildMod(targetMember)) {
    await msg.reply('You cannot report a staff member here. Contact an admin directly.')
    return true
  }
  if (!safeguardChannelId) {
    await msg.reply('Reporting is not fully set up yet (no review channel configured).')
    return true
  }

  reportCooldown.set(msg.author.id, now)
  const targetTag = targetMember?.user.tag ?? (await msg.client.users.fetch(targetId).catch(() => null))?.tag ?? targetId
  const report = await addReport({
    guildId: msg.guild.id,
    targetId,
    targetTag,
    reporterId: msg.author.id,
    reason: reason.slice(0, 1000),
  })

  const embed = ndEmbed()
    .setTitle(`User report #${report.id}`)
    .setColor(0xffa500)
    .setDescription(
      `Reported: <@${targetId}> \`${targetId}\`\n` +
        `By: <@${msg.author.id}>\n\n` +
        `Reason:\n${reason.slice(0, 3000)}`,
    )
    .setTimestamp()
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`ndsgreport:approve:${report.id}`)
      .setLabel('Approve (blacklist)')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`ndsgreport:deny:${report.id}`)
      .setLabel('Dismiss')
      .setStyle(ButtonStyle.Secondary),
  )
  await postToSafeguard(msg.client, { embeds: [embed], components: [row] })
  await msg.reply('Thanks. Your report was sent to staff for review.')
  return true
}

// ---- report approve/deny buttons ------------------------------------------

export async function tryHandleSafeguardInteraction(interaction: Interaction): Promise<boolean> {
  if (!interaction.isButton()) return false
  const id = interaction.customId
  if (!id.startsWith('ndsgreport:')) return false
  const [, action, arg] = id.split(':')

  const member = interaction.member as GuildMember | null
  if (!isGuildMod(member)) {
    await interaction.reply({ content: 'Only staff can review reports.', flags: MessageFlags.Ephemeral })
    return true
  }
  const report = await getReport(Number(arg))
  if (!report || report.status !== 'open') {
    await interaction.reply({
      content: report ? `This report was already ${report.status}.` : 'Report not found.',
      flags: MessageFlags.Ephemeral,
    })
    return true
  }

  const approved = action === 'approve'
  if (approved) {
    await addToBlacklist({
      userId: report.targetId,
      category: 'other',
      reason: `Report: ${report.reason}`.slice(0, 500),
      addedBy: interaction.user.id,
      addedByTag: interaction.user.tag,
      addedAt: Date.now(),
    })
    await setReportStatus(report.id, 'approved')
    // Action them now if they are in the server.
    try {
      const guild = interaction.guild as Guild | null
      const target = guild ? await guild.members.fetch(report.targetId).catch(() => null) : null
      if (target) {
        await applyJoinAction(target, {
          userId: report.targetId,
          category: 'other',
          reason: report.reason,
          addedBy: interaction.user.id,
          addedByTag: interaction.user.tag,
          addedAt: Date.now(),
        })
      }
    } catch {
      /* ignore */
    }
  } else {
    await setReportStatus(report.id, 'denied')
  }

  const orig = interaction.message.embeds[0]
  const updated = EmbedBuilder.from(orig ?? new EmbedBuilder())
    .setColor(approved ? 0xff4444 : 0x808080)
    .setFooter({ text: `${approved ? 'Blacklisted' : 'Dismissed'} by ${interaction.user.tag}` })
  await interaction.update({ embeds: [updated], components: [] })
  return true
}
