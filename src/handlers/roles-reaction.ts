import { Events, type Client } from 'discord.js'
import { getAllReactionRoles } from '../services/roles-config.ts'

export function registerReactionRoles(client: Client): void {
  client.on(Events.MessageReactionAdd, async (reaction, user) => {
    if (user.bot) return
    try {
      if (reaction.partial) await reaction.fetch()
    } catch {
      return
    }
    const msg = reaction.message
    if (!msg.guild) return
    const emoji = reaction.emoji.id
      ? `<:${reaction.emoji.name}:${reaction.emoji.id}>`
      : reaction.emoji.name ?? ''
    const entries = await getAllReactionRoles()
    const match = entries.find(
      (e) =>
        e.messageId === msg.id &&
        e.guildId === msg.guild.id &&
        (e.emoji === emoji || e.emoji === reaction.emoji.name),
    )
    if (!match) return
    try {
      const member = await msg.guild.members.fetch(user.id)
      const role = await msg.guild.roles.fetch(match.roleId)
      if (role && member.manageable) await member.roles.add(role)
    } catch (e) {
      console.error('[roles]', e)
    }
  })

  client.on(Events.MessageReactionRemove, async (reaction, user) => {
    if (user.bot) return
    try {
      if (reaction.partial) await reaction.fetch()
    } catch {
      return
    }
    const msg = reaction.message
    if (!msg.guild) return
    const emoji = reaction.emoji.id
      ? `<:${reaction.emoji.name}:${reaction.emoji.id}>`
      : reaction.emoji.name ?? ''
    const entries = await getAllReactionRoles()
    const match = entries.find(
      (e) =>
        e.messageId === msg.id &&
        e.guildId === msg.guild.id &&
        (e.emoji === emoji || e.emoji === reaction.emoji.name),
    )
    if (!match) return
    try {
      const member = await msg.guild.members.fetch(user.id)
      const role = await msg.guild.roles.fetch(match.roleId)
      if (role && member.manageable) await member.roles.remove(role)
    } catch (e) {
      console.error('[roles]', e)
    }
  })
}
