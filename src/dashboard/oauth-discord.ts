/**
 * Dashboard "Login with Discord" (OAuth2).
 * Admin access = Discord ID in the allowlist OR holding the admin role in the
 * configured guild. The bot client is used for the role lookup (no extra OAuth
 * scopes needed beyond `identify`).
 */
import {
  dashboardAdminGuildId,
  dashboardAdminRoleIds,
  dashboardAdminUserIds,
  dashboardDiscordClientId,
  dashboardDiscordClientSecret,
  dashboardPublicUrl,
} from '../config.ts'
import { childLogger } from '../lib/logger.ts'
import { getDiscordClient } from './runtime-state.ts'

const log = childLogger('oauth')

const AUTHORIZE = 'https://discord.com/api/oauth2/authorize'
const TOKEN = 'https://discord.com/api/oauth2/token'
const USER = 'https://discord.com/api/users/@me'

export function oauthConfigured(): boolean {
  return Boolean(dashboardDiscordClientId && dashboardDiscordClientSecret)
}

export function redirectUri(): string {
  const base = dashboardPublicUrl || 'http://localhost:3853'
  return `${base}/auth/discord/callback`
}

export function buildAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: dashboardDiscordClientId ?? '',
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: 'identify',
    state,
  })
  return `${AUTHORIZE}?${params.toString()}`
}

export async function exchangeCode(code: string): Promise<string | null> {
  const body = new URLSearchParams({
    client_id: dashboardDiscordClientId ?? '',
    client_secret: dashboardDiscordClientSecret ?? '',
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(),
  })
  try {
    const res = await fetch(TOKEN, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    })
    const data = (await res.json()) as { access_token?: string; error?: string }
    if (!res.ok || !data.access_token) {
      log.warn({ status: res.status, err: data.error }, 'token exchange failed')
      return null
    }
    return data.access_token
  } catch (e) {
    log.warn({ err: e }, 'token exchange error')
    return null
  }
}

export type DiscordUser = { id: string; username: string; global_name?: string }

export async function fetchDiscordUser(accessToken: string): Promise<DiscordUser | null> {
  try {
    const res = await fetch(USER, { headers: { authorization: `Bearer ${accessToken}` } })
    if (!res.ok) return null
    return (await res.json()) as DiscordUser
  } catch {
    return null
  }
}

/**
 * Cached admin re-check for active sessions. Re-verifies allowlist/role at most
 * once every couple minutes per user, so removing someone's role (or pulling them
 * from the allowlist) revokes their dashboard access within that window.
 */
const adminCache = new Map<string, { ok: boolean; at: number }>()
const ADMIN_RECHECK_MS = 2 * 60 * 1000

export async function isStillAdmin(discordId: string): Promise<boolean> {
  const now = Date.now()
  const cached = adminCache.get(discordId)
  if (cached && now - cached.at < ADMIN_RECHECK_MS) return cached.ok
  const ok = await isAdminDiscordUser(discordId)
  adminCache.set(discordId, { ok, at: now })
  if (adminCache.size > 1000) adminCache.delete(adminCache.keys().next().value as string)
  return ok
}

/** Admin if allowlisted, OR holding ANY of the admin roles in the configured guild. */
export async function isAdminDiscordUser(discordId: string): Promise<boolean> {
  if (dashboardAdminUserIds.has(discordId)) {
    log.info({ discordId }, '[oauth] authorized via DASHBOARD_ADMIN_USER_IDS allowlist')
    return true
  }
  if (dashboardAdminRoleIds.size === 0) {
    log.warn(
      { discordId, allowlistSize: dashboardAdminUserIds.size },
      '[oauth] DENIED: no DASHBOARD_ADMIN_ROLE_IDS or DASHBOARD_ADMIN_USER_IDS configured (set them in .env and restart)',
    )
    return false
  }
  // biome-ignore lint/suspicious/noExplicitAny: discord.js client is type-erased in runtime-state
  const client = getDiscordClient<any>()
  if (!client) {
    log.warn({ discordId }, '[oauth] DENIED: Discord client not ready for role check')
    return false
  }
  try {
    const guild = dashboardAdminGuildId
      ? await client.guilds.fetch(dashboardAdminGuildId)
      : client.guilds.cache.first()
    if (!guild) {
      log.warn(
        { discordId, dashboardAdminGuildId, guildCount: client.guilds.cache.size },
        '[oauth] DENIED: no guild for role check (set DASHBOARD_ADMIN_GUILD_ID?)',
      )
      return false
    }
    const member = await guild.members.fetch(discordId).catch(() => null)
    if (!member) {
      log.warn(
        { discordId, guildId: guild.id },
        '[oauth] DENIED: you are not a member of that guild (check DASHBOARD_ADMIN_GUILD_ID)',
      )
      return false
    }
    const has = [...dashboardAdminRoleIds].some((r) => member.roles.cache.has(r))
    log.info(
      {
        discordId,
        guildId: guild.id,
        adminRoleIds: [...dashboardAdminRoleIds],
        yourRoleIds: [...member.roles.cache.keys()],
        authorized: has,
      },
      `[oauth] role check: ${has ? 'AUTHORIZED' : 'DENIED (none of the admin roles found on your account)'}`,
    )
    return has
  } catch (e) {
    log.warn({ err: e, discordId }, '[oauth] admin role check threw')
    return false
  }
}
