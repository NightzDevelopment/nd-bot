/**
 * nd!docs [query]: point members at docs.nightz.dev. The docs site is a
 * hash-routed SPA with no search API, so this is a curated set of the known
 * sections with light keyword matching. Extend SECTIONS as the docs grow.
 */
import type { Message } from 'discord.js'
import { ndEmbed } from '../utils/embed.ts'

interface DocSection {
  title: string
  url: string
  keywords: string[]
}

const DOCS_HOME = 'https://docs.nightz.dev/'

const SECTIONS: DocSection[] = [
  {
    title: 'Getting started',
    url: DOCS_HOME,
    keywords: ['start', 'getting started', 'intro', 'setup', 'install', 'framework', 'begin', 'guide'],
  },
  {
    title: 'License keys',
    url: 'https://docs.nightz.dev/#licensing/license-keys',
    keywords: [
      'license', 'licence', 'key', 'keys', 'activate', 'activation', 'bind', 'ip', 'slot',
      'entitlement', 'purchase', 'download', 'invalid', 'renew', 'expire',
    ],
  },
  {
    title: 'API overview',
    url: 'https://docs.nightz.dev/#developers/api-overview',
    keywords: ['api', 'developer', 'dev', 'integration', 'overview', 'endpoint', 'rest'],
  },
  {
    title: 'License API',
    url: 'https://docs.nightz.dev/#developers/license-api',
    keywords: ['license api', 'verify', 'validation', 'check license', 'api key', 'entitlement check'],
  },
  {
    title: 'Team API',
    url: 'https://docs.nightz.dev/#developers/team-api',
    keywords: ['team', 'team api', 'members', 'staff api', 'roles api'],
  },
]

function scoreSection(query: string, section: DocSection): number {
  const q = query.toLowerCase()
  let score = 0
  if (section.title.toLowerCase().includes(q)) score += 5
  for (const kw of section.keywords) {
    if (q.includes(kw) || kw.includes(q)) score += kw.includes(' ') ? 3 : 1
  }
  return score
}

function listAll(): string {
  return SECTIONS.map((s) => `- [${s.title}](${s.url})`).join('\n')
}

export async function handleDocsCommand(msg: Message, cmd: string, args: string): Promise<boolean> {
  if (cmd !== 'docs' && cmd !== 'documentation') return false
  const query = args.trim()

  if (!query) {
    await msg.reply({
      embeds: [
        ndEmbed()
          .setTitle('Nightz Development docs')
          .setDescription(`${listAll()}\n\nSearch a topic: \`nd!docs <topic>\` (for example \`nd!docs license keys\`).`),
      ],
    })
    return true
  }

  const ranked = SECTIONS.map((s) => ({ s, score: scoreSection(query, s) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)

  if (ranked.length === 0) {
    await msg.reply({
      embeds: [
        ndEmbed()
          .setTitle(`No exact match for "${query.slice(0, 80)}"`)
          .setDescription(`Browse the docs directly: ${DOCS_HOME}\n\nSections:\n${listAll()}`),
      ],
    })
    return true
  }

  const top = ranked.slice(0, 3).map(({ s }) => `- [${s.title}](${s.url})`)
  await msg.reply({
    embeds: [
      ndEmbed()
        .setTitle(`Docs for "${query.slice(0, 80)}"`)
        .setDescription(top.join('\n')),
    ],
  })
  return true
}
