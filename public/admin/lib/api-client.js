/**
 * API Client
 * Handles all HTTP requests to the dashboard API
 */

class ApiClient {
  constructor() {
    this.baseUrl = window.location.origin
    this.token = window.__ND_DASH_CONFIG__?.preloadedToken || localStorage.getItem('dashboardToken')
  }

  setToken(token) {
    this.token = token
    localStorage.setItem('dashboardToken', token)
  }

  async request(method, endpoint, data = null) {
    const url = `${this.baseUrl}${endpoint}`
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
    }

    if (this.token) {
      options.headers.Authorization = `Bearer ${this.token}`
    }

    if (data) {
      options.body = JSON.stringify(data)
    }

    try {
      const response = await fetch(url, options)

      // Session expired or role revoked (periodic re-check failed) -> back to login.
      if (response.status === 401) {
        try {
          localStorage.removeItem('dashboardToken')
        } catch {}
        window.location.replace('/pages/splash.html?error=session')
        throw new Error('Unauthorized')
      }

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || `HTTP ${response.status}`)
      }

      return result
    } catch (error) {
      console.error(`API Error (${method} ${endpoint}):`, error)
      throw error
    }
  }

  async get(endpoint) {
    return this.request('GET', endpoint)
  }

  async post(endpoint, data) {
    return this.request('POST', endpoint, data)
  }

  async put(endpoint, data) {
    return this.request('PUT', endpoint, data)
  }

  async getAnalyticsSummary(days = 30) {
    return this.get(`/api/analytics/summary?days=${days}`)
  }

  async getAnalyticsMessages(days = 30) {
    return this.get(`/api/analytics/messages?days=${days}`)
  }

  async getAnalyticsIntents() {
    return this.get(`/api/analytics/intents`)
  }

  async getAnalyticsModels() {
    return this.get(`/api/analytics/models`)
  }

  async getAnalyticsCommands(limit = 10) {
    return this.get(`/api/analytics/commands?limit=${limit}`)
  }

  async getAnalyticsTopUsers(limit = 10) {
    return this.get(`/api/analytics/top-users?limit=${limit}`)
  }

  async getMembers(stat = 'messages', limit = 50) {
    return this.get(`/api/members?stat=${stat}&limit=${limit}`)
  }

  async getMembersFull(sort = 'lastActivityAt', limit = 200) {
    return this.get(`/api/members/full?sort=${sort}&limit=${limit}`)
  }

  async getMember(userId) {
    return this.get(`/api/members/${userId}`)
  }

  async getModerationWarnings(limit = 50) {
    return this.get(`/api/moderation/warnings?limit=${limit}`)
  }

  async getModerationNeedsAttention() {
    return this.get(`/api/moderation/needs-attention`)
  }

  async getModerationHighSeverityNotes() {
    return this.get(`/api/moderation/high-severity-notes`)
  }

  async getDashboardHealth() {
    return this.get(`/api/dashboard/health`)
  }

  async getTicketStats() {
    return this.get(`/api/tickets/stats`)
  }

  async getTicketList(status = 'all', limit = 100) {
    return this.get(`/api/tickets/list?status=${status}&limit=${limit}`)
  }

  async getTicketDetail(channelId) {
    return this.get(`/api/tickets/${channelId}`)
  }

  async getTicketTemplates() {
    return this.get(`/api/tickets/templates`)
  }

  async getDiscordAudit(opts = {}) {
    const params = new URLSearchParams()
    if (opts.limit) params.set('limit', opts.limit)
    if (opts.action) params.set('action', opts.action)
    if (opts.userId) params.set('userId', opts.userId)
    if (opts.category) params.set('category', opts.category)
    if (opts.before) params.set('before', opts.before)
    return this.get(`/api/discord-audit?${params}`)
  }
  async getDiscordAuditModActions(limit = 50) {
    return this.get(`/api/discord-audit/mod-actions?limit=${limit}`)
  }
  async getDiscordAuditAlerts() {
    return this.get('/api/discord-audit/alerts')
  }

  async getRequestLog(limit = 200) {
    return this.get(`/api/request-log?limit=${limit}`)
  }
  async clearRequestLog() {
    return this.request('DELETE', '/api/request-log')
  }

  async pauseBot() {
    return this.post('/api/bot/pause', {})
  }
  async resumeBot() {
    return this.post('/api/bot/resume', {})
  }
  async getBotState() {
    return this.get('/api/bot/state')
  }
  async restartBot() {
    return this.post('/api/restart', {})
  }

  async ticketReply(channelId, content) {
    return this.post(`/api/tickets/${channelId}/reply`, { content })
  }
  async ticketClaim(channelId) {
    return this.post(`/api/tickets/${channelId}/claim`, {})
  }
  async ticketClose(channelId, reason = 'Closed via dashboard') {
    return this.post(`/api/tickets/${channelId}/close`, { reason })
  }
  async ticketSetPriority(channelId, level) {
    return this.post(`/api/tickets/${channelId}/priority`, { level })
  }
  async getTicketMessages(channelId, limit = 50) {
    return this.get(`/api/tickets/${channelId}/messages?limit=${limit}`)
  }

  async getGuildBans() {
    return this.get('/api/guild/bans')
  }
  async unbanUser(userId) {
    return this.post('/api/guild/unban', { userId })
  }
  async kickUser(userId, reason) {
    return this.post('/api/guild/kick', { userId, reason })
  }
  async banUser(userId, reason) {
    return this.post('/api/guild/ban', { userId, reason })
  }
  async getGuildChannels() {
    return this.get('/api/guild/channels')
  }
  async sendAnnouncement(channelId, content) {
    return this.post('/api/guild/announce', { channelId, content })
  }
  async getLeaderboard(stat = 'reputation', limit = 10) {
    return this.get(`/api/analytics/leaderboard?stat=${stat}&limit=${limit}`)
  }

  // Economy
  async getEconomyLeaderboard(limit = 10) {
    return this.get(`/api/economy/leaderboard?limit=${limit}`)
  }
  async getEconomyUser(userId) {
    return this.get(`/api/economy/user/${userId}`)
  }
  async setEconomyBalance(userId, balance) {
    return this.patch(`/api/economy/user/${userId}`, { balance })
  }

  // Levels
  async getLevelsLeaderboard(stat = 'level', limit = 10) {
    return this.get(`/api/levels/leaderboard?stat=${stat}&limit=${limit}`)
  }
  async getLevelsList() {
    return this.get('/api/levels/list')
  }
  async setLevelRecord(userId, guildId, patch) {
    return this.patch(`/api/levels/user/${userId}`, { guildId, ...patch })
  }
  async resetLevelRecord(userId, guildId) {
    return this.request('DELETE', `/api/levels/user/${userId}`, { guildId })
  }

  // Custom Commands
  async getCustomCommands() {
    return this.get('/api/custom-commands')
  }
  async addCustomCommand(data) {
    return this.post('/api/custom-commands', data)
  }
  async updateCustomCommand(name, patch) {
    return this.patch(`/api/custom-commands/${encodeURIComponent(name)}`, patch)
  }
  async deleteCustomCommand(name) {
    return this.request('DELETE', `/api/custom-commands/${encodeURIComponent(name)}`)
  }

  // Macros
  async getMacros() {
    return this.get('/api/macros')
  }
  async setMacro(key, body) {
    return this.post('/api/macros', { key, body })
  }
  async deleteMacro(key) {
    return this.request('DELETE', `/api/macros/${encodeURIComponent(key)}`)
  }

  // Warnings management
  async addWarning(userId, reason) {
    return this.post('/api/warnings', { userId, reason })
  }
  async clearWarnings(userId) {
    return this.request('DELETE', `/api/warnings/${encodeURIComponent(userId)}`)
  }

  // AI AutoMod Strikes
  async getAutomodStrikes() {
    return this.get('/api/automod/strikes')
  }
  async resetAutomodStrikes(key) {
    return this.request('DELETE', `/api/automod/strikes/${encodeURIComponent(key)}`)
  }

  // Shop
  async getShopItems() {
    return this.get('/api/shop/items')
  }
  async addShopItem(item) {
    return this.post('/api/shop/items', item)
  }
  async updateShopItem(id, patch) {
    return this.patch(`/api/shop/items/${id}`, patch)
  }
  async deleteShopItem(id) {
    return this.request('DELETE', `/api/shop/items/${id}`)
  }

  // Level Roles
  async getLevelRoles() {
    return this.get('/api/levelroles')
  }
  async setLevelRole(guildId, level, roleId) {
    return this.post('/api/levelroles', { guildId, level, roleId })
  }
  async removeLevelRole(guildId, level) {
    return this.request('DELETE', `/api/levelroles/${guildId}/${level}`)
  }

  // Counter Channels
  async getCounters() {
    return this.get('/api/counters')
  }
  async addCounter(data) {
    return this.post('/api/counters', data)
  }
  async updateCounter(channelId, patch) {
    return this.patch(`/api/counters/${channelId}`, patch)
  }
  async deleteCounter(channelId) {
    return this.request('DELETE', `/api/counters/${channelId}`)
  }
  async refreshCounters() {
    return this.post('/api/counters/refresh', {})
  }

  // Policies
  async getPolicies() {
    return this.get('/api/policies')
  }
  async updatePolicy(key, patch) {
    return this.put('/api/policies', { key, ...patch })
  }
  async publishPolicies() {
    return this.post('/api/policies/publish', {})
  }

  // Suggestions
  async getSuggestions(status = 'all') {
    return this.get(`/api/suggestions?status=${status}`)
  }
  async getSuggestionStats() {
    return this.get('/api/suggestions/stats')
  }
  async approveSuggestion(id) {
    return this.post(`/api/suggestions/${encodeURIComponent(id)}/approve`, {})
  }
  async denySuggestion(id) {
    return this.post(`/api/suggestions/${encodeURIComponent(id)}/deny`, {})
  }
  async implementSuggestion(id) {
    return this.post(`/api/suggestions/${encodeURIComponent(id)}/implement`, {})
  }

  // Giveaways
  async getGiveaways() {
    return this.get('/api/giveaways')
  }
  async createGiveaway(data) {
    return this.post('/api/giveaways', data)
  }
  async endGiveaway(id) {
    return this.post(`/api/giveaways/${encodeURIComponent(id)}/end`, {})
  }
  async rerollGiveaway(id) {
    return this.post(`/api/giveaways/${encodeURIComponent(id)}/reroll`, {})
  }

  // Polls
  async getPolls(status = 'all') {
    return this.get(`/api/polls?status=${status}`)
  }

  // Scheduler
  async getSchedules() {
    return this.get('/api/schedules')
  }
  async createSchedule(data) {
    return this.post('/api/schedules', data)
  }
  async deleteSchedule(id) {
    return this.request('DELETE', `/api/schedules/${encodeURIComponent(id)}`)
  }

  // Mod notes
  async addModNote(userId, text, severity) {
    return this.post('/api/mod-notes', { userId, text, severity })
  }

  // User resolution
  async resolveUsers(ids) {
    if (!ids || !ids.length) return { ok: true, data: {} }
    return this.get(`/api/guild/users/resolve?ids=${ids.slice(0, 100).join(',')}`)
  }

  // Economy configuration
  async getEconomyConfig() {
    return this.get('/api/economy-config')
  }
  async setEconomyConfig(config) {
    return this.request('PUT', '/api/economy-config', config)
  }

  async patch(endpoint, data) {
    return this.request('PATCH', endpoint, data)
  }
}

// Export as global
window.apiClient = new ApiClient()
