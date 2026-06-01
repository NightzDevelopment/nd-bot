/**
 * Virtual simulated stock market service for ND Discord Gemini Bot
 * Developed under strict Nightz Development proprietary standards (no emojis)
 */

import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCanvas } from '@napi-rs/canvas'
import type { Client, TextChannel } from 'discord.js'
import { addBalance, getBalance } from './economy-store.ts'
import { getDb } from './nd-db.ts'
import { incrementQuestProgress } from './quest-manager.ts'

export interface StockRecord {
  symbol: string
  name: string
  price: number
  volatility: number
  lastUpdated: number
}

export interface PortfolioItem {
  symbol: string
  name: string
  shares: number
  avgPrice: number
  currentPrice: number
  totalValue: number
}

const SYMBOLS = ['ND', 'FIVEM', 'GEMINI', 'CLAUDE', 'BITCOIN']

/** Get all stock listings */
export function getStocks(): StockRecord[] {
  const db = getDb()
  const rows = db.prepare('SELECT symbol, name, price, volatility, last_updated FROM stocks').all()
  return rows.map((r: any) => ({
    symbol: r.symbol,
    name: r.name,
    price: r.price,
    volatility: r.volatility,
    lastUpdated: r.last_updated,
  }))
}

/** Get a single stock */
export function getStock(symbol: string): StockRecord | null {
  const db = getDb()
  const r: any = db
    .prepare('SELECT symbol, name, price, volatility, last_updated FROM stocks WHERE symbol = ?')
    .get(symbol.toUpperCase())
  if (!r) return null
  return {
    symbol: r.symbol,
    name: r.name,
    price: r.price,
    volatility: r.volatility,
    lastUpdated: r.last_updated,
  }
}

/** Get a user's stock portfolio */
export function getUserPortfolio(userId: string): PortfolioItem[] {
  const db = getDb()
  // Group transactions to find net owned shares and average cost basis
  const rows = db
    .prepare(`
    SELECT 
      t.symbol,
      s.name,
      SUM(CASE WHEN t.type = 'BUY' THEN t.shares ELSE -t.shares END) as owned_shares,
      SUM(CASE WHEN t.type = 'BUY' THEN t.shares * t.price ELSE 0 END) / 
        NULLIF(SUM(CASE WHEN t.type = 'BUY' THEN t.shares ELSE 0 END), 0) as avg_cost,
      s.price as current_price
    FROM stock_transactions t
    JOIN stocks s ON t.symbol = s.symbol
    WHERE t.user_id = ?
    GROUP BY t.symbol
    HAVING owned_shares > 0
  `)
    .all(userId)

  return rows.map((r: any) => ({
    symbol: r.symbol,
    name: r.name,
    shares: r.owned_shares,
    avgPrice: r.avg_cost ?? 0,
    currentPrice: r.current_price,
    totalValue: r.owned_shares * r.current_price,
  }))
}

