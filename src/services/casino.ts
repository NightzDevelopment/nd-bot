/**
 * Virtual simulated Casino games for ND Discord Gemini Bot
 * Developed under strict Nightz Development proprietary standards (no emojis)
 */

import type { ButtonInteraction, Message } from 'discord.js'
import { addBalance, getBalance } from './economy-store.ts'
import { getDb } from './nd-db.ts'
import { incrementQuestProgress } from './quest-manager.ts'

export interface BlackjackSession {
  userId: string
  channelId: string
  deck: string[]
  playerHand: string[]
  dealerHand: string[]
  bet: number
  status: 'playing' | 'won' | 'lost' | 'push'
}

// In-memory active blackjack sessions
export const activeBlackjack = new Map<string, BlackjackSession>()

/** Initialize casino global state table */
function initCasinoDb(): void {
  const db = getDb()
  db.exec(`
    CREATE TABLE IF NOT EXISTS casino_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)

  // Set default jackpot if not exists
  const check = db.prepare('SELECT 1 FROM casino_state WHERE key = ?').get('jackpot')
  if (!check) {
    db.prepare('INSERT INTO casino_state (key, value) VALUES (?, ?)').run('jackpot', '5000')
  }
}

/** Get progressive jackpot amount */
export function getJackpot(): number {
  initCasinoDb()
  const db = getDb()
  const row: any = db.prepare('SELECT value FROM casino_state WHERE key = ?').get('jackpot')
  return row ? parseInt(row.value, 10) : 5000
}

/** Add to progressive jackpot */
export function addToJackpot(amount: number): void {
  initCasinoDb()
  const db = getDb()
  db.prepare(
    'UPDATE casino_state SET value = CAST(CAST(value AS INTEGER) + ? AS TEXT) WHERE key = ?',
  ).run(Math.floor(amount), 'jackpot')
}

/** Reset progressive jackpot */
export function resetJackpot(): void {
  initCasinoDb()
  const db = getDb()
  db.prepare('UPDATE casino_state SET value = ? WHERE key = ?').run('5000', 'jackpot')
}

/** Slots machine engine */
export async function playSlots(
  userId: string,
  bet: number,
): Promise<{
  success: boolean
  msg: string
  payout: number
  reels: string[]
}> {
  if (bet <= 0)
    return { success: false, msg: 'Bet must be greater than zero.', payout: 0, reels: [] }

  const eco = await getBalance(userId)
  if (eco.balance < bet) {
    return {
      success: false,
      msg: `Insufficient funds. You only have ${eco.balance.toLocaleString()} NDC.`,
      payout: 0,
      reels: [],
    }
  }

  // Deduct bet from balance
  await addBalance(userId, -bet)

  // Feed 1% to jackpot
  const jackpotContrib = bet * 0.01
  addToJackpot(jackpotContrib)

  const symbols = ['[CHERRY]', '[LEMON]', '[GRAPE]', '[BAR]', '[ND]', '[7]', '[JACKPOT]']
  // Weighted reels selection
  const drawSymbol = () => {
    const r = Math.random()
    if (r < 0.02) return '[JACKPOT]' // 2%
    if (r < 0.08) return '[7]' // 6%
    if (r < 0.15) return '[ND]' // 7%
    if (r < 0.3) return '[BAR]' // 15%
    if (r < 0.5) return '[GRAPE]' // 20%
    if (r < 0.75) return '[LEMON]' // 25%
    return '[CHERRY]' // 25%
  }

  const reels = [drawSymbol(), drawSymbol(), drawSymbol()]
  let multiplier = 0
  let isJackpotWin = false

  // Evaluate slots results
  if (reels[0] === reels[1] && reels[1] === reels[2]) {
    // 3 of a kind
    const match = reels[0]
    if (match === '[JACKPOT]') {
      isJackpotWin = true
    } else if (match === '[7]') {
      multiplier = 20
    } else if (match === '[ND]') {
      multiplier = 15
    } else if (match === '[BAR]') {
      multiplier = 8
    } else if (match === '[GRAPE]') {
      multiplier = 5
    } else if (match === '[LEMON]') {
      multiplier = 3
    } else if (match === '[CHERRY]') {
      multiplier = 2
    }
  } else if (reels[0] === reels[1] || reels[1] === reels[2] || reels[0] === reels[2]) {
    // 2 of a kind
    const match = reels[1] === reels[2] ? reels[1] : reels[0]
    if (match === '[JACKPOT]') multiplier = 3
    else if (match === '[7]') multiplier = 2
    else if (match === '[ND]') multiplier = 1.5
    else multiplier = 1.2
  }

  let payout = 0
  let msg = ''

  if (isJackpotWin) {
    const jack = getJackpot()
    payout = jack
    await addBalance(userId, payout)
    resetJackpot()
    incrementQuestProgress(userId, 'gamble', 1)
    msg = `MEGA JACKPOT!!! You matched 3 [JACKPOT] symbols and won the progressive pool of ${payout.toLocaleString()} NDC!`
  } else if (multiplier > 0) {
    payout = Math.floor(bet * multiplier)
    await addBalance(userId, payout)
    incrementQuestProgress(userId, 'gamble', 1)
    msg = `You matched reels and won ${payout.toLocaleString()} NDC (multiplier: ${multiplier}x)!`
  } else {
    msg = 'No matches. Better luck next spin!'
  }

  // Broadcast to telemetry websocket
  try {
    const { broadcastActivity } = await import('../dashboard/websocket.ts')
    broadcastActivity('casino_play', { userId, game: 'slots', bet, payout })
  } catch {}

  return { success: true, msg, payout, reels }
}

/** Coinflip double-or-nothing wager */
export async function playCoinflip(
  userId: string,
  bet: number,
  choice: 'heads' | 'tails',
): Promise<{
  success: boolean
  msg: string
  payout: number
  outcome: 'heads' | 'tails'
}> {
  if (bet <= 0)
    return { success: false, msg: 'Bet must be greater than zero.', payout: 0, outcome: 'heads' }

  const eco = await getBalance(userId)
  if (eco.balance < bet) {
    return {
      success: false,
      msg: `Insufficient funds. You only have ${eco.balance.toLocaleString()} NDC.`,
      payout: 0,
      outcome: 'heads',
    }
  }

  await addBalance(userId, -bet)

  const outcome = Math.random() < 0.5 ? 'heads' : 'tails'
  const won = choice.toLowerCase() === outcome
  const payout = won ? bet * 2 : 0

  if (won) {
    await addBalance(userId, payout)
    incrementQuestProgress(userId, 'gamble', 1)
  }

  // Broadcast to telemetry websocket
  try {
    const { broadcastActivity } = await import('../dashboard/websocket.ts')
    broadcastActivity('casino_play', { userId, game: 'coinflip', bet, payout })
  } catch {}

  const msg = won
    ? `The coin landed on ${outcome.toUpperCase()}! You won ${payout.toLocaleString()} NDC!`
    : `The coin landed on ${outcome.toUpperCase()}! You lost your bet.`

  return { success: true, msg, payout, outcome }
}

/** Roulette betting engine */
export async function playRoulette(
  userId: string,
  bet: number,
  wagerType: 'red' | 'black' | 'even' | 'odd' | 'high' | 'low' | number,
): Promise<{
  success: boolean
  msg: string
  payout: number
  winningNumber: number
  winningColor: 'red' | 'black' | 'green'
}> {
  if (bet <= 0)
    return {
      success: false,
      msg: 'Bet must be greater than zero.',
      payout: 0,
      winningNumber: 0,
      winningColor: 'green',
    }

  const eco = await getBalance(userId)
  if (eco.balance < bet) {
    return {
      success: false,
      msg: `Insufficient funds. You only have ${eco.balance.toLocaleString()} NDC.`,
      payout: 0,
      winningNumber: 0,
      winningColor: 'green',
    }
  }

  await addBalance(userId, -bet)

  // standard single-zero roulette (0-36)
  const winningNumber = Math.floor(Math.random() * 37)

  const redNumbers = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]
  const winningColor =
    winningNumber === 0 ? 'green' : redNumbers.includes(winningNumber) ? 'red' : 'black'

  let won = false
  let payoutMultiplier = 0

  if (typeof wagerType === 'number') {
    won = winningNumber === wagerType
    payoutMultiplier = 35
  } else {
    const type = wagerType.toLowerCase()
    if (type === 'red' || type === 'black') {
      won = winningColor === type
      payoutMultiplier = 2
    } else if (type === 'even') {
      won = winningNumber !== 0 && winningNumber % 2 === 0
      payoutMultiplier = 2
    } else if (type === 'odd') {
      won = winningNumber !== 0 && winningNumber % 2 !== 0
      payoutMultiplier = 2
    } else if (type === 'low') {
      won = winningNumber >= 1 && winningNumber <= 18
      payoutMultiplier = 2
    } else if (type === 'high') {
      won = winningNumber >= 19 && winningNumber <= 36
      payoutMultiplier = 2
    }
  }

  const payout = won ? bet * payoutMultiplier : 0
  if (won) {
    await addBalance(userId, payout)
    incrementQuestProgress(userId, 'gamble', 1)
  }

  // Broadcast to telemetry websocket
  try {
    const { broadcastActivity } = await import('../dashboard/websocket.ts')
    broadcastActivity('casino_play', { userId, game: 'roulette', bet, payout })
  } catch {}

  const msg = won
    ? `The wheel spun and landed on ${winningColor.toUpperCase()} ${winningNumber}! You won ${payout.toLocaleString()} NDC!`
    : `The wheel spun and landed on ${winningColor.toUpperCase()} ${winningNumber}! Better luck next spin.`

  return { success: true, msg, payout, winningNumber, winningColor }
}

/** Build card deck for Blackjack */
function buildDeck(): string[] {
  const suits = ['S', 'H', 'D', 'C']
  const values = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']
  const deck: string[] = []
  for (const s of suits) {
    for (const v of values) {
      deck.push(`${v}${s}`)
    }
  }
  // Shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const temp = deck[i]!
    deck[i] = deck[j]!
    deck[j] = temp
  }
  return deck
}

/** Calculate Blackjack hand value */
export function calculateHandValue(hand: string[]): number {
  let score = 0
  let aces = 0
  for (const card of hand) {
    const val = card.slice(0, -1)
    if (val === 'A') {
      aces++
      score += 11
    } else if (['J', 'Q', 'K'].includes(val)) {
      score += 10
    } else {
      score += parseInt(val, 10)
    }
  }
  while (score > 21 && aces > 0) {
    score -= 10
    aces--
  }
  return score
}

/** Start a new Blackjack game session */
export async function startBlackjack(
  userId: string,
  bet: number,
  channelId: string,
): Promise<{
  success: boolean
  msg: string
  session?: BlackjackSession
}> {
  if (bet <= 0) return { success: false, msg: 'Bet must be greater than zero.' }

  const eco = await getBalance(userId)
  if (eco.balance < bet) {
    return {
      success: false,
      msg: `Insufficient funds. You only have ${eco.balance.toLocaleString()} NDC.`,
    }
  }

  if (activeBlackjack.has(userId)) {
    return { success: false, msg: 'You already have an active Blackjack game. Finish it first!' }
  }

  await addBalance(userId, -bet)

  const deck = buildDeck()
  const playerHand = [deck.pop()!, deck.pop()!]
  const dealerHand = [deck.pop()!, deck.pop()!]

  const session: BlackjackSession = {
    userId,
    channelId,
    deck,
    playerHand,
    dealerHand,
    bet,
    status: 'playing',
  }

  const playerScore = calculateHandValue(playerHand)
  if (playerScore === 21) {
    // Natural Blackjack!
    session.status = 'won'
    const payout = Math.floor(bet * 2.5)
    await addBalance(userId, payout)
    incrementQuestProgress(userId, 'gamble', 1)
    activeBlackjack.delete(userId)

    try {
      const { broadcastActivity } = await import('../dashboard/websocket.ts')
      broadcastActivity('casino_play', { userId, game: 'blackjack', bet, payout })
    } catch {}

    return {
      success: true,
      msg: `Natural Blackjack! Your hand: ${playerHand.join(', ')} (21). Dealer hand: ${dealerHand.join(', ')}. You won ${payout.toLocaleString()} NDC!`,
    }
  }

  activeBlackjack.set(userId, session)
  return { success: true, msg: 'Game started.', session }
}

/** Hit Blackjack hand */
export async function blackjackHit(
  userId: string,
): Promise<{ success: boolean; msg: string; session?: BlackjackSession }> {
  const session = activeBlackjack.get(userId)
  if (!session || session.status !== 'playing') {
    return { success: false, msg: 'No active Blackjack session found.' }
  }

  const card = session.deck.pop()!
  session.playerHand.push(card)
  const playerScore = calculateHandValue(session.playerHand)

  if (playerScore > 21) {
    // Busted
    session.status = 'lost'
    activeBlackjack.delete(userId)

    try {
      const { broadcastActivity } = await import('../dashboard/websocket.ts')
      broadcastActivity('casino_play', { userId, game: 'blackjack', bet: session.bet, payout: 0 })
    } catch {}

    return {
      success: true,
      msg: `You busted! Your hand: ${session.playerHand.join(', ')} (${playerScore}). You lost your bet of ${session.bet.toLocaleString()} NDC.`,
      session,
    }
  }

  return { success: true, msg: `You drew ${card}.`, session }
}

/** Stand Blackjack hand (Dealers turn) */
export async function blackjackStand(
  userId: string,
): Promise<{ success: boolean; msg: string; session?: BlackjackSession }> {
  const session = activeBlackjack.get(userId)
  if (!session || session.status !== 'playing') {
    return { success: false, msg: 'No active Blackjack session found.' }
  }

  let dealerScore = calculateHandValue(session.dealerHand)

  // Dealer hits until soft 17 or higher
  while (dealerScore < 17) {
    session.dealerHand.push(session.deck.pop()!)
    dealerScore = calculateHandValue(session.dealerHand)
  }

  const playerScore = calculateHandValue(session.playerHand)
  let msg = ''
  let payout = 0

  if (dealerScore > 21) {
    // Dealer busted
    session.status = 'won'
    payout = session.bet * 2
    await addBalance(userId, payout)
    incrementQuestProgress(userId, 'gamble', 1)
    msg = `Dealer busted with ${dealerScore}! Your hand: ${session.playerHand.join(', ')} (${playerScore}). You won ${payout.toLocaleString()} NDC!`
  } else if (playerScore > dealerScore) {
    session.status = 'won'
    payout = session.bet * 2
    await addBalance(userId, payout)
    incrementQuestProgress(userId, 'gamble', 1)
    msg = `You beat the dealer! Your hand: ${session.playerHand.join(', ')} (${playerScore}) vs Dealer: ${session.dealerHand.join(', ')} (${dealerScore}). You won ${payout.toLocaleString()} NDC!`
  } else if (playerScore < dealerScore) {
    session.status = 'lost'
    msg = `Dealer beats you. Your hand: ${session.playerHand.join(', ')} (${playerScore}) vs Dealer: ${session.dealerHand.join(', ')} (${dealerScore}). You lost your bet.`
  } else {
    session.status = 'push'
    payout = session.bet
    await addBalance(userId, payout)
    msg = `Push! Both had ${playerScore}. Your bet of ${session.bet.toLocaleString()} NDC has been returned.`
  }

  activeBlackjack.delete(userId)

  try {
    const { broadcastActivity } = await import('../dashboard/websocket.ts')
    broadcastActivity('casino_play', { userId, game: 'blackjack', bet: session.bet, payout })
  } catch {}

  return { success: true, msg, session }
}
