import { ChannelType, type GuildMember, type Message, PermissionFlagsBits } from 'discord.js'
import { modRoleIds } from '../config.ts'

export function isGuildMod(member: GuildMember | null): boolean {
  if (!member) return false
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true
  if (member.permissions.has(PermissionFlagsBits.ManageGuild)) return true
  if (member.permissions.has(PermissionFlagsBits.ModerateMembers)) return true
  for (const id of modRoleIds) {
    if (member.roles.cache.has(id)) return true
  }
  return false
}

export function isModMessage(msg: Message): boolean {
  if (msg.channel.type === ChannelType.DM) return false
  const m = msg.member
  return isGuildMod(m)
}
