/**
 * Ban appeals flow.
 *
 * On ban (if APPEALS_ENABLED) the bot DMs the user an embed with a "Submit an
 * appeal" button. Clicking opens a modal; submitting posts the appeal to the
 * staff review channel with Approve/Deny buttons. Approve unbans the user.
 *
 * Interaction customIds:
 *   ndappeal:start:<guildId>   DM button  -> show modal
 *   ndappeal:submit:<guildId>  modal      -> create record + post to staff
 *   ndappeal:approve:<id>      staff      -> unban + mark approved
 *   ndappeal:deny:<id>         staff      -> mark denied
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type GuildMember,
  type Interaction,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type User,
} from 'discord.js'
import { appealAiTriageEnabled, appealsChannelId, appealsEnabled } from '../config.ts'
import { childLogger } from '../lib/logger.ts'
import { generateRaw } from './gemini.ts'
import { isGuildMod } from '../utils/permissions.ts'
import { addAppeal, getAppeal, hasOpenAppeal, updateAppeal } from './appeals-store.ts'
import { cancelActions } from './scheduled-actions-store.ts'

const log = childLogger('appeals')

const PREFIX = 'ndappeal'

/** Best-effort AI pre-assessment of an appeal for staff (advisory only). */
async function assessAppeal(body: string): Promise<string | null> {
  if (!appealAiTriageEnabled) return null
  try {
    const prompt =
      'A banned Discord user submitted this ban appeal. As a moderation assistant, give a ONE-line ' +
      'advisory for staff: a recommendation (lean approve / needs review / lean deny) and a brief why. ' +
      'Do not decide; staff decide. No preamble, just the one line.\n\nAppeal:\n' +
      body.slice(0, 1200)
    const raw = await generateRaw(prompt)
    return raw.trim().split('\n')[0]?.slice(0, 300) ?? null
  } catch (e) {
    log.warn({ err: e }, 'appeal triage failed')
    return null
  }
}

