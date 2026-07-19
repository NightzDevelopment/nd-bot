/**
 * Bot-owned rules / policies. The bot stores the canonical text for the Rules,
 * FAQ, Terms of Service, IP & Resale policy, and a Links/Info hub, displays them
 * on request, and can publish them as embeds it keeps updated in place (so the
 * rules channel is always current). Content is editable from the dashboard
 * Policies tab or seeded from the defaults below.
 *
 * Public display: nd!rules, nd!tos (nd!terms), nd!ippolicy (nd!resale), nd!info
 * (nd!websites). Staff: nd!policies list, nd!rules publish [#channel], nd!rules
 * refresh (re-render the published embeds from current content).
 */
import { type EmbedBuilder, type Message } from 'discord.js'
import { WELCOME_RULES_CHANNEL_ID } from '../config.ts'
import { readJson, writeJson } from './data-store.ts'
import { ndEmbed } from '../utils/embed.ts'
import { isGuildMod } from '../utils/permissions.ts'

export type PolicyKey = 'rules' | 'faq' | 'tos' | 'ip' | 'info'
export interface PolicySection {
  title: string
  body: string
  updated: string
  /** Where the published embed lives, so it can be edited in place. */
  channelId?: string
  messageId?: string
}
export type PoliciesStore = Partial<Record<PolicyKey, PolicySection>>

const FILE = 'policies.json'
export const POLICY_ORDER: PolicyKey[] = ['rules', 'faq', 'tos', 'ip', 'info']
const SEED_DATE = 'July 19, 2026'

