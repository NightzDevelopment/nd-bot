/**
 * Staff economy controls (UnbelievaBoat-style).
 *
 *   nd!add-money @user <amount>          add NDC to a member's wallet
 *   nd!remove-money @user <amount>       remove NDC from a member's wallet
 *   nd!add-money-role @role <amount>     add NDC to every member in a role
 *   nd!remove-money-role @role <amount>  remove NDC from every member in a role
 *   nd!reset-money @user                 zero a member's wallet and bank
 *
 * All staff-gated (isGuildMod). Balances are local SQLite writes, so the role
 * variants apply in a tight loop without rate-limit pacing.
 */
import { type Guild, type Message, type Role } from 'discord.js'
import { addBalance, getBalance, resetUserBalance } from './economy-store.ts'
import { ndEmbed } from '../utils/embed.ts'
import { isGuildMod } from '../utils/permissions.ts'

const ADMIN_CMDS = new Set([
  'add-money',
  'addmoney',
  'remove-money',
  'removemoney',
  'add-money-role',
  'addmoneyrole',
  'remove-money-role',
  'removemoneyrole',
  'reset-money',
  'resetmoney',
])

function parseAmount(arg: string): number | null {
  const cleaned = arg.replace(/[,_\s]/g, '').toLowerCase()
  const match = /^([\d.]+)\s*([kmb])?$/.exec(cleaned)
  if (!match) return null
  let n = Number.parseFloat(match[1] as string)
  if (!Number.isFinite(n) || n <= 0) return null
  const suffix = match[2]
  if (suffix === 'k') n *= 1_000
  else if (suffix === 'm') n *= 1_000_000
  else if (suffix === 'b') n *= 1_000_000_000
  return Math.floor(n)
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

export async function handleAdminEconomyCommand(
  msg: Message,
  cmd: string,
  args: string,
): Promise<boolean> {
  if (!ADMIN_CMDS.has(cmd)) return false
  if (!msg.guild) {
    await msg.reply('Use this in a server.')
    return true
  }
  const member = msg.member ?? (await msg.guild.members.fetch(msg.author.id).catch(() => null))
  if (!isGuildMod(member)) {
    await msg.reply('You need staff permissions to manage the economy.')
    return true
  }
  const guild = msg.guild
  const remove = cmd.startsWith('remove')
  const sign = remove ? -1 : 1

  // reset-money @user
  if (cmd === 'reset-money' || cmd === 'resetmoney') {
    const target = msg.mentions.users.first()
    if (!target) {
      await msg.reply('Usage: `nd!reset-money @user`')
      return true
    }
    await resetUserBalance(target.id)
    await msg.reply({
      embeds: [
        ndEmbed()
          .setTitle('Balance reset')
          .setDescription(`Zeroed wallet and bank for ${target}.`),
      ],
    })
    return true
  }

  // role variants: <@role> <amount>
  if (cmd.includes('role')) {
    const tokens = args.trim().split(/\s+/).filter(Boolean)
    const amount = parseAmount(tokens[tokens.length - 1] ?? '')
    const roleMention = msg.mentions.roles.first()
    const role = roleMention ?? resolveRole(guild, tokens.slice(0, -1).join(' '))
    if (!role || amount == null) {
      await msg.reply(`Usage: \`nd!${remove ? 'remove' : 'add'}-money-role @role <amount>\``)
      return true
    }
    await guild.members.fetch()
    const members = [...role.members.values()]
    if (members.length === 0) {
      await msg.reply(`No members have **${role.name}**.`)
      return true
    }
    let changed = 0
    for (const m of members) {
      try {
        await addBalance(m.id, sign * amount)
        changed++
      } catch {
        /* skip */
      }
    }
    await msg.reply({
      embeds: [
        ndEmbed()
          .setTitle(remove ? 'Money removed (role)' : 'Money added (role)')
          .setDescription(
            `${remove ? 'Removed' : 'Added'} **${fmt(amount)}** ${
              remove ? 'from' : 'to'
            } ${changed} member(s) in ${role}.`,
          ),
      ],
    })
    return true
  }

  // member variants: <@user> <amount>
  const target = msg.mentions.users.first()
  const tokens = args.trim().split(/\s+/).filter(Boolean)
  const amount = parseAmount(tokens[tokens.length - 1] ?? '')
  if (!target || amount == null) {
    await msg.reply(`Usage: \`nd!${remove ? 'remove' : 'add'}-money @user <amount>\``)
    return true
  }
  const rec = await addBalance(target.id, sign * amount)
  await msg.reply({
    embeds: [
      ndEmbed()
        .setTitle(remove ? 'Money removed' : 'Money added')
        .setDescription(
          `${remove ? 'Removed' : 'Added'} **${fmt(amount)}** ${
            remove ? 'from' : 'to'
          } ${target}.\nNew wallet: **${fmt(rec.balance)}**`,
        ),
    ],
  })
  return true
}
