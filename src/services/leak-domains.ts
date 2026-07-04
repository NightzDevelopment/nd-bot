/**
 * Known FiveM leak-site domains, as a growable database.
 *
 * Seeded with reported leak sites; staff extend it live with
 * `nd!leakdomain add|remove|list`, and additions persist to
 * data/leak-domains.json. findLeakDomain() de-obfuscates common evasion tricks
 * (spaces, the word "dot", "[.]") before matching, so "launcher leaks . net"
 * still resolves to launcherleaks.net.
 */
import type { Message } from 'discord.js'
import { readJson, writeJson } from './data-store.ts'
import { ndEmbed } from '../utils/embed.ts'
import { isGuildMod } from '../utils/permissions.ts'

const SEED_LEAK_DOMAINS: readonly string[] = [
  'launcherleaks.net',
  'fivevault.net',
  'vag.gg',
  'toxicfivem.com',
  'advanced-leaks.co.uk',
]

const FILE = 'leak-domains.json'
let added: string[] | null = null

function normalizeDomain(d: string): string {
  return d
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
}

async function loadAdded(): Promise<string[]> {
  if (!added) added = await readJson<string[]>(FILE, [])
  return added
}

export async function getLeakDomains(): Promise<string[]> {
  const extra = (await loadAdded()).map(normalizeDomain)
  return [...new Set([...SEED_LEAK_DOMAINS, ...extra].filter(Boolean))]
}

/** Warm the cache at startup so the matcher has file-added domains immediately. */
export async function initLeakDomains(): Promise<void> {
  await loadAdded()
}

export async function addLeakDomain(d: string): Promise<boolean> {
  const dom = normalizeDomain(d)
  if (!dom || dom.length < 3 || !dom.includes('.')) return false
  const extra = await loadAdded()
  if (SEED_LEAK_DOMAINS.includes(dom) || extra.map(normalizeDomain).includes(dom)) return false
  extra.push(dom)
  added = extra
  await writeJson(FILE, extra)
  return true
}

export async function removeLeakDomain(d: string): Promise<boolean> {
  const dom = normalizeDomain(d)
  const extra = await loadAdded()
  const next = extra.filter((x) => normalizeDomain(x) !== dom)
  if (next.length === extra.length) return false
  added = next
  await writeJson(FILE, next)
  return true
}

function deobfuscate(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s*\(?\s*dot\s*\)?\s*/g, '.')
    .replace(/\[\s*\.\s*\]|\(\s*\.\s*\)|\{\s*\.\s*\}/g, '.')
    .replace(/\s+/g, '')
}

/** The matched leak domain if the content references one, else null. */
export async function findLeakDomain(content: string): Promise<string | null> {
  if (!content) return null
  const norm = deobfuscate(content)
  for (const dom of await getLeakDomains()) {
    if (norm.includes(dom)) return dom
  }
  return null
}

/** Staff command: nd!leakdomain add|remove|list [domain]. */
export async function handleLeakDomainCommand(
  msg: Message,
  cmd: string,
  args: string,
): Promise<boolean> {
  if (cmd !== 'leakdomain' && cmd !== 'leak-domain' && cmd !== 'leakdomains') return false
  const member =
    msg.member ?? (await msg.guild?.members.fetch(msg.author.id).catch(() => null)) ?? null
  if (!isGuildMod(member)) {
    await msg.reply('Staff only.')
    return true
  }
  const tokens = args.trim().split(/\s+/).filter(Boolean)
  const action = (tokens[0] ?? 'list').toLowerCase()

  if (action === 'list') {
    const list = await getLeakDomains()
    await msg.reply({
      embeds: [
        ndEmbed()
          .setTitle('Leak-site database')
          .setDescription(list.map((d) => `- ${d}`).join('\n').slice(0, 3900) || 'Empty'),
      ],
    })
    return true
  }
  if (action === 'add') {
    const d = tokens[1]
    if (!d) {
      await msg.reply('Usage: `nd!leakdomain add <domain>`')
      return true
    }
    const ok = await addLeakDomain(d)
    await msg.reply(ok ? `Added \`${normalizeDomain(d)}\` to the leak database.` : `\`${d}\` is already listed or invalid.`)
    return true
  }
  if (action === 'remove') {
    const d = tokens[1]
    if (!d) {
      await msg.reply('Usage: `nd!leakdomain remove <domain>`')
      return true
    }
    const ok = await removeLeakDomain(d)
    await msg.reply(
      ok
        ? `Removed \`${normalizeDomain(d)}\`.`
        : `\`${d}\` is not in the added list (built-in seed domains cannot be removed).`,
    )
    return true
  }
  await msg.reply('Usage: `nd!leakdomain <add|remove|list> [domain]`')
  return true
}
