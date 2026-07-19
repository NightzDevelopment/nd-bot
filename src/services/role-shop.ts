/**
 * Cosmetic role shop: members spend economy currency (NDC) on color/cosmetic
 * roles. Staff curate the shop with nd!roleshop add|remove; members browse with
 * nd!roleshop (alias nd!colorshop) and buy with nd!buyrole <name>.
 *
 * Only roles the bot can manage (below its highest, not managed) can be sold or
 * granted. Persists to role-shop.json.
 */
import { type Guild, type Message, type Role } from 'discord.js'
import { readJson, writeJson } from './data-store.ts'
import { addBalance, getBalance } from './economy-store.ts'
import { ndEmbed } from '../utils/embed.ts'
import { isGuildMod } from '../utils/permissions.ts'

interface ShopRole {
  roleId: string
  name: string
  price: number
}
const FILE = 'role-shop.json'
let shop: ShopRole[] | null = null

async function load(): Promise<ShopRole[]> {
  if (!shop) shop = await readJson<ShopRole[]>(FILE, [])
  return shop
}

const fmt = (n: number) => `${n.toLocaleString()} NDC`

function resolveRole(guild: Guild, query: string): Role | null {
  const mention = query.match(/<@&(\d+)>/)
  if (mention) return guild.roles.cache.get(mention[1] as string) ?? null
  const q = query.trim().toLowerCase()
  if (!q) return null
  return (
    guild.roles.cache.find((r) => r.name.toLowerCase() === q) ??
    guild.roles.cache.find((r) => r.name.toLowerCase().includes(q) && q.length >= 2) ??
    null
  )
}

function botCanManage(guild: Guild, role: Role): boolean {
  const me = guild.members.me
  return !!me && !role.managed && role.id !== guild.id && me.roles.highest.position > role.position
}

export async function handleRoleShopCommand(
  msg: Message,
  cmd: string,
  args: string,
): Promise<boolean> {
  if (cmd !== 'roleshop' && cmd !== 'colorshop' && cmd !== 'buyrole') return false
  if (!msg.guild) {
    await msg.reply('Use this in a server.')
    return true
  }
  const guild = msg.guild
  const list = await load()

  // ---- buy ----
  if (cmd === 'buyrole') {
    const q = args.trim()
    if (!q) {
      await msg.reply('Usage: `nd!buyrole <role name>` (see `nd!roleshop`)')
      return true
    }
    const byName = list.find((e) => e.name.toLowerCase() === q.toLowerCase())
    const resolved = resolveRole(guild, q)
    const entry = byName ?? (resolved ? list.find((e) => e.roleId === resolved.id) : undefined)
    if (!entry) {
      await msg.reply(`"${q}" is not in the shop. See \`nd!roleshop\`.`)
      return true
    }
    const role = guild.roles.cache.get(entry.roleId)
    if (!role) {
      await msg.reply('That role no longer exists. Ask staff to update the shop.')
      return true
    }
    const member = msg.member ?? (await guild.members.fetch(msg.author.id).catch(() => null))
    if (!member) {
      await msg.reply('Could not resolve your membership.')
      return true
    }
    if (member.roles.cache.has(role.id)) {
      await msg.reply(`You already have **${role.name}**.`)
      return true
    }
    if (!botCanManage(guild, role)) {
      await msg.reply('I cannot grant that role right now (hierarchy). Ask staff to move my role up.')
      return true
    }
    const bal = await getBalance(msg.author.id)
    if (bal.balance < entry.price) {
      await msg.reply(`That costs **${fmt(entry.price)}**. You have **${fmt(bal.balance)}**.`)
      return true
    }
    await addBalance(msg.author.id, -entry.price)
    const ok = await member.roles
      .add(role, 'Role shop purchase')
      .then(() => true)
      .catch(() => false)
    if (!ok) {
      await addBalance(msg.author.id, entry.price) // refund on failure
      await msg.reply('Could not add the role (permissions?). You were refunded.')
      return true
    }
    await msg.reply(`Enjoy **${role.name}**. It cost **${fmt(entry.price)}**.`)
    return true
  }

  // ---- add / remove (staff) ----
  const tokens = args.trim().split(/\s+/).filter(Boolean)
  const action = (tokens[0] ?? '').toLowerCase()

  if (action === 'add' || action === 'remove') {
    const member = msg.member ?? (await guild.members.fetch(msg.author.id).catch(() => null)) ?? null
    if (!isGuildMod(member)) {
      await msg.reply('Only staff can manage the role shop.')
      return true
    }
    const role = msg.mentions.roles.first() ?? resolveRole(guild, tokens.slice(1).join(' '))
    if (action === 'add') {
      const price = Number.parseInt(tokens[tokens.length - 1] ?? '', 10)
      if (!role || !Number.isFinite(price) || price < 0) {
        await msg.reply('Usage: `nd!roleshop add @role <price>`')
        return true
      }
      if (list.some((e) => e.roleId === role.id)) {
        await msg.reply(`**${role.name}** is already in the shop.`)
        return true
      }
      if (!botCanManage(guild, role)) {
        await msg.reply(`I cannot manage **${role.name}**. Move my role above it first.`)
        return true
      }
      list.push({ roleId: role.id, name: role.name, price })
      await writeJson(FILE, list)
      await msg.reply(`Added **${role.name}** to the shop for **${fmt(price)}**.`)
      return true
    }
    if (!role) {
      await msg.reply('Usage: `nd!roleshop remove @role`')
      return true
    }
    shop = list.filter((e) => e.roleId !== role.id)
    await writeJson(FILE, shop)
    await msg.reply(`Removed **${role.name}** from the shop.`)
    return true
  }

  // ---- list ----
  if (list.length === 0) {
    await msg.reply({
      embeds: [
        ndEmbed()
          .setTitle('Role shop')
          .setDescription('The shop is empty. Staff add roles with `nd!roleshop add @role <price>`.'),
      ],
    })
    return true
  }
  const lines = list
    .slice(0, 25)
    .map((e) => `- **${e.name}** - ${fmt(e.price)}  ->  \`nd!buyrole ${e.name}\``)
  await msg.reply({
    embeds: [
      ndEmbed()
        .setTitle('Role shop')
        .setDescription(`${lines.join('\n')}\n\nBuy with \`nd!buyrole <name>\`. Earn NDC with the economy commands.`),
    ],
  })
  return true
}
