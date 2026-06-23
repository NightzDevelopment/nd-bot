import {
  ChannelType,
  type ChatInputCommandInteraction,
  type Client,
  type Message,
  MessageFlags,
} from 'discord.js'
import { afkAutoClear, afkNicknamePrefix } from '../config.ts'
import { ndEmbed } from '../utils/embed.ts'
import { clearAfk, getAfk, setAfk } from './afk-store.ts'
import { isFeatureEnabled } from './feature-gates.ts'

const mentionCooldown = new Map<string, number>()

function duration(since: number): string {
  const sec = Math.max(1, Math.floor((Date.now() - since) / 1000))
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ${min % 60}m`
  const d = Math.floor(hr / 24)
  return `${d}d ${hr % 24}h`
}

async function applyAfkNickname(msg: Message, enable: boolean): Promise<void> {
  if (!afkNicknamePrefix || !msg.member?.manageable) return
  const current = msg.member.nickname ?? msg.member.user.username
  try {
    if (enable && !current.startsWith(afkNicknamePrefix)) {
      await msg.member.setNickname(`${afkNicknamePrefix}${current}`.slice(0, 32), 'AFK enabled')
    } else if (!enable && current.startsWith(afkNicknamePrefix)) {
      await msg.member.setNickname(current.slice(afkNicknamePrefix.length) || null, 'AFK cleared')
    }
  } catch {
    /* nickname changes are best-effort */
  }
}

export function registerAfk(client: Client): void {
  if (!isFeatureEnabled('afk')) return
  client.on('messageCreate', async (msg) => {
    try {
      if (!msg.guild || msg.author.bot || msg.channel.type === ChannelType.DM) return

      const mentioned = [...msg.mentions.users.values()].filter((u) => u.id !== msg.author.id)
      for (const user of mentioned.slice(0, 5)) {
        const rec = await getAfk(msg.guild.id, user.id)
        if (!rec) continue
        const key = `${msg.channel.id}:${user.id}`
        const now = Date.now()
        if (now - (mentionCooldown.get(key) ?? 0) < 30_000) continue
        mentionCooldown.set(key, now)
        await msg
          .reply({
            embeds: [
              ndEmbed()
                .setTitle('AFK')
                .setDescription(`<@${user.id}> is AFK: **${rec.reason}**`)
                .addFields({ name: 'Away for', value: duration(rec.since), inline: true }),
            ],
          })
          .catch(() => {})
      }

      if (!afkAutoClear) return
      const own = await getAfk(msg.guild.id, msg.author.id)
      if (!own) return
      await clearAfk(msg.guild.id, msg.author.id)
      await applyAfkNickname(msg, false)
      await msg.reply(`Welcome back, <@${msg.author.id}>. I cleared your AFK.`).catch(() => {})
    } catch (e) {
      console.warn('[afk] messageCreate handler error:', e)
    }
  })
}

export async function handleAfkSlash(interaction: ChatInputCommandInteraction): Promise<boolean> {
  if (interaction.commandName !== 'afk') return false
  if (!interaction.guild) {
    await interaction.reply({ content: 'Use this in a server.', flags: MessageFlags.Ephemeral })
    return true
  }
  const reason = interaction.options.getString('reason')?.trim() || 'AFK'
  await setAfk(interaction.guild.id, interaction.user.id, reason.slice(0, 200))
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null)
  if (member) {
    const fake = { member } as Message
    await applyAfkNickname(fake, true)
  }
  await interaction.reply({
    embeds: [
      ndEmbed()
        .setTitle('AFK set')
        .setDescription(`Reason: **${reason.slice(0, 200)}**`),
    ],
    flags: MessageFlags.Ephemeral,
  })
  return true
}
