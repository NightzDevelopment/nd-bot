import { spawn, spawnSync } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { join, normalize } from 'node:path'
import { DATA_DIR } from '../config.ts'
import { getUserBadges } from '../services/achievements.ts'
import {
  allManifestFields,
  changedFromBoot,
  getEffectiveStringValues,
  overridesAreBroken,
  primeBootSnapshot,
  readOverridesFile,
  validateAndMergePatch,
  writeMergedOverrides,
} from '../services/dashboard-overrides.ts'
import { writeFileAtomic } from '../services/data-store.ts'
import { getAllProfiles, getMembersByStats, getProfile } from '../services/member-profile.ts'
import { getHighSeverityNotes, getUserNotes } from '../services/mod-notes.ts'
import { getReputation } from '../services/reputation.ts'
import { getStoreSnapshotHealth } from '../services/store-snapshot.ts'
import {
  getGlobalTicketStats,
  getTicketByChannel,
  listAllTickets,
  updateTicketPartial,
} from '../services/ticket-store.ts'
import { listTemplates } from '../services/ticket-templates.ts'
import { getRecentWarnings, getUsersNeedingAttention, getWarnings } from '../services/warnings.ts'
import { packageVersion } from '../utils/package-version.ts'
import {
  getAnalyticsSummary,
  getCustomCommandUsage,
  getIntentDistribution,
  getMessageCountByDay,
  getModelUsageDistribution,
  getTopUsersByMessages,
} from './analytics-queries.ts'
import { exportAuditAsCSV, logAudit, queryAudit, startAuditFlush } from './audit.ts'
import { getRecentSnapshots, getSnapshotConfig, recordSnapshot } from './change-history.ts'
import { clearRequestLog, getRequestLog, recordRequest } from './request-log.ts'
import { getDiscordStatus, getStartedAt } from './runtime-state.ts'
import {
  authenticatePassword,
  createUser,
  deleteUser,
  getUserById,
  type JWTPayload,
  listUsers,
  revokeUser,
  updateUserRole,
  verifyToken,
} from './users.ts'
import { broadcastBotRestarted, broadcastConfigChanged, wsManager } from './websocket.ts'

const PUBLIC_DIR = join(import.meta.dir, '../../public/admin')
const PROJECT_ROOT = join(import.meta.dir, '../..')

const MAX_LOG_TAIL_BYTES = 5 * 1024 * 1024

/** PM2 log paths relative to repo root — see ecosystem.config.cjs `logs/`. */
function pm2LogAbs(kind: 'out' | 'err'): string {
  const name = kind === 'out' ? 'pm2-out.log' : 'pm2-error.log'
  return join(PROJECT_ROOT, 'logs', name)
}

async function readPm2Tail(
  abs: string,
  lineCount: number,
): Promise<{ ok: true; text: string; truncatedFile: boolean } | { ok: false; reason: string }> {
  const st = await stat(abs).catch(() => null)
  if (!st || !st.isFile()) {
    return { ok: false, reason: 'not_found' }
  }
  if (st.size > MAX_LOG_TAIL_BYTES) {
    return {
      ok: false,
      reason: 'large_file',
    }
  }
  const raw = await readFile(abs, 'utf8')
  const lines = raw.split(/\r?\n/)
  const text = lines.slice(Math.max(0, lines.length - lineCount)).join('\n')
  return { ok: true, text, truncatedFile: false }
}

/**
 * Hard cap on every request body the dashboard will accept. The largest
 * legitimate payload is the AI_AUTOMOD_SERVER_RULES + system prompts patch,
 * which fits comfortably under 256 KB. Data-file PUTs (levels.json) can grow
 * larger on busy servers; bumped accordingly.
 */
const MAX_CONFIG_BODY_BYTES = 256 * 1024
const MAX_DATA_BODY_BYTES = 8 * 1024 * 1024

function restartFeatureEnabled(): boolean {
  const v = (process.env.DASHBOARD_RESTART_ENABLED ?? '1').trim().toLowerCase()
  return v !== '0' && v !== 'false' && v !== 'off' && v !== 'no'
}

function pm2AppName(): string {
  return (process.env.DASHBOARD_PM2_APP ?? 'nd-bot').trim() || 'nd-bot'
}

let cachedPm2Available: boolean | null = null
function pm2Available(): boolean {
  if (cachedPm2Available !== null) return cachedPm2Available
  // bunx pm2 -v is fast (~150 ms cold). Cache the result.
  try {
    const r = spawnSync(process.execPath, ['x', 'pm2', '-v'], {
      timeout: 4000,
      windowsHide: true,
      stdio: 'ignore',
    })
    cachedPm2Available = r.status === 0
  } catch {
    cachedPm2Available = false
  }
  return cachedPm2Available
}

/**
 * Triggers a host restart: default `bun x pm2 restart <name> --update-env` in PROJECT_ROOT, or
 * `DASHBOARD_RESTART_CMD` (shell) when set.
 */
function triggerProcessRestart(): { ok: true } | { ok: false; error: string } {
  if (!restartFeatureEnabled()) {
    return { ok: false, error: 'Restart disabled (DASHBOARD_RESTART_ENABLED=0)' }
  }
  const custom = process.env.DASHBOARD_RESTART_CMD?.trim()
  if (custom) {
    try {
      const c = spawn(custom, {
        shell: true,
        cwd: PROJECT_ROOT,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      })
      c.on('error', (err) => {
        console.error('[dashboard] DASHBOARD_RESTART_CMD failed:', err)
      })
      c.unref()
      return { ok: true }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  }
  if (pm2Available()) {
    const app = pm2AppName()
    const bun = process.execPath
    const args = ['x', 'pm2', 'restart', app, '--update-env']
    try {
      const c = spawn(bun, args, {
        cwd: PROJECT_ROOT,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      })
      c.on('error', (err) => {
        console.error('[dashboard] pm2 restart spawn error:', err)
      })
      c.unref()
      console.log(`[dashboard] restart: spawned ${bun} ${args.join(' ')} (cwd ${PROJECT_ROOT})`)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  }

  // Fallback: self-respawn with detached child running `bun run dev`, then exit current process.
  // This works regardless of PM2 / supervisor — the new process is independent.
  try {
    console.log('[dashboard] restart: PM2 not found, falling back to self-respawn')
    const bun = process.execPath
    const child = spawn(bun, ['run', 'dev'], {
      cwd: PROJECT_ROOT,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env },
    })
    child.on('error', (err) => {
      console.error('[dashboard] self-respawn error:', err)
    })
    child.unref()
    // Give the child time to grab the port — schedule exit shortly after
    setTimeout(() => {
      console.log('[dashboard] restart: parent exiting after spawning child')
      process.exit(0)
    }, 1500)
    return { ok: true }
  } catch (e) {
    return {
      ok: false,
      error: `Self-respawn failed: ${String(e)}. Install pm2 or set DASHBOARD_RESTART_CMD as a fallback.`,
    }
  }
}

type DataName = 'levels' | 'afk' | 'counters'
const DATA_FILES = {
  levels: 'levels.json',
  afk: 'afk.json',
  counters: 'counters.json',
} as const satisfies Readonly<Record<DataName, string>>

function isDataName(s: string): s is DataName {
  return Object.hasOwn(DATA_FILES, s)
}

function dashboardEnabled(): boolean {
  const v = (process.env.DASHBOARD_ENABLED ?? '').trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes' || v === 'on'
}

function dashboardReadOnly(): boolean {
  const v = (process.env.DASHBOARD_READ_ONLY ?? '').trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes' || v === 'on'
}

function expectedToken(): string {
  return (process.env.DASHBOARD_TOKEN ?? '').trim()
}

function listenHost(): string {
  return (process.env.DASHBOARD_HOST ?? '127.0.0.1').trim() || '127.0.0.1'
}

function listenPort(): number {
  const p = parseInt(process.env.DASHBOARD_PORT ?? '3849', 10)
  if (Number.isNaN(p) || p < 1 || p > 65535) return 3849
  return p
}

function isLoopbackHost(h: string): boolean {
  return (
    h === '127.0.0.1' || h === '::1' || h === 'localhost' || h.toLowerCase() === '::ffff:127.0.0.1'
  )
}

/**
 * Constant-time string compare. `===` short-circuits on first mismatch and
 * leaks length. `Buffer.from(a, 'utf8')` length-equal XOR keeps the comparison
 * fixed-time per byte once the lengths match (we early-return only on length
 * mismatch, which is itself constant-time information).
 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

function json(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { 'content-type': 'application/json; charset=utf-8', ...init?.headers },
  })
}

function dataPathFile(rel: string): string {
  return join(DATA_DIR, rel)
}

function unauthorized(): Response {
  return json({ error: 'Unauthorized' }, { status: 401 })
}

function checkAuth(req: Request): boolean {
  const want = expectedToken()
  if (!want) return false
  const h = req.headers.get('authorization')?.trim() ?? ''
  const m = /^Bearer\s+(.+)$/i.exec(h)
  if (!m) return false
  return safeEqual(m[1] ?? '', want)
}

/** Extract + verify JWT for v2 endpoints */
async function checkJwtAuth(req: Request): Promise<JWTPayload | null> {
  const h = req.headers.get('authorization')?.trim() ?? ''
  const m = /^Bearer\s+(.+)$/i.exec(h)
  if (!m) return null
  return verifyToken(m[1] ?? '')
}

function jsonForbidden(): Response {
  return json({ error: 'Forbidden' }, { status: 403 })
}

/**
 * Per-IP rolling window. Cheap enough to be in-memory: handful of keys at most
 * because the dashboard binds to localhost by default. Resets every WINDOW_MS.
 */
const RATE_WINDOW_MS = 60_000
const RATE_LIMIT_API = 240 // generous for live UI typing
const RATE_LIMIT_RESTART = 4
type Bucket = { resetAt: number; count: number }
const apiBuckets = new Map<string, Bucket>()
const restartBuckets = new Map<string, Bucket>()
function rateLimit(map: Map<string, Bucket>, key: string, limit: number): boolean {
  const now = Date.now()
  let b = map.get(key)
  if (!b || b.resetAt < now) {
    b = { resetAt: now + RATE_WINDOW_MS, count: 0 }
    map.set(key, b)
  }
  b.count++
  return b.count <= limit
}

function clientKey(
  req: Request,
  server: { requestIP?: (r: Request) => { address: string } | null } | null,
): string {
  try {
    const ip = server?.requestIP?.(req)?.address
    if (ip) return ip
  } catch {
    /* ignore */
  }
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '0.0.0.0'
}

/**
 * Inject the dashboard token for same-origin only (localhost by default) so the UI can authenticate
 * without pasting. Do not bind the dashboard to a public interface without additional protection.
 */
async function readIndexHtmlWithToken(): Promise<Response | null> {
  const abs = join(PUBLIC_DIR, 'index.html')
  if (!abs.startsWith(PUBLIC_DIR)) return null
  let html: string
  try {
    html = await readFile(abs, 'utf8')
  } catch {
    return null
  }
  const token = expectedToken()
  if (token) {
    // Encode the token as a JSON string only so an XSS-y character in the env
    // can't break out of the script tag.
    const safeJson = JSON.stringify({ preloadedToken: token }).replace(/</g, '\\u003c')
    const inj = `<script>window.__ND_DASH_CONFIG__=${safeJson}</script>\n`
    if (html.includes('</head>')) {
      html = html.replace('</head>', `${inj}</head>`)
    } else {
      html = inj + html
    }
  }
  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      // Inline script is required for the token preload, so we can't avoid
      // 'unsafe-inline'. Everything else stays on the same origin.
      'content-security-policy':
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
      'x-frame-options': 'DENY',
      'referrer-policy': 'no-referrer',
    },
  })
}

async function readStatic(pathname: string): Promise<Response | null> {
  if (pathname === '/' || pathname === '') {
    return readIndexHtmlWithToken()
  }
  const rel = normalize(pathname).replace(/^[\\/]+/, '')
  if (rel.includes('..')) return null
  if (rel === 'index.html' || rel === 'dashboard' || rel === 'dashboard.html') {
    return readIndexHtmlWithToken()
  }
  // v2 page routes without .html extension
  const pageRoutes: Record<string, string> = {
    users: 'pages/users.html',
    audit: 'pages/audit.html',
    settings: 'pages/settings.html',
    docs: 'pages/docs.html',
  }
  if (pageRoutes[rel]) {
    return readStaticFile(pageRoutes[rel])
  }
  return readStaticFile(rel)
}

async function readStaticFile(rel: string): Promise<Response | null> {
  const abs = join(PUBLIC_DIR, rel)
  if (!abs.startsWith(PUBLIC_DIR)) return null
  const f = Bun.file(abs)
  if (!(await f.exists())) return null
  return new Response(f, {
    headers: {
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
    },
  })
}

async function readBoundedJson(
  req: Request,
  maxBytes: number,
): Promise<{ ok: true; data: unknown } | { ok: false; status: number; error: string }> {
  const lenHeader = req.headers.get('content-length')
  if (lenHeader) {
    const n = parseInt(lenHeader, 10)
    if (!Number.isNaN(n) && n > maxBytes) {
      return { ok: false, status: 413, error: `body too large (${n} > ${maxBytes})` }
    }
  }
  // Bun streams the body; a chunked client could lie about content-length,
  // so we also enforce after read.
  let text: string
  try {
    text = await req.text()
  } catch (e) {
    return { ok: false, status: 400, error: `read failed: ${String(e)}` }
  }
  if (text.length > maxBytes) {
    return { ok: false, status: 413, error: `body too large (${text.length} > ${maxBytes})` }
  }
  try {
    return { ok: true, data: JSON.parse(text) as unknown }
  } catch {
    return { ok: false, status: 400, error: 'invalid JSON' }
  }
}

let dashboardServeStarted = false

/** True when the dashboard is configured (env) so the process can stay up if Discord login fails. */
export function isLocalDashboardConfigured(): boolean {
  return dashboardEnabled() && Boolean(expectedToken())
}

