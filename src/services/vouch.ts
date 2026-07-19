/**
 * nd!vouch [1-5] <review>: customers post a vouch/review into the configured
 * vouch channel (social proof for the store). Gated to the Customer role by
 * default (VOUCH_REQUIRE_CUSTOMER), with a 24h per-user cooldown. Off when
 * VOUCH_CHANNEL_ID is unset.
 */
import type { Message } from 'discord.js'
import { nightzCustomerRoleId, vouchChannelId, vouchRequireCustomer } from '../config.ts'
import { readJson, writeJson } from './data-store.ts'
import { ndEmbed } from '../utils/embed.ts'

const FILE = 'vouches.json'
type VouchState = Record<string, { count: number; lastAt: number }>
const COOLDOWN_MS = 24 * 60 * 60 * 1000

export async function handleVouchCommand(msg: Message, cmd: string, args: string): Promise<boolean> {
  if (cmd !== 'vouch') return false
  if (!msg.guild) {
    await msg.reply('Use this in a server.')
    return true
  }
  if (!vouchChannelId) {
    await msg.reply('Vouches are not set up yet.')
    return true
  }

  if (vouchRequireCustomer && nightzCustomerRoleId) {
    const member = msg.member ?? (await msg.guild.members.fetch(msg.author.id).catch(() => null))
    if (!member?.roles.cache.has(nightzCustomerRoleId)) {
      await msg.reply(
        'Only verified customers can vouch. Use `/verifypurchase` to link your purchase and get the Customer role.',
      )
      return true
    }
  }

  let text = args.trim()
  let rating = 0
  const m = text.match(/^([1-5])\b\s*([\s\S]*)$/)
  if (m) {
    rating = Number(m[1])
    text = (m[2] ?? '').trim()
  }
  if (!text || text.length < 5) {
    await msg.reply('Usage: `nd!vouch [1-5] <your review>` (for example `nd!vouch 5 clean scripts, fast support`)')
    return true
  }

  const state = await readJson<VouchState>(FILE, {})
  const rec = state[msg.author.id]
  const now = Date.now()
  if (rec && now - rec.lastAt < COOLDOWN_MS) {
    const hours = Math.ceil((COOLDOWN_MS - (now - rec.lastAt)) / 3_600_000)
    await msg.reply(`You already vouched recently. You can vouch again in about ${hours}h.`)
    return true
  }

  const ch = await msg.client.channels.fetch(vouchChannelId).catch(() => null)
  if (!ch?.isTextBased() || !('send' in ch)) {
    await msg.reply('The vouch channel is misconfigured. Tell an admin.')
    return true
  }

  const embed = ndEmbed()
    .setColor(0x00ff88)
    .setAuthor({ name: msg.author.tag, iconURL: msg.author.displayAvatarURL({ size: 64 }) })
    .setTitle('New vouch')
    .setDescription(text.slice(0, 2000))
    .setTimestamp()
  if (rating) embed.addFields({ name: 'Rating', value: `${rating}/5`, inline: true })
  await ch.send({ embeds: [embed] })

  state[msg.author.id] = { count: (rec?.count ?? 0) + 1, lastAt: now }
  await writeJson(FILE, state)
  await msg.reply('Thanks for the vouch. It has been posted.')
  return true
}
