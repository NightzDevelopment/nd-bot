/**
 * Moderation Commands Handler
 * /warnings, /usernote commands for staff
 */

import { type ChatInputCommandInteraction, type GuildMember, MessageFlags } from 'discord.js'
import {
  addNote,
  clearNotes,
  deleteNote,
  getHighSeverityNotes,
  getNotesSummary,
  getUserNotes,
} from '../services/mod-notes.ts'
import {
  addWarning,
  clearWarnings,
  ESCALATION_THRESHOLDS,
  getRecentWarnings,
  getWarnings,
  getWarningsSummary,
} from '../services/warnings.ts'
import { ndEmbed } from '../utils/embed.ts'
import { isGuildMod } from '../utils/permissions.ts'

/**
 * Handle /warnings command
 */
export async function handleWarningsSlash(
  interaction: ChatInputCommandInteraction,
): Promise<boolean> {
  const subcommand = interaction.options.getSubcommand()

  if (subcommand === 'view') {
    const user = interaction.options.getUser('user')
    if (!user) {
      await interaction.reply({
        content: 'Please specify a user.',
        flags: MessageFlags.Ephemeral,
      })
      return true
    }

    const record = await getWarnings(user.id)
    const embed = ndEmbed()
      .setTitle(`${user.username}'s Warnings`)
      .setThumbnail(user.displayAvatarURL())

    if (!record || record.count === 0) {
      embed.setDescription('No warnings on record.')
    } else {
      let desc = `**Warning Count**: ${record.count}/${ESCALATION_THRESHOLDS.BAN_THRESHOLD}\n\n`

      if (record.count >= ESCALATION_THRESHOLDS.BAN_THRESHOLD) {
        desc += '[ALERT-BAN] **BAN STATUS** - Automatic ban threshold reached\n\n'
      } else if (record.count >= ESCALATION_THRESHOLDS.KICK_THRESHOLD) {
        desc += '[WARN-KICK] **KICK STATUS** - Automatic kick threshold reached\n\n'
      } else if (record.count >= ESCALATION_THRESHOLDS.WARN_THRESHOLD) {
        desc += '[WARN-ESCALATED] **ESCALATED** - Close to auto-kick\n\n'
      }

      desc += '**Recent Warnings**:\n'
      const recent = record.warnings.slice(-5).reverse()
      for (const warning of recent) {
        const date = new Date(warning.at).toLocaleDateString()
        desc += `• ${warning.reason}\n  (${date})\n`
      }

      if (record.warnings.length > 5) {
        desc += `\n... and ${record.warnings.length - 5} more`
      }

      embed.setDescription(desc)
    }

    await interaction.reply({ embeds: [embed] })
    return true
  }

  if (subcommand === 'add') {
    if (!isGuildMod(interaction.member as GuildMember | null)) {
      await interaction.reply({
        content: 'Mod+ required.',
        flags: MessageFlags.Ephemeral,
      })
      return true
    }

    const user = interaction.options.getUser('user')
    const reason = interaction.options.getString('reason') ?? 'No reason specified'

    if (!user) {
      await interaction.reply({
        content: 'User not found.',
        flags: MessageFlags.Ephemeral,
      })
      return true
    }

    const { record, escalateAction } = await addWarning(user.id, interaction.user.id, reason)

    const embed = ndEmbed()
      .setTitle('[WARNING] Warning Added')
      .setDescription(`${user} - Warning ${record.count}/${ESCALATION_THRESHOLDS.BAN_THRESHOLD}`)
      .addFields({
        name: 'Reason',
        value: reason.slice(0, 200),
      })

    if (escalateAction === 'ban') {
      embed.setColor(0xff0000).addFields({
        name: '[ALERT] Action',
        value: 'Ban threshold reached - recommend immediate ban',
      })
    } else if (escalateAction === 'kick') {
      embed.setColor(0xff9900).addFields({
        name: '[WARN] Action',
        value: 'Kick threshold reached - recommend kick',
      })
    }

    await interaction.reply({ embeds: [embed] })
    return true
  }

  if (subcommand === 'leaderboard') {
    if (!isGuildMod(interaction.member as GuildMember | null)) {
      await interaction.reply({
        content: 'Mod+ required.',
        flags: MessageFlags.Ephemeral,
      })
      return true
    }

    const recent = await getRecentWarnings(15)
    const embed = ndEmbed()
      .setTitle('[WARNINGS] Warnings Leaderboard')
      .setDescription(
        recent.length === 0
          ? 'No warnings recorded.'
          : recent
              .map(
                (entry, idx) =>
                  `${idx + 1}. <@${entry.userId}> - **${entry.count}** warnings\n   Last: ${entry.latestReason?.slice(0, 40)}`,
              )
              .join('\n'),
      )

    await interaction.reply({ embeds: [embed] })
    return true
  }

  if (subcommand === 'clear') {
    if (!isGuildMod(interaction.member as GuildMember | null)) {
      await interaction.reply({
        content: 'Mod+ required.',
        flags: MessageFlags.Ephemeral,
      })
      return true
    }

    const user = interaction.options.getUser('user')
    if (!user) {
      await interaction.reply({
        content: 'User not found.',
        flags: MessageFlags.Ephemeral,
      })
      return true
    }

    const success = await clearWarnings(user.id)
    if (success) {
      await interaction.reply({
        content: `[SUCCESS] Cleared all warnings for ${user}.`,
        flags: MessageFlags.Ephemeral,
      })
    } else {
      await interaction.reply({
        content: `No warnings to clear for ${user}.`,
        flags: MessageFlags.Ephemeral,
      })
    }
    return true
  }

  return false
}

