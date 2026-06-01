/**
 * Economy Shop
 * Items members can buy with NDC.
 * Data: data/shop.json
 */

import type { Client } from 'discord.js'
import { readJson, writeJson } from './data-store.ts'
import { addBalance, getBalance } from './economy-store.ts'

const FILE = 'shop.json'

export type ShopItemType = 'role' | 'item'

export type ShopItem = {
  id: string
  name: string
  description: string
  price: number
  type: ShopItemType
  roleId?: string | undefined // if type === 'role', the Discord role to assign
  stock?: number | undefined // undefined = unlimited; 0 = sold out
  emoji?: string | undefined
  createdAt: number
}

type ShopStore = { items: ShopItem[] }

let cache: ShopStore | null = null

async function store(): Promise<ShopStore> {
  if (cache) return cache
  cache = await readJson<ShopStore>(FILE, { items: [] })
  return cache!
}

async function save(s: ShopStore): Promise<void> {
  cache = s
  await writeJson(FILE, s)
}

function newId(): string {
  return Math.random().toString(36).slice(2, 8)
}

export async function listShopItems(): Promise<ShopItem[]> {
  const s = await store()
  return s.items.filter((i) => i.stock === undefined || i.stock > 0)
}

export async function getAllShopItems(): Promise<ShopItem[]> {
  return (await store()).items
}

export async function addShopItem(item: Omit<ShopItem, 'id' | 'createdAt'>): Promise<ShopItem> {
  const s = await store()
  const full: ShopItem = { ...item, id: newId(), createdAt: Date.now() }
  s.items.push(full)
  await save(s)
  return full
}

export async function removeShopItem(id: string): Promise<boolean> {
  const s = await store()
  const idx = s.items.findIndex((i) => i.id === id)
  if (idx === -1) return false
  s.items.splice(idx, 1)
  await save(s)
  return true
}

export async function updateShopItem(
  id: string,
  patch: Partial<ShopItem>,
): Promise<ShopItem | null> {
  const s = await store()
  const item = s.items.find((i) => i.id === id)
  if (!item) return null
  Object.assign(item, patch)
  await save(s)
  return { ...item }
}

export type PurchaseResult =
  | { ok: true; item: ShopItem; newBalance: number }
  | { ok: false; reason: string }

export async function purchaseItem(
  client: Client,
  guildId: string,
  userId: string,
  itemId: string,
): Promise<PurchaseResult> {
  const s = await store()
  const item = s.items.find((i) => i.id === itemId)
  if (!item) return { ok: false, reason: 'Item not found.' }
  if (item.stock === 0) return { ok: false, reason: 'This item is sold out.' }

  const rec = await getBalance(userId)
  if (rec.balance < item.price) {
    return {
      ok: false,
      reason: `You need **${item.price.toLocaleString()} NDC** but only have **${rec.balance.toLocaleString()} NDC**.`,
    }
  }

  // Deduct balance
  const updated = await addBalance(userId, -item.price)

  // Decrement stock if limited
  if (item.stock !== undefined) {
    item.stock = Math.max(0, item.stock - 1)
    await save(s)
  }

  // If it's a role item, assign the role
  if (item.type === 'role' && item.roleId) {
    const guild = client.guilds.cache.get(guildId)
    if (guild) {
      const member = await guild.members.fetch(userId).catch(() => null)
      if (member) {
        await member.roles.add(item.roleId, `Bought from shop: ${item.name}`).catch(() => {})
      }
    }
  }

  return { ok: true, item, newBalance: updated.balance }
}
