/**
 * SIMPLIFIED DASHBOARD SERVER
 * Single-user version with just token auth and config editing.
 *
 * To use: Replace imports in bot.ts from './server.ts' to './server-simple.ts'
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  allManifestFields,
  getEffectiveStringValues,
  overridesAreBroken,
  readOverridesFile,
  validateAndMergePatch,
  writeMergedOverrides,
} from '../services/dashboard-overrides.ts'
import { packageVersion } from '../utils/package-version.ts'
import { getDiscordStatus, getStartedAt } from './runtime-state.ts'

const PUBLIC_DIR = join(import.meta.dir, '../../public/admin')

function json(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { 'content-type': 'application/json; charset=utf-8', ...init?.headers },
  })
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

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

/** Simple token validation */
function checkToken(req: Request): boolean {
  const want = expectedToken()
  if (!want) return false
  const h = req.headers.get('authorization')?.trim() ?? ''
  const m = /^Bearer\s+(.+)$/i.exec(h)
  if (!m) return false
  return safeEqual(m[1], want)
}

function unauthorized(): Response {
  return json({ error: 'Unauthorized' }, { status: 401 })
}

async function readIndexHtmlWithToken(): Promise<Response | null> {
  const abs = join(PUBLIC_DIR, 'index.html')
  let html: string
  try {
    html = await readFile(abs, 'utf8')
  } catch {
    return null
  }
  const token = expectedToken()
  if (token) {
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
      'content-security-policy':
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
      'x-frame-options': 'DENY',
      'referrer-policy': 'no-referrer',
    },
  })
}

async function readStaticFile(rel: string): Promise<Response | null> {
  const file = join(PUBLIC_DIR, rel)
  if (!file.startsWith(PUBLIC_DIR)) return null
  try {
    const content = await readFile(file, 'utf8')
    const type = rel.endsWith('.css')
      ? 'text/css'
      : rel.endsWith('.js')
        ? 'text/javascript'
        : 'text/plain'
    return new Response(content, {
      headers: { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store' },
    })
  } catch {
    return null
  }
}

export function startDashboard(): void {
  const token = expectedToken()
  if (!token) {
    console.warn('[dashboard] DASHBOARD_TOKEN not set, dashboard disabled')
    return
  }

  const host = listenHost()
  const port = listenPort()

  const server = Bun.serve({
    hostname: host,
    port,
    async fetch(req) {
      const url = new URL(req.url)
      const pathname = url.pathname

      // Public health endpoint
      if (pathname === '/api/health') {
        const d = getDiscordStatus()
        return json({
          ok: true,
          startedAt: new Date(getStartedAt()).toISOString(),
          botVersion: packageVersion(),
          discord: d.status,
        })
      }

      // Simple login endpoint
      if (pathname === '/auth/login' && req.method === 'POST') {
        try {
          const body = (await req.json()) as { token?: string }
          if (body.token && safeEqual(body.token, token)) {
            return json({ ok: true })
          }
          return json({ error: 'Invalid token' }, { status: 401 })
        } catch {
          return json({ error: 'Invalid request' }, { status: 400 })
        }
      }

      // All other routes require token
      if (!checkToken(req)) {
        return unauthorized()
      }

      // Config endpoints (existing, unchanged)
      if (req.method === 'GET' && pathname === '/api/config') {
        const fields = allManifestFields()
        return json({
          ok: true,
          values: getEffectiveStringValues(fields, true),
          changedFromBoot: [],
          overridesBroken: overridesAreBroken(),
        })
      }

      if (req.method === 'PUT' && pathname === '/api/config') {
        try {
          const body = await req.json()
          const fields = allManifestFields()
          const { merged, errors } = validateAndMergePatch(body, fields)
          if (!merged) return json({ errors }, { status: 400 })
          const existing = await readOverridesFile()
          await writeMergedOverrides(existing, merged)
          return json({ ok: true, values: getEffectiveStringValues(fields, true) })
        } catch (e) {
          return json({ error: String(e) }, { status: 500 })
        }
      }

      // Static files
      const r = await readStaticFile(pathname === '/' ? 'index.html' : pathname.replace(/^\//, ''))
      if (r) return r

      if (pathname === '/' || pathname === '/index.html') {
        return await readIndexHtmlWithToken()
      }

      return new Response('Not found', { status: 404 })
    },
  })

  console.log(
    `[dashboard] http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}/ (single-user, token auth)`,
  )
}
