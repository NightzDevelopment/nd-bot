/**
 * Authentication middleware for dashboard v2.
 * Handles JWT verification, role checking, and protected endpoint routing.
 */

import { type JWTPayload, verifyToken } from './users.ts'

export interface AuthenticatedRequest extends Request {
  user?: JWTPayload & { ipAddress: string; userAgent: string }
}

/**
 * Extract JWT from Authorization header
 */
export function extractToken(req: Request): string | null {
  const header = req.headers.get('authorization')
  if (!header) return null
  const match = /^Bearer\s+(.+)$/i.exec(header)
  return match ? match[1] : null
}

/**
 * Verify JWT and attach user to request
 */
export async function verifyAuth(req: AuthenticatedRequest): Promise<boolean> {
  const token = extractToken(req)
  if (!token) return false

  const payload = await verifyToken(token)
  if (!payload) return false

  // Attach user info to request
  req.user = {
    ...payload,
    ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown',
    userAgent: req.headers.get('user-agent') ?? 'unknown',
  }

  return true
}

/**
 * Check if user has required role (admin > moderator > viewer)
 */
export function hasRole(user: JWTPayload, minRole: 'admin' | 'moderator' | 'viewer'): boolean {
  const roleLevel = { admin: 3, moderator: 2, viewer: 1 }
  return roleLevel[user.role] >= roleLevel[minRole]
}

/**
 * Unauthorized response
 */
export function jsonUnauthorized(msg = 'Unauthorized'): Response {
  return new Response(JSON.stringify({ error: msg, status: 401 }), {
    status: 401,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

/**
 * Forbidden response (authenticated but lacks permission)
 */
export function jsonForbidden(msg = 'Forbidden'): Response {
  return new Response(JSON.stringify({ error: msg, status: 403 }), {
    status: 403,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}