function today(): string {
  return new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

const DEFAULTS: Record<PolicyKey, PolicySection> = {
  rules: {
    title: 'Nightz Development | Rules',
    updated: SEED_DATE,
    body: [
      'Welcome to the official Discord for Nightz Development (ND). By participating in this community or using ND services, you agree to follow the rules and accept the Terms of Service.',
      '',
      '**Community Conduct**',
      '- Respect all members and staff.',
      '- Harassment, hate speech, or discrimination is not tolerated.',
      '- Spam, trolling, and excessive tagging are prohibited.',
      '- Ghost pings and mass mentions are not allowed.',
      '- Leaking private conversations, tickets, or staff discussions is forbidden.',
      '- English must be used in main channels unless specified otherwise.',
      '- Voice channels must be used respectfully (no soundboards, yelling, or disruptive behavior).',
      '- Use the correct channels for their intended purpose (support must go through tickets).',
      '- NSFW, explicit, or graphic content is not permitted.',
      '- Advertising, self-promotion, or unsolicited DMs are prohibited.',
      '- All ticket procedures must be followed when requesting support, commissions, or applications.',
      '',
      'Note: Staff may mute, warn, or ban users without prior notice to maintain community safety.',
    ].join('\n'),
  },
  faq: {
    title: 'Nightz Development | Frequently Asked Questions',
    updated: SEED_DATE,
    body: [
      '**How do I obtain ND scripts or maps?**',
      'Free releases are posted in the server. Paid and exclusive content require a support ticket.',
      '',
      '**Can I become a tester?**',
      'Yes. Applications for QA and Closed Beta testing can be submitted via ticket.',
      '',
      '**Can I modify ND scripts?**',
      'Minor configuration edits are permitted. Modifying core code requires written approval from ND.',
      '',
      '**What is the turnaround time for commissions?**',
      'Timeframes depend on the project. An estimated delivery time will be provided when accepted.',
      '',
      '**Can I resell content I purchased?**',
      'No. All ND content is licensed for use on your server/account only. Redistribution or resale is strictly prohibited.',
      '',
      '**What happens if I violate the Terms of Service?**',
      'Violations may result in permanent bans, blacklisting, and reports to partnered developers.',
    ].join('\n'),
  },
  tos: {
    title: 'Nightz Development | Terms of Service',
    updated: SEED_DATE,
    body: [
      '**1. Intellectual Property**',
      'All ND content (scripts, maps, liveries, branding, and documentation) is protected by copyright. Purchasing or downloading does not grant ownership.',
      '',
      '**2. Licensing and Usage**',
      'Licenses are non-transferable and bound to the server/account that purchased them. Redistribution, resale, or unauthorized sharing of ND content is prohibited.',
      '',
      '**3. Modifications**',
      'Configuration-level edits are allowed. Core modifications, reverse-engineering, or bypassing protections are not permitted without written consent.',
      '',
      '**4. Payments and Refunds**',
      'All services and products must be paid in full before delivery. ND does not provide refunds once digital content is delivered. Chargebacks result in immediate blacklisting and possible legal escalation.',
      '',
      '**5. Security and Enforcement**',
      'Any attempt to leak, resell, or steal ND files results in permanent bans and blacklisting. ND may issue DMCA takedowns and pursue legal action.',
      '',
      '**6. Public and Free Releases**',
      'Free content is still subject to these terms. Removal of credits, rebranding, or unauthorized redistribution is prohibited.',
      '',
      '**7. Automation and Exploits**',
      'Automated purchasing, scraping, or exploit attempts on ND platforms are prohibited.',
      '',
      '**8. Support and Services**',
      'ND reserves the right to refuse service or support to individuals who violate these terms. Paid support has priority; free support is at ND discretion.',
      '',
      '**9. Business and Partnerships**',
      'ND is a registered business. Partnerships, reselling, or integrations require a formal written agreement. Unauthorized use of the ND name or brand is prohibited.',
      '',
      '**10. Termination**',
      'ND may suspend or terminate access to services or content if these terms are violated. By purchasing, downloading, or using ND content, you agree to these terms.',
    ].join('\n'),
  },
  ip: {
    title: 'Nightz Development | Intellectual Property & Resale Policy',
    updated: SEED_DATE,
    body: [
      '**Intellectual Property**',
      '- All ND scripts, assets, and documentation remain the property of ND.',
      '- Licenses grant usage, not ownership.',
      '- Reverse engineering, decompiling, or modifying ND scripts for resale or redistribution is prohibited.',
      '- Third-party assets remain property of their creators and are used with permission.',
      '',
      '**Resale & Distribution**',
      '- Personal use on one server is allowed.',
      '- Sharing with friends, teams, or reselling ND scripts is not allowed.',
      '- Bundling ND scripts with other assets is prohibited.',
      '- Selling private edits is only allowed with prior reseller authorization.',
      '- Authorized resellers must follow ND pricing, credit, and reporting requirements.',
      '',
      '**Enforcement & Penalties**',
      '- Unauthorized resale, leaks, or rebranding will result in license termination and permanent bans.',
      '- DMCA takedowns or legal action may be pursued.',
      '- Repeated violations may result in public listing on ND violator records.',
      '',
      '**Full Policy Documents**',
      'IP & Copyright Policy: https://docs.google.com/document/d/1TUNn-Ni3nS5wg3ApEsBhpwQTLpiEiV3Hvp6bMyUanag/edit',
      'Resale & Distribution Policy: https://docs.google.com/document/d/1p1ar6pZkdw2AF76VsVO3l3sKxsx8IHg4atMOi-e8D_w/edit',
    ].join('\n'),
  },
  info: {
    title: 'Nightz Development | Links & Info',
    updated: SEED_DATE,
    body: [
      'Everything Nightz Development in one place.',
      '',
      '**Store:** https://shop.nightz.dev',
      '**Docs:** https://docs.nightz.dev',
      '**Support Desk:** https://desk.nightz.dev',
      '**Feedback:** https://feedback.nightz.dev',
      '**Forms:** https://forms.nightz.dev',
      '**Bot Dashboard:** https://bot.nightz.dev',
      '',
      '**Policy Documents**',
      'IP & Copyright Policy: https://docs.google.com/document/d/1TUNn-Ni3nS5wg3ApEsBhpwQTLpiEiV3Hvp6bMyUanag/edit',
      'Resale & Distribution Policy: https://docs.google.com/document/d/1p1ar6pZkdw2AF76VsVO3l3sKxsx8IHg4atMOi-e8D_w/edit',
      '',
      '**Discord Safety Center:** https://discord.com/safety',
    ].join('\n'),
  },
}

let store: PoliciesStore | null = null
async function load(): Promise<PoliciesStore> {
  if (!store) store = await readJson<PoliciesStore>(FILE, {})
  return store
}

/** A section with defaults filled in for anything not yet customized. */
export async function getSection(key: PolicyKey): Promise<PolicySection> {
  const s = await load()
  return s[key] ?? DEFAULTS[key]
}

/** Full set (stored over defaults), for the dashboard. */
export async function getAllSections(): Promise<Record<PolicyKey, PolicySection>> {
  const s = await load()
  const out = {} as Record<PolicyKey, PolicySection>
  for (const key of POLICY_ORDER) out[key] = s[key] ?? DEFAULTS[key]
  return out
}

/** Edit a section (from the dashboard). Re-stamps the "Last Updated" date. */
export async function updateSection(
  key: PolicyKey,
  patch: { title?: string; body?: string },
): Promise<PolicySection> {
  const s = await load()
  const cur = s[key] ?? DEFAULTS[key]
  const next: PolicySection = {
    ...cur,
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.body !== undefined ? { body: patch.body } : {}),
    updated: today(),
  }
  s[key] = next
  await writeJson(FILE, s)
  return next
}

