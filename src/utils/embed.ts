import { EmbedBuilder } from 'discord.js'

const ND_COLOR = 0x5865f2

export function ndEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(ND_COLOR)
    .setFooter({ text: 'Nightz Development | Powered by AI' })
}

export function refusalEmbed(): EmbedBuilder {
  return ndEmbed().setDescription(
    "I can't help with that. Please keep the conversation respectful.",
  )
}