/**
 * Handle /usernote command
 */
export async function handleUserNoteSlash(
  interaction: ChatInputCommandInteraction,
): Promise<boolean> {
  const subcommand = interaction.options.getSubcommand()

  if (subcommand === 'add') {
    if (!isGuildMod(interaction.member as GuildMember | null)) {
      await interaction.reply({
        content: 'Mod+ required.',
        flags: MessageFlags.Ephemeral,
      })
      return true
    }

    const user = interaction.options.getUser('user')
    const text = interaction.options.getString('note')
    const severity = interaction.options.getString('severity') as 'low' | 'medium' | 'high' | null

    if (!user || !text) {
      await interaction.reply({
        content: 'User and note text required.',
        flags: MessageFlags.Ephemeral,
      })
      return true
    }

    const record = await addNote(user.id, interaction.user.id, text, severity ?? undefined)

    const severityEmoji =
      severity === 'high' ? '[HIGH]' : severity === 'medium' ? '[MEDIUM]' : '[LOW]'

    await interaction.reply({
      content: `${severityEmoji} Added note on ${user} (${record.notes.length} total)`,
      flags: MessageFlags.Ephemeral,
    })
    return true
  }

  if (subcommand === 'view') {
    if (!isGuildMod(interaction.member as GuildMember | null)) {
      await interaction.reply({
        content: 'Mod+ required.',
        flags: MessageFlags.Ephemeral,
      })
      return true
    }

    const user = interaction.options.getUser('user')
    if (!user) {
      await interaction.reply({
        content: 'User not found.',
        flags: MessageFlags.Ephemeral,
      })
      return true
    }

    const record = await getUserNotes(user.id)
    const embed = ndEmbed()
      .setTitle(`[NOTES] Notes on ${user.username}`)
      .setThumbnail(user.displayAvatarURL())

    if (!record || record.notes.length === 0) {
      embed.setDescription('No notes on record.')
    } else {
      let desc = `**Total Notes**: ${record.notes.length}\n\n`
      for (let i = Math.max(0, record.notes.length - 5); i < record.notes.length; i++) {
        const note = record.notes[i]
        if (!note) continue
        const date = new Date(note.at).toLocaleDateString()
        const severity = note.severity ? ` [${note.severity.toUpperCase()}]` : ''
        desc += `**${record.notes.length - i}.** ${note.text}${severity}\n`
        desc += `   <t:${Math.floor(note.at / 1000)}:R> by <@${note.by}>\n\n`
      }

      if (record.notes.length > 5) {
        desc += `... and ${record.notes.length - 5} more notes`
      }

      embed.setDescription(desc)
    }

    await interaction.reply({ embeds: [embed] })
    return true
  }

  return false
}
