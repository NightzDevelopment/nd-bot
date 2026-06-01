/**
 * WebSocket client for dashboard v2 real-time updates.
 * Auto-reconnects with exponential backoff, maintains message queue for offline.
 */

export class WebSocketClient {
  constructor(url, token) {
    this.url = url
    this.token = token
    this.ws = null
    this.listeners = new Map()
    this.messageQueue = []
    this.isConnected = false
    this.reconnectAttempts = 0
    this.maxReconnectAttempts = 10
    this.reconnectDelay = 1000 // start at 1 second
    this.maxReconnectDelay = 32000 // cap at 32 seconds
    this.heartbeatInterval = null
    this.offlineQueue = null
  }

  /**
   * Connect to WebSocket server
   */
  connect() {
    try {
      const url = new URL(this.url, window.location.origin)
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      url.searchParams.set('token', this.token)

      this.ws = new WebSocket(url.toString())

      this.ws.addEventListener('open', () => this._handleOpen())
      this.ws.addEventListener('message', (e) => this._handleMessage(e))
      this.ws.addEventListener('close', () => this._handleClose())
      this.ws.addEventListener('error', (e) => this._handleError(e))
    } catch (err) {
      console.error('[ws] connection failed:', err)
      this._scheduleReconnect()
    }
  }

  /**
   * Handle connection open
   */
  _handleOpen() {
    console.log('[ws] connected')
    this.isConnected = true
    this.reconnectAttempts = 0
    this.reconnectDelay = 1000

    // Start heartbeat
    this._startHeartbeat()

    // Flush offline queue
    if (this.offlineQueue) {
      void this.offlineQueue.sync()
    }

    // Emit event
    this._emit('connected', { timestamp: Date.now() })
  }

  /**
   * Handle incoming message
   */
  _handleMessage(event) {
    try {
      const msg = JSON.parse(event.data)

      if (msg.type === 'ping') {
        this.ws.send(JSON.stringify({ type: 'pong' }))
        return
      }

      // Emit to listeners
      this._emit(msg.type, msg)
    } catch (err) {
      console.error('[ws] message parse error:', err)
    }
  }

  /**
   * Handle connection close
   */
  _handleClose() {
    console.log('[ws] disconnected')
    this.isConnected = false
    this._stopHeartbeat()
    this._emit('disconnected', {})
    this._scheduleReconnect()
  }

  /**
   * Handle connection error
   */
  _handleError(err) {
    console.error('[ws] error:', err)
    this._emit('error', { message: String(err) })
  }

  /**
   * Schedule reconnect with exponential backoff
   */
  _scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[ws] max reconnect attempts reached')
      this._emit('failed', {})
      return
    }

    const delay = Math.min(
      this.reconnectDelay * 1.5 ** this.reconnectAttempts,
      this.maxReconnectDelay,
    )

    this.reconnectAttempts++
    console.log(`[ws] reconnecting in ${Math.round(delay)}ms (attempt ${this.reconnectAttempts})`)

    setTimeout(() => this.connect(), delay)
  }

  /**
   * Start heartbeat
   */
  _startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      if (this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({ type: 'ping' }))
        } catch (err) {
          console.error('[ws] heartbeat send failed:', err)
        }
      }
    }, 30000) // every 30 seconds
  }

  /**
   * Stop heartbeat
   */
  _stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }
  }

  /**
   * Subscribe to event
   */
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, [])
    }
    this.listeners.get(event).push(callback)
  }

  /**
   * Unsubscribe from event
   */
  off(event, callback) {
    const callbacks = this.listeners.get(event)
    if (callbacks) {
      const idx = callbacks.indexOf(callback)
      if (idx >= 0) {
        callbacks.splice(idx, 1)
      }
    }
  }

  /**
   * Emit event to all listeners
   */
  _emit(event, data) {
    const callbacks = this.listeners.get(event) || []
    callbacks.forEach((cb) => {
      try {
        cb(data)
      } catch (err) {
        console.error(`[ws] listener error for ${event}:`, err)
      }
    })
  }

  /**
   * Send message (if connected) or queue (if offline)
   */
  async send(event, data) {
    if (this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: event, ...data }))
    } else if (this.offlineQueue) {
      // Queue for later
      await this.offlineQueue.add({ event, data, timestamp: Date.now() })
    } else {
      console.warn('[ws] not connected and no offline queue')
    }
  }

  /**
   * Set offline queue handler
   */
  setOfflineQueue(queue) {
    this.offlineQueue = queue
  }

  /**
   * Disconnect
   */
  disconnect() {
    this._stopHeartbeat()
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }
}

// Export singleton
export const wsClient = new WebSocketClient('/ws', sessionStorage.getItem('token') || '')
