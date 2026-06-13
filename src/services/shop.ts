/**
 * Economy Shop slash command handlers
 */
import {
  type ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js'
import {
  addShopItem,
  getAllShopItems,
  listShopItems,
  purchaseItem,
  removeShopItem,
  type ShopItem,
  updateShopItem,
} from './shop-store.ts'

function itemEmbed(item: ShopItem, guild?: { name: string } | null) {
  const e = new EmbedBuilder()
    .setColor(0xf5c542)
    .setTitle(`[SHOP_ITEM] ${item.name}`)
    .setDescription(item.description || 'No description.')
    .addFields(
      { name: 'Price', value: `**${item.price.toLocaleString()} NDC**`, inline: true },
      {
        name: 'Type',
        value: item.type === 'role' ? '[ROLE] Role reward' : '[ITEM] Item',
        inline: true,
      },
    )
  if (item.roleId) e.addFields({ name: 'Grants role', value: `<@&${item.roleId}>`, inline: true })
  if (item.stock !== undefined)
    e.addFields({
      name: 'Stock',
      value: item.stock === 0 ? '[SOLD_OUT] Sold out' : `${item.stock}`,
      inline: true,
    })
  e.setFooter({ text: `ID: ${item.id}` })
  return e
}

export async function handleShopSlash(interaction: ChatInputCommandInteraction): Promise<boolean> {
  if (interaction.commandName !== 'shop') return false

  const sub = interaction.options.getSubcommand(true)

  if (sub === 'list') {
    const items = await listShopItems()
    if (!items.length) {
      await interaction.reply({
        content: 'The shop has no items yet. Staff can add them with `/shop add`.',
        flags: MessageFlags.Ephemeral,
      })
      return true
    }
    const lines = items.map((i) => {
      const stock = i.stock !== undefined ? ` · Stock: ${i.stock}` : ''
      const roleTag = i.roleId ? ` · <@&${i.roleId}>` : ''
      return `**[ITEM] ${i.name}**: **${i.price.toLocaleString()} NDC**${roleTag}${stock}\n> ${i.description || 'No description.'}\n> ID: \`${i.id}\``
    })
    const embed = new EmbedBuilder()
      .setColor(0xf5c542)
      .setTitle('[SHOP] NDC Shop')
      .setDescription(lines.join('\n\n').slice(0, 4000))
      .setFooter({ text: 'Buy with /shop buy <id>' })
    await interaction.reply({ embeds: [embed] })
    return true
  }

  if (sub === 'buy') {
    if (!interaction.guild) {
      await interaction.reply({ content: 'Use this in a server.', flags: MessageFlags.Ephemeral })
      return true
    }
    const itemId = interaction.options.getString('id', true).trim()
    await interaction.deferReply({ flags: MessageFlags.Ephemeral })
    const result = await purchaseItem(
      interaction.client,
      interaction.guild.id,
      interaction.user.id,
      itemId,
    )
    if (!result.ok) {
      await interaction.editReply(result.reason)
      return true
    }
    const { item, newBalance } = result

    try {
      const { generateLootCard } = await import('./loot-cards.ts')
      const buffer = await generateLootCard({
        itemName: item.name,
        itemDescription: item.description || '',
        itemType: item.type,
        price: item.price,
        balance: newBalance,
        roleId: item.roleId,
      })
      const { AttachmentBuilder } = await import('discord.js')
      const file = new AttachmentBuilder(buffer, { name: `purchase-${interaction.user.id}.png` })
      await interaction.editReply({ files: [file] })
    } catch (err) {
      console.error('[shop] Error drawing purchase card, falling back to embed:', err)
      const embed = new EmbedBuilder()
        .setColor(0x34d399)
        .setTitle('[SUCCESS] Purchase successful!')
        .setDescription(`You bought **${item.name}** for **${item.price.toLocaleString()} NDC**.`)
        .addFields({
          name: 'Remaining balance',
          value: `${newBalance.toLocaleString()} NDC`,
          inline: true,
        })
      if (item.type === 'role' && item.roleId) {
        embed.addFields({ name: 'Role added', value: `<@&${item.roleId}>`, inline: true })
      }
      await interaction.editReply({ embeds: [embed] })
    }

    // Broadcast purchase to dashboard activity feed
    try {
      const { broadcastActivity } = await import('../dashboard/websocket.ts')
      broadcastActivity('shop_purchase', {
        userId: interaction.user.id,
        username: interaction.user.username,
        displayName:
          interaction.member && 'displayName' in interaction.member
            ? (interaction.member as any).displayName
            : interaction.user.username,
        itemName: item.name,
        itemEmoji: item.emoji ?? null,
        price: item.price,
        newBalance,
      })
    } catch {
      /* ignore */
    }

    return true
  }

  // Staff-only commands below
  if (!interaction.guild) {
    await interaction.reply({ content: 'Use in a server.', flags: MessageFlags.Ephemeral })
    return true
  }
  const member = await interaction.guild.members.fetch(interaction.user.id)
  if (!member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({ content: 'Manage Server required.', flags: MessageFlags.Ephemeral })
    return true
  }

  if (sub === 'add') {
    const name = interaction.options.getString('name', true).trim()
    const price = interaction.options.getInteger('price', true)
    const description = interaction.options.getString('description') ?? ''
    const role = interaction.options.getRole('role')
    const stock = interaction.options.getInteger('stock') ?? undefined
    const emoji = interaction.options.getString('emoji') ?? undefined

    const item = await addShopItem({
      name,
      price,
      description,
      type: role ? 'role' : 'item',
      roleId: role?.id,
      stock,
      emoji,
    })
    await interaction.reply({
      content: `[SUCCESS] Added **${item.name}** to the shop (ID: \`${item.id}\`).`,
      embeds: [itemEmbed(item)],
      flags: MessageFlags.Ephemeral,
    })
    return true
  }

  if (sub === 'remove') {
    const id = interaction.options.getString('id', true).trim()
    const removed = await removeShopItem(id)
    await interaction.reply({
      content: removed
        ? `Removed item \`${id}\` from the shop.`
        : `No item found with ID \`${id}\`.`,
      flags: MessageFlags.Ephemeral,
    })
    return true
  }

  if (sub === 'edit') {
    const id = interaction.options.getString('id', true).trim()
    const patch: Record<string, unknown> = {}
    const name = interaction.options.getString('name')
    const price = interaction.options.getInteger('price')
    const description = interaction.options.getString('description')
    const stock = interaction.options.getInteger('stock')
    const emoji = interaction.options.getString('emoji')
    if (name) patch.name = name
    if (price !== null) patch.price = price
    if (description !== null) patch.description = description
    if (stock !== null) patch.stock = stock
    if (emoji) patch.emoji = emoji
    const updated = await updateShopItem(id, patch)
    if (!updated) {
      await interaction.reply({
        content: `No item found with ID \`${id}\`.`,
        flags: MessageFlags.Ephemeral,
      })
      return true
    }
    await interaction.reply({
      content: `Updated item \`${id}\`.`,
      embeds: [itemEmbed(updated)],
      flags: MessageFlags.Ephemeral,
    })
    return true
  }

  if (sub === 'manage') {
    const items = await getAllShopItems()
    if (!items.length) {
      await interaction.reply({
        content: 'No items in the shop yet.',
        flags: MessageFlags.Ephemeral,
      })
      return true
    }
    const lines = items.map((i) => {
      const stock =
        i.stock !== undefined
          ? ` · ${i.stock === 0 ? '[SOLD_OUT] sold out' : `${i.stock} left`}`
          : ' · unlimited'
      return `\`${i.id}\` **${i.name}**: ${i.price.toLocaleString()} NDC${stock}`
    })
    await interaction.reply({
      content: `**Shop items (${items.length}):**\n${lines.join('\n')}\n\nEdit with \`/shop edit id:<id>\` · Remove with \`/shop remove id:<id>\``,
      flags: MessageFlags.Ephemeral,
    })
    return true
  }

  return true
}
