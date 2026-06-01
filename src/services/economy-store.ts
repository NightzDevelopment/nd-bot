/**
 * Economy store - ND Coins (NDC)
 * Driven by high-performance SQLite backend.
 */

import { readJson, writeJson } from './data-store.ts'
import { getDb } from './nd-db.ts'

// Lazy import to avoid circular dependencies
async function broadcastEconomy(
  userId: string,
  action: string,
  amount: number,
  balance: number,
): Promise<void> {
  try {
    const { broadcastActivity } = await import('../dashboard/websocket.ts')
    broadcastActivity('economy_transaction', { userId, action, amount, balance })
  } catch {
    // WS not available, ignore
  }
}

export type EconomyRecord = {
  balance: number
  bank: number
  lastDaily: number
  lastWork: number
  lastCrime: number
  lastHeist: number
  lastHunt: number
  lastFish: number
  lastMine: number
  totalEarned: number
  updatedAt: number
  dailyStreak: number
}

export type EconomyConfig = {
  dailyAmount: number
  workMin: number
  workMax: number
  gambleJackpotChance: number
  gambleJackpotMultiplier: number
  gambleWinChance: number
  gambleWinMin: number
  gambleWinMax: number
  crimeSuccessChance: number
  crimeMinReward: number
  crimeMaxReward: number
  crimeCatchChance: number
  crimeFineMin: number
  crimeFineMax: number
  heistSuccessChance: number
  heistMinReward: number
  heistMaxReward: number
  heistCatchChance: number
  heistFineMin: number
  heistFineMax: number
  robStealPercentMin: number
  robStealPercentMax: number
  robMinVictimBalance: number
  huntMinReward: number
  huntMaxReward: number
  huntCooldownMin: number
  fishMinReward: number
  fishMaxReward: number
  fishCooldownMin: number
  mineMinReward: number
  mineMaxReward: number
  mineCooldownMin: number
}

// Default economy configuration
export const DEFAULT_ECONOMY_CONFIG: EconomyConfig = {
  dailyAmount: 500,
  workMin: 50,
  workMax: 220,
  gambleJackpotChance: 0.03,
  gambleJackpotMultiplier: 5,
  gambleWinChance: 0.37,
  gambleWinMin: 1.2,
  gambleWinMax: 2.0,
  crimeSuccessChance: 0.6,
  crimeMinReward: 100,
  crimeMaxReward: 500,
  crimeCatchChance: 0.4,
  crimeFineMin: 100,
  crimeFineMax: 300,
  heistSuccessChance: 0.4,
  heistMinReward: 300,
  heistMaxReward: 1500,
  heistCatchChance: 0.5,
  heistFineMin: 200,
  heistFineMax: 600,
  robStealPercentMin: 0.2,
  robStealPercentMax: 0.3,
  robMinVictimBalance: 50,
  huntMinReward: 40,
  huntMaxReward: 180,
  huntCooldownMin: 30,
  fishMinReward: 30,
  fishMaxReward: 140,
  fishCooldownMin: 20,
  mineMinReward: 60,
  mineMaxReward: 250,
  mineCooldownMin: 45,
}

let configCache: EconomyConfig | null = null
const CONFIG_FILE = 'economy-config.json'

function defaultRecord(): EconomyRecord {
  return {
    balance: 0,
    bank: 0,
    lastDaily: 0,
    lastWork: 0,
    lastCrime: 0,
    lastHeist: 0,
    lastHunt: 0,
    lastFish: 0,
    lastMine: 0,
    totalEarned: 0,
    updatedAt: Date.now(),
    dailyStreak: 0,
  }
}

export async function getEconomyConfig(): Promise<EconomyConfig> {
  if (configCache) return configCache
  const stored = await readJson<Partial<EconomyConfig>>(CONFIG_FILE, {}).catch(() => ({}))
  configCache = { ...DEFAULT_ECONOMY_CONFIG, ...stored }
  return configCache
}

export async function setEconomyConfig(cfg: Partial<EconomyConfig>): Promise<EconomyConfig> {
  const current = await getEconomyConfig()
  const validKeys = Object.keys(DEFAULT_ECONOMY_CONFIG) as Array<keyof EconomyConfig>
  const sanitized: Partial<EconomyConfig> = {}
  for (const key of validKeys) {
    if (key in cfg && typeof cfg[key] === 'number' && isFinite(cfg[key] as number)) {
      sanitized[key] = cfg[key] as never
    }
  }
  configCache = { ...current, ...sanitized }
  await writeJson(CONFIG_FILE, configCache).catch((e) =>
    console.warn('[economy] config save failed:', e),
  )
  return configCache
}

