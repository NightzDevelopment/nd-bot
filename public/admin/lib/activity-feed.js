/**
 * Live Activity Feed
 * Owns its own WebSocket connection (with auto-reconnect) and renders
 * a scrolling activity timeline. Mounts onto any element ID.
 */

const MAX_EVENTS = 100
const PERSIST_KEY = 'activityFeed'
const PERSIST_COUNT = 50

const EVENT_META = {
  member_joined: { icon: '🟢', color: '#34d399', label: 'joined the server' },
  member_left: { icon: '🔴', color: '#94a3b8', label: 'left the server' },
  automod_flag: { icon: '⚠', color: '#fbbf24', label: 'flagged by AutoMod' },
  ticket_opened: { icon: '🎫', color: '#60a5fa', label: 'opened a ticket' },
  ticket_closed: { icon: '✓', color: '#64748b', label: 'closed ticket' },
  warning_issued: { icon: '⚠', color: '#fb923c', label: 'was warned' },
  level_up: { icon: '⬆', color: '#a78bfa', label: 'leveled up' },
  shop_purchase: { icon: '💰', color: '#fbbf24', label: 'made a purchase' },
  giveaway_ended: { icon: '🎉', color: '#f472b6', label: 'giveaway ended' },
  suggestion_submitted: { icon: '💡', color: '#60a5fa', label: 'submitted suggestion' },
  suggestion_state_changed: { icon: '✏', color: '#60a5fa', label: 'suggestion updated' },
  economy_transaction: { icon: '💵', color: '#f5c542', label: 'economy transaction' },
}

class ActivityFeed {
  constructor() {
    this.events = []
    this.mountEl = null
    this.ws = null
    this.reconnectDelay = 1000
    this.restore()
  }

  restore() {
    try {
      const raw = localStorage.getItem(PERSIST_KEY)
      if (raw) this.events = JSON.parse(raw)
    } catch {}
  }

  persist() {
    try {
      localStorage.setItem(PERSIST_KEY, JSON.stringify(this.events.slice(0, PERSIST_COUNT)))
    } catch {}
  }

  add(type, data) {
    const event = { type, data, at: Date.now() }
    this.events.unshift(event)
    if (this.events.length > MAX_EVENTS) this.events.length = MAX_EVENTS
    this.persist()
    this.render()
  }

  mount(elementId) {
    this.mountEl = document.getElementById(elementId)
    if (!this.mountEl) return
    this.connectWS()
    this.render()
  }

  connectWS() {
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)
    )
      return

    const token = window.apiClient?.token
    if (!token) {
      console.warn('[activity-feed] no token; skipping WS')
      return
    }

    try {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const url = `${proto}//${window.location.host}/ws?token=${encodeURIComponent(token)}`
      this.ws = new WebSocket(url)

      this.ws.addEventListener('open', () => {
        this.reconnectDelay = 1000
      })

      this.ws.addEventListener('message', (e) => {
        try {
          const msg = JSON.parse(e.data)
          if (msg.type === 'ping') {
            this.ws.send(JSON.stringify({ type: 'pong' }))
            return
          }
          if (EVENT_META[msg.type]) {
            this.add(msg.type, msg.data || {})
          }
        } catch {}
      })

      this.ws.addEventListener('close', () => {
        // Exponential backoff reconnect
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 32000)
        setTimeout(() => this.connectWS(), this.reconnectDelay)
      })

      this.ws.addEventListener('error', () => {
        // close will fire after this
      })
    } catch (e) {
      console.warn('[activity-feed] WS connect failed:', e)
    }
  }

  render() {
    if (!this.mountEl) return
    if (this.events.length === 0) {
      this.mountEl.innerHTML =
        '<div style="text-align:center;color:#475569;padding:1.5rem;font-size:12px;">No recent activity. Events will appear here as they happen.</div>'
      return
    }
    this.mountEl.innerHTML = this.events
      .slice(0, 50)
      .map((e) => {
        const meta = EVENT_META[e.type] || { icon: '•', color: '#94a3b8', label: e.type }
        const d = e.data || {}
        const userName = d.displayName || d.username
        const userPart = userName
          ? `<strong style="color:#e2e8f0;cursor:pointer;" onclick="openMemberCard('${window.esc(d.userId || '')}')">${window.esc(userName)}</strong>`
          : d.userId
            ? `<code style="font-size:10px;color:#64748b;cursor:pointer;" onclick="openMemberCard('${window.esc(d.userId)}')">${window.esc(d.userId)}</code>`
            : '<span style="color:#64748b;">someone</span>'
        const detailParts = []
        if (d.reason) detailParts.push(window.esc(String(d.reason).slice(0, 80)))
        if (d.verdict) detailParts.push('<em>' + window.esc(d.verdict) + '</em>')
        if (d.level) detailParts.push('to Level ' + window.esc(d.level))
        if (d.itemName)
          detailParts.push(
            window.esc((d.itemEmoji || '') + ' ' + d.itemName) + ' (' + (d.price || 0) + ' NDC)',
          )
        if (d.escalateAction)
          detailParts.push(
            '— <strong style="color:#f87171;">' + window.esc(d.escalateAction) + '</strong>',
          )
        if (e.type === 'economy_transaction' && d.action) {
          const sign = (d.amount ?? 0) >= 0 ? '+' : ''
          const color = (d.amount ?? 0) >= 0 ? '#34d399' : '#f87171'
          detailParts.push(`<code style="color:#a78bfa;">${window.esc(d.action)}</code>`)
          detailParts.push(
            `<strong style="color:${color};">${sign}${(d.amount ?? 0).toLocaleString()} NDC</strong>`,
          )
        }
        const detail = detailParts.length
          ? ' <span style="color:#64748b;">' + detailParts.join(' · ') + '</span>'
          : ''
        const channelPart = d.channelName
          ? ` in <span style="color:#60a5fa;">#${window.esc(d.channelName)}</span>`
          : ''
        return `<div style="display:flex;align-items:center;gap:.5rem;padding:.4rem .6rem;border-bottom:1px solid rgba(148,163,184,0.05);font-size:12px;">
        <span style="font-size:14px;width:18px;text-align:center;color:${meta.color};">${meta.icon}</span>
        <span style="flex:1;color:#94a3b8;line-height:1.4;">${userPart} <span style="color:${meta.color};">${meta.label}</span>${channelPart}${detail}</span>
        <span style="color:#475569;font-size:10px;white-space:nowrap;" title="${new Date(e.at).toLocaleString()}">${window.fmtRelative(e.at)}</span>
      </div>`
      })
      .join('')
  }

  clear() {
    this.events = []
    this.persist()
    this.render()
  }
}

window.activityFeed = new ActivityFeed()
