import { createCanvas, loadImage } from '@napi-rs/canvas'
import { getDb } from './nd-db.ts'

export interface ReceiptCardData {
  userId: string
  username: string
  avatarUrl: string
  title: string
  description: string
  amount: number
  balance: number
  isSuccess: boolean
}

/**
 * Generates a gorgeous, high-fidelity 600x150 transaction receipt banner.
 */
export async function generateReceiptCard(data: ReceiptCardData): Promise<Buffer> {
  const canvas = createCanvas(600, 150)
  const ctx = canvas.getContext('2d')

  // 1. Theme Configuration
  const isPositive = data.amount >= 0
  const themeColor = data.isSuccess
    ? isPositive
      ? '#10b981'
      : '#60a5fa' // Green for reward, Blue for zero/info
    : '#f87171' // Crimson for caught/fines

  const bgGradientStart = '#080914'
  const bgGradientEnd = '#121427'

  // 2. Draw Background Gradient
  const grad = ctx.createLinearGradient(0, 0, 600, 150)
  grad.addColorStop(0, bgGradientStart)
  grad.addColorStop(1, bgGradientEnd)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, 600, 150)

  // 3. Draw Rounded Accent Border
  ctx.strokeStyle = themeColor + '30' // 20% opacity
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.roundRect(8, 8, 584, 134, 10)
  ctx.stroke()

  // Draw a subtle left accent vertical bar
  ctx.fillStyle = themeColor
  ctx.beginPath()
  ctx.roundRect(8, 8, 6, 134, { topLeft: 10, bottomLeft: 10, topRight: 0, bottomRight: 0 })
  ctx.fill()

  // 4. Draw Avatar with rounded clipping mask
  const avatarX = 32
  const avatarY = 30
  const avatarSize = 90

  ctx.save()
  ctx.beginPath()
  ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2)
  ctx.clip()

  try {
    if (data.avatarUrl) {
      const avatarImg = await loadImage(data.avatarUrl)
      ctx.drawImage(avatarImg, avatarX, avatarY, avatarSize, avatarSize)
    } else {
      throw new Error()
    }
  } catch {
    // Fallback initials
    ctx.fillStyle = themeColor
    ctx.fillRect(avatarX, avatarY, avatarSize, avatarSize)
    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 36px Arial'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(
      data.username.slice(0, 2).toUpperCase(),
      avatarX + avatarSize / 2,
      avatarY + avatarSize / 2,
    )
  }
  ctx.restore()

  // Inner avatar ring border
  ctx.strokeStyle = '#ffffff20'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2)
  ctx.stroke()

  // 5. Draw Metadata Block
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'

  // Title / Action Type
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 15px Arial'
  ctx.fillText(data.title.toUpperCase(), 142, 48)

  // Description Detail text
  ctx.fillStyle = '#94a3b8'
  ctx.font = '13px Arial'
  const desc = data.description
  if (ctx.measureText(desc).width > 280) {
    ctx.fillText(desc.slice(0, 42) + '...', 142, 76)
  } else {
    ctx.fillText(desc, 142, 76)
  }

  // Serial hash receipt index (looks high-tech and futuristic)
  const pseudoHash = `TX-${data.userId.slice(-4)}-${Math.floor(Math.random() * 90000 + 10000)}`
  ctx.fillStyle = '#475569'
  ctx.font = 'bold 11px Courier New'
  ctx.fillText(pseudoHash, 142, 108)

  // 6. Draw Right-Side Payout Pill
  const pillWidth = 126
  const pillHeight = 36
  const pillX = 442
  const pillY = 40

  // Pill Capsule BG
  ctx.fillStyle = themeColor + '1a' // 10% opacity
  ctx.beginPath()
  ctx.roundRect(pillX, pillY, pillWidth, pillHeight, 18)
  ctx.fill()

  // Pill Capsule Border
  ctx.strokeStyle = themeColor + '50' // 30% opacity
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.roundRect(pillX, pillY, pillWidth, pillHeight, 18)
  ctx.stroke()

  // Pill Value Text
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = themeColor
  ctx.font = 'bold 14px Arial'

  const amtFormatted = Math.abs(data.amount).toLocaleString()
  const sign = data.amount > 0 ? '+' : data.amount < 0 ? '-' : ''
  ctx.fillText(`${sign}${amtFormatted} NDC`, pillX + pillWidth / 2, pillY + pillHeight / 2)

  // 7. Draw Current Balance under the Pill
  ctx.fillStyle = '#64748b'
  ctx.font = '11px Arial'
  ctx.fillText(
    `BAL: ${data.balance.toLocaleString()} NDC`,
    pillX + pillWidth / 2,
    pillY + pillHeight / 2 + 36,
  )

  return canvas.toBuffer('image/png')
}
