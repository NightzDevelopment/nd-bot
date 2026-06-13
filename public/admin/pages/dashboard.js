/**
 * Dashboard (Command) Page
 * Health panel, leaderboard, announcement sender, stat cards
 */

let dashboardRefreshInterval = null
let _allChannels = []

async function initDashboard() {
  if (dashboardRefreshInterval) clearInterval(dashboardRefreshInterval)
  await Promise.all([loadDashboardStats(), loadLeaderboard('reputation'), loadGuildChannels()])
  dashboardRefreshInterval = setInterval(() => loadDashboardStats(), 30000)
  // Mount the live activity feed
  if (window.activityFeed) window.activityFeed.mount('activity-feed-root')
}

async function loadDashboardStats() {
  try {
    const [statsRes, healthRes, ticketsRes] = await Promise.all([
      window.apiClient.getAnalyticsSummary(30).catch(() => ({ ok: false })),
      window.apiClient.getDashboardHealth().catch(() => ({ ok: false })),
      window.apiClient.getTicketStats().catch(() => ({ ok: false })),
    ])

    if (statsRes.ok) {
      const d = statsRes.data
      updateStatCard('messages', d.totalMessages ?? 0)
      updateStatCard('responses', d.totalAiResponses ?? 0)
      updateStatCard('users', d.uniqueUsers ?? 0)
      updateStatCard('commands', d.totalCustomCommands ?? 0)
      renderAlerts(d)
      setText('h-active-members', (d.uniqueUsers ?? '-').toLocaleString?.() ?? d.uniqueUsers ?? '-')
      if (d.modelName) setText('h-ai-model', d.modelName)
    }

    if (healthRes.ok) {
      const uptime = formatUptime(healthRes.uptime ?? 0)
      setText('h-uptime', uptime)
      setText('dashboard-timestamp', new Date(healthRes.timestamp).toLocaleTimeString())
      const botStatus = document.getElementById('h-bot-status')
      if (botStatus) {
        botStatus.textContent = '●  Online'
        botStatus.style.color = '#34d399'
      }
    } else {
      const botStatus = document.getElementById('h-bot-status')
      if (botStatus) {
        botStatus.textContent = '●  Offline'
        botStatus.style.color = '#f87171'
      }
    }

    if (ticketsRes.ok) {
      setText('h-open-tickets', ticketsRes.data?.totalOpen ?? '0')
    }
  } catch (err) {
    console.error('Dashboard error:', err)
  }
}

function renderAlerts(data) {
  const el = document.getElementById('dashboard-alerts')
  if (!el) return
  const alerts = []
  if (!data.totalMessages)
    alerts.push({ icon: 'ℹ️', msg: 'No messages recorded yet', color: '#60a5fa' })
  if (data.topIntent)
    alerts.push({ icon: '🎯', msg: `Top intent: ${data.topIntent}`, color: '#94a3b8' })
  if ((data.uniqueUsers ?? 0) > 100)
    alerts.push({ icon: '✅', msg: `${data.uniqueUsers} active members`, color: '#34d399' })
  if (!alerts.length) alerts.push({ icon: '✅', msg: 'All systems operational', color: '#34d399' })
  el.innerHTML = alerts
    .map(
      (a) =>
        `<div style="display:flex;align-items:center;gap:.5rem;font-size:12px;padding:.3rem 0;color:${a.color};">${a.icon} ${a.msg}</div>`,
    )
    .join('')
}

window.loadLeaderboard = async (stat = 'reputation') => {
  const el = document.getElementById('lb-list')
  if (!el) return
  el.innerHTML =
    '<div style="color:#475569;font-size:12px;text-align:center;padding:1rem;">Loading…</div>'
  try {
    const r = await window.apiClient.getLeaderboard(stat, 10)
    if (!r.ok) throw new Error(r.error)
    const rows = r.data || []
    if (!rows.length) {
      el.innerHTML =
        '<div style="color:#475569;font-size:12px;text-align:center;padding:1rem;">No data yet.</div>'
      return
    }
    const medals = ['🥇', '🥈', '🥉']
    el.innerHTML = rows
      .map(
        (row, i) => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:.35rem 0;border-bottom:1px solid rgba(148,163,184,0.07);">
        <span style="font-size:12px;color:#94a3b8;">${medals[i] || `${i + 1}.`} <code style="color:#e2e8f0;font-size:11px;">${escapeHtml(row.userId?.slice(0, 10) ?? '-')}</code></span>
        <span style="font-size:13px;font-weight:700;color:#60a5fa;">${row.value?.toLocaleString?.() ?? row.value ?? 0}</span>
      </div>`,
      )
      .join('')
  } catch (e) {
    el.innerHTML = `<div style="color:#f87171;font-size:12px;padding:.5rem;">Error: ${e.message}</div>`
  }
}

async function loadGuildChannels() {
  try {
    const r = await window.apiClient.getGuildChannels()
    if (!r.ok) return
    _allChannels = r.data || []
    const sel = document.getElementById('announce-channel')
    if (!sel) return
    sel.innerHTML =
      '<option value="">Select channel…</option>' +
      _allChannels
        .map(
          (c) =>
            `<option value="${escapeAttr(c.id)}">${escapeHtml(c.parentName ? `#${c.name} (${c.parentName})` : `#${c.name}`)}</option>`,
        )
        .join('')
  } catch (e) {
    console.warn('Failed to load channels:', e)
  }
}

window.sendAnnouncement = async () => {
  const channelId = document.getElementById('announce-channel')?.value
  const content = document.getElementById('announce-content')?.value?.trim()
  if (!channelId) {
    showToast('Select a channel first', 'warning')
    return
  }
  if (!content) {
    showToast('Type a message first', 'warning')
    return
  }
  if (!confirm(`Send this announcement to the selected channel?`)) return
  try {
    const r = await window.apiClient.sendAnnouncement(channelId, content)
    if (r.ok) {
      showToast('Announcement sent!', 'success')
      document.getElementById('announce-content').value = ''
    } else {
      showToast('Failed: ' + r.error, 'error')
    }
  } catch (e) {
    showToast('Error: ' + e.message, 'error')
  }
}

function updateStatCard(id, value) {
  const card = document.getElementById(`stat-${id}`)
  if (!card) return
  const el = card.querySelector('.stat-value')
  if (el) el.textContent = (typeof value === 'number' ? value.toLocaleString() : value) ?? '0'
}

function setText(id, val) {
  const el = document.getElementById(id)
  if (el) el.textContent = val ?? '-'
}

function formatUptime(seconds) {
  const s = Math.floor(seconds ?? 0)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 24) return `${Math.floor(h / 24)}d ${h % 24}h`
  return `${h}h ${m}m`
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
function escapeAttr(s) {
  return String(s ?? '')
    .replace(/'/g, '&apos;')
    .replace(/"/g, '&quot;')
}

window.initDashboard = initDashboard
