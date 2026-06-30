/**
 * Self-assignable roles and auto-roles on join.
 *
 *   nd!self-role add|remove|list <role>   (staff) manage the self-assign list
 *   nd!iam <role>  / nd!join-role <role>   member grants themselves a self-role
 *   nd!iamnot <role> / nd!leave-role <role> member removes a self-role
 *   nd!roles                                list the self-assignable roles
 *   nd!auto-role add|remove|list <role>    (staff) roles auto-given on join
 *
 * Only roles an admin added to the self-role list can be self-assigned, so a
 * member can never grant themselves staff. Stored per guild in role-settings.json.
 */
import {
  type Client,
  Events,
  type Guild,
  type GuildMember,
  type Message,
  PermissionFlagsBits,
  type Role,
} from 'discord.js'
import { readJson, writeJson } from './data-store.ts'
import { ndEmbed } from '../utils/embed.ts'
import { isGuildMod } from '../utils/permissions.ts'

interface GuildRoleSettings {
  selfRoleIds: string[]
  autoRoleIds: string[]
}
type Store = Record<string, GuildRoleSettings>

const FILE = 'role-settings.json'
let cache: Store | null = null

async function load(): Promise<Store> {
  if (!cache) cache = await readJson<Store>(FILE, {})
  return cache
}
function blank(): GuildRoleSettings {
  return { selfRoleIds: [], autoRoleIds: [] }
}
async function getSettings(guildId: string): Promise<GuildRoleSettings> {
  return { ...blank(), ...(await load())[guildId] }
}
async function save(guildId: string, next: GuildRoleSettings): Promise<void> {
  const store = await load()
  store[guildId] = next
  await writeJson(FILE, store)
}

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

/** The bot can only hand out a role that sits below its own highest role. */
function botCanManage(guild: Guild, role: Role): boolean {
  const me = guild.members.me
  return !!me && !role.managed && role.id !== guild.id && me.roles.highest.position > role.position
}

async function requireStaff(msg: Message): Promise<GuildMember | null> {
  const member = msg.member ?? (await msg.guild?.members.fetch(msg.author.id).catch(() => null)) ?? null
  if (!isGuildMod(member)) {
    await msg.reply('You need staff permissions to manage roles.')
    return null
  }
  return member
}

// ---- command dispatch -----------------------------------------------------

