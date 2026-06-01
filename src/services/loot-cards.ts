import { createCanvas } from '@napi-rs/canvas'

export interface LootCardData {
  itemName: string
  itemDescription: string
  itemType: string
  price: number
  balance: number
  roleId?: string | null | undefined
}

/**
 * Procedurally draws a gorgeous 600x400 item box / loot capsule opening card
 */
export async function generateLootCard(data: LootCardData): Promise<Buffer> {
  const width = 600
  const height = 400
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')

  // 1. Determine Rarity Class based on Price
  let rarityName = 'COMMON'
  let rarityColor = '#64748b' // Slate
  if (data.price >= 5000) {
    rarityName = 'LEGENDARY'
    rarityColor = '#fbbf24' // Gold
  } else if (data.price >= 2000) {
    rarityName = 'EPIC'
    rarityColor = '#a78bfa' // Electric Violet
  } else if (data.price >= 500) {
    rarityName = 'RARE'
    rarityColor = '#60a5fa' // Cobalt Blue
  }

  // 2. Draw Deep Space Background
  const bgGrad = ctx.createLinearGradient(0, 0, width, height)
  bgGrad.addColorStop(0, '#060713')
  bgGrad.addColorStop(1, '#0e1022')
  ctx.fillStyle = bgGrad
  ctx.fillRect(0, 0, width, height)

  // 3. Draw Radial Neon Rarity Glow in the Center
  const glowX = width / 2
  const glowY = height / 2 - 20
  const radialGlow = ctx.createRadialGradient(glowX, glowY, 20, glowX, glowY, 180)
  radialGlow.addColorStop(0, rarityColor + '3d') // 24% opacity
  radialGlow.addColorStop(0.5, rarityColor + '10') // 6% opacity
  radialGlow.addColorStop(1, 'rgba(6, 7, 19, 0)')
  ctx.fillStyle = radialGlow
  ctx.fillRect(0, 0, width, height)

  // 4. Subtle Outer Accent Gridlines (Monospace Style)
  ctx.strokeStyle = '#ffffff0a'
  ctx.lineWidth = 1
  ctx.beginPath()
  // Draw vertical guides
  ctx.moveTo(100, 0)
  ctx.lineTo(100, height)
  ctx.moveTo(width - 100, 0)
  ctx.lineTo(width - 100, height)
  // Draw horizontal guides
  ctx.moveTo(0, 80)
  ctx.lineTo(width, 80)
  ctx.moveTo(0, height - 80)
  ctx.lineTo(width, height - 80)
  ctx.stroke()

  // 5. Draw the Center Stylized Item Card
  const cardW = 260
  const cardH = 310
  const cardX = (width - cardW) / 2
  const cardY = (height - cardH) / 2 - 10

  // Card Background (Ultra-dark glassmorphism)
  ctx.fillStyle = '#0a0c1a'
  ctx.beginPath()
  ctx.roundRect(cardX, cardY, cardW, cardH, 14)
  ctx.fill()

  // Card Inner Border (Glow aligned with rarity)
  ctx.strokeStyle = rarityColor + '4d' // 30% opacity
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.roundRect(cardX, cardY, cardW, cardH, 14)
  ctx.stroke()

  // Card Header Pill
  const headW = 120
  const headH = 22
  ctx.fillStyle = rarityColor + '1a' // 10% opacity
  ctx.beginPath()
  ctx.roundRect(cardX + (cardW - headW) / 2, cardY + 16, headW, headH, 11)
  ctx.fill()

  ctx.strokeStyle = rarityColor + '50'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.roundRect(cardX + (cardW - headW) / 2, cardY + 16, headW, headH, 11)
  ctx.stroke()

  ctx.fillStyle = rarityColor
  ctx.font = 'bold 10px Courier New'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(rarityName, cardX + cardW / 2, cardY + 16 + headH / 2)

  // 6. Draw Procedural Tech Ring in center of card (representing item container)
  const ringX = cardX + cardW / 2
  const ringY = cardY + 120
  const ringRadius = 45

  // Outer segmented rings
  ctx.strokeStyle = '#ffffff0f'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(ringX, ringY, ringRadius, 0, Math.PI * 2)
  ctx.stroke()

  ctx.strokeStyle = rarityColor + '80'
  ctx.lineWidth = 2.5
  ctx.beginPath()
  ctx.arc(ringX, ringY, ringRadius - 6, -Math.PI / 4, Math.PI / 2)
  ctx.stroke()

  // Inner core glow
  const innerGlow = ctx.createRadialGradient(ringX, ringY, 5, ringX, ringY, ringRadius - 12)
  innerGlow.addColorStop(0, rarityColor + '50')
  innerGlow.addColorStop(1, 'rgba(10, 12, 26, 0)')
  ctx.fillStyle = innerGlow
  ctx.beginPath()
  ctx.arc(ringX, ringY, ringRadius - 12, 0, Math.PI * 2)
  ctx.fill()

  // 7. Write Item Information Inside Card
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'

  // Item Title
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 15px Arial'
  const displayName = data.itemName.toUpperCase()
  if (ctx.measureText(displayName).width > cardW - 30) {
    ctx.fillText(displayName.slice(0, 20) + '...', cardX + cardW / 2, cardY + 205)
  } else {
    ctx.fillText(displayName, cardX + cardW / 2, cardY + 205)
  }

  // Item Type Subtitle
  ctx.fillStyle = '#64748b'
  ctx.font = 'bold 9px Courier New'
  const itemTypeTag = data.roleId ? '[ROLE REWARD]' : '[INVENTORY ITEM]'
  ctx.fillText(itemTypeTag, cardX + cardW / 2, cardY + 222)

  // Item Description
  ctx.fillStyle = '#94a3b8'
  ctx.font = '11px Arial'
  const desc = data.itemDescription || 'No description provided.'
  if (ctx.measureText(desc).width > cardW - 40) {
    ctx.fillText(desc.slice(0, 32) + '...', cardX + cardW / 2, cardY + 248)
  } else {
    ctx.fillText(desc, cardX + cardW / 2, cardY + 248)
  }

  // Price tag capsule
  const priceTag = `${data.price.toLocaleString()} NDC`
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 13px Arial'
  ctx.fillText(priceTag, cardX + cardW / 2, cardY + 282)

  // 8. Draw Receipt / Balance details at the bottom of the banner (outside the card)
  ctx.fillStyle = '#475569'
  ctx.font = 'bold 10px Courier New'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  const serial = `ITEM-RC-${Math.floor(Math.random() * 900000 + 100000)}`
  ctx.fillText(`SERIAL: ${serial}`, 32, height - 32)

  ctx.textAlign = 'right'
  ctx.fillStyle = '#64748b'
  ctx.font = '11px Arial'
  ctx.fillText(`REMAINING BAL: ${data.balance.toLocaleString()} NDC`, width - 32, height - 32)

  // Header Title of the whole banner
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 13px Arial'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillText('NIGHTZ SHOP REGISTRATION', width / 2, 22)

  return canvas.toBuffer('image/png')
}
