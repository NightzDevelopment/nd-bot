/**
 * Auth endpoint handlers for dashboard v2.
 * Add these to server.ts fetch handler.
 */

import { logAudit } from './audit.ts'
import { authenticatePassword, createUser, type JWTPayload, listUsers } from './users.ts'

function json(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { 'content-type': 'application/json; charset=utf-8', ...init?.headers },
  })
}

/**
 * POST /auth/login
 * { email, password } → { token, refreshToken, user }
 */
export async function handleAuthLogin(req: Request): Promise<Response> {
  try {
    const body = (await req.json()) as { email?: string; password?: string }
    const { email, password } = body

    if (!email || !password) {
      return json({ error: 'Missing email or password' }, { status: 400 })
    }

    const result = await authenticatePassword(email, password)
    if (!result) {
      // Log failed attempt
      await logAudit(
        'unknown',
        email,
        'login',
        'failed',
        { reason: 'invalid_credentials' },
        req.headers.get('x-forwarded-for') || 'unknown',
        req.headers.get('user-agent') || 'unknown',
      )
      return json({ error: 'Invalid email or password' }, { status: 401 })
    }

    // Log successful login
    await logAudit(
      result.user.id,
      result.user.email,
      'login',
      `user:${result.user.id}`,
      { role: result.user.role },
      req.headers.get('x-forwarded-for') || 'unknown',
      req.headers.get('user-agent') || 'unknown',
    )

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

/**
 * GET /api/servers
 * List servers the user has access to
 */
export async function handleGetServers(payload: JWTPayload): Promise<Response> {
  // For now, return a default server
  // In production, look up servers from user.servers array
  return json({
    servers: [
      { id: 'nightz-network', name: 'Nightz Network' },
      // Add more servers from user.servers here
    ],
  })
}

/**
 * GET /api/users (Admin only)
 * List all users
 */
export async function handleGetUsers(payload: JWTPayload): Promise<Response> {
  if (payload.role !== 'admin') {
    return json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
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
        })),
    })
  } catch (err) {
    console.error('[auth] list users error:', err)
    return json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/users (Admin only)
 * Create a new user
 */
export async function handleCreateUser(
  payload: JWTPayload,
  body: { email?: string; password?: string; role?: string; servers?: string[] },
): Promise<Response> {
  if (payload.role !== 'admin') {
    return json({ error: 'Forbidden' }, { status: 403 })
  }

  const { email, password, role = 'viewer', servers = [] } = body

  if (!email || !password) {
    return json({ error: 'Missing email or password' }, { status: 400 })
  }

  if (!['admin', 'moderator', 'viewer'].includes(role)) {
    return json({ error: 'Invalid role' }, { status: 400 })
  }

  try {
    const user = await createUser(email, password, role as any, servers)

    // Log user creation
    await logAudit(payload.sub, payload.email, 'user_created', `user:${user.id}`, {
      newEmail: email,
      newRole: role,
    })

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
  } catch (err) {
    console.error('[auth] create user error:', err)
    return json({ error: String(err) }, { status: 400 })
  }
}

/**
 * Integration note:
 *
 * Add this to server.ts fetch handler (around line 500-550):
 *
 * --- ADD IMPORTS AT TOP ---
 * import { handleAuthLogin, handleGetServers, handleGetUsers, handleCreateUser } from './auth-handlers.ts'
 *
 * --- ADD AFTER API ROUTES, BEFORE STATIC FILE SERVING ---
 *
 * // Auth endpoints (no bearer token required)
 * if (pathname === '/auth/login' && req.method === 'POST') {
 *   return handleAuthLogin(req)
 * }
 *
 * // Protected API endpoints (require bearer token)
 * if (pathname.startsWith('/api/users')) {
 *   if (!checkAuth(req)) return unauthorized()
 *   const payload = await verifyToken(extractToken(req) || '')
 *   if (!payload) return unauthorized()
 *
 *   if (pathname === '/api/users' && req.method === 'GET') {
 *     return handleGetUsers(payload)
 *   }
 *   if (pathname === '/api/users' && req.method === 'POST') {
 *     const body = await req.json()
 *     return handleCreateUser(payload, body)
 *   }
 * }
 *
 * if (pathname === '/api/servers' && req.method === 'GET') {
 *   if (!checkAuth(req)) return unauthorized()
 *   const payload = await verifyToken(extractToken(req) || '')
 *   if (!payload) return unauthorized()
 *   return handleGetServers(payload)
 * }
 */