export async function handleRoleSettingsCommand(
  msg: Message,
  cmd: string,
  args: string,
): Promise<boolean> {
  const selfAdmin = cmd === 'self-role' || cmd === 'selfrole'
  const autoAdmin = cmd === 'auto-role' || cmd === 'autorole'
  const join = cmd === 'iam' || cmd === 'join-role' || cmd === 'joinrole'
  const leave = cmd === 'iamnot' || cmd === 'leave-role' || cmd === 'leaverole'
  const listSelf = cmd === 'roles' || cmd === 'self-roles' || cmd === 'selfroles'
  if (!selfAdmin && !autoAdmin && !join && !leave && !listSelf) return false

  if (!msg.guild) {
    await msg.reply('Use this in a server.')
    return true
  }
  const guild = msg.guild

  if (listSelf) {
    const { selfRoleIds } = await getSettings(guild.id)
    const names = selfRoleIds.map((id) => `<@&${id}>`).join(', ')
    await msg.reply({
      embeds: [
        ndEmbed()
          .setTitle('Self-assignable roles')
          .setDescription(
            names
              ? `${names}\n\nUse \`nd!iam <role>\` to get one, \`nd!iamnot <role>\` to remove it.`
              : 'No self-assignable roles are set up yet.',
          ),
      ],
    })
    return true
  }

  if (join || leave) {
    if (!args.trim()) {
      await msg.reply(`Usage: \`nd!${join ? 'iam' : 'iamnot'} <role>\``)
      return true
    }
    const role = resolveRole(guild, args)
    if (!role) {
      await msg.reply(`Could not find a role matching "${args.trim()}".`)
      return true
    }
    const { selfRoleIds } = await getSettings(guild.id)
    if (!selfRoleIds.includes(role.id)) {
      await msg.reply('That role is not self-assignable. See `nd!roles` for the list.')
      return true
    }
    if (!botCanManage(guild, role)) {
      await msg.reply('I cannot manage that role. Move my role above it and try again.')
      return true
    }
    const member = msg.member ?? (await guild.members.fetch(msg.author.id).catch(() => null))
    if (!member) {
      await msg.reply('Could not resolve your membership.')
      return true
    }
    try {
      if (join) {
        await member.roles.add(role, 'self-role')
        await msg.reply(`You now have **${role.name}**.`)
      } else {
        await member.roles.remove(role, 'self-role')
        await msg.reply(`Removed **${role.name}** from you.`)
      }
    } catch {
      await msg.reply('Failed to update your roles. Check my permissions.')
    }
    return true
  }

  // Admin: self-role / auto-role add|remove|list
  const member = await requireStaff(msg)
  if (!member) return true

  const tokens = args.trim().split(/\s+/).filter(Boolean)
  const action = (tokens[0] ?? '').toLowerCase()
  const roleQuery = tokens.slice(1).join(' ')
  const which = selfAdmin ? 'self' : 'auto'
  const verbCmd = selfAdmin ? 'self-role' : 'auto-role'

  if (action === 'list' || !action) {
    const s = await getSettings(guild.id)
    const ids = which === 'self' ? s.selfRoleIds : s.autoRoleIds
    const names = ids.map((id) => `<@&${id}>`).join(', ')
    await msg.reply({
      embeds: [
        ndEmbed()
          .setTitle(which === 'self' ? 'Self-assignable roles' : 'Auto-roles on join')
          .setDescription(names || 'None set.'),
      ],
    })
    return true
  }

  if (action !== 'add' && action !== 'remove') {
    await msg.reply(`Usage: \`nd!${verbCmd} <add|remove|list> <role>\``)
    return true
  }
  if (!roleQuery) {
    await msg.reply(`Usage: \`nd!${verbCmd} ${action} <role>\``)
    return true
  }
  const role = resolveRole(guild, roleQuery)
  if (!role) {
    await msg.reply(`Could not find a role matching "${roleQuery}".`)
    return true
  }
  if (action === 'add' && !botCanManage(guild, role)) {
    await msg.reply(`I cannot manage **${role.name}**. Move my role above it first.`)
    return true
  }

  const s = await getSettings(guild.id)
  const list = which === 'self' ? s.selfRoleIds : s.autoRoleIds
  const has = list.includes(role.id)
  if (action === 'add') {
    if (has) {
      await msg.reply(`**${role.name}** is already in the ${which}-role list.`)
      return true
    }
    list.push(role.id)
  } else {
    if (!has) {
      await msg.reply(`**${role.name}** is not in the ${which}-role list.`)
      return true
    }
    if (which === 'self') s.selfRoleIds = list.filter((id) => id !== role.id)
    else s.autoRoleIds = list.filter((id) => id !== role.id)
  }
  await save(guild.id, s)
  await msg.reply(
    `${action === 'add' ? 'Added' : 'Removed'} **${role.name}** ${
      action === 'add' ? 'to' : 'from'
    } the ${which}-role list.`,
  )
  return true
}

// ---- auto-role on join ----------------------------------------------------

export function registerAutoRole(client: Client): void {
  client.on(Events.GuildMemberAdd, async (member: GuildMember) => {
    try {
      const { autoRoleIds } = await getSettings(member.guild.id)
      if (autoRoleIds.length === 0) return
      for (const id of autoRoleIds) {
        const role = member.guild.roles.cache.get(id)
        if (role && botCanManage(member.guild, role)) {
          await member.roles.add(role, 'auto-role on join').catch(() => undefined)
        }
      }
    } catch (e) {
      console.error('[auto-role]', e)
    }
  })
}
