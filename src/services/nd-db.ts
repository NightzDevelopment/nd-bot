/**
 * Nightz Development SQLite Database Service
 * Provides high-speed SQL queries using Bun's native bun:sqlite module.
 * Incorporates safe automatic migrations from legacy JSON stores.
 */
import { Database } from 'bun:sqlite'
import { existsSync } from 'node:fs'
import { readFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { DATA_DIR } from '../config.ts'

const DB_PATH = join(DATA_DIR, 'nd-bot.db')
let dbInstance: Database | null = null

export function getDb(): Database {
  if (dbInstance) return dbInstance

  dbInstance = new Database(DB_PATH, { create: true })
  // Enable WAL mode for high concurrency
  dbInstance.exec('PRAGMA journal_mode = WAL;')
  dbInstance.exec('PRAGMA foreign_keys = ON;')

  initSchema(dbInstance)
  runMigrations(dbInstance)

  return dbInstance
}

function initSchema(db: Database): void {
  // User Economy table
  db.exec(`
    CREATE TABLE IF NOT EXISTS users_economy (
      userId TEXT PRIMARY KEY,
      balance INTEGER DEFAULT 0,
      bank INTEGER DEFAULT 0,
      lastDaily INTEGER DEFAULT 0,
      lastWork INTEGER DEFAULT 0,
      lastCrime INTEGER DEFAULT 0,
      lastHeist INTEGER DEFAULT 0,
      lastHunt INTEGER DEFAULT 0,
      lastFish INTEGER DEFAULT 0,
      lastMine INTEGER DEFAULT 0,
      totalEarned INTEGER DEFAULT 0,
      updatedAt INTEGER DEFAULT 0
    );
  `)

  // User Levels table
  db.exec(`
    CREATE TABLE IF NOT EXISTS users_levels (
      guildId TEXT,
      userId TEXT,
      xp INTEGER DEFAULT 0,
      level INTEGER DEFAULT 0,
      messageCount INTEGER DEFAULT 0,
      lastXpAt INTEGER DEFAULT 0,
      updatedAt INTEGER DEFAULT 0,
      PRIMARY KEY (guildId, userId)
    );
  `)

  // User Profiles and Customizations
  db.exec(`
    CREATE TABLE IF NOT EXISTS users_profiles (
      userId TEXT PRIMARY KEY,
      timezone TEXT DEFAULT 'UTC',
      bio TEXT DEFAULT 'Nightz Development Associate',
      card_customization TEXT DEFAULT '{"bg_gradient":"linear-gradient(135deg, #1e1e38, #0f0f1a)","border_color":"#3b82f6","badge_slots":[]}'
    );
  `)

  // Warnings table
  db.exec(`
    CREATE TABLE IF NOT EXISTS warnings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guildId TEXT,
      userId TEXT,
      timestamp INTEGER NOT NULL,
      reason TEXT NOT NULL,
      moderatorId TEXT NOT NULL
    );
  `)

  // Tickets table
  db.exec(`
    CREATE TABLE IF NOT EXISTS tickets (
      id TEXT PRIMARY KEY,
      channelId TEXT NOT NULL,
      guildId TEXT NOT NULL,
      userId TEXT NOT NULL,
      userTag TEXT NOT NULL,
      reason TEXT,
      openedAt INTEGER NOT NULL,
      status TEXT CHECK(status IN ('open', 'closed', 'pending')) DEFAULT 'open',
      priority TEXT DEFAULT 'normal',
      welcomeMessageId TEXT,
      lastUserMessageAt INTEGER DEFAULT 0,
      logMessageId TEXT,
      claimedBy TEXT,
      claimedByTag TEXT,
      closedAt INTEGER,
      closedBy TEXT,
      closedByTag TEXT,
      closeReason TEXT,
      workflowStatus TEXT DEFAULT 'Open',
      messageCount INTEGER DEFAULT 0,
      intakeProduct TEXT,
      intakeFramework TEXT,
      intakeDetails TEXT,
      staffEngaged INTEGER DEFAULT 0 -- 0 for false, 1 for true
    );
  `)

  // Stock Market listings
  db.exec(`
    CREATE TABLE IF NOT EXISTS stocks (
      symbol TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      price REAL NOT NULL,
      volatility REAL DEFAULT 0.05,
      last_updated INTEGER NOT NULL
    );
  `)

  // Stock price history
  db.exec(`
    CREATE TABLE IF NOT EXISTS stock_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT,
      price REAL NOT NULL,
      timestamp INTEGER NOT NULL,
      FOREIGN KEY(symbol) REFERENCES stocks(symbol) ON DELETE CASCADE
    );
  `)

  // Stock transactions
  db.exec(`
    CREATE TABLE IF NOT EXISTS stock_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      shares REAL NOT NULL,
      type TEXT CHECK(type IN ('BUY', 'SELL')) NOT NULL,
      price REAL NOT NULL,
      timestamp INTEGER NOT NULL,
      FOREIGN KEY(symbol) REFERENCES stocks(symbol) ON DELETE CASCADE
    );
  `)

  // Alarms and Reminders table
  db.exec(`
    CREATE TABLE IF NOT EXISTS reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message TEXT NOT NULL,
      trigger_time INTEGER NOT NULL,
      recurring TEXT -- CRON pattern or NULL
    );
  `)

  // Dashboard Config Rollback Snapshots
  db.exec(`
    CREATE TABLE IF NOT EXISTS config_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      config_data TEXT NOT NULL,
      description TEXT NOT NULL
    );
  `)

  // Reputation logs
  db.exec(`
    CREATE TABLE IF NOT EXISTS reputation (
      id TEXT PRIMARY KEY,
      points INTEGER DEFAULT 0,
      history TEXT DEFAULT '[]'
    );
  `)

  // AI Feedback Loop
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_feedback_loop (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      messageId TEXT NOT NULL,
      chunkId TEXT NOT NULL,
      userId TEXT NOT NULL,
      reaction TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    );
  `)

  // Chunk penalties
  db.exec(`
    CREATE TABLE IF NOT EXISTS chunk_penalties (
      chunkId TEXT PRIMARY KEY,
      penaltyWeight REAL DEFAULT 0.0,
      updatedAt INTEGER NOT NULL
    );
  `)
}

function runMigrations(db: Database): void {
  const flagPath = join(DATA_DIR, '.sqlite_migrated')
  if (existsSync(flagPath)) return

  console.log('[nd-db] running legacy JSON to SQLite migrations...')

  try {
    db.transaction(() => {
      // 1. Migrate Economy
      const economyJsonPath = join(DATA_DIR, 'economy.json')
      if (existsSync(economyJsonPath)) {
        try {
          const raw = require(economyJsonPath)
          const stmt = db.prepare(`
            INSERT OR REPLACE INTO users_economy (
              userId, balance, bank, lastDaily, lastWork, lastCrime,
              lastHeist, lastFish, lastHunt, lastMine, totalEarned, updatedAt
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `)
          for (const [userId, rec] of Object.entries(raw)) {
            const r = rec as any
            stmt.run(
              userId,
              r.balance ?? 0,
              r.bank ?? 0,
              r.lastDaily ?? 0,
              r.lastWork ?? 0,
              r.lastCrime ?? 0,
              r.lastHeist ?? 0,
              r.lastFish ?? 0,
              r.lastHunt ?? 0,
              r.lastMine ?? 0,
              r.totalEarned ?? 0,
              r.updatedAt ?? 0,
            )
          }
          console.log('[nd-db] migrated economy.json records successfully')
        } catch (e) {
          console.warn('[nd-db] error migrating economy.json:', e)
        }
      }

      // 2. Migrate Levels
      const levelsJsonPath = join(DATA_DIR, 'levels.json')
      if (existsSync(levelsJsonPath)) {
        try {
          const raw = require(levelsJsonPath)
          const stmt = db.prepare(`
            INSERT OR REPLACE INTO users_levels (
              guildId, userId, xp, level, messageCount, lastXpAt, updatedAt
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
          `)
          for (const [guildId, guildData] of Object.entries(raw)) {
            for (const [userId, rec] of Object.entries(guildData as any)) {
              const r = rec as any
              stmt.run(
                guildId,
                userId,
                r.xp ?? 0,
                r.level ?? 0,
                r.messageCount ?? 0,
                r.lastXpAt ?? 0,
                r.updatedAt ?? 0,
              )
            }
          }
          console.log('[nd-db] migrated levels.json records successfully')
        } catch (e) {
          console.warn('[nd-db] error migrating levels.json:', e)
        }
      }

      // 3. Migrate Warnings
      const warningsJsonPath = join(DATA_DIR, 'warnings.json')
      if (existsSync(warningsJsonPath)) {
        try {
          const raw = require(warningsJsonPath)
          const stmt = db.prepare(`
            INSERT INTO warnings (guildId, userId, timestamp, reason, moderatorId)
            VALUES (?, ?, ?, ?, ?)
          `)
          for (const [guildUserKey, warns] of Object.entries(raw)) {
            const [guildId, userId] = guildUserKey.split(':')
            if (guildId && userId && Array.isArray(warns)) {
              for (const w of warns) {
                stmt.run(
                  guildId,
                  userId,
                  w.at ?? Date.now(),
                  w.reason ?? 'Unknown',
                  w.moderatorId ?? 'system',
                )
              }
            }
          }
          console.log('[nd-db] migrated warnings.json records successfully')
        } catch (e) {
          console.warn('[nd-db] error migrating warnings.json:', e)
        }
      }

      // 4. Migrate Tickets
      const ticketsJsonPath = join(DATA_DIR, 'tickets.json')
      if (existsSync(ticketsJsonPath)) {
        try {
          const raw = require(ticketsJsonPath)
          const stmt = db.prepare(`
            INSERT OR REPLACE INTO tickets (
              id, channelId, guildId, userId, userTag, reason, openedAt, status,
              priority, welcomeMessageId, lastUserMessageAt, logMessageId,
              claimedBy, claimedByTag, closedAt, closedBy, closedByTag,
              closeReason, workflowStatus, messageCount, intakeProduct,
              intakeFramework, intakeDetails, staffEngaged
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `)
          if (raw && typeof raw === 'object' && raw.records) {
            for (const [chanId, rec] of Object.entries(raw.records)) {
              const r = rec as any
              stmt.run(
                r.channelId ?? chanId,
                r.channelId ?? chanId,
                r.guildId ?? 'unknown',
                r.userId ?? 'unknown',
                r.userTag ?? 'unknown',
                r.reason ?? 'General Support',
                r.openedAt ?? Date.now(),
                r.status ?? 'open',
                r.priority ?? 'normal',
                r.welcomeMessageId ?? null,
                r.lastUserMessageAt ?? 0,
                r.logMessageId ?? null,
                r.claimedBy ?? null,
                r.claimedByTag ?? null,
                r.closedAt ?? null,
                r.closedBy ?? null,
                r.closedByTag ?? null,
                r.closeReason ?? null,
                r.workflowStatus ?? 'Open',
                r.messageCount ?? 0,
                r.intakeProduct ?? null,
                r.intakeFramework ?? null,
                r.intakeDetails ?? null,
                r.staffEngaged ? 1 : 0,
              )
            }
          }
          console.log('[nd-db] migrated tickets.json records successfully')
        } catch (e) {
          console.warn('[nd-db] error migrating tickets.json:', e)
        }
      }

      // 5. Migrate Reputation
      const repJsonPath = join(DATA_DIR, 'reputation.json')
      if (existsSync(repJsonPath)) {
        try {
          const raw = require(repJsonPath)
          const stmt = db.prepare(`
            INSERT OR REPLACE INTO reputation (id, points, history)
            VALUES (?, ?, ?)
          `)
          for (const [id, rec] of Object.entries(raw)) {
            const r = rec as any
            stmt.run(id, r.points ?? 0, JSON.stringify(r.history ?? []))
          }
          console.log('[nd-db] migrated reputation.json records successfully')
        } catch (e) {
          console.warn('[nd-db] error migrating reputation.json:', e)
        }
      }

      // Initialize default stocks
      const defaultStocks = [
        { symbol: 'ND', name: 'Nightz Development Corp', price: 150.0, volatility: 0.04 },
        { symbol: 'FIVEM', name: 'FiveM Hosting Solutions', price: 45.0, volatility: 0.07 },
        { symbol: 'GEMINI', name: 'Gemini Intelligence Inc', price: 210.0, volatility: 0.03 },
        { symbol: 'CLAUDE', name: 'Anthropic Agentic Systems', price: 340.0, volatility: 0.05 },
        { symbol: 'BITCOIN', name: 'Virtual Simulated Token', price: 9200.0, volatility: 0.12 },
      ]

      const checkStock = db.prepare('SELECT 1 FROM stocks WHERE symbol = ?')
      const insertStock = db.prepare(`
        INSERT INTO stocks (symbol, name, price, volatility, last_updated)
        VALUES (?, ?, ?, ?, ?)
      `)
      const insertHistory = db.prepare(`
        INSERT INTO stock_history (symbol, price, timestamp)
        VALUES (?, ?, ?)
      `)

      const nowTime = Date.now()
      for (const s of defaultStocks) {
        if (!checkStock.get(s.symbol)) {
          insertStock.run(s.symbol, s.name, s.price, s.volatility, nowTime)
          insertHistory.run(s.symbol, s.price, nowTime)
        }
      }
      console.log('[nd-db] initialized stock market data')
    })()

    // Write flag file
    const fs = require('node:fs')
    fs.writeFileSync(flagPath, Date.now().toString())
    console.log('[nd-db] migration process complete.')
  } catch (e) {
    console.error('[nd-db] database transaction failed during migration:', e)
  }
}
