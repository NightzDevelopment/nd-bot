/**
 * WebSocket server for real-time dashboard updates.
 * Handles authenticated connections, heartbeat, and event broadcasting.
 * Built on Bun's native WebSocket support.
 */

import type { Server as BunServer, ServerWebSocket } from 'bun'
import { verifyToken } from './users.ts'

export type WSEventType =
  | 'config_changed'
  | 'config_restored'
  | 'data_file_updated'
  | 'bot_restarted'
  | 'user_joined'
  | 'user_left'
  | 'audit_log_new'
  | 'discord_status_changed'
  | 'health_update'
  // Activity feed events
  | 'member_joined'
  | 'member_left'
  | 'automod_flag'
  | 'ticket_opened'
  | 'ticket_closed'
  | 'warning_issued'
  | 'level_up'
  | 'shop_purchase'
  | 'giveaway_ended'
  | 'suggestion_submitted'
  | 'suggestion_state_changed'
  | 'economy_transaction'

export interface WSEvent {
  type: WSEventType
  timestamp: number
  userId?: string
  userEmail?: string
  data: Record<string, unknown>
}

export interface AuthenticatedWS extends ServerWebSocket<{ userId: string; userEmail: string }> {
  userId: string
  userEmail: string
  authenticated: boolean
}

class WebSocketManager {
  private clients: Map<ServerWebSocket, AuthenticatedWS> = new Map()
  private heartbeatIntervals: Map<ServerWebSocket, NodeJS.Timer> = new Map()

  /**
   * Handle WebSocket upgrade
   */
  async handleUpgrade(request: Request, server: BunServer): Promise<Response | undefined> {
    const url = new URL(request.url)

    // Check for token in query or header
    const token =
      url.searchParams.get('token') || request.headers.get('authorization')?.split(' ')[1]

    if (!token) {
      return new Response('Unauthorized', { status: 401 })
    }

    // Verify token
    const payload = await verifyToken(token)
    if (!payload) {
      return new Response('Unauthorized', { status: 401 })
    }

    // Upgrade to WebSocket
    const success = server.upgrade(request, {
      data: {
        userId: payload.sub,
        userEmail: payload.email,
      },
    })

    if (!success) {
      return new Response('Failed to upgrade', { status: 400 })
    }

    return undefined // upgrade handled
  }

  /**
   * Register a new WebSocket connection
   */
  registerConnection(ws: ServerWebSocket<unknown>): void {
    const authWs = ws as AuthenticatedWS
    authWs.userId = authWs.data.userId
    authWs.userEmail = authWs.data.userEmail
    authWs.authenticated = true

    this.clients.set(ws, authWs)

    // Send welcome message
    this.sendToClient(ws, {
      type: 'connected',
      timestamp: Date.now(),
      data: {
        userId: authWs.userId,
        userEmail: authWs.userEmail,
        clientCount: this.clients.size,
      },
    } as unknown as WSEvent)

    // Start heartbeat
    this.startHeartbeat(ws)

    console.log(`[ws] client connected: ${authWs.userEmail} (total: ${this.clients.size})`)
  }

  /**
   * Unregister a WebSocket connection
   */
  unregisterConnection(ws: ServerWebSocket<unknown>): void {
    const authWs = this.clients.get(ws as ServerWebSocket)
    if (authWs) {
      const interval = this.heartbeatIntervals.get(ws)
      if (interval) clearInterval(interval)
      this.heartbeatIntervals.delete(ws)
      this.clients.delete(ws)
      console.log(`[ws] client disconnected: ${authWs.userEmail} (total: ${this.clients.size})`)
    }
  }

