import { EmbedBuilder } from 'discord.js'

const ND_COLOR = 0x5865f2

/** Ticket UI: matches in-channel support branding (Ticket Tool–style). */
export const TICKET_FOOTER_WITH_AI =
  'Nightz Network · Live Support | Nightz Development · Powered by AI'

export const TICKET_FOOTER_SUPPORT =
  'Nightz Network · Live Support | Nightz Development'

export function ndEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(ND_COLOR)
    .setFooter({ text: 'Nightz Development | Powered by AI' })
}

/** Open/welcome ticket threads — AI may respond first. */
export function ndTicketEmbedOpen(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(ND_COLOR)
    .setFooter({ text: TICKET_FOOTER_WITH_AI })
}

/** Closed tickets, staff actions, DMs — no AI in footer. */
export function ndTicketEmbedStaff(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(ND_COLOR)
    .setFooter({ text: TICKET_FOOTER_SUPPORT })
}

export function refusalEmbed(): EmbedBuilder {
  return ndEmbed().setDescription(
    "I can't help with that. Please keep the conversation respectful.",
  )
}
