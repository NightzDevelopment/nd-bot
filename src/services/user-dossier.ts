/**
 * Unified user dossier: one read-only view merging warnings, mod notes, mod
 * cases, reputation, profile, and ticket history that currently live in
 * separate stores. Used by /dossier and the dashboard /api/dossier/:userId.
 */
import { EmbedBuilder } from 'discord.js'
import { getProfile } from './member-profile.ts'
import { listCasesForUser, type ModCase } from './mod-cases-store.ts'
import { getUserNotes } from './mod-notes.ts'
import { getReputation } from './reputation.ts'
import { listAllTickets, listOpenTicketsForUser } from './ticket-store.ts'
import { getWarnings } from './warnings.ts'

export type Dossier = {
  userId: string
  guildId: string
  warningCount: number
  warnings: { at: number; moderatorId: string; reason: string }[]
  notes: { at: number; by: string; text: string; severity?: string | undefined }[]
  cases: ModCase[]
  reputation: number
  reputationReceived: number
  profile: {
    bio?: string | undefined
    badges: string[]
    level: number
    messages: number
    ticketsHelped: number
  } | null
  openTickets: number
  totalTickets: number
  /** Combined moderation risk from warnings, cases, and high-severity notes. */
  riskScore: number
  riskLevel: 'low' | 'medium' | 'high'
  repeatOffender: boolean
}

/** Transparent risk weighting: warnings x2, cases x3, high-severity notes x2. */
export function computeRisk(
  warningCount: number,
  caseCount: number,
  highSeverityNotes: number,
): { riskScore: number; riskLevel: 'low' | 'medium' | 'high'; repeatOffender: boolean } {
  const riskScore = warningCount * 2 + caseCount * 3 + highSeverityNotes * 2
  const riskLevel = riskScore >= 8 ? 'high' : riskScore >= 4 ? 'medium' : 'low'
  const repeatOffender = warningCount >= 5 || caseCount >= 3
  return { riskScore, riskLevel, repeatOffender }
}

export async function buildDossier(guildId: string, userId: string): Promise<Dossier> {
  const [w, notes, cases, rep, profile, open, allTickets] = await Promise.all([
    getWarnings(userId),
    getUserNotes(userId),
    listCasesForUser(guildId, userId),
    getReputation(userId),
    getProfile(userId),
    listOpenTicketsForUser(guildId, userId),
    listAllTickets(2000),
  ])
  const totalTickets = allTickets.filter(
    (t) => t.guildId === guildId && t.userId === userId,
  ).length
  return {
    userId,
    guildId,
    warningCount: w?.count ?? 0,
    warnings: (w?.warnings ?? [])
      .slice(-10)
      .reverse()
      .map((x) => ({ at: x.at, moderatorId: x.moderatorId, reason: x.reason })),
    notes: (notes?.notes ?? [])
      .slice(-10)
      .reverse()
      .map((n) => ({ at: n.at, by: n.by, text: n.text, severity: n.severity })),
    cases,
    reputation: rep?.points ?? 0,
    reputationReceived: rep?.history.length ?? 0,
    profile: profile
      ? {
          bio: profile.bio,
          badges: profile.badges,
          level: profile.stats.level,
          messages: profile.stats.messages,
          ticketsHelped: profile.stats.ticketsHelped,
        }
      : null,
    openTickets: open.length,
    totalTickets,
    ...computeRisk(
      w?.count ?? 0,
      cases.length,
      (notes?.notes ?? []).filter((n) => n.severity === 'high').length,
    ),
  }
}

function rel(ts: number): string {
  return `<t:${Math.floor(ts / 1000)}:R>`
}

export function formatDossierEmbed(d: Dossier, userTag: string): EmbedBuilder {
  const sevTag = (s?: string): string => (s ? ` [${s.toUpperCase()}]` : '')
  const warnLines = d.warnings.length
    ? d.warnings
        .slice(0, 5)
        .map((w) => `• ${rel(w.at)}: ${w.reason.slice(0, 80)}`)
        .join('\n')
    : '*none*'
  const noteLines = d.notes.length
    ? d.notes
        .slice(0, 5)
        .map((n) => `• ${rel(n.at)}${sevTag(n.severity)} ${n.text.slice(0, 80)}`)
        .join('\n')
    : '*none*'
  const caseLines = d.cases.length
    ? d.cases
        .slice(0, 5)
        .map((c) => `• ${rel(c.at)}: **${c.action}** ${c.reason.slice(0, 60)}`)
        .join('\n')
    : '*none*'

  const color =
    d.riskLevel === 'high' ? 0xef4444 : d.riskLevel === 'medium' ? 0xfbbf24 : 0x60a5fa
  const riskLabel =
    d.riskLevel === 'high' ? 'HIGH' : d.riskLevel === 'medium' ? 'MEDIUM' : 'low'
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`Dossier: ${userTag}`)
    .setDescription(
      `<@${d.userId}> · \`${d.userId}\`\n**Risk: ${riskLabel}** (score ${d.riskScore})${d.repeatOffender ? ' · repeat offender' : ''}`,
    )
    .addFields(
      {
        name: 'Summary',
        value: [
          `Warnings: **${d.warningCount}**`,
          `Cases: **${d.cases.length}**`,
          `Notes: **${d.notes.length}**`,
          `Reputation: **${d.reputation}**`,
          `Tickets: **${d.openTickets}** open / **${d.totalTickets}** total`,
        ].join(' · '),
        inline: false,
      },
      { name: `Warnings (${d.warningCount})`, value: warnLines.slice(0, 1024), inline: false },
      { name: 'Recent cases', value: caseLines.slice(0, 1024), inline: false },
      { name: 'Staff notes', value: noteLines.slice(0, 1024), inline: false },
    )
  if (d.profile) {
    embed.addFields({
      name: 'Profile',
      value:
        `Level **${d.profile.level}** · ${d.profile.messages} msgs · ` +
        `${d.profile.ticketsHelped} tickets helped` +
        (d.profile.badges.length ? ` · ${d.profile.badges.length} badge(s)` : ''),
      inline: false,
    })
  }
  return embed
}