export function startDashboard(): void {
  if (dashboardServeStarted) return
  if (!dashboardEnabled()) return
  const token = expectedToken()
  if (!token) {
    console.error(
      '[dashboard] DASHBOARD_ENABLED is set but DASHBOARD_TOKEN is empty — not starting',
    )
    return
  }

  const host = listenHost()
  const port = listenPort()
  const readonly = dashboardReadOnly()

  // Refuse to bind to a non-loopback interface unless the token is reasonably
  // long. This catches the common "I exposed it for testing and forgot the
  // 16-char token I picked" mistake.
  if (!isLoopbackHost(host) && token.length < 32) {
    console.error(
      `[dashboard] refusing to bind to ${host} with a short DASHBOARD_TOKEN (need >= 32 chars when remote-bound). Lengthen the token or use 127.0.0.1 + an SSH tunnel.`,
    )
    return
  }

  // Snapshot the boot env before any writes, so /api/config can flag drift.
  primeBootSnapshot()

  // Start audit log flush interval
  startAuditFlush()

  const serverRef: { server: ReturnType<typeof Bun.serve> | null } = { server: null }

  serverRef.server = Bun.serve({
    hostname: host,
    port,
    websocket: {
      open(ws) {
        wsManager.registerConnection(ws)
      },
      message(ws, data) {
        wsManager.handleMessage(ws, typeof data === 'string' ? data : data.toString())
      },
      close(ws) {
        wsManager.unregisterConnection(ws)
      },
    },
    async fetch(req) {
      const _reqStart = Date.now()
      const url = new URL(req.url)
      const pathname = url.pathname
      const ip =
        req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
        req.headers.get('cf-connecting-ip') ??
        (req as any).socket?.remoteAddress ??
        'unknown'

      // Wrap to capture status + log after every response
      const _respond = (res: Response, user: string | null = null): Response => {
        const durationMs = Date.now() - _reqStart
        // Skip static asset noise (js, css, fonts, icons)
        if (!/\.(js|css|woff2?|ttf|png|ico|svg|map)$/.test(pathname)) {
          recordRequest({
            at: _reqStart,
            method: req.method,
            path: pathname + (url.search || ''),
            status: res.status,
            durationMs,
            ip,
            user,
            bytes: Number(res.headers.get('content-length') ?? 0),
          })
        }
        return res
      }

      // Wrap everything so every response passes through _respond for request logging
      const _res = await (async (): Promise<Response> => {
        // Public health endpoint — no auth, so external watchdogs can ping it.
        // Returns intentionally minimal info (no tokens, no env values).
        if (pathname === '/api/health') {
          const d = getDiscordStatus()
          return json(
            {
              ok: true,
              startedAt: new Date(getStartedAt()).toISOString(),
              uptimeSec: Math.floor((Date.now() - getStartedAt()) / 1000),
              discord: d.status,
              discordReadyAt: d.readyAt ? new Date(d.readyAt).toISOString() : null,
              discordGuildCount: d.guildCount,
              discordWsPingMs: d.wsPingMs,
              botVersion: packageVersion(),
              processPid: process.pid,
              overridesBroken: overridesAreBroken(),
              readOnly: readonly,
              storeSnapshot: getStoreSnapshotHealth(),
            },
            {
              headers: {
                'cache-control': 'no-store',
                'access-control-allow-origin': '*',
              },
            },
          )
        }

        // ===== AUTH ENDPOINTS (Dashboard v2) =====
        if (pathname === '/auth/login' && req.method === 'POST') {
          try {
            const body = (await req.json()) as { email?: string; password?: string }
            const { email, password } = body

            if (!email || !password) {
              return json({ error: 'Missing email or password' }, { status: 400 })
            }

            const result = await authenticatePassword(email, password)
            if (!result) {
              return json({ error: 'Invalid email or password' }, { status: 401 })
            }

            return json({
              token: result.token,
              refreshToken: result.refreshToken,
              user: {
                id: result.user.id,
                email: result.user.email,
                role: result.user.role,
              },
            })
          } catch (err) {
            console.error('[auth] login error:', err)
            return json({ error: 'Internal server error' }, { status: 500 })
          }
        }

        if (pathname === '/api/servers' && req.method === 'GET') {
          return json({
            servers: [{ id: 'nightz-network', name: 'Nightz Network' }],
          })
        }

        // ===== WEBSOCKET UPGRADE =====
        if (pathname === '/ws') {
          const result = await wsManager.handleUpgrade(req, serverRef.server!)
          return result ?? new Response('WebSocket upgrade failed', { status: 400 })
        }

        // ===== V2 API (JWT auth) =====
        if (pathname.startsWith('/api/v2/')) {
          const jwtPayload = await checkJwtAuth(req)
          if (!jwtPayload) return unauthorized()

          const ip = clientKey(req, serverRef.server)
          const userAgent = req.headers.get('user-agent') || 'unknown'

          // --- Users ---
          if (pathname === '/api/v2/users' && req.method === 'GET') {
            if (jwtPayload.role !== 'admin') return jsonForbidden()
            const users = await listUsers()
            return json({
              users: users
                .filter((u) => u.active)
                .map((u) => ({
                  id: u.id,
                  email: u.email,
                  role: u.role,
                  createdAt: u.createdAt,
                  lastLogin: u.lastLogin,
                  servers: u.servers,
                  discordTag: u.discordTag,
                })),
            })
          }

          if (pathname === '/api/v2/users' && req.method === 'POST') {
            if (jwtPayload.role !== 'admin') return jsonForbidden()
            const body = await readBoundedJson(req, 4096)
            if (!body.ok) return json({ error: body.error }, { status: body.status })
            const {
              email,
              password,
              role = 'viewer',
              servers = [],
            } = body.data as Record<string, unknown>
            if (!email || !password)
              return json({ error: 'Missing email or password' }, { status: 400 })
            if (!['admin', 'moderator', 'viewer'].includes(String(role)))
              return json({ error: 'Invalid role' }, { status: 400 })
            try {
              const user = await createUser(
                String(email),
                String(password),
                role as any,
                servers as string[],
              )
              await logAudit(
                jwtPayload.sub,
                jwtPayload.email,
                'user_created',
                `user:${user.id}`,
                { newEmail: email, newRole: role },
                ip,
                userAgent,
              )
              return json(
                {
                  user: {
                    id: user.id,
                    email: user.email,
                    role: user.role,
                    createdAt: user.createdAt,
                  },
                },
                { status: 201 },
              )
            } catch (e) {
              return json({ error: String(e) }, { status: 400 })
            }
          }

          const userIdMatch = pathname.match(/^\/api\/v2\/users\/([^/]+)$/)
          if (userIdMatch) {
            const targetId = userIdMatch[1] ?? ''
            if (jwtPayload.role !== 'admin') return jsonForbidden()

            if (req.method === 'PATCH') {
              const body = await readBoundedJson(req, 4096)
              if (!body.ok) return json({ error: body.error }, { status: body.status })
              const { role } = body.data as Record<string, unknown>
              if (!role || !['admin', 'moderator', 'viewer'].includes(String(role)))
                return json({ error: 'Invalid role' }, { status: 400 })
              const updated = await updateUserRole(targetId, role as any)
              if (!updated) return json({ error: 'User not found' }, { status: 404 })
              await logAudit(
                jwtPayload.sub,
                jwtPayload.email,
                'user_role_changed',
                `user:${targetId}`,
                { newRole: role },
                ip,
                userAgent,
              )
              return json({ user: { id: updated.id, email: updated.email, role: updated.role } })
            }

            if (req.method === 'DELETE') {
              const user = await getUserById(targetId)
              if (!user) return json({ error: 'User not found' }, { status: 404 })
              if (targetId === jwtPayload.sub)
                return json({ error: 'Cannot delete yourself' }, { status: 400 })
              await deleteUser(targetId)
              await logAudit(
                jwtPayload.sub,
                jwtPayload.email,
                'user_deleted',
                `user:${targetId}`,
                { email: user.email },
                ip,
                userAgent,
              )
              return json({ ok: true })
            }
          }

          // --- Audit log ---
          if (pathname === '/api/v2/audit' && req.method === 'GET') {
            const format = url.searchParams.get('format')
            const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '100', 10), 1000)
            const offset = parseInt(url.searchParams.get('offset') ?? '0', 10)
            const action = (url.searchParams.get('action') as any) || undefined
            const resource = url.searchParams.get('resource') || undefined
            const userId = url.searchParams.get('userId') || undefined
            const fromTime = url.searchParams.get('from')
              ? parseInt(url.searchParams.get('from')!, 10)
              : undefined
            const toTime = url.searchParams.get('to')
              ? parseInt(url.searchParams.get('to')!, 10)
              : undefined

            if (format === 'csv') {
              const csv = await exportAuditAsCSV({
                limit: 10000,
                fromTime,
                toTime,
                userId,
                action,
                resource,
              })
              return new Response(csv, {
                headers: {
                  'content-type': 'text/csv; charset=utf-8',
                  'content-disposition': `attachment; filename="audit-${Date.now()}.csv"`,
                },
              })
            }

            const entries = await queryAudit({
              limit,
              offset,
              fromTime,
              toTime,
              userId,
              action,
              resource,
            })
            return json({ entries, limit, offset })
          }

          // --- Config history ---
          if (pathname === '/api/v2/config/history' && req.method === 'GET') {
            const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 200)
            const snapshots = await getRecentSnapshots(limit)
            return json({ snapshots })
          }

          if (pathname === '/api/v2/config/restore' && req.method === 'POST') {
            if (readonly) return json({ error: 'read-only' }, { status: 403 })
            if (jwtPayload.role !== 'admin' && jwtPayload.role !== 'moderator')
              return jsonForbidden()
            const body = await readBoundedJson(req, 4096)
            if (!body.ok) return json({ error: body.error }, { status: body.status })
            const { snapshotId } = body.data as Record<string, unknown>
            if (!snapshotId) return json({ error: 'Missing snapshotId' }, { status: 400 })
            const snapshotConfig = await getSnapshotConfig(String(snapshotId))
            if (!snapshotConfig) return json({ error: 'Snapshot not found' }, { status: 404 })

            const fields = allManifestFields()
            const existing = await readOverridesFile()
            const { merged, errors } = validateAndMergePatch(
              snapshotConfig as Record<string, unknown>,
              fields,
            )
            if (!merged) return json({ errors }, { status: 400 })
            try {
              await writeMergedOverrides(existing, merged)
            } catch (e) {
              return json({ error: String(e) }, { status: 500 })
            }

            await logAudit(
              jwtPayload.sub,
              jwtPayload.email,
              'config_restored',
              `snapshot:${snapshotId}`,
              {},
              ip,
              userAgent,
            )
            broadcastConfigChanged(jwtPayload.sub, jwtPayload.email, Object.keys(snapshotConfig))
            return json({ ok: true, restoredKeys: Object.keys(snapshotConfig) })
          }

          // --- RAG Manager Endpoints (admin/moderator/staff) ---
          if (pathname === '/api/v2/rag/nodes' && req.method === 'GET') {
            const { getCorpus, isEmbeddingBuilding } = await import('../services/embeddings.ts')
            const nodes = getCorpus().map((c) => ({
              source: c.source,
              text: c.text,
              hasEmbedding: c.embedding.length > 0,
              dimensions: c.embedding.length,
            }))
            return json({ nodes, building: isEmbeddingBuilding(), count: nodes.length })
          }

          if (pathname === '/api/v2/rag/rebuild' && req.method === 'POST') {
            if (readonly) return json({ error: 'read-only' }, { status: 403 })
            if (jwtPayload.role !== 'admin') return jsonForbidden()
            const { rebuildEmbeddingIndex, isEmbeddingBuilding } = await import(
              '../services/embeddings.ts'
            )
            if (isEmbeddingBuilding()) {
              return json({ error: 'Embedding rebuild is already in progress' }, { status: 409 })
            }
            // Rebuild index asynchronously
            rebuildEmbeddingIndex().catch((err) => console.error('[rag] rebuild failed:', err))
            await logAudit(
              jwtPayload.sub,
              jwtPayload.email,
              'rag_rebuild_triggered',
              'rag:corpus',
              {},
              ip,
              userAgent,
            )
            return json({ ok: true, message: 'Rebuild triggered successfully.' })
          }

          if (pathname === '/api/v2/rag/search' && req.method === 'GET') {
            const queryVal = url.searchParams.get('query') || ''
            if (!queryVal.trim()) {
              return json({ error: 'Query is required' }, { status: 400 })
            }
            const { buildVectorContextAsync } = await import('../services/embeddings.ts')
            const context = await buildVectorContextAsync(queryVal)
            return json({ query: queryVal, context })
          }

          // --- Database Editor Endpoints (admin only) ---
          if (pathname === '/api/v2/db/tables' && req.method === 'GET') {
            if (jwtPayload.role !== 'admin') return jsonForbidden()
            const { getDb } = await import('../services/nd-db.ts')
            const db = getDb()
            const tables = db
              .prepare(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'chunk_penalties'",
              )
              .all() as { name: string }[]
            return json({ tables: tables.map((t) => t.name) })
          }

          if (pathname === '/api/v2/db/query' && req.method === 'GET') {
            if (jwtPayload.role !== 'admin') return jsonForbidden()
            const tbl = url.searchParams.get('table') || ''
            const limit = Math.min(
              Math.max(parseInt(url.searchParams.get('limit') || '50', 10), 1),
              250,
            )
            const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10), 0)

            const { getDb } = await import('../services/nd-db.ts')
            const db = getDb()

            const validTables = db
              .prepare(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
              )
              .all() as { name: string }[]
            const tableNames = new Set(validTables.map((t) => t.name))
            if (!tableNames.has(tbl)) {
              return json({ error: 'Invalid or non-existent table name' }, { status: 400 })
            }

            const rows = db.prepare(`SELECT * FROM ${tbl} LIMIT ? OFFSET ?`).all(limit, offset)
            const columnsInfo = db.prepare(`PRAGMA table_info(${tbl})`).all() as {
              name: string
              type: string
              pk: number
            }[]
            const countRow = db.prepare(`SELECT COUNT(*) as count FROM ${tbl}`).get() as {
              count: number
            }

            return json({
              table: tbl,
              columns: columnsInfo.map((c) => ({
                name: c.name,
                type: c.type,
                isPrimary: c.pk > 0,
              })),
              rows,
              total: countRow.count,
              limit,
              offset,
            })
          }

          if (pathname === '/api/v2/db/row' && req.method === 'PATCH') {
            if (readonly) return json({ error: 'read-only' }, { status: 403 })
            if (jwtPayload.role !== 'admin') return jsonForbidden()

            const body = await readBoundedJson(req, 16384)
            if (!body.ok) return json({ error: body.error }, { status: body.status })
            const { table, primaryKeys, updatedValues } = body.data as {
              table: string
              primaryKeys: Record<string, any>
              updatedValues: Record<string, any>
            }

            if (!table || !primaryKeys || !updatedValues) {
              return json(
                { error: 'Missing table, primaryKeys, or updatedValues' },
                { status: 400 },
              )
            }

            const { getDb } = await import('../services/nd-db.ts')
            const db = getDb()

            const validTables = db
              .prepare(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
              )
              .all() as { name: string }[]
            const tableNames = new Set(validTables.map((t) => t.name))
            if (!tableNames.has(table)) {
              return json({ error: 'Invalid table name' }, { status: 400 })
            }

            const setClauses: string[] = []
            const setParams: any[] = []
            for (const [k, v] of Object.entries(updatedValues)) {
              setClauses.push(`${k} = ?`)
              setParams.push(v)
            }

            const whereClauses: string[] = []
            const whereParams: any[] = []
            for (const [k, v] of Object.entries(primaryKeys)) {
              whereClauses.push(`${k} = ?`)
              whereParams.push(v)
            }

            if (setClauses.length === 0 || whereClauses.length === 0) {
              return json({ error: 'Missing update data or criteria' }, { status: 400 })
            }

            try {
              const stmt = db.prepare(
                `UPDATE ${table} SET ${setClauses.join(', ')} WHERE ${whereClauses.join(' AND ')}`,
              )
              stmt.run(...setParams, ...whereParams)
              await logAudit(
                jwtPayload.sub,
                jwtPayload.email,
                'db_row_updated',
                `table:${table}`,
                { primaryKeys },
                ip,
                userAgent,
              )
              return json({ ok: true })
            } catch (err) {
              return json(
                { error: err instanceof Error ? err.message : String(err) },
                { status: 500 },
              )
            }
          }

          if (pathname === '/api/v2/db/row' && req.method === 'DELETE') {
            if (readonly) return json({ error: 'read-only' }, { status: 403 })
            if (jwtPayload.role !== 'admin') return jsonForbidden()

            const body = await readBoundedJson(req, 4096)
            if (!body.ok) return json({ error: body.error }, { status: body.status })
            const { table, primaryKeys } = body.data as {
              table: string
              primaryKeys: Record<string, any>
            }

            if (!table || !primaryKeys) {
              return json({ error: 'Missing table or primaryKeys' }, { status: 400 })
            }

            const { getDb } = await import('../services/nd-db.ts')
            const db = getDb()

            const validTables = db
              .prepare(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
              )
              .all() as { name: string }[]
            const tableNames = new Set(validTables.map((t) => t.name))
            if (!tableNames.has(table)) {
              return json({ error: 'Invalid table name' }, { status: 400 })
            }

            const whereClauses: string[] = []
            const whereParams: any[] = []
            for (const [k, v] of Object.entries(primaryKeys)) {
              whereClauses.push(`${k} = ?`)
              whereParams.push(v)
            }

            if (whereClauses.length === 0) {
              return json({ error: 'Missing delete criteria' }, { status: 400 })
            }

            try {
              const stmt = db.prepare(`DELETE FROM ${table} WHERE ${whereClauses.join(' AND ')}`)
              stmt.run(...whereParams)
              await logAudit(
                jwtPayload.sub,
                jwtPayload.email,
                'db_row_deleted',
                `table:${table}`,
                { primaryKeys },
                ip,
                userAgent,
              )
              return json({ ok: true })
            } catch (err) {
              return json(
                { error: err instanceof Error ? err.message : String(err) },
                { status: 500 },
              )
            }
          }

          // --- WS connected users (admin only) ---
          if (pathname === '/api/v2/ws/clients' && req.method === 'GET') {
            if (jwtPayload.role !== 'admin') return jsonForbidden()
            return json({
              clients: wsManager.getConnectedUsers(),
              count: wsManager.getClientCount(),
            })
          }

          // --- Proactive FiveM Telemetry Triage (POST /api/v2/telemetry/logs) ---
          if (pathname === '/api/v2/telemetry/logs' && req.method === 'POST') {
            try {
              const body = (await req.json().catch(() => ({}))) as any
              const { serverName, logText, severity, resource } = body

              if (!logText || !logText.trim()) {
                return json({ error: 'Log content is required.' }, { status: 400 })
              }

              // Invoke the universal agent retrieval loop to analyze this exception!
              const systemPrompt = `You are the Proactive FiveM Telemetry Triage Agent for Nightz Development.
Analyze the incoming server/client crash log or exception stack trace.
Use your system tools to list files, read code, or grep search to locate the buggy files.
Provide a clear breakdown of the crash cause, specify the exact script, file name, and line number that triggered it, and write a copy-pasteable recommended hotfix to resolve it.
Do NOT use any emojis. Maintain an advanced technical, helpful, and concise standard.`

              const triageQuery = `Incoming Telemetry Exception Alert!
Server: ${serverName || 'ND Main Server'}
Resource Scope: ${resource || 'unknown'}
Severity: ${severity || 'CRITICAL'}

Log Output:
"""
${logText}
"""

Triage the root cause, identify the buggy files in the workspace, and provide the definitive hotfix.`

              // Execute the universal agent loop in the background
              const { runUniversalAgentLoop } = await import('../services/universal-nd-expert.ts')
              const { getDiscordClient } = await import('./runtime-state.ts')
              const { EmbedBuilder } = await import('discord.js')

              // We run it asynchronously in the background so the HTTP response is instantaneous
              void (async () => {
                try {
                  const diagnosis = await runUniversalAgentLoop(systemPrompt, [], triageQuery)

                  // Alert staff dev logs channel
                  const client: any = getDiscordClient()
                  const { ticketLogChannelId } = await import('../config.ts')

                  if (client && ticketLogChannelId) {
                    const channel = await client.channels
                      .fetch(ticketLogChannelId)
                      .catch(() => null)
                    if (channel && 'send' in channel) {
                      const embed = new EmbedBuilder()
                        .setColor(0xef4444)
                        .setTitle(
                          `[PROACTIVE TELEMETRY ALERT] ${resource ? `Resource: ${resource}` : 'System Exception'}`,
                        )
                        .setDescription(diagnosis.slice(0, 4000))
                        .setTimestamp()
                        .setFooter({
                          text: `Nightz Development Crash Triage · Server: ${serverName || 'ND Main'}`,
                        })

                      await (channel as any)
                        .send({
                          content: `[ALERT] Proactive AI crash triage report completed for a telemetry exception on **${serverName || 'ND Main'}**:`,
                          embeds: [embed],
                        })
                        .catch(() => {})
                    }
                  }
                } catch (bgErr) {
                  console.error('[telemetry-triage] Background diagnostic failed:', bgErr)
                }
              })()

              return json({
                ok: true,
                message: 'Telemetry log received. Proactive AI triage initiated in background.',
              })
            } catch (err: any) {
              return json({ error: `Failed to process telemetry: ${err.message}` }, { status: 500 })
            }
          }

          // --- System Telemetry (admin/moderator/staff) ---
          if (pathname === '/api/v2/telemetry' && req.method === 'GET') {
            const os = await import('node:os')
            const cpus = os.cpus()
            const totalMem = os.totalmem()
            const freeMem = os.freemem()
            const usedMem = totalMem - freeMem
            const memPercent = totalMem > 0 ? (usedMem / totalMem) * 100 : 0

            const loadAvg = os.loadavg()
            const uptime = process.uptime()

            let cpuUsage = 0
            if (os.platform() === 'win32') {
              const cpuStart = process.cpuUsage()
              const timeStart = performance.now()
              await new Promise((resolve) => setTimeout(resolve, 50))
              const cpuEnd = process.cpuUsage(cpuStart)
              const timeEnd = performance.now()
              const elapsedMs = timeEnd - timeStart
              const totalCpuMs = (cpuEnd.user + cpuEnd.system) / 1000
              cpuUsage = Math.min(100, Math.max(0, (totalCpuMs / (elapsedMs * cpus.length)) * 100))
            } else {
              cpuUsage = (loadAvg[0] / cpus.length) * 100
            }

            return json({
              ok: true,
              telemetry: {
                platform: os.platform(),
                arch: os.arch(),
                cpu: {
                  model: cpus[0]?.model ?? 'Unknown',
                  cores: cpus.length,
                  loadAvg,
                  usagePercent: Math.round(cpuUsage * 100) / 100,
                },
                memory: {
                  totalBytes: totalMem,
                  freeBytes: freeMem,
                  usedBytes: usedMem,
                  usagePercent: Math.round(memPercent * 100) / 100,
                  processBytes: process.memoryUsage().heapUsed,
                },
                process: {
                  uptime,
                  pid: process.pid,
                  nodeVersion: process.version,
                  bunVersion: (process as any).versions?.bun ?? 'unknown',
                },
                websocket: {
                  activeClients: wsManager.getClientCount(),
                },
              },
            })
          }

          // GET /api/v2/economy/leaderboard?limit=10
          if (req.method === 'GET' && pathname === '/api/v2/economy/leaderboard') {
            const { richestUsers } = await import('../services/economy-store.ts')
            const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '10', 10), 50)
            const data = await richestUsers(limit)
            return json({ ok: true, data })
          }

          // GET /api/v2/economy/user/:userId
          if (req.method === 'GET' && pathname.startsWith('/api/v2/economy/user/')) {
            const userId = pathname.split('/').pop()!
            const { getBalance } = await import('../services/economy-store.ts')
            const rec = await getBalance(userId)
            return json({ ok: true, data: { userId, ...rec } })
          }

          // PATCH /api/v2/economy/user/:userId  { balance?, bank? }
          if (req.method === 'PATCH' && pathname.startsWith('/api/v2/economy/user/')) {
            if (jwtPayload.role !== 'admin') return jsonForbidden()
            const userId = pathname.split('/').pop()!
            const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
            const { setBalance } = await import('../services/economy-store.ts')
            if (typeof body.balance === 'number') await setBalance(userId, body.balance)
            return json({ ok: true })
          }

          // GET /api/v2/levels/leaderboard?guildId=...&limit=10
          if (req.method === 'GET' && pathname === '/api/v2/levels/leaderboard') {
            const { getLeaderboard } = await import('./analytics-queries.ts')
            const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '10', 10), 50)
            const stat = url.searchParams.get('stat') ?? 'level'
            const data = await getLeaderboard(stat, limit)
            return json({ ok: true, data })
          }

          // GET /api/v2/levels/list — all users with level+XP across all guilds
          if (req.method === 'GET' && pathname === '/api/v2/levels/list') {
            const { readFile: rf } = await import('node:fs/promises')
            const { join: pj } = await import('node:path')
            const raw = await rf(pj(DATA_DIR, 'levels.json'), 'utf8').catch(() => '{}')
            const map = JSON.parse(raw) as Record<
              string,
              Record<string, { messages?: number; level?: number; xp?: number }>
            >
            const agg: Record<string, { messages: number; level: number; xp: number }> = {}
            for (const guildData of Object.values(map)) {
              for (const [uid, d] of Object.entries(guildData)) {
                if (!agg[uid]) agg[uid] = { messages: 0, level: 0, xp: 0 }
                agg[uid].messages += d.messages ?? 0
                agg[uid].level = Math.max(agg[uid].level, d.level ?? 0)
                agg[uid].xp += d.xp ?? 0
              }
            }
            const data = Object.entries(agg)
              .map(([userId, v]) => ({ userId, ...v }))
              .sort((a, b) => b.xp - a.xp)
            return json({ ok: true, data })
          }

          return json({ error: 'Not found' }, { status: 404 })
        }

        if (pathname.startsWith('/api/')) {
          const ip = clientKey(req, serverRef.server)
          if (!rateLimit(apiBuckets, ip, RATE_LIMIT_API)) {
            return json({ error: 'rate limited' }, { status: 429 })
          }
          if (!checkAuth(req)) return unauthorized()

          if (req.method === 'GET' && pathname === '/api/logs') {
            const kindRaw = url.searchParams.get('kind')?.trim().toLowerCase() ?? 'out'
            const kind: 'out' | 'err' = kindRaw === 'error' || kindRaw === 'err' ? 'err' : 'out'
            const n = parseInt(url.searchParams.get('lines') ?? '120', 10)
            const lines = Math.min(Math.max(Number.isFinite(n) ? n : 120, 1), 500)
            const abs = pm2LogAbs(kind)
            const logsRoot = normalize(join(PROJECT_ROOT, 'logs'))
            if (!normalize(abs).startsWith(logsRoot)) {
              return json({ error: 'invalid log path' }, { status: 400 })
            }
            const tail = await readPm2Tail(abs, lines)
            if (!tail.ok) {
              if (tail.reason === 'large_file') {
                return json(
                  { error: 'log file exceeds dashboard size cap; tail on host' },
                  { status: 413 },
                )
              }
              return json(
                {
                  error: 'log not found',
                  hint: 'PM2 merged logs usually go under ./logs/. Run the bot at least once with PM2 so files exist.',
                  kind,
                },
                { status: 404 },
              )
            }
            return json({
              ok: true,
              kind,
              linesRequested: lines,
              content: tail.text,
            })
          }
          if (req.method === 'GET' && pathname === '/api/config') {
            const fields = allManifestFields()
            const d = getDiscordStatus()
            return json({
              dataDir: DATA_DIR,
              readOnly: readonly,
              manifest: fields,
              values: getEffectiveStringValues(fields, true),
              hint: 'Sensitive values show as ***. Re-enter to change, or set in .env. Restart-required fields take effect after the bot process restarts.',
              restartEnabled: restartFeatureEnabled(),
              restartAvailable:
                restartFeatureEnabled() &&
                (Boolean(process.env.DASHBOARD_RESTART_CMD?.trim()) || pm2Available()),
              pm2App: pm2AppName(),
              pm2Available: pm2Available(),
              hasCustomRestartCmd: Boolean(process.env.DASHBOARD_RESTART_CMD?.trim()),
              overridesBroken: overridesAreBroken(),
              overridesError: process.env.ND_DASH_OVERRIDES_ERROR ?? null,
              changedFromBoot: changedFromBoot(fields),
              discord: d,
              botVersion: packageVersion(),
              processPid: process.pid,
              uptimeSec: Math.floor((Date.now() - getStartedAt()) / 1000),
              host,
              port,
            })
          }
          if (req.method === 'POST' && pathname === '/api/developer/sandbox/validate') {
            const body = (await req.json().catch(() => ({}))) as { code?: string }
            if (typeof body.code !== 'string') {
              return json(
                { error: 'invalid payload; expected "code" string property' },
                { status: 400 },
              )
            }

            const { checkLuaSyntax } = await import('../utils/lua-syntax-check.ts')
            const result = checkLuaSyntax(body.code)
            return json({
              ok: true,
              valid: result.valid,
              error: result.error ?? null,
              line: result.line ?? null,
              context: result.context ?? null,
            })
          }
          if (req.method === 'POST' && pathname === '/api/restart') {
            if (!rateLimit(restartBuckets, ip, RATE_LIMIT_RESTART)) {
              return json({ error: 'restart rate limited' }, { status: 429 })
            }
            const r = triggerProcessRestart()
            if (!r.ok) {
              return json({ error: r.error }, { status: 400 })
            }
            const jwtUser = await checkJwtAuth(req)
            const actorId = jwtUser?.sub ?? 'dashboard'
            const actorEmail = jwtUser?.email ?? 'dashboard'
            void logAudit(
              actorId,
              actorEmail,
              'bot_restarted',
              'bot:restart',
              {},
              ip,
              req.headers.get('user-agent') || 'unknown',
            )
            broadcastBotRestarted(actorId, actorEmail)
            return json({
              ok: true,
              message: pm2Available()
                ? `Restart requested for ${pm2AppName()}. The dashboard will disconnect when PM2 replaces the process.`
                : `Restart requested. Dashboard will briefly disconnect (~2s) while a new process spawns.`,
            })
          }

          // Soft stop / start (pause / resume Discord interactions, dashboard stays up)
          if (req.method === 'POST' && pathname === '/api/bot/pause') {
            const { pauseBot } = await import('./runtime-state.ts')
            const jwtUser = await checkJwtAuth(req)
            const actor = jwtUser?.email ?? 'dashboard'
            pauseBot(actor)
            void logAudit(
              jwtUser?.sub ?? 'dashboard',
              actor,
              'bot_paused',
              'bot:pause',
              {},
              ip,
              req.headers.get('user-agent') || 'unknown',
            )
            return json({
              ok: true,
              message: 'Bot paused. Discord events will be ignored until resumed.',
            })
          }

          if (req.method === 'POST' && pathname === '/api/bot/resume') {
            const { resumeBot } = await import('./runtime-state.ts')
            const jwtUser = await checkJwtAuth(req)
            const actor = jwtUser?.email ?? 'dashboard'
            resumeBot()
            void logAudit(
              jwtUser?.sub ?? 'dashboard',
              actor,
              'bot_resumed',
              'bot:resume',
              {},
              ip,
              req.headers.get('user-agent') || 'unknown',
            )
            return json({
              ok: true,
              message: 'Bot resumed. Discord events will be processed again.',
            })
          }

          if (req.method === 'GET' && pathname === '/api/bot/state') {
            const { getBotLifecycleState } = await import('./runtime-state.ts')
            return json({ ok: true, ...getBotLifecycleState() })
          }
          if (req.method === 'PUT' && pathname === '/api/config') {
            if (readonly) return json({ error: 'read-only' }, { status: 403 })
            const body = await readBoundedJson(req, MAX_CONFIG_BODY_BYTES)
            if (!body.ok) return json({ error: body.error }, { status: body.status })
            if (!body.data || typeof body.data !== 'object') {
              return json({ error: 'expected object' }, { status: 400 })
            }
            const fields = allManifestFields()
            const prevValues = getEffectiveStringValues(fields, false)
            const { merged, errors } = validateAndMergePatch(
              body.data as Record<string, unknown>,
              fields,
            )
            if (!merged) return json({ errors }, { status: 400 })
            const existing = await readOverridesFile()
            try {
              await writeMergedOverrides(existing, merged)
            } catch (e) {
              return json({ error: String(e) }, { status: 500 })
            }
            // Audit + history + WS broadcast
            const changedKeys = Object.keys(merged)
            const jwtUser = await checkJwtAuth(req)
            const actorId = jwtUser?.sub ?? 'dashboard'
            const actorEmail = jwtUser?.email ?? 'dashboard'
            const ip = clientKey(req, serverRef.server)
            void logAudit(
              actorId,
              actorEmail,
              'config_changed',
              changedKeys.join(','),
              {
                keys: changedKeys,
                oldValues: Object.fromEntries(changedKeys.map((k) => [k, prevValues[k] ?? ''])),
              },
              ip,
              req.headers.get('user-agent') || 'unknown',
            )
            void recordSnapshot(
              actorId,
              actorEmail,
              'api_change',
              getEffectiveStringValues(fields, false),
              changedKeys,
              prevValues,
            )
            broadcastConfigChanged(actorId, actorEmail, changedKeys)
            return json({
              ok: true,
              values: getEffectiveStringValues(allManifestFields(), true),
              changedFromBoot: changedFromBoot(allManifestFields()),
              note: 'Saved. Fields marked "Restart required" only take effect after a process restart.',
            })
          }
          // Economy configuration endpoints
          if (req.method === 'GET' && pathname === '/api/economy-config') {
            const { getEconomyConfig } = await import('../services/economy-store.ts')
            const cfg = await getEconomyConfig()
            return json({ ok: true, data: cfg })
          }
          if (req.method === 'PUT' && pathname === '/api/economy-config') {
            if (readonly) return json({ error: 'read-only' }, { status: 403 })
            const { setEconomyConfig } = await import('../services/economy-store.ts')
            const body = await readBoundedJson(req, MAX_CONFIG_BODY_BYTES)
            if (!body.ok) return json({ error: body.error }, { status: body.status })
            if (!body.data || typeof body.data !== 'object') {
              return json({ error: 'expected object' }, { status: 400 })
            }
            try {
              await setEconomyConfig(body.data as Record<string, unknown>)
              const jwtUser = await checkJwtAuth(req)
              const actorId = jwtUser?.sub ?? 'dashboard'
              const actorEmail = jwtUser?.email ?? 'dashboard'
              const ip = clientKey(req, serverRef.server)
              void logAudit(
                actorId,
                actorEmail,
                'economy_config_changed',
                'economy',
                body.data as Record<string, unknown>,
                ip,
                req.headers.get('user-agent') || 'unknown',
              )
              const { getEconomyConfig } = await import('../services/economy-store.ts')
              const cfg = await getEconomyConfig()
              return json({ ok: true, data: cfg })
            } catch (e) {
              return json({ error: String(e) }, { status: 500 })
            }
          }
          if (req.method === 'GET' && pathname.startsWith('/api/data/')) {
            const name = pathname.replace(/^\/api\/data\//, '')
            if (!isDataName(name)) {
              return json({ error: 'unknown data file' }, { status: 404 })
            }
            const file = dataPathFile(DATA_FILES[name])
            try {
              const raw = await readFile(file, 'utf8')
              return new Response(raw, {
                headers: {
                  'content-type': 'application/json; charset=utf-8',
                  'cache-control': 'no-store',
                },
              })
            } catch {
              return json({ error: 'not found or unreadable' }, { status: 404 })
            }
          }
          if (req.method === 'PUT' && pathname.startsWith('/api/data/')) {
            if (readonly) return json({ error: 'read-only' }, { status: 403 })
            const name = pathname.replace(/^\/api\/data\//, '')
            if (!isDataName(name)) {
              return json({ error: 'unknown data file' }, { status: 404 })
            }
            const body = await readBoundedJson(req, MAX_DATA_BODY_BYTES)
            if (!body.ok) return json({ error: body.error }, { status: body.status })
            if (
              body.data === null ||
              (typeof body.data !== 'object' && !Array.isArray(body.data))
            ) {
              return json({ error: 'expected JSON object or array' }, { status: 400 })
            }
            const file = dataPathFile(DATA_FILES[name])
            try {
              await writeFileAtomic(file, JSON.stringify(body.data, null, 2) + '\n')
            } catch (e) {
              return json({ error: String(e) }, { status: 500 })
            }
            return json({ ok: true })
          }

          // ===== ANALYTICS ENDPOINTS =====
          if (req.method === 'GET' && pathname === '/api/analytics/summary') {
            try {
              const days = parseInt(url.searchParams.get('days') ?? '30', 10)
              const summary = await getAnalyticsSummary(days)
              return json({ ok: true, data: summary })
            } catch (e) {
              return json({ ok: false, error: String(e) }, { status: 500 })
            }
          }

          if (req.method === 'GET' && pathname === '/api/analytics/messages') {
            try {
              const days = parseInt(url.searchParams.get('days') ?? '30', 10)
              const data = await getMessageCountByDay(days)
              return json({ ok: true, data })
            } catch (e) {
              return json({ ok: false, error: String(e) }, { status: 500 })
            }
          }

          if (req.method === 'GET' && pathname === '/api/analytics/top-users') {
            try {
              const limit = parseInt(url.searchParams.get('limit') ?? '10', 10)
              const data = await getTopUsersByMessages(limit)
              return json({ ok: true, data })
            } catch (e) {
              return json({ ok: false, error: String(e) }, { status: 500 })
            }
          }

          if (req.method === 'GET' && pathname === '/api/analytics/intents') {
            try {
              const data = await getIntentDistribution()
              return json({ ok: true, data })
            } catch (e) {
              return json({ ok: false, error: String(e) }, { status: 500 })
            }
          }

          if (req.method === 'GET' && pathname === '/api/analytics/commands') {
            try {
              const limit = parseInt(url.searchParams.get('limit') ?? '10', 10)
              const data = await getCustomCommandUsage(limit)
              return json({ ok: true, data })
            } catch (e) {
              return json({ ok: false, error: String(e) }, { status: 500 })
            }
          }

          if (req.method === 'GET' && pathname === '/api/analytics/models') {
            try {
              const data = await getModelUsageDistribution()
              return json({ ok: true, data })
            } catch (e) {
              return json({ ok: false, error: String(e) }, { status: 500 })
            }
          }

          // ===== MEMBERS ENDPOINTS =====
          // Enriched list — joins profile + reputation + warnings + notes + badges
          if (req.method === 'GET' && pathname === '/api/members/full') {
            try {
              const limit = parseInt(url.searchParams.get('limit') ?? '200', 10)
              const sortBy = (url.searchParams.get('sort') as string) || 'lastActivityAt'

              const { getDiscordClient } = await import('./runtime-state.ts')
              const client = getDiscordClient<any>()
              const guild = client?.guilds.cache.first()

              const profiles = await getAllProfiles()
              const profilesMap = new Map(profiles.map((p) => [p.userId, p]))

              let fetchedMembers: any = new Map()
              if (guild) {
                fetchedMembers = await guild.members.fetch().catch(() => new Map())
              }

              for (const [userId, gm] of fetchedMembers.entries()) {
                if (!profilesMap.has(userId) && !gm.user.bot) {
                  profilesMap.set(userId, {
                    userId,
                    stats: {
                      messages: 0,
                      level: 0,
                      reputation: 0,
                      ticketsHelped: 0,
                      joinedAt: gm.joinedTimestamp || Date.now(),
                      lastActivityAt: 0,
                    },
                    badges: [],
                  })
                }
              }

              const combinedProfiles = Array.from(profilesMap.values())

              const enriched = await Promise.all(
                combinedProfiles.map(async (p) => {
                  const [rep, warns, notes, badges] = await Promise.all([
                    getReputation(p.userId).catch(() => null),
                    getWarnings(p.userId).catch(() => null),
                    getUserNotes(p.userId).catch(() => null),
                    getUserBadges(p.userId).catch(() => []),
                  ])
                  return {
                    userId: p.userId,
                    bio: p.bio || null,
                    messages: p.stats.messages || 0,
                    level: p.stats.level || 0,
                    reputation: rep?.points ?? p.stats.reputation ?? 0,
                    ticketsHelped: p.stats.ticketsHelped || 0,
                    warnings: warns?.count ?? 0,
                    notesCount: notes?.notes?.length ?? 0,
                    badges: badges || [],
                    badgeCount: (badges || []).length,
                    joinedAt: p.stats.joinedAt || null,
                    lastActivityAt: p.stats.lastActivityAt || null,
                  }
                }),
              )

              // Sort by requested column (default: lastActivityAt desc)
              const sortable: Record<string, (m: any) => number> = {
                lastActivityAt: (m) => m.lastActivityAt || 0,
                messages: (m) => m.messages,
                level: (m) => m.level,
                reputation: (m) => m.reputation,
                warnings: (m) => m.warnings,
                badgeCount: (m) => m.badgeCount,
              }
              const fn = sortable[sortBy] || sortable.lastActivityAt
              enriched.sort((a, b) => fn(b) - fn(a))

              const sliced = enriched.slice(0, limit)

              // Resolve Discord usernames for the sliced active view
              for (const m of sliced as any[]) {
                const gm = fetchedMembers.get(m.userId)
                if (gm) {
                  m.username = gm.user.username
                  m.displayName = gm.displayName || gm.user.username
                  m.avatarUrl = gm.displayAvatarURL({ size: 32 })
                } else {
                  const u = client?.users.cache.get(m.userId)
                  if (u) {
                    m.username = u.username
                    m.displayName = u.displayName ?? u.username
                    m.avatarUrl = u.displayAvatarURL({ size: 32 })
                  }
                }
              }

              return json({
                ok: true,
                data: sliced,
                count: combinedProfiles.length,
                guildId: guild?.id || null,
              })
            } catch (e) {
              return json({ ok: false, error: String(e) }, { status: 500 })
            }
          }

          if (req.method === 'GET' && pathname === '/api/members') {
            try {
              const stat = (url.searchParams.get('stat') as string) || 'messages'
              const limit = parseInt(url.searchParams.get('limit') ?? '50', 10)
              const members = await getMembersByStats(stat as any, limit)
              return json({
                ok: true,
                data: members.map((m) => ({
                  userId: m.userId,
                  [stat]: m.value,
                })),
              })
            } catch (e) {
              return json({ ok: false, error: String(e) }, { status: 500 })
            }
          }

          const memberUserIdMatch = pathname.match(/^\/api\/members\/([^/]+)$/)
          if (memberUserIdMatch && req.method === 'GET') {
            try {
              const userId = memberUserIdMatch[1] ?? ''
              const profile = await getProfile(userId)
              const badges = await getUserBadges(userId)
              const rep = await getReputation(userId)
              const warnings = await getWarnings(userId)
              const notes = await getUserNotes(userId)

              return json({
                ok: true,
                data: {
                  userId,
                  profile,
                  badges,
                  reputation: rep?.points ?? 0,
                  reputationHistory: rep?.history?.slice(-10).reverse() ?? [],
                  warnings: warnings?.count ?? 0,
                  warningHistory: warnings?.warnings?.slice(-10).reverse() ?? [],
                  notes: notes?.notes.length ?? 0,
                  notesList: notes?.notes?.slice(-10).reverse() ?? [],
                },
              })
            } catch (e) {
              return json({ ok: false, error: String(e) }, { status: 500 })
            }
          }

          // GET /api/members/:userId/tickets — list user's open tickets for member card
          const memberTicketsMatch = pathname.match(/^\/api\/members\/([^/]+)\/tickets$/)
          if (memberTicketsMatch && req.method === 'GET') {
            try {
              const userId = memberTicketsMatch[1] ?? ''
              const { listAllOpenTickets } = await import('../services/ticket-store.ts')
              const all = await listAllOpenTickets()
              const data = all
                .filter((t: any) => t.userId === userId)
                .map((t: any) => ({
                  channelId: t.channelId,
                  reason: t.reason,
                  createdAt: t.createdAt,
                  priority: t.priority,
                  staffEngaged: t.staffEngaged,
                }))
              return json({ ok: true, data })
            } catch (e) {
              return json({ ok: false, error: String(e) }, { status: 500 })
            }
          }

          // POST /api/mod-notes — add a staff note to a user
          if (req.method === 'POST' && pathname === '/api/mod-notes') {
            if (readonly) return json({ error: 'read-only' }, { status: 403 })
            const body = await readBoundedJson(req, 4 * 1024)
            if (!body.ok) return json({ error: body.error }, { status: body.status })
            const userId = String((body.data as any)?.userId ?? '').trim()
            const text = String((body.data as any)?.text ?? '').trim()
            const severity = (body.data as any)?.severity as 'low' | 'medium' | 'high' | undefined
            if (!userId || !text)
              return json({ error: 'userId and text required' }, { status: 400 })
            try {
              const { addNote } = await import('../services/mod-notes.ts')
              const jwtUser = await checkJwtAuth(req)
              const staffId = jwtUser?.email || jwtUser?.sub || 'dashboard'
              const record = await addNote(userId, staffId, text, severity)
              void logAudit(
                jwtUser?.sub ?? 'dashboard',
                jwtUser?.email ?? 'dashboard',
                'mod_note_added',
                `user:${userId}`,
                { severity },
                ip,
                req.headers.get('user-agent') || 'unknown',
              )
              return json({ ok: true, data: record })
            } catch (e) {
              return json({ ok: false, error: String(e) }, { status: 500 })
            }
          }

          // ===== MODERATION ENDPOINTS =====
          if (req.method === 'GET' && pathname === '/api/moderation/warnings') {
            try {
              const limit = parseInt(url.searchParams.get('limit') ?? '50', 10)
              const data = await getRecentWarnings(limit)
              return json({ ok: true, data })
            } catch (e) {
              return json({ ok: false, error: String(e) }, { status: 500 })
            }
          }

          if (req.method === 'GET' && pathname === '/api/moderation/needs-attention') {
            try {
              const data = await getUsersNeedingAttention()
              return json({ ok: true, data })
            } catch (e) {
              return json({ ok: false, error: String(e) }, { status: 500 })
            }
          }

          if (req.method === 'GET' && pathname === '/api/moderation/high-severity-notes') {
            try {
              const notesList = await import('../services/mod-notes.ts').then((m) =>
                m.getAllNotes?.(),
              )
              if (!notesList) return json({ ok: true, data: [] })

              const users = Object.entries(notesList)
                .filter(([_, record]: any) => record.notes?.some((n: any) => n.severity === 'high'))
                .slice(0, 20)

              return json({
                ok: true,
                data: users.map(([userId, record]: any) => ({
                  userId,
                  noteCount: record.notes?.length ?? 0,
                  highCount: record.notes?.filter((n: any) => n.severity === 'high').length ?? 0,
                  latestNote: record.notes?.[record.notes.length - 1],
                })),
              })
            } catch (e) {
              return json({ ok: false, error: String(e) }, { status: 500 })
            }
          }

          // ===== TICKETS ENDPOINTS =====
          if (req.method === 'GET' && pathname === '/api/tickets/stats') {
            try {
              const stats = await getGlobalTicketStats()
              return json({ ok: true, data: stats })
            } catch (e) {
              return json({ ok: false, error: String(e) }, { status: 500 })
            }
          }

          if (req.method === 'GET' && pathname === '/api/tickets/list') {
            try {
              const limit = parseInt(url.searchParams.get('limit') ?? '100', 10)
              const status = url.searchParams.get('status') as 'open' | 'closed' | 'all' | null
              const all = await listAllTickets(500)
              const filtered =
                status && status !== 'all' ? all.filter((t) => t.status === status) : all
              return json({
                ok: true,
                data: filtered.slice(0, limit).map((t) => ({
                  id: t.id,
                  channelId: t.channelId,
                  guildId: t.guildId,
                  userId: t.userId,
                  userTag: t.userTag,
                  reason: t.reason,
                  priority: t.priority ?? 'normal',
                  status: t.status,
                  workflowStatus: t.workflowStatus,
                  claimedByTag: t.claimedByTag,
                  openedAt: t.openedAt,
                  closedAt: t.closedAt,
                  firstStaffReplyAt: t.firstStaffReplyAt,
                  slaBreachedAt: t.slaBreachedAt,
                  staffNote: t.staffNote,
                  messageCount: t.messageCount ?? 0,
                })),
                count: filtered.length,
              })
            } catch (e) {
              return json({ ok: false, error: String(e) }, { status: 500 })
            }
          }

          // /api/tickets/:channelId
          const ticketChMatch = pathname.match(/^\/api\/tickets\/([^/]+)$/)
          if (
            ticketChMatch &&
            req.method === 'GET' &&
            ticketChMatch[1] !== 'stats' &&
            ticketChMatch[1] !== 'list' &&
            ticketChMatch[1] !== 'templates'
          ) {
            try {
              const t = await getTicketByChannel(ticketChMatch[1] ?? '')
              if (!t) return json({ ok: false, error: 'not found' }, { status: 404 })
              return json({ ok: true, data: t })
            } catch (e) {
              return json({ ok: false, error: String(e) }, { status: 500 })
            }
          }

          if (req.method === 'GET' && pathname === '/api/tickets/templates') {
            try {
              const list = await listTemplates()
              return json({ ok: true, data: list })
            } catch (e) {
              return json({ ok: false, error: String(e) }, { status: 500 })
            }
          }

          // ===== TICKET ACTIONS (dashboard-driven) =====
          // POST /api/tickets/:channelId/reply  { content }
          const ticketReplyMatch = pathname.match(/^\/api\/tickets\/([^/]+)\/reply$/)
          if (ticketReplyMatch && req.method === 'POST') {
            if (readonly) return json({ error: 'read-only' }, { status: 403 })
            const channelId = ticketReplyMatch[1] ?? ''
            const body = await readBoundedJson(req, 8 * 1024)
            if (!body.ok) return json({ error: body.error }, { status: body.status })
            const content = String((body.data as any)?.content ?? '').trim()
            if (!content) return json({ error: 'content required' }, { status: 400 })

            const { getDiscordClient } = await import('./runtime-state.ts')
            const client = getDiscordClient<any>()
            if (!client) return json({ error: 'Discord not connected' }, { status: 503 })

            try {
              const ch = await client.channels.fetch(channelId).catch(() => null)
              if (!ch || ch.isDMBased?.() || !ch.isTextBased?.()) {
                return json({ error: 'channel not found or not a text channel' }, { status: 404 })
              }
              const ticket = await getTicketByChannel(channelId)
              if (!ticket) return json({ error: 'not a tracked ticket' }, { status: 404 })
              const jwtUser = await checkJwtAuth(req)
              const actor = jwtUser?.email ?? 'dashboard'
              const safe = content.slice(0, 1900)
              await ch.send({ content: `**Nightz Network Live Support** (via Dashboard): ${safe}` })
              await updateTicketPartial(channelId, {
                firstStaffReplyAt: ticket.firstStaffReplyAt ?? Date.now(),
                staffEngaged: true,
              })
              void logAudit(
                jwtUser?.sub ?? 'dashboard',
                actor,
                'ticket_replied',
                `ticket:${channelId}`,
                { length: safe.length },
                ip,
                req.headers.get('user-agent') || 'unknown',
              )
              return json({ ok: true, message: 'Reply posted to ticket channel.' })
            } catch (e) {
              return json({ error: String(e) }, { status: 500 })
            }
          }

          // POST /api/tickets/:channelId/claim
          const ticketClaimMatch = pathname.match(/^\/api\/tickets\/([^/]+)\/claim$/)
          if (ticketClaimMatch && req.method === 'POST') {
            if (readonly) return json({ error: 'read-only' }, { status: 403 })
            const channelId = ticketClaimMatch[1] ?? ''
            const ticket = await getTicketByChannel(channelId)
            if (!ticket) return json({ error: 'not found' }, { status: 404 })

            const jwtUser = await checkJwtAuth(req)
            const actor = jwtUser?.email ?? 'dashboard-operator'
            const claimerId = jwtUser?.sub ?? 'dashboard'

            const { getDiscordClient } = await import('./runtime-state.ts')
            const client = getDiscordClient<any>()

            await updateTicketPartial(channelId, {
              claimedBy: claimerId,
              claimedByTag: actor,
              workflowStatus: 'Claimed',
              staffEngaged: true,
            })

            if (client) {
              try {
                const ch = await client.channels.fetch(channelId).catch(() => null)
                if (ch?.isTextBased?.()) {
                  await ch.send({ content: `🛡️ Ticket claimed by **${actor}** (via Dashboard).` })
                }
              } catch {
                /* ignore */
              }
            }

            void logAudit(
              claimerId,
              actor,
              'ticket_claimed',
              `ticket:${channelId}`,
              {},
              ip,
              req.headers.get('user-agent') || 'unknown',
            )
            return json({ ok: true, message: 'Ticket claimed.' })
          }

          // POST /api/tickets/:channelId/close  { reason? }
          const ticketCloseMatch = pathname.match(/^\/api\/tickets\/([^/]+)\/close$/)
          if (ticketCloseMatch && req.method === 'POST') {
            if (readonly) return json({ error: 'read-only' }, { status: 403 })
            const channelId = ticketCloseMatch[1] ?? ''
            const body = await readBoundedJson(req, 4 * 1024)
            const reason = body.ok
              ? String((body.data as any)?.reason ?? '')
                  .trim()
                  .slice(0, 300)
              : ''
            const ticket = await getTicketByChannel(channelId)
            if (!ticket) return json({ error: 'not found' }, { status: 404 })
            if (ticket.status === 'closed')
              return json({ error: 'already closed' }, { status: 400 })

            const jwtUser = await checkJwtAuth(req)
            const actor = jwtUser?.email ?? 'dashboard-operator'
            const actorId = jwtUser?.sub ?? 'dashboard'

            const closedAt = Date.now()
            await updateTicketPartial(channelId, {
              status: 'closed',
              closedAt,
              closedBy: actorId,
              closedByTag: actor,
              closeReason: reason || 'Closed via dashboard',
              workflowStatus: 'Closed',
            })

            const { getDiscordClient } = await import('./runtime-state.ts')
            const client = getDiscordClient<any>()
            if (client) {
              try {
                const ch = await client.channels.fetch(channelId).catch(() => null)
                if (ch?.isTextBased?.()) {
                  await ch.send({
                    content: `🔒 **Ticket closed** by ${actor} (via Dashboard)${reason ? ` — ${reason}` : ''}.`,
                  })
                }
              } catch {
                /* ignore */
              }
            }

            void logAudit(
              actorId,
              actor,
              'ticket_closed',
              `ticket:${channelId}`,
              { reason },
              ip,
              req.headers.get('user-agent') || 'unknown',
            )
            return json({ ok: true, message: 'Ticket closed.' })
          }

          // POST /api/tickets/:channelId/priority  { level }
          const ticketPriMatch = pathname.match(/^\/api\/tickets\/([^/]+)\/priority$/)
          if (ticketPriMatch && req.method === 'POST') {
            if (readonly) return json({ error: 'read-only' }, { status: 403 })
            const channelId = ticketPriMatch[1] ?? ''
            const body = await readBoundedJson(req, 1024)
            if (!body.ok) return json({ error: body.error }, { status: body.status })
            const level = String((body.data as any)?.level ?? '')
              .trim()
              .toLowerCase()
            if (!['low', 'normal', 'high', 'critical'].includes(level)) {
              return json({ error: 'invalid priority' }, { status: 400 })
            }
            const ticket = await getTicketByChannel(channelId)
            if (!ticket) return json({ error: 'not found' }, { status: 404 })

            await updateTicketPartial(channelId, { priority: level as any })

            const jwtUser = await checkJwtAuth(req)
            const actor = jwtUser?.email ?? 'dashboard'
            void logAudit(
              jwtUser?.sub ?? 'dashboard',
              actor,
              'ticket_priority',
              `ticket:${channelId}`,
              { level },
              ip,
              req.headers.get('user-agent') || 'unknown',
            )
            return json({ ok: true, message: `Priority set to ${level}.` })
          }

          // GET /api/tickets/:channelId/messages — fetch channel message history
          const ticketMsgsMatch = pathname.match(/^\/api\/tickets\/([^/]+)\/messages$/)
          if (ticketMsgsMatch && req.method === 'GET') {
            const channelId = ticketMsgsMatch[1] ?? ''
            const limit = Math.min(Number(url.searchParams.get('limit') ?? '50'), 100)
            const { getDiscordClient } = await import('./runtime-state.ts')
            const client = getDiscordClient<any>()
            if (!client) return json({ error: 'Discord not connected' }, { status: 503 })
            try {
              const ch = await client.channels.fetch(channelId).catch(() => null)
              if (!ch || !ch.isTextBased?.())
                return json({ error: 'channel not found' }, { status: 404 })
              const fetched = await ch.messages.fetch({ limit })
              const messages = [...fetched.values()].reverse().map((m: any) => ({
                id: m.id,
                authorId: m.author.id,
                authorTag: m.author.tag,
                authorBot: m.author.bot,
                content: m.content,
                embeds:
                  m.embeds?.map((e: any) => ({ title: e.title, description: e.description })) ?? [],
                attachments: [...(m.attachments?.values() ?? [])].map((a: any) => ({
                  name: a.name,
                  url: a.url,
                })),
                createdAt: m.createdTimestamp,
              }))
              return json({ ok: true, data: messages })
            } catch (e) {
              return json({ error: String(e) }, { status: 500 })
            }
          }

          // GET /api/guild/bans — list banned users
          if (req.method === 'GET' && pathname === '/api/guild/bans') {
            const { getDiscordClient } = await import('./runtime-state.ts')
            const client = getDiscordClient<any>()
            if (!client) return json({ error: 'Discord not connected' }, { status: 503 })
            try {
              const guild = client.guilds.cache.first()
              if (!guild) return json({ error: 'no guild' }, { status: 503 })
              const bans = await guild.bans.fetch()
              const data = [...bans.values()].map((b: any) => ({
                userId: b.user.id,
                userTag: b.user.tag,
                reason: b.reason ?? null,
              }))
              return json({ ok: true, data })
            } catch (e) {
              return json({ error: String(e) }, { status: 500 })
            }
          }

          // POST /api/guild/unban  { userId }
          if (req.method === 'POST' && pathname === '/api/guild/unban') {
            if (readonly) return json({ error: 'read-only' }, { status: 403 })
            const body = await readBoundedJson(req, 4 * 1024)
            if (!body.ok) return json({ error: body.error }, { status: body.status })
            const userId = String((body.data as any)?.userId ?? '').trim()
            if (!userId) return json({ error: 'userId required' }, { status: 400 })
            const { getDiscordClient } = await import('./runtime-state.ts')
            const client = getDiscordClient<any>()
            if (!client) return json({ error: 'Discord not connected' }, { status: 503 })
            try {
              const guild = client.guilds.cache.first()
              if (!guild) return json({ error: 'no guild' }, { status: 503 })
              await guild.bans.remove(userId, 'Unbanned via dashboard')
              const jwtUser = await checkJwtAuth(req)
              void logAudit(
                jwtUser?.sub ?? 'dashboard',
                jwtUser?.email ?? 'dashboard',
                'user_unbanned',
                `user:${userId}`,
                {},
                ip,
                req.headers.get('user-agent') || 'unknown',
              )
              return json({ ok: true })
            } catch (e) {
              return json({ error: String(e) }, { status: 500 })
            }
          }

          // POST /api/guild/kick  { userId, reason }
          if (req.method === 'POST' && pathname === '/api/guild/kick') {
            if (readonly) return json({ error: 'read-only' }, { status: 403 })
            const body = await readBoundedJson(req, 4 * 1024)
            if (!body.ok) return json({ error: body.error }, { status: body.status })
            const userId = String((body.data as any)?.userId ?? '').trim()
            const reason = String((body.data as any)?.reason ?? 'Kicked via dashboard').trim()
            if (!userId) return json({ error: 'userId required' }, { status: 400 })
            const { getDiscordClient } = await import('./runtime-state.ts')
            const client = getDiscordClient<any>()
            if (!client) return json({ error: 'Discord not connected' }, { status: 503 })
            try {
              const guild = client.guilds.cache.first()
              if (!guild) return json({ error: 'no guild' }, { status: 503 })
              const member = await guild.members.fetch(userId).catch(() => null)
              if (!member) return json({ error: 'Member not found in guild' }, { status: 404 })
              await member.kick(reason)
              const jwtUser = await checkJwtAuth(req)
              void logAudit(
                jwtUser?.sub ?? 'dashboard',
                jwtUser?.email ?? 'dashboard',
                'user_kicked',
                `user:${userId}`,
                { reason },
                ip,
                req.headers.get('user-agent') || 'unknown',
              )
              return json({ ok: true })
            } catch (e) {
              return json({ error: String(e) }, { status: 500 })
            }
          }

          // POST /api/guild/ban  { userId, reason }
          if (req.method === 'POST' && pathname === '/api/guild/ban') {
            if (readonly) return json({ error: 'read-only' }, { status: 403 })
            const body = await readBoundedJson(req, 4 * 1024)
            if (!body.ok) return json({ error: body.error }, { status: body.status })
            const userId = String((body.data as any)?.userId ?? '').trim()
            const reason = String((body.data as any)?.reason ?? 'Banned via dashboard').trim()
            if (!userId) return json({ error: 'userId required' }, { status: 400 })
            const { getDiscordClient } = await import('./runtime-state.ts')
            const client = getDiscordClient<any>()
            if (!client) return json({ error: 'Discord not connected' }, { status: 503 })
            try {
              const guild = client.guilds.cache.first()
              if (!guild) return json({ error: 'no guild' }, { status: 503 })
              await guild.members.ban(userId, { reason })
              const jwtUser = await checkJwtAuth(req)
              void logAudit(
                jwtUser?.sub ?? 'dashboard',
                jwtUser?.email ?? 'dashboard',
                'user_banned',
                `user:${userId}`,
                { reason },
                ip,
                req.headers.get('user-agent') || 'unknown',
              )
              return json({ ok: true })
            } catch (e) {
              return json({ error: String(e) }, { status: 500 })
            }
          }

          // POST /api/guild/announce  { channelId, content }
          if (req.method === 'POST' && pathname === '/api/guild/announce') {
            if (readonly) return json({ error: 'read-only' }, { status: 403 })
            const body = await readBoundedJson(req, 8 * 1024)
            if (!body.ok) return json({ error: body.error }, { status: body.status })
            const channelId = String((body.data as any)?.channelId ?? '').trim()
            const content = String((body.data as any)?.content ?? '').trim()
            if (!channelId || !content)
              return json({ error: 'channelId and content required' }, { status: 400 })
            const { getDiscordClient } = await import('./runtime-state.ts')
            const client = getDiscordClient<any>()
            if (!client) return json({ error: 'Discord not connected' }, { status: 503 })
            try {
              const ch = await client.channels.fetch(channelId).catch(() => null)
              if (!ch || !ch.isTextBased?.())
                return json({ error: 'channel not found' }, { status: 404 })
              await ch.send({ content: content.slice(0, 2000) })
              const jwtUser = await checkJwtAuth(req)
              void logAudit(
                jwtUser?.sub ?? 'dashboard',
                jwtUser?.email ?? 'dashboard',
                'announcement_sent',
                `channel:${channelId}`,
                { length: content.length },
                ip,
                req.headers.get('user-agent') || 'unknown',
              )
              return json({ ok: true })
            } catch (e) {
              return json({ error: String(e) }, { status: 500 })
            }
          }

          // GET /api/guild/channels — list text channels for pickers
          if (req.method === 'GET' && pathname === '/api/guild/channels') {
            const { getDiscordClient } = await import('./runtime-state.ts')
            const client = getDiscordClient<any>()
            if (!client) return json({ error: 'Discord not connected' }, { status: 503 })
            try {
              const guild = client.guilds.cache.first()
              if (!guild) return json({ error: 'no guild' }, { status: 503 })
              const channels = [...guild.channels.cache.values()]
                .filter((c: any) => c.isTextBased?.() && !c.isDMBased?.())
                .map((c: any) => ({ id: c.id, name: c.name, parentName: c.parent?.name ?? null }))
                .sort((a: any, b: any) => a.name.localeCompare(b.name))
              return json({ ok: true, data: channels })
            } catch (e) {
              return json({ error: String(e) }, { status: 500 })
            }
          }

          // GET /api/analytics/leaderboard?stat=reputation&limit=10
          if (req.method === 'GET' && pathname === '/api/analytics/leaderboard') {
            const { getLeaderboard } = await import('./analytics-queries.ts')
            const stat = (url.searchParams.get('stat') as string) || 'reputation'
            const limit = parseInt(url.searchParams.get('limit') ?? '10', 10)
            const data = await getLeaderboard(stat, limit)
            return json({ ok: true, data })
          }

          if (req.method === 'GET' && pathname === '/api/dashboard/health') {
            return json({
              ok: true,
              timestamp: Date.now(),
              uptime: process.uptime(),
            })
          }

          // ===== DISCORD AUDIT LOGS =====
          if (req.method === 'GET' && pathname === '/api/discord-audit') {
            const { getDiscordClient } = await import('./runtime-state.ts')
            const client = getDiscordClient<any>()
            if (!client) return json({ error: 'Discord not connected' }, { status: 503 })
            const { fetchDiscordAuditLogs } = await import('../services/discord-audit.ts')
            const limit = Math.min(Number(url.searchParams.get('limit') ?? '50'), 100)
            const actionCode = url.searchParams.get('action')
              ? Number(url.searchParams.get('action'))
              : undefined
            const userId = url.searchParams.get('userId') || undefined
            const before = url.searchParams.get('before') || undefined
            const category = url.searchParams.get('category') || undefined
            let entries = await fetchDiscordAuditLogs(client, { limit, actionCode, userId, before })
            if (category) entries = entries.filter((e: any) => e.category === category)
            return json({ ok: true, data: entries })
          }

          if (req.method === 'GET' && pathname === '/api/discord-audit/export') {
            const { getDiscordClient } = await import('./runtime-state.ts')
            const client = getDiscordClient<any>()
            if (!client) return json({ error: 'Discord not connected' }, { status: 503 })
            const { fetchDiscordAuditLogs, exportAuditAsCsv } = await import(
              '../services/discord-audit.ts'
            )
            const entries = await fetchDiscordAuditLogs(client, { limit: 100 })
            const csv = exportAuditAsCsv(entries)
            return new Response(csv, {
              headers: {
                'Content-Type': 'text/csv',
                'Content-Disposition': 'attachment; filename="discord-audit.csv"',
              },
            })
          }

          if (req.method === 'GET' && pathname === '/api/discord-audit/mod-actions') {
            const { getDiscordClient } = await import('./runtime-state.ts')
            const client = getDiscordClient<any>()
            if (!client) return json({ error: 'Discord not connected' }, { status: 503 })
            const { fetchModActions } = await import('../services/discord-audit.ts')
            const limit = Math.min(Number(url.searchParams.get('limit') ?? '50'), 100)
            const entries = await fetchModActions(client, limit)
            return json({ ok: true, data: entries })
          }

          if (req.method === 'GET' && pathname === '/api/discord-audit/alerts') {
            const { getDiscordClient } = await import('./runtime-state.ts')
            const client = getDiscordClient<any>()
            if (!client) return json({ error: 'Discord not connected' }, { status: 503 })
            const { detectAlerts } = await import('../services/discord-audit.ts')
            const alerts = await detectAlerts(client)
            return json({ ok: true, data: alerts })
          }

          // ===== REQUEST LOG =====
          if (req.method === 'GET' && pathname === '/api/request-log') {
            const limit = Math.min(Number(url.searchParams.get('limit') ?? '200'), 500)
            return json({ ok: true, data: getRequestLog(limit) })
          }
          if (req.method === 'DELETE' && pathname === '/api/request-log') {
            if (readonly) return json({ error: 'read-only' }, { status: 403 })
            clearRequestLog()
            return json({ ok: true })
          }

          // GET /api/guild/users/resolve?ids=id1,id2,...
          // Returns { userId: { username, displayName, avatarUrl } } for each resolvable ID
          if (req.method === 'GET' && pathname === '/api/guild/users/resolve') {
            const { getDiscordClient } = await import('./runtime-state.ts')
            const client = getDiscordClient<any>()
            const idsParam = url.searchParams.get('ids') ?? ''
            const ids = idsParam
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
              .slice(0, 100)
            const result: Record<
              string,
              { username: string; displayName: string; avatarUrl: string | null }
            > = {}
            if (client) {
              const guild = client.guilds.cache.first()
              await Promise.all(
                ids.map(async (id) => {
                  try {
                    const member = guild ? await guild.members.fetch(id).catch(() => null) : null
                    if (member) {
                      result[id] = {
                        username: member.user.username,
                        displayName: member.displayName,
                        avatarUrl: member.user.displayAvatarURL({ size: 32 }),
                      }
                    } else {
                      // Try fetching user directly (may not be in guild)
                      const user = await client.users.fetch(id).catch(() => null)
                      if (user) {
                        result[id] = {
                          username: user.username,
                          displayName: user.globalName ?? user.username,
                          avatarUrl: user.displayAvatarURL({ size: 32 }),
                        }
                      }
                    }
                  } catch {
                    /* skip unresolvable */
                  }
                }),
              )
            }
            return json({ ok: true, data: result })
          }

          // ===== CUSTOM COMMANDS ENDPOINTS =====
          if (req.method === 'GET' && pathname === '/api/custom-commands') {
            const { listCommands } = await import('../services/custom-commands.ts')
            const cmds = listCommands().map(({ name, command }) => ({ name, ...command }))
            return json({ ok: true, data: cmds })
          }
          if (req.method === 'POST' && pathname === '/api/custom-commands') {
            if (readonly) return json({ error: 'read-only' }, { status: 403 })
            const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
            const name = String(body.name ?? '').trim()
            const response = String(body.response ?? '').trim()
            const aliases = Array.isArray(body.aliases) ? (body.aliases as string[]) : []
            if (!name || !response)
              return json({ error: 'name and response required' }, { status: 400 })
            const { addCommand } = await import('../services/custom-commands.ts')
            const result = await addCommand(name, response, 'dashboard-admin', aliases)
            if (!result.ok) return json({ error: result.error }, { status: 400 })
            return json({ ok: true })
          }
          if (req.method === 'PATCH' && pathname.startsWith('/api/custom-commands/')) {
            if (readonly) return json({ error: 'read-only' }, { status: 403 })
            const name = decodeURIComponent(pathname.split('/api/custom-commands/')[1] ?? '')
            const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
            const { forceUpdateCommand } = await import('../services/custom-commands.ts')
            const result = await forceUpdateCommand(name, {
              ...(body.response !== undefined ? { response: String(body.response) } : {}),
              ...(body.cooldown !== undefined ? { cooldown: Number(body.cooldown) } : {}),
              ...(body.permissions !== undefined ? { permissions: body.permissions as any } : {}),
              ...(Array.isArray(body.aliases) ? { aliases: body.aliases as string[] } : {}),
            })
            if (!result.ok) return json({ error: result.error }, { status: 400 })
            return json({ ok: true })
          }
          if (req.method === 'DELETE' && pathname.startsWith('/api/custom-commands/')) {
            if (readonly) return json({ error: 'read-only' }, { status: 403 })
            const name = decodeURIComponent(pathname.split('/api/custom-commands/')[1] ?? '')
            const { forceDeleteCommand } = await import('../services/custom-commands.ts')
            const deleted = await forceDeleteCommand(name)
            if (!deleted) return json({ error: 'Command not found' }, { status: 404 })
            return json({ ok: true })
          }

          // ===== MACROS ENDPOINTS =====
          if (req.method === 'GET' && pathname === '/api/macros') {
            const { listMacros } = await import('../services/macros-store.ts')
            return json({ ok: true, data: await listMacros() })
          }
          if (req.method === 'POST' && pathname === '/api/macros') {
            if (readonly) return json({ error: 'read-only' }, { status: 403 })
            const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
            const key = String(body.key ?? '').trim()
            const bodyText = String(body.body ?? '').trim()
            if (!key || !bodyText) return json({ error: 'key and body required' }, { status: 400 })
            const { setMacro } = await import('../services/macros-store.ts')
            await setMacro(key, bodyText)
            return json({ ok: true })
          }
          if (req.method === 'DELETE' && pathname.startsWith('/api/macros/')) {
            if (readonly) return json({ error: 'read-only' }, { status: 403 })
            const key = decodeURIComponent(pathname.split('/api/macros/')[1] ?? '')
            const { deleteMacro } = await import('../services/macros-store.ts')
            const deleted = await deleteMacro(key)
            if (!deleted) return json({ error: 'Macro not found' }, { status: 404 })
            return json({ ok: true })
          }

          // ===== WARNINGS MANAGEMENT ENDPOINTS =====
          if (req.method === 'POST' && pathname === '/api/warnings') {
            if (readonly) return json({ error: 'read-only' }, { status: 403 })
            const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
            const userId = String(body.userId ?? '').trim()
            const reason = String(body.reason ?? '').trim()
            if (!userId || !reason)
              return json({ error: 'userId and reason required' }, { status: 400 })
            const { addWarning } = await import('../services/warnings.ts')
            const result = await addWarning(userId, 'dashboard-admin', reason)
            return json({ ok: true, data: result })
          }
          if (req.method === 'DELETE' && pathname.startsWith('/api/warnings/')) {
            if (readonly) return json({ error: 'read-only' }, { status: 403 })
            const userId = decodeURIComponent(pathname.split('/api/warnings/')[1] ?? '')
            const { clearWarnings } = await import('../services/warnings.ts')
            await clearWarnings(userId)
            return json({ ok: true })
          }

          // ===== AI AUTOMOD STRIKES ENDPOINT =====
          if (req.method === 'GET' && pathname === '/api/automod/strikes') {
            const { readJson } = await import('../services/data-store.ts')
            const raw = await readJson<
              Record<
                string,
                {
                  strikes: number
                  autoWarned: boolean
                  autoKicked: boolean
                  autoBanned: boolean
                  lastStrikeAt: number
                }
              >
            >('ai-automod-strikes.json', {})
            const {
              aiAutomodEscalationWarnAt,
              aiAutomodEscalationKickAt,
              aiAutomodEscalationBanAt,
              aiAutomodEscalationDecayDays,
            } = await import('../config.ts')
            const rows = Object.entries(raw)
              .map(([key, rec]) => {
                const [guildId, userId] = key.split(':')
                return {
                  guildId,
                  userId,
                  ...rec,
                  warnAt: aiAutomodEscalationWarnAt,
                  kickAt: aiAutomodEscalationKickAt,
                  banAt: aiAutomodEscalationBanAt,
                  decayDays: aiAutomodEscalationDecayDays,
                }
              })
              .sort((a, b) => b.strikes - a.strikes)
            return json({ ok: true, data: rows })
          }
          if (req.method === 'DELETE' && pathname.startsWith('/api/automod/strikes/')) {
            if (readonly) return json({ error: 'read-only' }, { status: 403 })
            const key = decodeURIComponent(pathname.split('/api/automod/strikes/')[1] ?? '')
            const { readJson, writeJson } = await import('../services/data-store.ts')
            const raw = await readJson<Record<string, unknown>>('ai-automod-strikes.json', {})
            delete raw[key]
            await writeJson('ai-automod-strikes.json', raw)
            return json({ ok: true })
          }

          // ===== COUNTER CHANNELS ENDPOINTS =====
          if (req.method === 'GET' && pathname === '/api/counters') {
            try {
              const { listCountersWithPreview, listAvailableStats } = await import(
                '../services/counter-channels.ts'
              )
              const { getDiscordClient } = await import('./runtime-state.ts')
              const client = getDiscordClient<any>()
              const data = client ? await listCountersWithPreview(client) : []
              const stats = listAvailableStats()
              return json({ ok: true, data, stats })
            } catch (e) {
              return json({ ok: false, error: String(e) }, { status: 500 })
            }
          }
          if (req.method === 'POST' && pathname === '/api/counters') {
            if (readonly) return json({ error: 'read-only' }, { status: 403 })
            const body = await readBoundedJson(req, 4 * 1024)
            if (!body.ok) return json({ error: body.error }, { status: body.status })
            const d = body.data as any
            const { addCounter, applyCounterForRow } = await import(
              '../services/counter-channels.ts'
            )
            const { getDiscordClient } = await import('./runtime-state.ts')
            const client = getDiscordClient<any>()
            if (!client) return json({ error: 'Discord not connected' }, { status: 503 })
            const guildId = String(d?.guildId ?? client.guilds.cache.first()?.id ?? '').trim()
            if (!guildId) return json({ error: 'guildId required' }, { status: 400 })
            const result = await addCounter(
              guildId,
              String(d?.channelId ?? ''),
              String(d?.stat ?? ''),
              d?.template,
            )
            if (!result.ok) return json({ error: result.error }, { status: 400 })
            // Trigger immediate apply
            void applyCounterForRow(client, result.row).catch(() => {})
            const jwtUser = await checkJwtAuth(req)
            void logAudit(
              jwtUser?.sub ?? 'dashboard',
              jwtUser?.email ?? 'dashboard',
              'counter_added',
              `counter:${result.row.channelId}`,
              { stat: result.row.stat },
              ip,
              req.headers.get('user-agent') || 'unknown',
            )
            return json({ ok: true, data: result.row })
          }
          const counterChannelMatch = pathname.match(/^\/api\/counters\/([^/]+)$/)
          if (counterChannelMatch && req.method === 'PATCH') {
            if (readonly) return json({ error: 'read-only' }, { status: 403 })
            const body = await readBoundedJson(req, 4 * 1024)
            if (!body.ok) return json({ error: body.error }, { status: body.status })
            const { updateCounter, applyCounterForRow } = await import(
              '../services/counter-channels.ts'
            )
            const { getDiscordClient } = await import('./runtime-state.ts')
            const result = await updateCounter(counterChannelMatch[1] ?? '', body.data as any)
            if (!result.ok) return json({ error: result.error }, { status: 400 })
            const client = getDiscordClient<any>()
            if (client) void applyCounterForRow(client, result.row).catch(() => {})
            const jwtUser = await checkJwtAuth(req)
            void logAudit(
              jwtUser?.sub ?? 'dashboard',
              jwtUser?.email ?? 'dashboard',
              'counter_updated',
              `counter:${counterChannelMatch[1]}`,
              {},
              ip,
              req.headers.get('user-agent') || 'unknown',
            )
            return json({ ok: true, data: result.row })
          }
          if (counterChannelMatch && req.method === 'DELETE') {
            if (readonly) return json({ error: 'read-only' }, { status: 403 })
            const { deleteCounter } = await import('../services/counter-channels.ts')
            const ok = await deleteCounter(counterChannelMatch[1] ?? '')
            if (!ok) return json({ error: 'not found' }, { status: 404 })
            const jwtUser = await checkJwtAuth(req)
            void logAudit(
              jwtUser?.sub ?? 'dashboard',
              jwtUser?.email ?? 'dashboard',
              'counter_deleted',
              `counter:${counterChannelMatch[1]}`,
              {},
              ip,
              req.headers.get('user-agent') || 'unknown',
            )
            return json({ ok: true })
          }
          if (req.method === 'POST' && pathname === '/api/counters/refresh') {
            if (readonly) return json({ error: 'read-only' }, { status: 403 })
            const { refreshAllGlobal } = await import('../services/counter-channels.ts')
            const { getDiscordClient } = await import('./runtime-state.ts')
            const client = getDiscordClient<any>()
            if (!client) return json({ error: 'Discord not connected' }, { status: 503 })
            void refreshAllGlobal(client).catch(() => {})
            return json({ ok: true, message: 'Refresh triggered' })
          }

          // ===== SUGGESTIONS ENDPOINTS =====
          if (req.method === 'GET' && pathname === '/api/suggestions') {
            try {
              const status = url.searchParams.get('status') || 'all'
              const { listAll } = await import('../services/suggestions-store.ts')
              let data = await listAll()
              if (status !== 'all') data = data.filter((s) => s.status === status)
              return json({ ok: true, data })
            } catch (e) {
              return json({ ok: false, error: String(e) }, { status: 500 })
            }
          }
          if (req.method === 'GET' && pathname === '/api/suggestions/stats') {
            try {
              const { getStats } = await import('../services/suggestions-store.ts')
              const data = await getStats()
              return json({ ok: true, data })
            } catch (e) {
              return json({ ok: false, error: String(e) }, { status: 500 })
            }
          }
          const suggestionMatch = pathname.match(
            /^\/api\/suggestions\/([^/]+)\/(approve|deny|implement)$/,
          )
          if (suggestionMatch && req.method === 'POST') {
            if (readonly) return json({ error: 'read-only' }, { status: 403 })
            const id = suggestionMatch[1] ?? ''
            const action = suggestionMatch[2]
            try {
              const { setStatus, findById } = await import('../services/suggestions-store.ts')
              const newStatus =
                action === 'implement'
                  ? 'approved'
                  : ((action === 'approve' ? 'approved' : 'denied') as
                      | 'open'
                      | 'approved'
                      | 'denied')
              await setStatus(id, newStatus)
              const entry = await findById(id)
              // Broadcast state change
              try {
                const { broadcastActivity } = await import('./websocket.ts')
                broadcastActivity('suggestion_state_changed', {
                  id,
                  status: newStatus,
                  content: entry?.content?.slice(0, 80),
                })
              } catch {
                /* ignore */
              }
              const jwtUser = await checkJwtAuth(req)
              void logAudit(
                jwtUser?.sub ?? 'dashboard',
                jwtUser?.email ?? 'dashboard',
                'suggestion_' + action,
                `suggestion:${id}`,
                {},
                ip,
                req.headers.get('user-agent') || 'unknown',
              )
              return json({ ok: true, data: entry })
            } catch (e) {
              return json({ ok: false, error: String(e) }, { status: 500 })
            }
          }

          // ===== GIVEAWAYS ENDPOINTS =====
          if (req.method === 'GET' && pathname === '/api/giveaways') {
            try {
              const { listAllGiveaways } = await import('../services/giveaways-store.ts')
              const data = await listAllGiveaways()
              data.sort((a, b) => b.endsAt - a.endsAt)
              return json({ ok: true, data })
            } catch (e) {
              return json({ ok: false, error: String(e) }, { status: 500 })
            }
          }
          if (req.method === 'POST' && pathname === '/api/giveaways') {
            if (readonly) return json({ error: 'read-only' }, { status: 403 })
            const body = await readBoundedJson(req, 4 * 1024)
            if (!body.ok) return json({ error: body.error }, { status: body.status })
            const d = body.data as any
            const { createGiveawayFromDashboard } = await import('../handlers/prefix-extra.ts')
            const { getDiscordClient } = await import('./runtime-state.ts')
            const client = getDiscordClient<any>()
            if (!client) return json({ error: 'Discord not connected' }, { status: 503 })
            const jwtUser = await checkJwtAuth(req)
            const guildId = String(d?.guildId ?? client.guilds.cache.first()?.id ?? '').trim()
            const channelId = String(d?.channelId ?? '').trim()
            const prize = String(d?.prize ?? '').trim()
            const durationMs = parseInt(d?.durationMs, 10) || 0
            const winnerCount = parseInt(d?.winnerCount, 10) || 1
            if (!guildId || !channelId || !prize || durationMs <= 0) {
              return json({ error: 'guildId/channelId/prize/durationMs required' }, { status: 400 })
            }
            const result = await createGiveawayFromDashboard(client, {
              guildId,
              channelId,
              prize,
              durationMs,
              winnerCount,
              hostId: jwtUser?.sub ?? 'dashboard',
            })
            if (!result.ok) return json({ error: result.error }, { status: 500 })
            void logAudit(
              jwtUser?.sub ?? 'dashboard',
              jwtUser?.email ?? 'dashboard',
              'giveaway_created',
              `giveaway:${result.data?.id}`,
              { prize },
              ip,
              req.headers.get('user-agent') || 'unknown',
            )
            return json({ ok: true, data: result.data })
          }
          const giveawayEndMatch = pathname.match(/^\/api\/giveaways\/([^/]+)\/end$/)
          if (giveawayEndMatch && req.method === 'POST') {
            if (readonly) return json({ error: 'read-only' }, { status: 403 })
            const { endGiveawayDraw } = await import('../handlers/prefix-extra.ts')
            const { getDiscordClient } = await import('./runtime-state.ts')
            const client = getDiscordClient<any>()
            if (!client) return json({ error: 'Discord not connected' }, { status: 503 })
            const result = await endGiveawayDraw(client, giveawayEndMatch[1] ?? '')
            const jwtUser = await checkJwtAuth(req)
            void logAudit(
              jwtUser?.sub ?? 'dashboard',
              jwtUser?.email ?? 'dashboard',
              'giveaway_ended',
              `giveaway:${giveawayEndMatch[1]}`,
              {},
              ip,
              req.headers.get('user-agent') || 'unknown',
            )
            return json({ ok: result.ok, data: { winners: result.winners, prize: result.prize } })
          }
          const giveawayRerollMatch = pathname.match(/^\/api\/giveaways\/([^/]+)\/reroll$/)
          if (giveawayRerollMatch && req.method === 'POST') {
            if (readonly) return json({ error: 'read-only' }, { status: 403 })
            const { rerollGiveawayDraw } = await import('../handlers/prefix-extra.ts')
            const { getDiscordClient } = await import('./runtime-state.ts')
            const client = getDiscordClient<any>()
            if (!client) return json({ error: 'Discord not connected' }, { status: 503 })
            const result = await rerollGiveawayDraw(client, giveawayRerollMatch[1] ?? '')
            if (!result.ok) return json({ error: result.error }, { status: 400 })
            const jwtUser = await checkJwtAuth(req)
            void logAudit(
              jwtUser?.sub ?? 'dashboard',
              jwtUser?.email ?? 'dashboard',
              'giveaway_rerolled',
              `giveaway:${giveawayRerollMatch[1]}`,
              {},
              ip,
              req.headers.get('user-agent') || 'unknown',
            )
            return json({ ok: true, data: { winners: result.winners } })
          }

          // ===== POLLS ENDPOINTS =====
          if (req.method === 'GET' && pathname === '/api/polls') {
            try {
              const status = url.searchParams.get('status') || 'all'
              const { readJson } = await import('../services/data-store.ts')
              const raw = await readJson<any>('poll-tracks.json', { tracks: [] })
              const all: any[] = Array.isArray(raw) ? raw : (raw?.tracks ?? raw?.polls ?? [])
              const { getDiscordClient } = await import('./runtime-state.ts')
              const client = getDiscordClient<any>()
              const guild = client?.guilds.cache.first()
              const guildId = guild?.id
              const now = Date.now()
              let data = (all || []).map((p: any) => {
                const ended = !!p.ended || (p.expiresAt && now >= p.expiresAt)
                return {
                  ...p,
                  ended,
                  jumpUrl:
                    guildId && p.channelId && p.messageId
                      ? `https://discord.com/channels/${guildId}/${p.channelId}/${p.messageId}`
                      : null,
                }
              })
              if (status === 'active') data = data.filter((p: any) => !p.ended)
              if (status === 'ended') data = data.filter((p: any) => p.ended)
              data.sort((a: any, b: any) => (b.createdAt || 0) - (a.createdAt || 0))
              return json({ ok: true, data })
            } catch (e) {
              return json({ ok: false, error: String(e) }, { status: 500 })
            }
          }

          // ===== SCHEDULER ENDPOINTS =====
          if (req.method === 'GET' && pathname === '/api/schedules') {
            try {
              const { listSchedules } = await import('../services/scheduler-store.ts')
              const data = await listSchedules()
              data.sort((a: any, b: any) => (a.runAt || 0) - (b.runAt || 0))
              return json({ ok: true, data })
            } catch (e) {
              return json({ ok: false, error: String(e) }, { status: 500 })
            }
          }
          if (req.method === 'POST' && pathname === '/api/schedules') {
            if (readonly) return json({ error: 'read-only' }, { status: 403 })
            const body = await readBoundedJson(req, 8 * 1024)
            if (!body.ok) return json({ error: body.error }, { status: body.status })
            const d = body.data as any
            const channelId = String(d?.channelId ?? '').trim()
            const content = String(d?.content ?? '').trim()
            const runAt = parseInt(d?.runAt, 10)
            if (!channelId || !content || !Number.isFinite(runAt)) {
              return json({ error: 'channelId/content/runAt required' }, { status: 400 })
            }
            const { addSchedule } = await import('../services/scheduler-store.ts')
            const { randomBytes } = await import('node:crypto')
            const { getDiscordClient } = await import('./runtime-state.ts')
            const sClient = getDiscordClient<any>()
            const guildId = String(d?.guildId ?? sClient?.guilds.cache.first()?.id ?? '').trim()
            const jwtUserEarly = await checkJwtAuth(req)
            const entry = {
              id: randomBytes(8).toString('hex'),
              guildId,
              channelId,
              content,
              runAt,
              repeatMs: d?.repeatMs ? parseInt(d.repeatMs, 10) : null,
              authorId: jwtUserEarly?.sub || 'dashboard',
            }
            await addSchedule(entry)
            const jwtUser = await checkJwtAuth(req)
            void logAudit(
              jwtUser?.sub ?? 'dashboard',
              jwtUser?.email ?? 'dashboard',
              'schedule_created',
              `schedule:${entry.id}`,
              { runAt },
              ip,
              req.headers.get('user-agent') || 'unknown',
            )
            return json({ ok: true, data: entry })
          }
          const scheduleDeleteMatch = pathname.match(/^\/api\/schedules\/([^/]+)$/)
          if (scheduleDeleteMatch && req.method === 'DELETE') {
            if (readonly) return json({ error: 'read-only' }, { status: 403 })
            const { removeSchedule } = await import('../services/scheduler-store.ts')
            await removeSchedule(scheduleDeleteMatch[1] ?? '')
            const jwtUser = await checkJwtAuth(req)
            void logAudit(
              jwtUser?.sub ?? 'dashboard',
              jwtUser?.email ?? 'dashboard',
              'schedule_deleted',
              `schedule:${scheduleDeleteMatch[1]}`,
              {},
              ip,
              req.headers.get('user-agent') || 'unknown',
            )
            return json({ ok: true })
          }

          // ===== SHOP ENDPOINTS =====
          if (req.method === 'GET' && pathname === '/api/shop/items') {
            const { getAllShopItems } = await import('../services/shop-store.ts')
            return json({ ok: true, data: await getAllShopItems() })
          }
          if (req.method === 'POST' && pathname === '/api/shop/items') {
            if (readonly) return json({ error: 'read-only' }, { status: 403 })
            const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
            const { addShopItem } = await import('../services/shop-store.ts')
            const item = await addShopItem({
              name: String(body.name ?? 'Unnamed'),
              description: String(body.description ?? ''),
              price: Math.max(1, Number(body.price) || 1),
              type: body.type === 'role' ? 'role' : 'item',
              roleId: body.roleId ? String(body.roleId) : undefined,
              stock:
                body.stock !== undefined && body.stock !== null
                  ? Math.max(0, Number(body.stock))
                  : undefined,
              emoji: body.emoji ? String(body.emoji) : undefined,
            })
            return json({ ok: true, data: item })
          }
          if (req.method === 'PATCH' && pathname.startsWith('/api/shop/items/')) {
            if (readonly) return json({ error: 'read-only' }, { status: 403 })
            const id = pathname.split('/').pop()!
            const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
            const { updateShopItem } = await import('../services/shop-store.ts')
            const updated = await updateShopItem(id, body as any)
            if (!updated) return json({ error: 'Not found' }, { status: 404 })
            return json({ ok: true, data: updated })
          }
          if (req.method === 'DELETE' && pathname.startsWith('/api/shop/items/')) {
            if (readonly) return json({ error: 'read-only' }, { status: 403 })
            const id = pathname.split('/').pop()!
            const { removeShopItem } = await import('../services/shop-store.ts')
            const ok = await removeShopItem(id)
            return json({ ok })
          }

          // ===== LEVEL ROLES ENDPOINTS =====
          if (req.method === 'GET' && pathname === '/api/levelroles') {
            const { getDiscordClient } = await import('./runtime-state.ts')
            const client = getDiscordClient<any>()
            const guild = client?.guilds.cache.first()
            if (!guild) return json({ error: 'No guild' }, { status: 503 })
            const { getLevelRoles } = await import('../services/level-roles.ts')
            const roles = await getLevelRoles(guild.id)
            // Enrich with role name/color from Discord
            const enriched = roles.map((r) => {
              const role = guild.roles.cache.get(r.roleId)
              return {
                ...r,
                roleName: role?.name ?? 'Unknown',
                roleColor: role?.hexColor ?? '#888',
              }
            })
            return json({ ok: true, data: enriched, guildId: guild.id })
          }
          if (req.method === 'POST' && pathname === '/api/levelroles') {
            if (readonly) return json({ error: 'read-only' }, { status: 403 })
            const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
            const guildId = String(body.guildId ?? '')
            const level = Number(body.level)
            const roleId = String(body.roleId ?? '')
            if (!guildId || !level || !roleId)
              return json({ error: 'guildId, level, roleId required' }, { status: 400 })
            const { setLevelRole, backfillLevelRole } = await import('../services/level-roles.ts')
            const { getDiscordClient } = await import('./runtime-state.ts')
            const client = getDiscordClient<any>()
            await setLevelRole(guildId, level, roleId)
            // Fire backfill in background — don't block the API response
            void backfillLevelRole(client, guildId, level, roleId).catch(() => {})
            return json({ ok: true })
          }
          if (req.method === 'DELETE' && pathname.startsWith('/api/levelroles/')) {
            if (readonly) return json({ error: 'read-only' }, { status: 403 })
            const parts = pathname.split('/') // /api/levelroles/:guildId/:level
            const level = Number(parts.pop())
            const guildId = String(parts.pop() ?? '')
            if (!guildId || !level)
              return json({ error: 'guildId and level required' }, { status: 400 })
            const { removeLevelRole } = await import('../services/level-roles.ts')
            await removeLevelRole(guildId, level)
            return json({ ok: true })
          }

          // ===== ECONOMY ENDPOINTS =====
          if (req.method === 'GET' && pathname === '/api/economy/leaderboard') {
            const { richestUsers } = await import('../services/economy-store.ts')
            const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '10', 10), 50)
            const data = await richestUsers(limit)
            return json({ ok: true, data })
          }

          if (req.method === 'GET' && pathname.startsWith('/api/economy/user/')) {
            const userId = pathname.split('/').pop()!
            const { getBalance } = await import('../services/economy-store.ts')
            const rec = await getBalance(userId)
            return json({ ok: true, data: { userId, ...rec } })
          }

          if (req.method === 'PATCH' && pathname.startsWith('/api/economy/user/')) {
            if (readonly) return json({ error: 'read-only' }, { status: 403 })
            const userId = pathname.split('/').pop()!
            const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
            const { setBalance } = await import('../services/economy-store.ts')
            if (typeof body.balance === 'number') await setBalance(userId, body.balance)
            return json({ ok: true })
          }

          // ===== LEVELS ENDPOINTS =====
          if (req.method === 'GET' && pathname === '/api/levels/leaderboard') {
            const { getLeaderboard } = await import('./analytics-queries.ts')
            const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '10', 10), 50)
            const stat = url.searchParams.get('stat') ?? 'level'
            const data = await getLeaderboard(stat, limit)
            return json({ ok: true, data })
          }

          if (req.method === 'GET' && pathname === '/api/levels/list') {
            const { readFile: rf } = await import('node:fs/promises')
            const { join: pj } = await import('node:path')
            const raw = await rf(pj(DATA_DIR, 'levels.json'), 'utf8').catch(() => '{}')
            const map = JSON.parse(raw) as Record<
              string,
              Record<
                string,
                { messageCount?: number; messages?: number; level?: number; xp?: number }
              >
            >
            const agg: Record<
              string,
              { messages: number; level: number; xp: number; guildId: string }
            > = {}
            for (const [guildId, guildData] of Object.entries(map)) {
              for (const [uid, d] of Object.entries(guildData)) {
                if (!agg[uid]) agg[uid] = { messages: 0, level: 0, xp: 0, guildId }
                agg[uid].messages += d.messageCount ?? d.messages ?? 0
                if ((d.level ?? 0) >= agg[uid].level) {
                  agg[uid].level = d.level ?? 0
                  agg[uid].guildId = guildId
                }
                agg[uid].xp += d.xp ?? 0
              }
            }
            const data = Object.entries(agg)
              .map(([userId, v]) => ({ userId, ...v }))
              .sort((a, b) => b.xp - a.xp)
            return json({ ok: true, data })
          }

          // PATCH /api/levels/user/:userId  { guildId, xp?, level?, messageCount? }
          if (req.method === 'PATCH' && pathname.startsWith('/api/levels/user/')) {
            if (readonly) return json({ error: 'read-only' }, { status: 403 })
            const userId = pathname.split('/').pop()!
            const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
            const guildId = String(body.guildId ?? '')
            if (!guildId) return json({ error: 'guildId required' }, { status: 400 })
            const { setLevelRecord } = await import('../services/levels-store.ts')
            const patch: Record<string, number> = {}
            if (typeof body.xp === 'number') patch.xp = Math.max(0, body.xp)
            if (typeof body.level === 'number') patch.level = Math.max(0, body.level)
            if (typeof body.messageCount === 'number')
              patch.messageCount = Math.max(0, body.messageCount)
            const rec = await setLevelRecord(guildId, userId, patch)
            return json({ ok: true, data: rec })
          }

          // DELETE /api/levels/user/:userId  { guildId }  — full reset
          if (req.method === 'DELETE' && pathname.startsWith('/api/levels/user/')) {
            if (readonly) return json({ error: 'read-only' }, { status: 403 })
            const userId = pathname.split('/').pop()!
            const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
            const guildId = String(body.guildId ?? '')
            if (!guildId) return json({ error: 'guildId required' }, { status: 400 })
            const { resetLevelRecord } = await import('../services/levels-store.ts')
            await resetLevelRecord(guildId, userId)
            return json({ ok: true })
          }

          return json({ error: 'not found' }, { status: 404 })
        }

        if (req.method === 'GET') {
          const r = await readStatic(pathname)
          if (r) return r
          return new Response('Not found', { status: 404 })
        }
        return new Response('Method not allowed', { status: 405 })

        // ── IIFE close ──
      })()
      return _respond(_res)
    },
  })
  dashboardServeStarted = true

  const displayHost = host === '0.0.0.0' ? '127.0.0.1' : host
  console.log(
    `[dashboard] http://${displayHost}:${port}/  (bound ${host}:${port}; use Authorization: Bearer <DASHBOARD_TOKEN>)${readonly ? ' [READ-ONLY]' : ''}`,
  )
  if (!isLoopbackHost(host)) {
    console.warn(
      `[dashboard] WARNING: bound to ${host} (non-loopback). Use SSH port forward / Tailscale or front with TLS + extra auth.`,
    )
  } else {
    console.log(
      '[dashboard] Binds to localhost by default. Remote access: use SSH port forward or Tailscale, not 0.0.0.0, unless you know the risk.',
    )
  }
}