/** DM a just-banned user an appeal button. Best-effort (DMs may be closed). */
export async function dmBanAppealPrompt(
  user: User,
  guildId: string,
  guildName: string,
): Promise<void> {
  if (!appealsEnabled) return
  try {
    const embed = new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle(`You were banned from ${guildName}`)
      .setDescription(
        'If you believe this was a mistake, you can submit one appeal for staff to review. Use the button below.',
      )
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${PREFIX}:start:${guildId}`)
        .setLabel('Submit an appeal')
        .setStyle(ButtonStyle.Primary),
    )
    await user.send({ embeds: [embed], components: [row] })
  } catch {
    /* DMs closed, nothing we can do */
  }
}

export async function tryHandleAppealInteraction(interaction: Interaction): Promise<boolean> {
  if (interaction.isButton()) {
    const id = interaction.customId
    if (!id.startsWith(`${PREFIX}:`)) return false
    const [, action, arg] = id.split(':')

    if (action === 'start') {
      const guildId = arg ?? ''
      if (await hasOpenAppeal(guildId, interaction.user.id)) {
        await interaction.reply({
          content: 'You already have an appeal pending review. Please wait for a decision.',
          flags: MessageFlags.Ephemeral,
        })
        return true
      }
      const modal = new ModalBuilder()
        .setCustomId(`${PREFIX}:submit:${guildId}`)
        .setTitle('Ban appeal')
      const input = new TextInputBuilder()
        .setCustomId('appeal_body')
        .setLabel('Why should this ban be lifted?')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(1500)
      modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input))
      await interaction.showModal(modal)
      return true
    }

    if (action === 'approve' || action === 'deny') {
      const member = interaction.member as GuildMember | null
      if (!member || !isGuildMod(member)) {
        await interaction.reply({
          content: 'Only staff can review appeals.',
          flags: MessageFlags.Ephemeral,
        })
        return true
      }
      const appealId = Number(arg)
      const appeal = await getAppeal(appealId)
      if (!appeal) {
        await interaction.reply({ content: 'Appeal not found.', flags: MessageFlags.Ephemeral })
        return true
      }
      if (appeal.status !== 'open') {
        await interaction.reply({
          content: `This appeal was already ${appeal.status}.`,
          flags: MessageFlags.Ephemeral,
        })
        return true
      }

      const approved = action === 'approve'
      if (approved) {
        try {
          const guild = await interaction.client.guilds.fetch(appeal.guildId)
          await guild.bans.remove(appeal.userId, `Appeal approved by ${interaction.user.tag}`)
          // Drop any pending temp-ban auto-unban for this user.
          await cancelActions((a) => a.type === 'unban' && a.userId === appeal.userId)
        } catch (e) {
          log.warn({ err: e, userId: appeal.userId }, 'unban on appeal approve failed')
        }
      }

      await updateAppeal(appealId, {
        status: approved ? 'approved' : 'denied',
        reviewedBy: interaction.user.id,
        reviewedByTag: interaction.user.tag,
        decidedAt: Date.now(),
      })

      // Update the staff message: disable buttons, recolor.
      const orig = interaction.message.embeds[0]
      const updated = EmbedBuilder.from(orig ?? new EmbedBuilder())
        .setColor(approved ? 0x34d399 : 0xef4444)
        .setFooter({ text: `${approved ? 'Approved' : 'Denied'} by ${interaction.user.tag}` })
      await interaction.update({ embeds: [updated], components: [] })

      // Notify the user of the decision (best-effort).
      try {
        const user = await interaction.client.users.fetch(appeal.userId)
        await user.send(
          approved
            ? 'Your ban appeal was approved. You have been unbanned and may rejoin.'
            : 'Your ban appeal was reviewed and denied. The ban stands.',
        )
      } catch {
        /* DMs closed */
      }
      return true
    }

    return false
  }

  if (interaction.isModalSubmit()) {
    const id = interaction.customId
    if (!id.startsWith(`${PREFIX}:submit:`)) return false
    const guildId = id.slice(`${PREFIX}:submit:`.length)
    const body = interaction.fields.getTextInputValue('appeal_body')?.trim()
    if (!body) {
      await interaction.reply({ content: 'Appeal cannot be empty.', flags: MessageFlags.Ephemeral })
      return true
    }
    if (await hasOpenAppeal(guildId, interaction.user.id)) {
      await interaction.reply({
        content: 'You already have an appeal pending review.',
        flags: MessageFlags.Ephemeral,
      })
      return true
    }

    const appeal = await addAppeal({
      guildId,
      userId: interaction.user.id,
      userTag: interaction.user.tag,
      body: body.slice(0, 1500),
    })

    // Post to staff review channel.
    if (appealsChannelId) {
      try {
        const ch = await interaction.client.channels.fetch(appealsChannelId)
        if (ch?.isTextBased() && 'send' in ch) {
          const triage = await assessAppeal(body)
          const embed = new EmbedBuilder()
            .setColor(0xfbbf24)
            .setTitle(`Ban appeal #${appeal.id}`)
            .setDescription(body.slice(0, 4000))
            .addFields(
              { name: 'User', value: `<@${appeal.userId}> · \`${appeal.userId}\``, inline: false },
              { name: 'Tag', value: appeal.userTag, inline: true },
            )
            .setTimestamp()
          if (triage) {
            embed.addFields({ name: 'AI triage (advisory)', value: triage.slice(0, 1024), inline: false })
          }
          const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId(`${PREFIX}:approve:${appeal.id}`)
              .setLabel('Approve (unban)')
              .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
              .setCustomId(`${PREFIX}:deny:${appeal.id}`)
              .setLabel('Deny')
              .setStyle(ButtonStyle.Danger),
          )
          const sent = await ch.send({ embeds: [embed], components: [row] })
          await updateAppeal(appeal.id, { staffMessageId: sent.id })
        }
      } catch (e) {
        log.warn({ err: e }, 'failed to post appeal to staff channel')
      }
    }

    await interaction.reply({
      content: 'Your appeal has been submitted for staff review. You will be notified of the decision.',
      flags: MessageFlags.Ephemeral,
    })
    return true
  }

  return false
}