/** Buy stock shares */
export async function buyStock(
  userId: string,
  symbol: string,
  shares: number,
): Promise<{ ok: boolean; msg: string }> {
  if (shares <= 0) return { ok: false, msg: 'Shares amount must be greater than zero.' }

  const stock = getStock(symbol)
  if (!stock) return { ok: false, msg: `Stock symbol ${symbol.toUpperCase()} not found.` }

  const cost = stock.price * shares
  const eco = await getBalance(userId)

  if (eco.balance < cost) {
    return {
      ok: false,
      msg: `Insufficient funds. Cost is ${cost.toLocaleString()} NDC, but you only have ${eco.balance.toLocaleString()} NDC.`,
    }
  }

  const db = getDb()
  try {
    db.transaction(() => {
      // Deduct balance
      db.prepare(
        'UPDATE users_economy SET balance = balance - ?, updatedAt = ? WHERE userId = ?',
      ).run(cost, Date.now(), userId)

      // Record transaction
      db.prepare(
        'INSERT INTO stock_transactions (user_id, symbol, shares, type, price, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(userId, stock.symbol, shares, 'BUY', stock.price, Date.now())
    })()

    // Broadcast dashboard economy update
    try {
      const { broadcastActivity } = await import('../dashboard/websocket.ts')
      broadcastActivity('economy_transaction', {
        userId,
        action: `buy_${stock.symbol}`,
        amount: -cost,
        balance: eco.balance - cost,
      })
    } catch {}

    // Increment stock quest progress
    incrementQuestProgress(userId, 'stock', 1)

    return {
      ok: true,
      msg: `Successfully purchased ${shares.toLocaleString()} shares of ${stock.symbol} for ${cost.toLocaleString()} NDC.`,
    }
  } catch (e) {
    console.error('[stocks] buy transaction failed:', e)
    return { ok: false, msg: 'Database transaction error occurred.' }
  }
}

/** Sell stock shares */
export async function sellStock(
  userId: string,
  symbol: string,
  shares: number,
): Promise<{ ok: boolean; msg: string }> {
  if (shares <= 0) return { ok: false, msg: 'Shares amount must be greater than zero.' }

  const stock = getStock(symbol)
  if (!stock) return { ok: false, msg: `Stock symbol ${symbol.toUpperCase()} not found.` }

  const portfolio = getUserPortfolio(userId)
  const item = portfolio.find((p) => p.symbol === stock.symbol)

  if (!item || item.shares < shares) {
    return {
      ok: false,
      msg: `You do not own enough shares of ${stock.symbol}. Owned: ${item ? item.shares.toLocaleString() : 0}.`,
    }
  }

  const payout = stock.price * shares
  const db = getDb()

  try {
    db.transaction(() => {
      // Add balance
      db.prepare(
        'UPDATE users_economy SET balance = balance + ?, totalEarned = totalEarned + ?, updatedAt = ? WHERE userId = ?',
      ).run(payout, payout, Date.now(), userId)

      // Record transaction
      db.prepare(
        'INSERT INTO stock_transactions (user_id, symbol, shares, type, price, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(userId, stock.symbol, shares, 'SELL', stock.price, Date.now())
    })()

    // Broadcast dashboard economy update
    try {
      const { broadcastActivity } = await import('../dashboard/websocket.ts')
      const eco = await getBalance(userId)
      broadcastActivity('economy_transaction', {
        userId,
        action: `sell_${stock.symbol}`,
        amount: payout,
        balance: eco.balance,
      })
    } catch {}

    // Increment stock quest progress
    incrementQuestProgress(userId, 'stock', 1)

    return {
      ok: true,
      msg: `Successfully sold ${shares.toLocaleString()} shares of ${stock.symbol} for ${payout.toLocaleString()} NDC.`,
    }
  } catch (e) {
    console.error('[stocks] sell transaction failed:', e)
    return { ok: false, msg: 'Database transaction error occurred.' }
  }
}

/** Simulate stock market fluctuations (hourly volatility) */
export async function simulateMarketFluctuations(client?: Client): Promise<string> {
  const db = getDb()
  const stocks = getStocks()
  const summaries: string[] = []
  const timestamp = Date.now()

  try {
    db.transaction(() => {
      for (const s of stocks) {
        // Random walk model: price = price * (1 + (volatility * random_normal))
        // Volatility represents max standard deviation of hourly price change
        const rand = (Math.random() - 0.5) * 2 // -1.0 to 1.0
        const percentChange = s.volatility * rand
        const priceDiff = s.price * percentChange
        let nextPrice = Math.max(1.0, s.price + priceDiff) // Floor price at 1.0 NDC

        // Round to 2 decimal places
        nextPrice = Math.round(nextPrice * 100) / 100
        const actualPercent = ((nextPrice - s.price) / s.price) * 100

        // Update database
        db.prepare('UPDATE stocks SET price = ?, last_updated = ? WHERE symbol = ?').run(
          nextPrice,
          timestamp,
          s.symbol,
        )

        // Add historical record
        db.prepare('INSERT INTO stock_history (symbol, price, timestamp) VALUES (?, ?, ?)').run(
          s.symbol,
          nextPrice,
          timestamp,
        )

        const changeDirection = actualPercent >= 0 ? '+' : ''
        summaries.push(
          `• ${s.symbol}: ${nextPrice.toFixed(2)} NDC (${changeDirection}${actualPercent.toFixed(2)}%)`,
        )
      }
    })()

    // Send summary to discord trading channel if available
    if (client) {
      const tradingChannelId = process.env.DISCORD_TRADING_CHANNEL_ID
      if (tradingChannelId) {
        try {
          const ch = (await client.channels.fetch(tradingChannelId)) as TextChannel | null
          if (ch?.isTextBased()) {
            await ch.send({
              content: `**Nightz Stock Exchange · Market Report**\nThe hourly exchange fluctuation has been applied:\n\n${summaries.join('\n')}\n\n*Execute /stock list to see the full market index.*`,
            })
          }
        } catch {}
      }
    }

    return summaries.join('\n')
  } catch (e) {
    console.error('[stocks] market fluctuation simulation failed:', e)
    return 'Fluctuation failed due to database write conflict'
  }
}

/** Render a stock performance candlestick chart as a PNG file path */
export async function generateStockChart(symbol: string): Promise<string | null> {
  const db = getDb()
  const history = db
    .prepare(
      'SELECT price, timestamp FROM stock_history WHERE symbol = ? ORDER BY timestamp DESC LIMIT 24',
    )
    .all(symbol.toUpperCase())
  if (history.length < 2) return null

  // Reverse so chronological order is left-to-right
  const data = history.reverse() as { price: number; timestamp: number }[]

  // Group into 8 candlesticks (3 hours per candle)
  interface Candle {
    open: number
    close: number
    high: number
    low: number
    volume: number
    timestamp: number
  }

  const candles: Candle[] = []
  const groupSize = 3
  for (let i = 0; i < data.length; i += groupSize) {
    const chunk = data.slice(i, i + groupSize)
    if (chunk.length === 0) continue
    const prices = chunk.map((c) => c.price)
    const open = chunk[0]!.price
    const close = chunk[chunk.length - 1]!.price
    const maxVal = Math.max(...prices)
    const minVal = Math.min(...prices)

    // Add small realistic high/low wicks
    const wickHigh = maxVal * (1 + (Math.random() * 0.003 + 0.001))
    const wickLow = minVal * (1 - (Math.random() * 0.003 + 0.001))

    // Simulate transaction volume for visual depth
    const volume = Math.floor(Math.random() * 35000 + 15000)

    candles.push({
      open,
      close,
      high: wickHigh,
      low: wickLow,
      volume,
      timestamp: chunk[chunk.length - 1]!.timestamp,
    })
  }

  const width = 800
  const height = 400
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')

  // Background - Premium Dark HSL theme
  ctx.fillStyle = '#080914'
  ctx.fillRect(0, 0, width, height)

  // Inner Accent Border
  ctx.strokeStyle = '#ffffff0f'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.roundRect(10, 10, width - 20, height - 20, 12)
  ctx.stroke()

  // Chart boundaries
  const paddingLeft = 70
  const paddingRight = 30
  const paddingTop = 80
  const paddingBottom = 60
  const chartWidth = width - paddingLeft - paddingRight
  const chartHeight = height - paddingTop - paddingBottom

  // Find min/max values across all wicks
  const highs = candles.map((c) => c.high)
  const lows = candles.map((c) => c.low)
  const minPrice = Math.min(...lows) * 0.99
  const maxPrice = Math.max(...highs) * 1.01
  const priceRange = maxPrice - minPrice

  // Draw Dotted Horizontal Grid lines
  ctx.strokeStyle = '#1d2038'
  ctx.lineWidth = 1
  ctx.setLineDash([4, 4])
  for (let i = 0; i <= 5; i++) {
    const y = paddingTop + (chartHeight / 5) * i
    ctx.beginPath()
    ctx.moveTo(paddingLeft, y)
    ctx.lineTo(width - paddingRight, y)
    ctx.stroke()
  }
  ctx.setLineDash([]) // Reset line dash

  // Draw Candlesticks & Volume Bars
  const candleSpacing = chartWidth / candles.length
  const bodyWidth = candleSpacing * 0.6

  // Draw volume bars first (bottom quadrant, semi-transparent)
  const maxVolume = Math.max(...candles.map((c) => c.volume))
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!
    const x = paddingLeft + candleSpacing * i + candleSpacing / 2
    const volHeight = (c.volume / maxVolume) * (chartHeight * 0.15)
    const volY = height - paddingBottom - volHeight

    ctx.fillStyle = c.close >= c.open ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)'
    ctx.fillRect(x - bodyWidth / 2, volY, bodyWidth, volHeight)
  }

  // Draw Candlestick Body & Wicks
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!
    const isUp = c.close >= c.open
    const color = isUp ? '#10b981' : '#ef4444' // sleek green or red

    const x = paddingLeft + candleSpacing * i + candleSpacing / 2
    const yHigh = paddingTop + chartHeight - ((c.high - minPrice) / priceRange) * chartHeight
    const yLow = paddingTop + chartHeight - ((c.low - minPrice) / priceRange) * chartHeight
    const yOpen = paddingTop + chartHeight - ((c.open - minPrice) / priceRange) * chartHeight
    const yClose = paddingTop + chartHeight - ((c.close - minPrice) / priceRange) * chartHeight

    // Draw wick line
    ctx.strokeStyle = color
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(x, yHigh)
    ctx.lineTo(x, yLow)
    ctx.stroke()

    // Draw candle body
    ctx.fillStyle = color
    const bodyY = Math.min(yOpen, yClose)
    const bodyH = Math.max(Math.abs(yOpen - yClose), 1.5) // ensure at least 1.5px thickness
    ctx.beginPath()
    ctx.roundRect(x - bodyWidth / 2, bodyY, bodyWidth, bodyH, 3)
    ctx.fill()
  }

  // Draw Monospace axes text
  ctx.fillStyle = '#64748b'
  ctx.font = 'bold 11px Courier New'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'

  // Y-Axis Price Labels
  for (let i = 0; i <= 5; i++) {
    const price = maxPrice - (priceRange / 5) * i
    const y = paddingTop + (chartHeight / 5) * i
    ctx.fillText(`${price.toFixed(2)} NDC`, paddingLeft - 10, y)
  }

  // X-Axis Time Labels
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.font = '11px sans-serif'
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!
    const x = paddingLeft + candleSpacing * i + candleSpacing / 2
    const timeStr = new Date(c.timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    })
    ctx.fillText(timeStr, x, height - paddingBottom + 12)
  }

  // Stock Title, Metadata, and Metrics header
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'

  // Stock Logo / Name
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 18px Arial'
  ctx.fillText(`${symbol.toUpperCase()} EXCHANGE INDEX`, 32, 42)

  ctx.fillStyle = '#64748b'
  ctx.font = '13px Arial'
  ctx.fillText('24H CANDLESTICK CHART', 32, 60)

  // Current Price Callout on Top-Right
  const currentPrice = data[data.length - 1]!.price
  const priceDiffPercent = ((data[data.length - 1]!.price - data[0]!.price) / data[0]!.price) * 100
  const colorPrice = priceDiffPercent >= 0 ? '#10b981' : '#ef4444'

  ctx.textAlign = 'right'
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 20px Courier New'
  ctx.fillText(`${currentPrice.toFixed(2)} NDC`, width - 32, 42)

  ctx.fillStyle = colorPrice
  ctx.font = 'bold 12px Arial'
  const sign = priceDiffPercent >= 0 ? '+' : ''
  ctx.fillText(`${sign}${priceDiffPercent.toFixed(2)}% (24H)`, width - 32, 60)

  // Save to temporary file
  const tmpPath = join(tmpdir(), `chart-${symbol.toLowerCase()}-${Date.now()}.png`)
  const buffer = canvas.toBuffer('image/png')
  writeFileSync(tmpPath, buffer)
  return tmpPath
}
