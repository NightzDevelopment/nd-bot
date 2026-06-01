import { EmbedBuilder } from 'discord.js'

const ND_COLOR = 0x60a5fa // primary indigo/blue (open ticket, info)
const ND_COLOR_AMBER = 0xfbbf24 // claimed / awaiting staff
const ND_COLOR_GREEN = 0x34d399 // resolved / closed (positive)
const ND_COLOR_RED = 0xef4444 // critical / breached SLA / forced close

/** Ticket UI: matches in-channel support branding. */
export const TICKET_FOOTER_WITH_AI =
  'Nightz Network · Live Support | Nightz Development · Powered by AI'

export const TICKET_FOOTER_SUPPORT = 'Nightz Network · Live Support | Nightz Development'

export function ndEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(ND_COLOR)
    .setFooter({ text: 'Nightz Development | Powered by AI' })
}

/** Open/welcome ticket threads — AI may respond first. */
export function ndTicketEmbedOpen(): EmbedBuilder {
  return new EmbedBuilder().setColor(ND_COLOR).setFooter({ text: TICKET_FOOTER_WITH_AI })
}

/** Claimed / actively-being-worked tickets (amber). */
export function ndTicketEmbedClaimed(): EmbedBuilder {
  return new EmbedBuilder().setColor(ND_COLOR_AMBER).setFooter({ text: TICKET_FOOTER_SUPPORT })
}

/** Resolved/closed tickets (green). */
export function ndTicketEmbedClosed(): EmbedBuilder {
  return new EmbedBuilder().setColor(ND_COLOR_GREEN).setFooter({ text: TICKET_FOOTER_SUPPORT })
}

/** Critical / SLA-breached / force-closed tickets (red). */
export function ndTicketEmbedCritical(): EmbedBuilder {
  return new EmbedBuilder().setColor(ND_COLOR_RED).setFooter({ text: TICKET_FOOTER_SUPPORT })
}

/** Closed tickets, staff actions, DMs — no AI in footer. */
export function ndTicketEmbedStaff(): EmbedBuilder {
  return new EmbedBuilder().setColor(ND_COLOR).setFooter({ text: TICKET_FOOTER_SUPPORT })
}

export function refusalEmbed(): EmbedBuilder {
  return ndEmbed().setDescription(
    "I can't help with that. Please keep the conversation respectful.",
  )
}
