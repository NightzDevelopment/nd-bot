/**
 * Two channel-hygiene tools:
 *
 *  - Sticky messages: nd!sticky set <text> keeps a message pinned to the BOTTOM
 *    of a channel (great for "read this first" in support). The bot re-posts it
 *    under new activity, debounced so a busy channel is not spammed.
 *  - Auto-threads: nd!autothread on makes the bot open a thread on every new
 *    post in a channel (great for bug-reports / showcase).
 *
 * Both are staff-gated and persist to disk.
 */
import { type Client, Events, type Message } from 'discord.js'
import { readJson, writeJson } from './data-store.ts'
import { ndEmbed } from '../utils/embed.ts'
import { isGuildMod } from '../utils/permissions.ts'

// ---- stores ---------------------------------------------------------------

interface Sticky {
  text: string
  lastId?: string
}
type StickyStore = Record<string, Sticky> // channelId -> sticky
const STICKY_FILE = 'stickies.json'
let stickies: StickyStore | null = null

async function loadStickies(): Promise<StickyStore> {
  if (!stickies) stickies = await readJson<StickyStore>(STICKY_FILE, {})
  return stickies
}

const AUTOTHREAD_FILE = 'autothread.json'
let autoThreadChannels: string[] | null = null

async function loadAutoThreads(): Promise<string[]> {
  if (!autoThreadChannels) autoThreadChannels = await readJson<string[]>(AUTOTHREAD_FILE, [])
  return autoThreadChannels
}

// ---- commands -------------------------------------------------------------

async function requireStaff(msg: Message): Promise<boolean> {
  const member = msg.member ?? (await msg.guild?.members.fetch(msg.author.id).catch(() => null)) ?? null
  if (!isGuildMod(member)) {
    await msg.reply('Staff only.')
    return false
  }
  return true
}

export async function handleStickyCommand(msg: Message, cmd: string, args: string): Promise<boolean> {
  if (cmd !== 'sticky') return false
  if (!msg.guild || !msg.channel.isTextBased() || !('send' in msg.channel)) {
    await msg.reply('Use this in a server text channel.')
    return true
  }
  if (!(await requireStaff(msg))) return true

  const [sub, ...rest] = args.trim().split(/\s+/)
  const action = (sub ?? '').toLowerCase()
  const store = await loadStickies()

  if (action === 'clear' || action === 'off' || action === 'remove') {
    const existing = store[msg.channel.id]
    if (existing?.lastId) {
      await msg.channel.messages.delete(existing.lastId).catch(() => undefined)
    }
    delete store[msg.channel.id]
    await writeJson(STICKY_FILE, store)
    await msg.reply('Sticky cleared for this channel.')
    return true
  }

  if (action === 'set') {
    const text = rest.join(' ').trim() || args.trim().slice(action.length).trim()
    if (!text) {
      await msg.reply('Usage: `nd!sticky set <message>`')
      return true
    }
    const old = store[msg.channel.id]?.lastId
    if (old) await msg.channel.messages.delete(old).catch(() => undefined)
    const sent = await msg.channel.send({
      embeds: [ndEmbed().setDescription(text.slice(0, 4000))],
    })
    store[msg.channel.id] = { text: text.slice(0, 4000), lastId: sent.id }
    await writeJson(STICKY_FILE, store)
    await msg.reply('Sticky set. It will stay at the bottom of this channel.')
    return true
  }

  await msg.reply('Usage: `nd!sticky set <message>` or `nd!sticky clear`')
  return true
}

export async function handleAutoThreadCommand(
  msg: Message,
  cmd: string,
  args: string,
): Promise<boolean> {
  if (cmd !== 'autothread') return false
  if (!msg.guild) {
    await msg.reply('Use this in a server.')
    return true
  }
  if (!(await requireStaff(msg))) return true

  const action = args.trim().toLowerCase()
  const list = await loadAutoThreads()
  const on = list.includes(msg.channel.id)

  if (action === 'on') {
    if (!on) {
      list.push(msg.channel.id)
      await writeJson(AUTOTHREAD_FILE, list)
    }
    await msg.reply('Auto-threading ON for this channel: every new post gets its own thread.')
    return true
  }
  if (action === 'off') {
    autoThreadChannels = list.filter((id) => id !== msg.channel.id)
    await writeJson(AUTOTHREAD_FILE, autoThreadChannels)
    await msg.reply('Auto-threading OFF for this channel.')
    return true
  }
  await msg.reply(`Auto-threading is **${on ? 'on' : 'off'}** here. Usage: \`nd!autothread <on|off>\``)
  return true
}

// ---- listener -------------------------------------------------------------

// Per-channel debounce so a busy channel does not trigger a repost per message.
const stickyTimers = new Map<string, ReturnType<typeof setTimeout>>()
const STICKY_DEBOUNCE_MS = 4000

export function registerChannelUtilities(client: Client): void {
  client.on(Events.MessageCreate, async (msg: Message) => {
    try {
      if (!msg.guild || msg.author.id === client.user?.id) return
      const channelId = msg.channel.id

      // Auto-thread: open a thread on human posts in configured channels.
      const threads = await loadAutoThreads()
      if (
        !msg.author.bot &&
        threads.includes(channelId) &&
        'threads' in msg.channel &&
        !msg.hasThread
      ) {
        await msg.startThread({ name: `${msg.author.username} - ${msg.content.slice(0, 40) || 'discussion'}`.slice(0, 90) }).catch(() => undefined)
      }

      // Sticky: repost to the bottom, debounced.
      const store = await loadStickies()
      const sticky = store[channelId]
      if (sticky && msg.id !== sticky.lastId && !stickyTimers.has(channelId)) {
        const timer = setTimeout(async () => {
          stickyTimers.delete(channelId)
          const ch = msg.channel
          if (!ch.isTextBased() || !('send' in ch)) return
          const cur = (await loadStickies())[channelId]
          if (!cur) return
          if (cur.lastId) await ch.messages.delete(cur.lastId).catch(() => undefined)
          const sent = await ch.send({ embeds: [ndEmbed().setDescription(cur.text)] }).catch(() => null)
          if (sent) {
            cur.lastId = sent.id
            await writeJson(STICKY_FILE, await loadStickies())
          }
        }, STICKY_DEBOUNCE_MS)
        stickyTimers.set(channelId, timer)
      }
    } catch (e) {
      console.error('[channel-utils]', e)
    }
  })
}
