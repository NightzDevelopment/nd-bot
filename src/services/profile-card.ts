import { createCanvas, loadImage } from '@napi-rs/canvas'
import { getDb } from './nd-db.ts'

export interface ProfileCardData {
  userId: string
  username: string
  avatarUrl: string
  level: number
  xp: number
  nextLevelXp: number
  messages: number
  reputation: number
  bio: string
  badges: { name: string; icon: string }[]
}

/**
 * Helper to wrap text into multiple lines for the canvas context.
 */
function wrapText(
  ctx: any,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number = 2,
): void {
  const words = text.split(' ')
  let line = ''
  let lineCount = 0

  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + ' '
    const metrics = ctx.measureText(testLine)
    const testWidth = metrics.width
    if (testWidth > maxWidth && n > 0) {
      ctx.fillText(line, x, y)
      line = words[n] + ' '
      y += lineHeight
      lineCount++
      if (lineCount >= maxLines - 1) {
        break
      }
    } else {
      line = testLine
    }
  }
  if (lineCount < maxLines) {
    ctx.fillText(line, x, y)
  }
}

/**
 * Renders a gorgeous 800x250 profile rank card using canvas.
 */
export async function generateProfileCard(data: ProfileCardData): Promise<Buffer> {
  const canvas = createCanvas(800, 250)
  const ctx = canvas.getContext('2d')

  // 1. Fetch custom card configurations from database
  let bgGradientStart = '#1e1e38'
  let bgGradientEnd = '#0f0f1a'
  let borderColor = '#3b82f6'

  try {
    const db = getDb()
    const row = db
      .prepare('SELECT card_customization FROM users_profiles WHERE userId = ?')
      .get(data.userId) as { card_customization: string } | undefined
    if (row && row.card_customization) {
      const custom = JSON.parse(row.card_customization)
      if (custom.bg_gradient) {
        // Parse gradient colors (e.g. from linear-gradient(135deg, #color1, #color2))
        const hexes = custom.bg_gradient.match(/#[0-9a-fA-F]{6}/g)
        if (hexes && hexes.length >= 2) {
          bgGradientStart = hexes[0]
          bgGradientEnd = hexes[1]
        }
      }
      if (custom.border_color) {
        borderColor = custom.border_color
      }
    }
  } catch (e) {
    console.warn('[profile-card] Failed to fetch customization from db:', e)
  }

  // 2. Draw background gradient
  const grad = ctx.createLinearGradient(0, 0, 800, 250)
  grad.addColorStop(0, bgGradientStart)
  grad.addColorStop(1, bgGradientEnd)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, 800, 250)

  // 3. Draw rounded premium border
  ctx.strokeStyle = borderColor
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.roundRect(10, 10, 780, 230, 15)
  ctx.stroke()

  // 4. Draw Avatar with rounded clipping mask
  const avatarX = 40
  const avatarY = 40
  const avatarSize = 170

  ctx.save()
  // Create rounded clipping path
  ctx.beginPath()
  ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2)
  ctx.clip()

  try {
    if (data.avatarUrl) {
      const avatarImg = await loadImage(data.avatarUrl)
      ctx.drawImage(avatarImg, avatarX, avatarY, avatarSize, avatarSize)
    } else {
      throw new Error('No avatar url')
    }
  } catch {
    // Fallback: draw elegant initials placeholder
    ctx.fillStyle = '#2563eb'
    ctx.fillRect(avatarX, avatarY, avatarSize, avatarSize)
    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 70px Arial'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(
      data.username.slice(0, 2).toUpperCase(),
      avatarX + avatarSize / 2,
      avatarY + avatarSize / 2,
    )
  }
  ctx.restore()

  // Draw white border ring around avatar
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2)
  ctx.stroke()

  // Reset text settings
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'

  // 5. Draw Username
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 32px Arial'
  ctx.fillText(data.username, 240, 65)

  // 6. Draw Custom Bio
  ctx.fillStyle = '#94a3b8'
  ctx.font = 'italic 16px Arial'
  const bioText = data.bio || 'Nightz Development Associate'
  wrapText(ctx, bioText, 240, 95, 340, 22, 2)

  // 7. Draw XP Progress Bar
  const barX = 240
  const barY = 150
  const barWidth = 360
  const barHeight = 16
  const fillPercentage =
    data.nextLevelXp > 0 ? Math.max(0, Math.min(1, data.xp / data.nextLevelXp)) : 0

  // Bar Background
  ctx.fillStyle = '#1e293b'
  ctx.beginPath()
  ctx.roundRect(barX, barY, barWidth, barHeight, 8)
  ctx.fill()

  // Bar Fill
  if (fillPercentage > 0) {
    ctx.fillStyle = borderColor
    ctx.beginPath()
    ctx.roundRect(barX, barY, barWidth * fillPercentage, barHeight, 8)
    ctx.fill()
  }

  // XP Text below progress bar
  ctx.fillStyle = '#94a3b8'
  ctx.font = 'bold 12px Arial'
  ctx.fillText(`${data.xp} / ${data.nextLevelXp} XP`, barX, barY + 34)

  // Message and Reputation Mini Stats
  ctx.font = '12px Arial'
  ctx.fillText(`MSG: ${data.messages}`, barX + 160, barY + 34)
  ctx.fillText(`REP: ${data.reputation}`, barX + 260, barY + 34)

  // 8. Draw Level Number (accented)
  ctx.textAlign = 'right'
  ctx.fillStyle = borderColor
  ctx.font = 'bold 55px Arial'
  ctx.fillText(`LVL ${data.level}`, 750, 75)

  // 9. Draw Badges Capsules (right side, aligned cleanly, no emojis)
  ctx.textAlign = 'left'
  const badgeX = 615
  let badgeY = 110
  const maxBadgeCount = 3
  const badgeList = data.badges.slice(0, maxBadgeCount)

  if (badgeList.length > 0) {
    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 12px Arial'
    ctx.fillText('BADGES', 615, 100)

    for (const b of badgeList) {
      // Draw premium badge pill capsule
      const cleanIcon = b.icon.replace(/[[\]]/g, '') // remove brackets if any
      const badgeText = `${cleanIcon} ${b.name}`
      ctx.font = '10px Arial'
      const textWidth = ctx.measureText(badgeText).width
      const capsuleWidth = textWidth + 16
      const capsuleHeight = 22

      // Capsule Background
      ctx.fillStyle = '#1e293b'
      ctx.beginPath()
      ctx.roundRect(badgeX, badgeY, capsuleWidth, capsuleHeight, 11)
      ctx.fill()

      // Capsule Border
      ctx.strokeStyle = '#475569'
      ctx.lineWidth = 1
      ctx.stroke()

      // Capsule Text
      ctx.fillStyle = '#f8fafc'
      ctx.fillText(badgeText, badgeX + 8, badgeY + 14)

      badgeY += 28 // Stack badges vertically
    }
  } else {
    ctx.fillStyle = '#475569'
    ctx.font = 'italic 12px Arial'
    ctx.fillText('No badges unlocked.', 615, 115)
  }

  return canvas.toBuffer('image/png')
}
