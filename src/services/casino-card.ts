import { createCanvas } from '@napi-rs/canvas'

export interface BlackjackCardData {
  username: string
  playerHand: string[]
  dealerHand: string[]
  playerScore: number
  dealerScore: number
  bet: number
  status: 'playing' | 'won' | 'lost' | 'push'
}

/**
 * Procedurally generates a high-fidelity 600x350 Blackjack table banner.
 */
export async function generateBlackjackCard(data: BlackjackCardData): Promise<Buffer> {
  const canvas = createCanvas(600, 350)
  const ctx = canvas.getContext('2d')

  // Theme Configuration
  let themeColor = '#60a5fa' // playing (blue)
  if (data.status === 'won') themeColor = '#10b981'
  if (data.status === 'lost') themeColor = '#f87171'
  if (data.status === 'push') themeColor = '#fbbf24'

  const bgGradientStart = '#080914'
  const bgGradientEnd = '#121427'

  // Draw Background
  const grad = ctx.createLinearGradient(0, 0, 600, 350)
  grad.addColorStop(0, bgGradientStart)
  grad.addColorStop(1, bgGradientEnd)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, 600, 350)

  // Draw Rounded Accent Border
  ctx.strokeStyle = themeColor + '30'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.roundRect(8, 8, 584, 334, 10)
  ctx.stroke()

  // Draw a subtle left accent vertical bar
  ctx.fillStyle = themeColor
  ctx.beginPath()
  ctx.roundRect(8, 8, 6, 334, [10, 0, 0, 10])
  ctx.fill()

  // Header
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 20px Arial'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText('NIGHTZ CASINO - BLACKJACK', 30, 24)

  ctx.fillStyle = '#94a3b8'
  ctx.font = '14px Arial'
  let statusText = 'GAME IN PROGRESS'
  if (data.status === 'won') statusText = 'YOU WON!'
  if (data.status === 'lost') statusText = 'DEALER WINS'
  if (data.status === 'push') statusText = 'PUSH (TIE)'
  ctx.fillText(`STATUS: ${statusText}   BET: ${data.bet.toLocaleString()} NDC`, 30, 50)

  // Helper function to draw a single playing card
  const drawCard = (x: number, y: number, card: string, isHidden = false) => {
    const cardWidth = 60
    const cardHeight = 85

    // Card shadow
    ctx.fillStyle = 'rgba(0,0,0,0.3)'
    ctx.beginPath()
    ctx.roundRect(x + 2, y + 2, cardWidth, cardHeight, 6)
    ctx.fill()

    if (isHidden) {
      // Draw card back
      const backGrad = ctx.createLinearGradient(x, y, x + cardWidth, y + cardHeight)
      backGrad.addColorStop(0, '#1e293b')
      backGrad.addColorStop(1, '#0f172a')
      ctx.fillStyle = backGrad
      ctx.beginPath()
      ctx.roundRect(x, y, cardWidth, cardHeight, 6)
      ctx.fill()

      ctx.strokeStyle = '#334155'
      ctx.lineWidth = 2
      ctx.stroke()

      ctx.fillStyle = '#475569'
      ctx.font = 'bold 24px Arial'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('?', x + cardWidth / 2, y + cardHeight / 2)
      return
    }

    // Card face
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.roundRect(x, y, cardWidth, cardHeight, 6)
    ctx.fill()

    ctx.strokeStyle = '#cbd5e1'
    ctx.lineWidth = 1
    ctx.stroke()

    const val = card.slice(0, -1)
    const suitCode = card.slice(-1)

    let suit = ''
    let color = '#0f172a'
    if (suitCode === 'S') {
      suit = '♠'
      color = '#0f172a'
    }
    if (suitCode === 'H') {
      suit = '♥'
      color = '#ef4444'
    }
    if (suitCode === 'D') {
      suit = '♦'
      color = '#ef4444'
    }
    if (suitCode === 'C') {
      suit = '♣'
      color = '#0f172a'
    }

    ctx.fillStyle = color
    ctx.font = 'bold 18px Arial'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillText(val, x + 6, y + 6)

    ctx.font = '24px Arial'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(suit, x + cardWidth / 2, y + cardHeight / 2 + 4)
  }

  // Draw Dealer Area
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 16px Arial'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText('DEALER', 30, 90)

  if (data.status === 'playing') {
    ctx.fillStyle = '#64748b'
    ctx.font = '14px Arial'
    ctx.fillText('Score: ?', 110, 92)
  } else {
    ctx.fillStyle = '#64748b'
    ctx.font = '14px Arial'
    ctx.fillText(`Score: ${data.dealerScore}`, 110, 92)
  }

  // Dealer Cards
  for (let i = 0; i < data.dealerHand.length; i++) {
    const isHidden = data.status === 'playing' && i === 1
    drawCard(30 + i * 70, 120, data.dealerHand[i] ?? '', isHidden)
  }

  // Draw Player Area
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 16px Arial'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText(data.username.toUpperCase(), 30, 220)

  ctx.fillStyle = '#64748b'
  ctx.font = '14px Arial'
  ctx.fillText(
    `Score: ${data.playerScore}`,
    30 + ctx.measureText(data.username.toUpperCase()).width + 10,
    222,
  )

  // Player Cards
  for (let i = 0; i < data.playerHand.length; i++) {
    drawCard(30 + i * 70, 250, data.playerHand[i] ?? '')
  }

  return canvas.toBuffer('image/png')
}