  /**
   * Start heartbeat for a connection
   */
  private startHeartbeat(ws: ServerWebSocket): void {
    const interval = setInterval(() => {
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }))
        }
      } catch {
        // connection might be closed
      }
    }, 30000) // heartbeat every 30 seconds

    this.heartbeatIntervals.set(ws, interval)
  }

  /**
   * Send message to a single client
   */
  sendToClient(ws: ServerWebSocket, event: WSEvent): void {
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(event))
      }
    } catch (err) {
      console.error('[ws] failed to send to client:', err)
    }
  }

  /**
   * Broadcast message to all connected clients
   */
  broadcast(event: WSEvent, excludeUserIds?: string[]): void {
    const exclude = new Set(excludeUserIds || [])
    let sent = 0

    for (const [ws, authWs] of this.clients.entries()) {
      if (!exclude.has(authWs.userId)) {
        this.sendToClient(ws, event)
        sent++
      }
    }

    if (event.type !== 'ping') {
      console.log(`[ws] broadcast ${event.type} to ${sent} clients`)
    }
  }

  /**
   * Get connected client count
   */
  getClientCount(): number {
    return this.clients.size
  }

  /**
   * Get list of connected users
   */
  getConnectedUsers(): Array<{ userId: string; userEmail: string }> {
    return Array.from(this.clients.values()).map((ws) => ({
      userId: ws.userId,
      userEmail: ws.userEmail,
    }))
  }

  /**
   * Handle incoming message from client (mainly for pong/heartbeat)
   */
  handleMessage(ws: ServerWebSocket<unknown>, data: string): void {
    try {
      const msg = JSON.parse(data) as { type: string }
      if (msg.type === 'pong') {
        // heartbeat response, do nothing
      }
    } catch {
      // ignore malformed messages
    }
  }
}

// Export singleton instance
export const wsManager = new WebSocketManager()

/**
 * Broadcast event helper functions
 */

export function broadcastConfigChanged(userId: string, userEmail: string, keys: string[]): void {
  wsManager.broadcast({
    type: 'config_changed',
    timestamp: Date.now(),
    userId,
    userEmail,
    data: {
      keys,
    },
  })
}

export function broadcastConfigRestored(
  userId: string,
  userEmail: string,
  snapshotId: string,
  keys: string[],
): void {
  wsManager.broadcast({
    type: 'config_restored',
    timestamp: Date.now(),
    userId,
    userEmail,
    data: {
      snapshotId,
      keys,
    },
  })
}

export function broadcastDataFileUpdated(
  userId: string,
  userEmail: string,
  fileName: string,
): void {
  wsManager.broadcast({
    type: 'data_file_updated',
    timestamp: Date.now(),
    userId,
    userEmail,
    data: {
      fileName,
    },
  })
}

export function broadcastBotRestarted(userId: string, userEmail: string): void {
  wsManager.broadcast({
    type: 'bot_restarted',
    timestamp: Date.now(),
    userId,
    userEmail,
    data: {},
  })
}

export function broadcastAuditLogNew(entry: {
  id: string
  action: string
  resource: string
  userEmail: string
}): void {
  wsManager.broadcast({
    type: 'audit_log_new',
    timestamp: Date.now(),
    data: {
      entryId: entry.id,
      action: entry.action,
      resource: entry.resource,
      userEmail: entry.userEmail,
    },
  })
}

export function broadcastDiscordStatusChanged(status: {
  discordStatus: string
  error: string | null
  tag: string | null
  ping: number
}): void {
  wsManager.broadcast({
    type: 'discord_status_changed',
    timestamp: Date.now(),
    data: {
      ...status,
    },
  })
}

/**
 * Generic broadcaster for activity-feed events.
 * Use this for any event the dashboard's activity feed should display.
 * Wraps the event in the standard WSEvent shape and broadcasts to all clients.
 */
export function broadcastActivity(
  type:
    | 'member_joined'
    | 'member_left'
    | 'automod_flag'
    | 'ticket_opened'
    | 'ticket_closed'
    | 'warning_issued'
    | 'level_up'
    | 'shop_purchase'
    | 'giveaway_ended'
    | 'suggestion_submitted'
    | 'suggestion_state_changed'
    | 'casino_play'
    | 'economy_transaction',
  data: Record<string, unknown>,
): void {
  try {
    wsManager.broadcast({
      type,
      timestamp: Date.now(),
      data,
    })
  } catch (e) {
    // never let WS broadcast failures crash an emitter
    console.warn('[ws] broadcastActivity failed:', e)
  }
}

export function broadcastHealthUpdate(health: {
  uptime: number
  guildCount: number
  ping: number
}): void {
  wsManager.broadcast({
    type: 'health_update',
    timestamp: Date.now(),
    data: {
      ...health,
    },
  })
}
