/**
 * Multi-user authentication and session management for dashboard v2.
 * Supports email/password login, Discord OAuth, role-based access control.
 * Uses JSON file storage with atomic writes.
 */

import { createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { writeFileAtomic } from '../services/data-store.ts'

export type UserRole = 'admin' | 'moderator' | 'viewer'

export interface User {
  id: string
  email: string
  passwordHash: string
  role: UserRole
  createdAt: number
  lastLogin: number | null
  servers: string[] // list of server/guild IDs user can access
  discordId?: string // Discord user ID if OAuth
  discordTag?: string // Discord user#discriminator
  active: boolean
}

export interface Session {
  id: string
  userId: string
  token: string
  createdAt: number
  expiresAt: number
  refreshToken: string
  refreshExpiresAt: number
}

export interface JWTPayload {
  sub: string // user ID
  email: string
  role: UserRole
  did?: string // Discord ID (for periodic role re-checks on OAuth sessions)
  iat: number
  exp: number
}

const DATA_DIR = process.env.DATA_DIR || './data'
const USERS_FILE = join(DATA_DIR, 'users.json')
const SESSIONS_FILE = join(DATA_DIR, 'sessions.json')

// Never sign tokens with the old public default 'dev-secret-change-me' - that
// let anyone forge an admin JWT. Require a strong configured secret; if unset or
// weak, use a random per-boot secret (secure, but sessions reset each restart
// until DASHBOARD_JWT_SECRET is set persistently in .env).
function resolveJwtSecret(): string {
  const env = process.env.DASHBOARD_JWT_SECRET
  if (env && env !== 'dev-secret-change-me' && env.length >= 32) return env
  console.warn(
    '[dashboard] DASHBOARD_JWT_SECRET is unset or too weak (<32 chars). Using a random ' +
      'per-boot secret. Set a persistent DASHBOARD_JWT_SECRET (>= 32 chars) in .env so ' +
      'dashboard sessions survive restarts.',
  )
  return randomBytes(48).toString('hex')
}
const JWT_SECRET = resolveJwtSecret()
const JWT_EXPIRY = 3600 // 1 hour
const REFRESH_EXPIRY = 604800 // 7 days
const BCRYPT_ROUNDS = 10

// Simple in-memory cache with TTL
let usersCache: User[] | null = null
let usersCacheTime = 0
const CACHE_TTL = 5000 // 5 seconds

/**
 * Hash a password using PBKDF2 (bcrypt-like, but no native Bun bcrypt)
 * In production, use 'bcryptjs' npm package for better security.
 */
function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex')
  // Simple format: salt$hash
  return `pbkdf2$${salt}$${hash}`
}

/**
 * Verify password against hash
 */
function verifyPassword(password: string, hash: string): boolean {
  const [method, salt, storedHash] = hash.split('$')
  if (method !== 'pbkdf2' || !salt || !storedHash) return false

  try {
    const testHash = pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex')
    return timingSafeEqual(Buffer.from(testHash), Buffer.from(storedHash))
  } catch {
    return false
  }
}

/**
 * Generate JWT token
 */
function generateJWT(user: User, expiresIn = JWT_EXPIRY): string {
  const payload: JWTPayload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    ...(user.discordId ? { did: user.discordId } : {}),
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + expiresIn,
  }

  // Simple JWT (not production-grade; use 'jsonwebtoken' npm for real use)
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payloadStr = Buffer.from(JSON.stringify(payload)).toString('base64url')

  const signature = createHmac('sha256', JWT_SECRET)
    .update(`${header}.${payloadStr}`)
    .digest('base64url')

  return `${header}.${payloadStr}.${signature}`
}

/**
 * Verify and decode JWT
 */
function verifyJWT(token: string): JWTPayload | null {
  try {
    const [headerB64, payloadB64, signatureB64] = token.split('.')
    if (!headerB64 || !payloadB64 || !signatureB64) return null

    // Verify signature
    const expectedSig = createHmac('sha256', JWT_SECRET)
      .update(`${headerB64}.${payloadB64}`)
      .digest('base64url')

    if (!timingSafeEqual(Buffer.from(signatureB64), Buffer.from(expectedSig))) {
      return null
    }

    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString()) as JWTPayload
    const now = Math.floor(Date.now() / 1000)
    if (payload.exp < now) return null // expired

    return payload
  } catch {
    return null
  }
}

/**
 * Load all users from disk
 */
async function loadUsers(): Promise<User[]> {
  // Check cache
  if (usersCache && Date.now() - usersCacheTime < CACHE_TTL) {
    return usersCache
  }

  try {
    const content = await readFile(USERS_FILE, 'utf8')
    const users = JSON.parse(content) as User[]
    usersCache = users
    usersCacheTime = Date.now()
    return users
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return []
    }
    throw err
  }
}

/**
 * Save all users to disk atomically
 */
async function saveUsers(users: User[]): Promise<void> {
  await mkdir(dirname(USERS_FILE), { recursive: true })
  const content = JSON.stringify(users, null, 2) + '\n'
  await writeFileAtomic(USERS_FILE, content)
  usersCache = users
  usersCacheTime = Date.now()
}

/**
 * Load all sessions from disk
 */
async function loadSessions(): Promise<Session[]> {
  try {
    const content = await readFile(SESSIONS_FILE, 'utf8')
    return JSON.parse(content) as Session[]
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return []
    }
    throw err
  }
}

/**
 * Save all sessions to disk atomically
 */
async function saveSessions(sessions: Session[]): Promise<void> {
  await mkdir(dirname(SESSIONS_FILE), { recursive: true })
  const content = JSON.stringify(sessions, null, 2) + '\n'
  await writeFileAtomic(SESSIONS_FILE, content)
}