function embedFor(sec: PolicySection): EmbedBuilder {
  return ndEmbed()
    .setTitle(sec.title)
    .setDescription(sec.body.slice(0, 4096))
    .setFooter({ text: `Nightz Development · Last Updated: ${sec.updated}` })
}

/** Re-render every published section in place (dashboard calls this after a save). */
export async function refreshPublished(client: import('discord.js').Client): Promise<number> {
  const s = await load()
  let updated = 0
  for (const key of POLICY_ORDER) {
    const sec = s[key]
    if (!sec?.channelId || !sec.messageId) continue
    const ch = await client.channels.fetch(sec.channelId).catch(() => null)
    if (!ch?.isTextBased() || !('messages' in ch)) continue
    const m = await ch.messages.fetch(sec.messageId).catch(() => null)
    if (m) {
      await m.edit({ embeds: [embedFor(sec)] }).catch(() => undefined)
      updated++
    }
  }
  return updated
}

async function requireStaff(msg: Message): Promise<boolean> {
  const member = msg.member ?? (await msg.guild?.members.fetch(msg.author.id).catch(() => null)) ?? null
  if (!isGuildMod(member)) {
    await msg.reply('Staff only.')
    return false
  }
  return true
}

const DISPLAY: Record<string, PolicyKey> = {
  rules: 'rules',
  tos: 'tos',
  terms: 'tos',
  ippolicy: 'ip',
  resale: 'ip',
  info: 'info',
  websites: 'info',
}

export async function handlePolicyCommand(msg: Message, cmd: string, args: string): Promise<boolean> {
  if (cmd !== 'policies' && cmd !== 'rules' && !(cmd in DISPLAY)) return false

  const sub = args.trim().split(/\s+/)[0]?.toLowerCase() ?? ''

  // Admin verbs live under nd!policies and nd!rules <publish|refresh|list>.
  if (cmd === 'policies' || (cmd === 'rules' && ['publish', 'refresh', 'list'].includes(sub))) {
    if (!msg.guild) {
      await msg.reply('Use this in a server.')
      return true
    }
    const verb = cmd === 'policies' ? sub || 'list' : sub

    if (verb === 'list' || verb === '') {
      const all = await getAllSections()
      const lines = POLICY_ORDER.map((k) => {
        const sec = all[k]
        const where = sec.channelId ? `published in <#${sec.channelId}>` : 'not published'
        return `- **${k}** - ${sec.title} (${where})`
      })
      await msg.reply(
        `${lines.join('\n')}\n\n**Publish:** \`nd!rules publish [#channel]\` · **Update in place:** \`nd!rules refresh\`. Edit the text in the dashboard Policies tab.`,
      )
      return true
    }

    if (!(await requireStaff(msg))) return true

    if (verb === 'publish') {
      const mentioned = msg.mentions.channels.first()
      const fallback = WELCOME_RULES_CHANNEL_ID
        ? await msg.client.channels.fetch(WELCOME_RULES_CHANNEL_ID).catch(() => null)
        : null
      const target = mentioned ?? fallback ?? msg.channel
      if (!target || !target.isTextBased() || !('send' in target)) {
        await msg.reply('Pick a text channel: `nd!rules publish #rules`.')
        return true
      }
      const s = await load()
      for (const key of POLICY_ORDER) {
        const sec = { ...(s[key] ?? DEFAULTS[key]), updated: today() }
        const sent = await target.send({ embeds: [embedFor(sec)] })
        s[key] = { ...sec, channelId: target.id, messageId: sent.id }
      }
      await writeJson(FILE, s)
      await msg.reply(`Published ${POLICY_ORDER.length} policy embeds to <#${target.id}>.`)
      return true
    }

    if (verb === 'refresh') {
      const n = await refreshPublished(msg.client)
      await msg.reply(
        n > 0
          ? `Updated ${n} published embed${n === 1 ? '' : 's'} in place.`
          : 'Nothing is published yet. Use `nd!rules publish #rules` first.',
      )
      return true
    }
  }

  // Public display.
  const key = DISPLAY[cmd]
  if (!key) {
    // nd!rules with an unrecognized subcommand still shows the rules.
    if (cmd === 'rules') {
      await msg.reply({ embeds: [embedFor(await getSection('rules'))] })
      return true
    }
    return false
  }
  await msg.reply({ embeds: [embedFor(await getSection(key))] })
  return true
}