export async function getBalance(userId: string): Promise<EconomyRecord> {
  const db = getDb()
  const row = db.prepare('SELECT * FROM users_economy WHERE userId = ?').get(userId) as
    | EconomyRecord
    | undefined
  if (!row) {
    const def = defaultRecord()
    db.prepare(`
      INSERT OR IGNORE INTO users_economy (
        userId, balance, bank, lastDaily, lastWork, lastCrime,
        lastHeist, lastFish, lastHunt, lastMine, totalEarned, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      def.balance,
      def.bank,
      def.lastDaily,
      def.lastWork,
      def.lastCrime,
      def.lastHeist,
      def.lastFish,
      def.lastHunt,
      def.lastMine,
      def.totalEarned,
      def.updatedAt,
    )
    return def
  }
  return row
}

export async function addBalance(userId: string, amount: number): Promise<EconomyRecord> {
  const db = getDb()
  await getBalance(userId) // ensure record exists

  if (amount > 0) {
    db.prepare(`
      UPDATE users_economy
      SET balance = balance + ?, totalEarned = totalEarned + ?, updatedAt = ?
      WHERE userId = ?
    `).run(amount, amount, Date.now(), userId)
  } else if (amount < 0) {
    db.prepare(`
      UPDATE users_economy
      SET balance = MAX(0, balance + ?), updatedAt = ?
      WHERE userId = ?
    `).run(amount, Date.now(), userId)
  }

  return getBalance(userId)
}

export async function setBalance(userId: string, amount: number): Promise<void> {
  const db = getDb()
  await getBalance(userId)
  db.prepare('UPDATE users_economy SET balance = ?, updatedAt = ? WHERE userId = ?').run(
    Math.max(0, amount),
    Date.now(),
    userId,
  )
}

export async function deposit(
  userId: string,
  amount: number,
): Promise<{ ok: boolean; msg: string; rec: EconomyRecord }> {
  const db = getDb()
  const rec = await getBalance(userId)
  if (amount <= 0) return { ok: false, msg: 'Amount must be positive.', rec }
  if (rec.balance < amount)
    return {
      ok: false,
      msg: `You only have **${rec.balance.toLocaleString()} NDC** in your wallet.`,
      rec,
    }

  db.prepare(`
    UPDATE users_economy
    SET balance = balance - ?, bank = bank + ?, updatedAt = ?
    WHERE userId = ?
  `).run(amount, amount, Date.now(), userId)

  const updated = await getBalance(userId)
  return {
    ok: true,
    msg: `Deposited **${amount.toLocaleString()} NDC** to your bank.`,
    rec: updated,
  }
}

export async function withdraw(
  userId: string,
  amount: number,
): Promise<{ ok: boolean; msg: string; rec: EconomyRecord }> {
  const db = getDb()
  const rec = await getBalance(userId)
  if (amount <= 0) return { ok: false, msg: 'Amount must be positive.', rec }
  if (rec.bank < amount)
    return {
      ok: false,
      msg: `You only have **${rec.bank.toLocaleString()} NDC** in your bank.`,
      rec,
    }

  db.prepare(`
    UPDATE users_economy
    SET balance = balance + ?, bank = bank - ?, updatedAt = ?
    WHERE userId = ?
  `).run(amount, amount, Date.now(), userId)

  const updated = await getBalance(userId)
  return {
    ok: true,
    msg: `Withdrew **${amount.toLocaleString()} NDC** from your bank.`,
    rec: updated,
  }
}

export async function transfer(
  fromId: string,
  toId: string,
  amount: number,
): Promise<{ ok: boolean; msg: string }> {
  const db = getDb()
  const from = await getBalance(fromId)
  await getBalance(toId) // Ensure target user exists

  if (amount <= 0) return { ok: false, msg: 'Amount must be positive.' }
  if (from.balance < amount)
    return { ok: false, msg: `You only have **${from.balance.toLocaleString()} NDC**.` }

  db.transaction(() => {
    db.prepare(
      'UPDATE users_economy SET balance = balance - ?, updatedAt = ? WHERE userId = ?',
    ).run(amount, Date.now(), fromId)
    db.prepare(
      'UPDATE users_economy SET balance = balance + ?, totalEarned = totalEarned + ?, updatedAt = ? WHERE userId = ?',
    ).run(amount, amount, Date.now(), toId)
  })()

  return { ok: true, msg: `Transferred **${amount.toLocaleString()} NDC**.` }
}

export async function claimDaily(
  userId: string,
): Promise<{ ok: boolean; amount: number; msg: string; streak: number }> {
  const db = getDb()
  const rec = await getBalance(userId)
  const now = Date.now()
  const cooldown = 20 * 60 * 60 * 1000 // 20h window
  if (now - rec.lastDaily < cooldown) {
    const remaining = cooldown - (now - rec.lastDaily)
    const h = Math.floor(remaining / 3_600_000)
    const m = Math.floor((remaining % 3_600_000) / 60_000)
    return {
      ok: false,
      amount: 0,
      msg: `Daily already claimed. Next in **${h}h ${m}m**.`,
      streak: rec.dailyStreak ?? 0,
    }
  }
  const cfg = await getEconomyConfig()
  // Streak continues if the previous claim was within 48h; otherwise it resets.
  const missWindow = 48 * 60 * 60 * 1000
  const prevStreak = rec.dailyStreak ?? 0
  const streak = rec.lastDaily > 0 && now - rec.lastDaily <= missWindow ? prevStreak + 1 : 1
  const base = cfg.dailyAmount
  const bonus = Math.floor(Math.random() * 200)
  const streakBonus = Math.min(streak, 7) * 50
  const { currentSeasonalMultipliers } = await import('./seasonal-events.ts')
  const amount = Math.round((base + bonus + streakBonus) * currentSeasonalMultipliers().currency)

  db.prepare(`
    UPDATE users_economy
    SET balance = balance + ?, totalEarned = totalEarned + ?, lastDaily = ?, dailyStreak = ?, updatedAt = ?
    WHERE userId = ?
  `).run(amount, amount, now, streak, now, userId)

  const updated = await getBalance(userId)
  void broadcastEconomy(userId, 'daily', amount, updated.balance)
  const streakLine = `Streak: **${streak} day${streak === 1 ? '' : 's'}** (+${streakBonus} bonus)`
  return {
    ok: true,
    amount,
    msg: `[SUCCESS] You claimed your daily **${amount.toLocaleString()} NDC**! ${streakLine}`,
    streak,
  }
}

export async function claimWork(
  userId: string,
): Promise<{ ok: boolean; amount: number; msg: string; job: string }> {
  const db = getDb()
  const rec = await getBalance(userId)
  const now = Date.now()
  const cooldown = 60 * 60 * 1000 // 1h
  if (now - rec.lastWork < cooldown) {
    const remaining = cooldown - (now - rec.lastWork)
    const m = Math.ceil(remaining / 60_000)
    return { ok: false, amount: 0, msg: `You need to rest. Work again in **${m}m**.`, job: '' }
  }
  const cfg = await getEconomyConfig()
  const jobs = [
    { job: 'fixed a FiveM script bug' },
    { job: 'ran a car wash' },
    { job: 'delivered packages' },
    { job: 'drove a taxi' },
    { job: 'stocked shelves' },
    { job: 'guarded a checkpoint' },
    { job: 'repaired vehicles' },
    { job: 'sold produce at the market' },
    { job: 'wrote documentation' },
    { job: 'tested a new script' },
  ]
  // Bounded random — index is always within range.
  const pick = jobs[Math.floor(Math.random() * jobs.length)] as { job: string }
  const baseWork = cfg.workMin + Math.floor(Math.random() * (cfg.workMax - cfg.workMin + 1))
  const { currentSeasonalMultipliers } = await import('./seasonal-events.ts')
  const amount = Math.round(baseWork * currentSeasonalMultipliers().currency)

  db.prepare(`
    UPDATE users_economy
    SET balance = balance + ?, totalEarned = totalEarned + ?, lastWork = ?, updatedAt = ?
    WHERE userId = ?
  `).run(amount, amount, now, now, userId)

  try {
    const { incrementQuestProgress } = await import('./quest-manager.ts')
    incrementQuestProgress(userId, 'work', 1)
  } catch {}

  const updated = await getBalance(userId)
  void broadcastEconomy(userId, 'work', amount, updated.balance)
  return {
    ok: true,
    amount,
    msg: `[WORK] You ${pick.job} and earned **${amount.toLocaleString()} NDC**.`,
    job: pick.job,
  }
}

export type GambleResult = 'jackpot' | 'win' | 'lose' | 'broke'
export async function gamble(
  userId: string,
  bet: number,
): Promise<{ ok: boolean; result: GambleResult; payout: number; msg: string }> {
  const db = getDb()
  const rec = await getBalance(userId)
  if (bet <= 0) return { ok: false, result: 'lose', payout: 0, msg: 'Bet must be positive.' }
  if (bet > rec.balance)
    return {
      ok: false,
      result: 'broke',
      payout: 0,
      msg: `Not enough NDC. You have **${rec.balance.toLocaleString()} NDC**.`,
    }

  const cfg = await getEconomyConfig()
  const roll = Math.random()
  let result: GambleResult
  let payout: number

  if (roll < cfg.gambleJackpotChance) {
    result = 'jackpot'
    payout = bet * cfg.gambleJackpotMultiplier
  } else if (roll < cfg.gambleJackpotChance + cfg.gambleWinChance) {
    result = 'win'
    payout = Math.floor(
      bet * (cfg.gambleWinMin + Math.random() * (cfg.gambleWinMax - cfg.gambleWinMin)),
    )
  } else {
    result = 'lose'
    payout = 0
  }

  const net = payout - bet
  db.prepare(`
    UPDATE users_economy
    SET balance = balance + ?, totalEarned = totalEarned + ?, updatedAt = ?
    WHERE userId = ?
  `).run(net, net > 0 ? net : 0, Date.now(), userId)

  if (result === 'win' || result === 'jackpot') {
    try {
      const { incrementQuestProgress } = await import('./quest-manager.ts')
      incrementQuestProgress(userId, 'gamble', 1)
    } catch {}
  }

  const updated = await getBalance(userId)
  void broadcastEconomy(userId, `gamble_${result}`, net, updated.balance)

  const sign = net >= 0 ? '+' : ''
  const msgs: Record<GambleResult, string> = {
    jackpot: `[JACKPOT] **JACKPOT!** You won **${payout.toLocaleString()} NDC**! (${sign}${net.toLocaleString()})`,
    win: `[WIN] **Win!** You got back **${payout.toLocaleString()} NDC** (${sign}${net.toLocaleString()})`,
    lose: `[LOSE] **Lost** your **${bet.toLocaleString()} NDC** bet. Better luck next time.`,
    broke: `Not enough NDC.`,
  }
  return { ok: true, result, payout, msg: msgs[result] }
}

export async function rob(
  robberId: string,
  victimId: string,
): Promise<{ ok: boolean; msg: string; amount: number }> {
  const db = getDb()
  const robber = await getBalance(robberId)
  const victim = await getBalance(victimId)
  const cfg = await getEconomyConfig()

  if (victim.balance < cfg.robMinVictimBalance) {
    return {
      ok: false,
      msg: `That person is too broke to rob (needs at least **${cfg.robMinVictimBalance} NDC**).`,
      amount: 0,
    }
  }

  const roll = Math.random()
  if (roll < 0.45) {
    const fine = Math.min(
      robber.balance,
      Math.floor(cfg.crimeFineMin + Math.random() * (cfg.crimeFineMax - cfg.crimeFineMin)),
    )
    db.prepare(
      'UPDATE users_economy SET balance = MAX(0, balance - ?), updatedAt = ? WHERE userId = ?',
    ).run(fine, Date.now(), robberId)
    return {
      ok: false,
      msg: `[POLICE] You got caught! Paid a fine of **${fine.toLocaleString()} NDC**.`,
      amount: -fine,
    }
  }

  const stealPercent =
    cfg.robStealPercentMin + Math.random() * (cfg.robStealPercentMax - cfg.robStealPercentMin)
  const maxSteal = Math.floor(victim.balance * stealPercent)
  const stolen = Math.floor(
    cfg.crimeMinReward +
      Math.random() * Math.min(maxSteal - cfg.crimeMinReward, cfg.crimeMaxReward),
  )

  db.transaction(() => {
    db.prepare(
      'UPDATE users_economy SET balance = balance + ?, totalEarned = totalEarned + ?, updatedAt = ? WHERE userId = ?',
    ).run(stolen, stolen, Date.now(), robberId)
    db.prepare(
      'UPDATE users_economy SET balance = MAX(0, balance - ?), updatedAt = ? WHERE userId = ?',
    ).run(stolen, Date.now(), victimId)
  })()

  const updatedRobber = await getBalance(robberId)
  void broadcastEconomy(robberId, 'rob_success', stolen, updatedRobber.balance)
  return {
    ok: true,
    msg: `[SUCCESS] You robbed **${stolen.toLocaleString()} NDC**!`,
    amount: stolen,
  }
}

export type CrimeResult = 'success' | 'caught' | 'broke'
export async function commitCrime(
  userId: string,
): Promise<{ ok: boolean; result: CrimeResult; amount: number; msg: string }> {
  const db = getDb()
  const rec = await getBalance(userId)
  const cfg = await getEconomyConfig()
  const now = Date.now()
  const cooldown = 60 * 60 * 1000 // 1h cooldown

  if (now - rec.lastCrime < cooldown) {
    const remaining = cooldown - (now - rec.lastCrime)
    const m = Math.ceil(remaining / 60_000)
    return {
      ok: false,
      result: 'broke',
      amount: 0,
      msg: `You need to lay low. Try again in **${m}m**.`,
    }
  }

  const roll = Math.random()
  let result: CrimeResult
  let amount: number

  if (roll < cfg.crimeCatchChance) {
    result = 'caught'
    const fine = Math.floor(
      cfg.crimeFineMin + Math.random() * (cfg.crimeFineMax - cfg.crimeFineMin),
    )
    amount = -Math.min(rec.balance, fine)
    db.prepare(
      'UPDATE users_economy SET balance = MAX(0, balance - ?), lastCrime = ?, updatedAt = ? WHERE userId = ?',
    ).run(Math.abs(amount), now, now, userId)
  } else {
    result = 'success'
    amount = Math.floor(
      cfg.crimeMinReward + Math.random() * (cfg.crimeMaxReward - cfg.crimeMinReward),
    )
    db.prepare(
      'UPDATE users_economy SET balance = balance + ?, totalEarned = totalEarned + ?, lastCrime = ?, updatedAt = ? WHERE userId = ?',
    ).run(amount, amount, now, now, userId)

    try {
      const { incrementQuestProgress } = await import('./quest-manager.ts')
      incrementQuestProgress(userId, 'crime', 1)
    } catch {}
  }

  const updated = await getBalance(userId)
  void broadcastEconomy(userId, `crime_${result}`, amount, updated.balance)

  const msgs: Record<CrimeResult, string> = {
    success: `[CRIME] Crime successful! You stole **${amount.toLocaleString()} NDC**.`,
    caught: `[POLICE] Busted! You got caught and paid a fine of **${Math.abs(amount).toLocaleString()} NDC**.`,
    broke: `You're too broke for this.`,
  }

  return { ok: true, result, amount, msg: msgs[result] }
}

export type HeistResult = 'success' | 'caught' | 'broke'
export async function commitHeist(
  userId: string,
): Promise<{ ok: boolean; result: HeistResult; amount: number; msg: string }> {
  const db = getDb()
  const rec = await getBalance(userId)
  const cfg = await getEconomyConfig()
  const now = Date.now()
  const cooldown = 4 * 60 * 60 * 1000 // 4h cooldown

  if (now - rec.lastHeist < cooldown) {
    const remaining = cooldown - (now - rec.lastHeist)
    const h = Math.floor(remaining / 3_600_000)
    const m = Math.floor((remaining % 3_600_000) / 60_000)
    return {
      ok: false,
      result: 'broke',
      amount: 0,
      msg: `You need more time to plan. Next heist in **${h}h ${m}m**.`,
    }
  }

  const roll = Math.random()
  let result: HeistResult
  let amount: number

  if (roll < cfg.heistCatchChance) {
    result = 'caught'
    const fine = Math.floor(
      cfg.heistFineMin + Math.random() * (cfg.heistFineMax - cfg.heistFineMin),
    )
    amount = -Math.min(rec.balance, fine)
    db.prepare(
      'UPDATE users_economy SET balance = MAX(0, balance - ?), lastHeist = ?, updatedAt = ? WHERE userId = ?',
    ).run(Math.abs(amount), now, now, userId)
  } else if (roll < cfg.heistCatchChance + cfg.heistSuccessChance) {
    result = 'success'
    amount = Math.floor(
      cfg.heistMinReward + Math.random() * (cfg.heistMaxReward - cfg.heistMinReward),
    )
    db.prepare(
      'UPDATE users_economy SET balance = balance + ?, totalEarned = totalEarned + ?, lastHeist = ?, updatedAt = ? WHERE userId = ?',
    ).run(amount, amount, now, now, userId)
  } else {
    result = 'success'
    amount = Math.floor((cfg.heistMinReward + cfg.heistMaxReward) / 3)
    db.prepare(
      'UPDATE users_economy SET balance = balance + ?, totalEarned = totalEarned + ?, lastHeist = ?, updatedAt = ? WHERE userId = ?',
    ).run(amount, amount, now, now, userId)
  }

  const updated = await getBalance(userId)
  void broadcastEconomy(userId, `heist_${result}`, amount, updated.balance)

  const msgs: Record<HeistResult, string> = {
    success: `[HEIST] **Heist successful!** You pulled off the score and got **${amount.toLocaleString()} NDC**!`,
    caught: `[POLICE] **Heist failed!** You got caught and paid **${Math.abs(amount).toLocaleString()} NDC** in fines.`,
    broke: `You don't have the resources for a heist right now.`,
  }

  return { ok: true, result, amount, msg: msgs[result] }
}

type GatherKind = 'hunt' | 'fish' | 'mine'

const GATHER_FLAVORS: Record<
  GatherKind,
  Array<{ emoji: string; item: string; multiplier: number }>
> = {
  hunt: [
    { emoji: '[RABBIT]', item: 'rabbit', multiplier: 0.8 },
    { emoji: '[DEER]', item: 'deer', multiplier: 1.2 },
    { emoji: '[BOAR]', item: 'wild boar', multiplier: 1.5 },
    { emoji: '[BEAR]', item: 'bear', multiplier: 2.0 },
    { emoji: '[EAGLE]', item: 'eagle', multiplier: 1.8 },
    { emoji: '[FOX]', item: 'fox', multiplier: 1.0 },
  ],
  fish: [
    { emoji: '[FISH-COMMON]', item: 'common fish', multiplier: 0.7 },
    { emoji: '[FISH-TROPICAL]', item: 'tropical fish', multiplier: 1.0 },
    { emoji: '[FISH-PUFFER]', item: 'pufferfish', multiplier: 1.3 },
    { emoji: '[SHARK]', item: 'shark', multiplier: 2.5 },
    { emoji: '[OCTOPUS]', item: 'octopus', multiplier: 1.8 },
    { emoji: '[LOBSTER]', item: 'lobster', multiplier: 1.5 },
    { emoji: '[CRAB]', item: 'crab', multiplier: 1.1 },
  ],
  mine: [
    { emoji: '[STONE]', item: 'rock', multiplier: 0.5 },
    { emoji: '[COPPER]', item: 'copper ore', multiplier: 0.9 },
    { emoji: '[IRON]', item: 'iron ore', multiplier: 1.2 },
    { emoji: '[GOLD]', item: 'gold ore', multiplier: 1.8 },
    { emoji: '[DIAMOND]', item: 'diamond', multiplier: 3.0 },
    { emoji: '[SAPPHIRE]', item: 'sapphire', multiplier: 2.2 },
    { emoji: '[AMBER]', item: 'amber', multiplier: 1.5 },
  ],
}

async function doGather(
  userId: string,
  kind: GatherKind,
): Promise<{ ok: boolean; amount: number; msg: string; item: string }> {
  const db = getDb()
  const rec = await getBalance(userId)
  const cfg = await getEconomyConfig()
  const now = Date.now()

  const lastField = kind === 'hunt' ? 'lastHunt' : kind === 'fish' ? 'lastFish' : 'lastMine'
  const cooldownMinKey =
    kind === 'hunt' ? 'huntCooldownMin' : kind === 'fish' ? 'fishCooldownMin' : 'mineCooldownMin'
  const minRewardKey =
    kind === 'hunt' ? 'huntMinReward' : kind === 'fish' ? 'fishMinReward' : 'mineMinReward'
  const maxRewardKey =
    kind === 'hunt' ? 'huntMaxReward' : kind === 'fish' ? 'fishMaxReward' : 'mineMaxReward'

  const cooldown = cfg[cooldownMinKey] * 60 * 1000
  const lastTime = rec[lastField]

  if (now - lastTime < cooldown) {
    const remaining = cooldown - (now - lastTime)
    const m = Math.ceil(remaining / 60_000)
    const verb = kind === 'hunt' ? 'hunt' : kind === 'fish' ? 'fish' : 'mine'
    return { ok: false, amount: 0, msg: `You can ${verb} again in **${m}m**.`, item: '' }
  }

  if (Math.random() < 0.1) {
    db.prepare(`UPDATE users_economy SET ${lastField} = ?, updatedAt = ? WHERE userId = ?`).run(
      now,
      now,
      userId,
    )
    const fail =
      kind === 'hunt'
        ? '[HUNT] You hunted for hours but found nothing.'
        : kind === 'fish'
          ? '[FISH] Your line came back empty.'
          : '[MINE] You mined for hours but found only dirt.'
    return { ok: true, amount: 0, msg: fail, item: 'nothing' }
  }

  const flavors = GATHER_FLAVORS[kind]
  // Bounded random index — always in range.
  const pick = flavors[Math.floor(Math.random() * flavors.length)] as (typeof flavors)[number]
  const baseMin = cfg[minRewardKey]
  const baseMax = cfg[maxRewardKey]
  const baseAmount = baseMin + Math.floor(Math.random() * (baseMax - baseMin + 1))
  const amount = Math.floor(baseAmount * pick.multiplier)

  db.prepare(`
    UPDATE users_economy
    SET balance = balance + ?, totalEarned = totalEarned + ?, ${lastField} = ?, updatedAt = ?
    WHERE userId = ?
  `).run(amount, amount, now, now, userId)

  const updated = await getBalance(userId)
  void broadcastEconomy(userId, kind, amount, updated.balance)

  const verb = kind === 'hunt' ? 'hunted' : kind === 'fish' ? 'caught' : 'mined'
  return {
    ok: true,
    amount,
    msg: `${pick.emoji} You ${verb} a **${pick.item}** and earned **${amount.toLocaleString()} NDC**!`,
    item: pick.item,
  }
}

export async function hunt(userId: string) {
  return doGather(userId, 'hunt')
}
export async function fish(userId: string) {
  return doGather(userId, 'fish')
}
export async function mine(userId: string) {
  return doGather(userId, 'mine')
}

export type CooldownStatus = {
  command: string
  ready: boolean
  nextAvailable: number
  remainingMs: number
}

export async function getCooldowns(userId: string): Promise<CooldownStatus[]> {
  const rec = await getBalance(userId)
  const cfg = await getEconomyConfig()
  const now = Date.now()

  const commands: Array<{ command: string; lastField: keyof EconomyRecord; cooldownMs: number }> = [
    { command: 'daily', lastField: 'lastDaily', cooldownMs: 20 * 60 * 60 * 1000 },
    { command: 'work', lastField: 'lastWork', cooldownMs: 60 * 60 * 1000 },
    { command: 'crime', lastField: 'lastCrime', cooldownMs: 60 * 60 * 1000 },
    { command: 'heist', lastField: 'lastHeist', cooldownMs: 4 * 60 * 60 * 1000 },
    { command: 'hunt', lastField: 'lastHunt', cooldownMs: cfg.huntCooldownMin * 60 * 1000 },
    { command: 'fish', lastField: 'lastFish', cooldownMs: cfg.fishCooldownMin * 60 * 1000 },
    { command: 'mine', lastField: 'lastMine', cooldownMs: cfg.mineCooldownMin * 60 * 1000 },
  ]

  return commands.map((c) => {
    const last = (rec[c.lastField] as number) || 0
    const nextAvailable = last + c.cooldownMs
    const remainingMs = Math.max(0, nextAvailable - now)
    return {
      command: c.command,
      ready: remainingMs === 0,
      nextAvailable,
      remainingMs,
    }
  })
}

export async function richestUsers(
  limit = 10,
): Promise<Array<{ userId: string; balance: number; bank: number; total: number }>> {
  const db = getDb()
  const rows = db
    .prepare(
      'SELECT userId, balance, bank, (balance + bank) AS total FROM users_economy ORDER BY total DESC LIMIT ?',
    )
    .all(limit) as Array<{ userId: string; balance: number; bank: number; total: number }>
  return rows
}

export async function getAllBalances(): Promise<Array<{ userId: string } & EconomyRecord>> {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM users_economy').all() as Array<
    { userId: string } & EconomyRecord
  >
  return rows
}