/**
 * Get user by ID
 */
export async function getUserById(id: string): Promise<User | null> {
  const users = await loadUsers()
  return users.find((u) => u.id === id) || null
}

/**
 * Get user by email
 */
export async function getUserByEmail(email: string): Promise<User | null> {
  const users = await loadUsers()
  return users.find((u) => u.email === email.toLowerCase()) || null
}

/**
 * List all users (admin only)
 */
export async function listUsers(): Promise<User[]> {
  return loadUsers()
}

/**
 * Create a new user
 */
export async function createUser(
  email: string,
  password: string,
  role: UserRole = 'viewer',
  servers: string[] = [],
): Promise<User> {
  const existing = await getUserByEmail(email)
  if (existing) {
    throw new Error(`User ${email} already exists`)
  }

  const user: User = {
    id: randomBytes(16).toString('hex'),
    email: email.toLowerCase(),
    passwordHash: hashPassword(password),
    role,
    createdAt: Date.now(),
    lastLogin: null,
    servers,
    active: true,
  }

  const users = await loadUsers()
  users.push(user)
  await saveUsers(users)

  return user
}

/**
 * Create or update Discord OAuth user
 */
export async function upsertDiscordUser(
  discordId: string,
  email: string,
  discordTag: string,
  servers: string[] = [],
): Promise<User> {
  const users = await loadUsers()
  const existing = users.find((u) => u.discordId === discordId)

  if (existing) {
    existing.lastLogin = Date.now()
    existing.discordTag = discordTag
    if (servers.length > 0) {
      existing.servers = [...new Set([...existing.servers, ...servers])]
    }
    await saveUsers(users)
    return existing
  }

  // Create new user from Discord
  const user: User = {
    id: randomBytes(16).toString('hex'),
    email: email.toLowerCase(),
    passwordHash: '', // no password for OAuth users
    role: 'viewer',
    createdAt: Date.now(),
    lastLogin: Date.now(),
    servers,
    discordId,
    discordTag,
    active: true,
  }

  users.push(user)
  await saveUsers(users)
  return user
}

/**
 * Sign in a Discord-authenticated admin (already authorized by OAuth + allowlist/
 * role check): upsert them as an admin user and return a freshly signed JWT.
 */
export async function loginDiscordAdmin(discordId: string, discordTag: string): Promise<string> {
  const users = await loadUsers()
  let user = users.find((u) => u.discordId === discordId)
  if (user) {
    user.role = 'admin'
    user.discordTag = discordTag
    user.lastLogin = Date.now()
    user.active = true
  } else {
    user = {
      id: randomBytes(16).toString('hex'),
      email: `${discordId}@discord.local`,
      passwordHash: '',
      role: 'admin',
      createdAt: Date.now(),
      lastLogin: Date.now(),
      servers: [],
      discordId,
      discordTag,
      active: true,
    }
    users.push(user)
  }
  await saveUsers(users)
  return generateJWT(user)
}

/**
 * Authenticate with email and password
 */
export async function authenticatePassword(
  email: string,
  password: string,
): Promise<{ user: User; token: string; refreshToken: string } | null> {
  const user = await getUserByEmail(email)
  if (!user || !user.passwordHash) return null

  if (!verifyPassword(password, user.passwordHash)) {
    return null
  }

  // Update last login
  const users = await loadUsers()
  const idx = users.findIndex((u) => u.id === user.id)
  const existing = idx >= 0 ? users[idx] : undefined
  if (existing) {
    existing.lastLogin = Date.now()
    await saveUsers(users)
  }

  const token = generateJWT(user, JWT_EXPIRY)
  const refreshToken = generateJWT(user, REFRESH_EXPIRY)

  return { user, token, refreshToken }
}

/**
 * Verify JWT token and return payload
 */
export async function verifyToken(token: string): Promise<JWTPayload | null> {
  return verifyJWT(token)
}

/**
 * Update user role
 */
export async function updateUserRole(userId: string, role: UserRole): Promise<User | null> {
  const users = await loadUsers()
  const idx = users.findIndex((u) => u.id === userId)
  const u = idx >= 0 ? users[idx] : undefined
  if (!u) return null

  u.role = role
  await saveUsers(users)
  return u
}

/**
 * Add server access to user
 */
export async function addServerToUser(userId: string, serverId: string): Promise<User | null> {
  const users = await loadUsers()
  const idx = users.findIndex((u) => u.id === userId)
  const u = idx >= 0 ? users[idx] : undefined
  if (!u) return null

  if (!u.servers.includes(serverId)) {
    u.servers.push(serverId)
  }

  await saveUsers(users)
  return u
}

/**
 * Revoke user access
 */
export async function revokeUser(userId: string): Promise<User | null> {
  const users = await loadUsers()
  const idx = users.findIndex((u) => u.id === userId)
  const u = idx >= 0 ? users[idx] : undefined
  if (!u) return null

  u.active = false
  await saveUsers(users)

  // Invalidate all sessions for this user
  const sessions = await loadSessions()
  const filtered = sessions.filter((s) => s.userId !== userId)
  await saveSessions(filtered)

  return u
}

/**
 * Delete user completely
 */
export async function deleteUser(userId: string): Promise<void> {
  const users = await loadUsers()
  const filtered = users.filter((u) => u.id !== userId)
  await saveUsers(filtered)

  // Invalidate all sessions for this user
  const sessions = await loadSessions()
  const sessionFiltered = sessions.filter((s) => s.userId !== userId)
  await saveSessions(sessionFiltered)
}
