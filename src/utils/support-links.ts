import {
  FAQ_CHANNEL_ID,
  WELCOME_RULES_CHANNEL_ID,
  WELCOME_TICKET_CHANNEL_ID,
  supportLinksJson,
} from '../config.ts'

export function formatSupportLinksMarkdown(): string {
  if (supportLinksJson) {
    try {
      const arr = JSON.parse(supportLinksJson) as { label?: string; url?: string }[]
      if (Array.isArray(arr) && arr.length > 0) {
        return arr
          .filter((x) => x.label && x.url)
          .map((x) => `• **${x.label}**: ${x.url}`)
          .join('\n')
      }
    } catch {
      /* ignore */
    }
  }
  const lines: string[] = []
  if (FAQ_CHANNEL_ID) lines.push(`• **FAQ:** <#${FAQ_CHANNEL_ID}>`)
  if (WELCOME_TICKET_CHANNEL_ID) lines.push(`• **Tickets:** <#${WELCOME_TICKET_CHANNEL_ID}>`)
  if (WELCOME_RULES_CHANNEL_ID) lines.push(`• **Rules:** <#${WELCOME_RULES_CHANNEL_ID}>`)
  lines.push('• **Discord Safety Center:** https://discord.com/safety')
  return lines.join('\n')
}
