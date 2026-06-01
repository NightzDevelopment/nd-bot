/**
 * Discord Audit Logs Page
 * Live audit log viewer, moderation actions panel, and suspicious-activity alerts.
 */

let _auditData = []
let _auditRefreshInt = null

const CATEGORY_COLORS = {
  Moderation: { bg: 'rgba(239,68,68,.1)', text: '#f87171', border: 'rgba(239,68,68,.3)' },
  Permissions: { bg: 'rgba(251,191,36,.1)', text: '#fbbf24', border: 'rgba(251,191,36,.3)' },
  Members: { bg: 'rgba(96,165,250,.1)', text: '#60a5fa', border: 'rgba(96,165,250,.3)' },
  Channels: { bg: 'rgba(167,139,250,.1)', text: '#a78bfa', border: 'rgba(167,139,250,.3)' },
  Roles: { bg: 'rgba(52,211,153,.1)', text: '#34d399', border: 'rgba(52,211,153,.3)' },
  Server: { bg: 'rgba(148,163,184,.1)', text: '#94a3b8', border: 'rgba(148,163,184,.3)' },
  Messages: { bg: 'rgba(251,146,60,.1)', text: '#fb923c', border: 'rgba(251,146,60,.3)' },
  AutoMod: { bg: 'rgba(232,121,249,.1)', text: '#e879f9', border: 'rgba(232,121,249,.3)' },
  Invites: { bg: 'rgba(148,163,184,.08)', text: '#94a3b8', border: 'rgba(148,163,184,.2)' },
  Other: { bg: 'rgba(148,163,184,.06)', text: '#64748b', border: 'rgba(148,163,184,.15)' },
}

const ALERT_ICONS = {
  mass_ban: '🔨',
  mass_kick: '🥾',
  mass_role_change: '🎭',
  bulk_delete: '🗑️',
  permission_change: '🔐',
  mass_channel_delete: '💥',
}

async function initAuditLogs() {
  if (_auditRefreshInt) clearInterval(_auditRefreshInt)

  setupAuditToolbar()
  await Promise.all([loadAuditAlerts(), loadAuditLogs()])

  _auditRefreshInt = setInterval(() => {
    if (document.querySelector('#page-audit-logs')?.style.display !== 'none') {
      loadAuditAlerts()
      loadAuditLogs()
    }
  }, 30_000)
}

async function loadAuditAlerts() {
  const container = document.getElementById('al-alerts')
  if (!container) return
  try {
    const r = await window.apiClient.get('/api/discord-audit/alerts')
    if (!r.ok) {
      container.innerHTML = ''
      return
    }
    const alerts = r.data || []
    if (!alerts.length) {
      container.innerHTML =
        '<div style="color:var(--text-secondary);font-size:12px;padding:0.5rem 0;">No suspicious activity detected in the last 10 minutes.</div>'
      return
    }
    container.innerHTML = alerts
      .map((a) => {
        const icon = ALERT_ICONS[a.type] || '⚠️'
        const color = a.severity === 'high' ? '#f87171' : '#fbbf24'
        const bg = a.severity === 'high' ? 'rgba(239,68,68,.08)' : 'rgba(251,191,36,.08)'
        const border = a.severity === 'high' ? 'rgba(239,68,68,.3)' : 'rgba(251,191,36,.3)'
        const exec = a.executor ? `by <strong>${escHtml(a.executor.tag)}</strong>` : ''
        return `
        <div style="display:flex;align-items:flex-start;gap:0.75rem;padding:0.75rem 1rem;background:${bg};border:1px solid ${border};border-radius:8px;margin-bottom:0.5rem;">
          <span style="font-size:1.1rem;line-height:1.4;">${icon}</span>
          <div>
            <div style="font-weight:600;font-size:13px;color:${color};">${escHtml(a.message)} ${exec}</div>
            <div style="font-size:11px;color:var(--text-secondary);margin-top:2px;">${new Date(a.detectedAt).toLocaleTimeString()}</div>
          </div>
          <span style="margin-left:auto;font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${color};background:${bg};border:1px solid ${border};padding:2px 7px;border-radius:4px;white-space:nowrap;">${a.severity}</span>
        </div>`
      })
      .join('')
  } catch (e) {
    console.error('Audit alerts error:', e)
    container.innerHTML = ''
  }
}

async function loadAuditLogs() {
  const tab = document.querySelector('#al-tab-bar button.active')?.dataset.tab || 'all'
  const search = document.getElementById('al-search')?.value?.toLowerCase() || ''
  const category = document.getElementById('al-filter-category')?.value || ''
  const limit = 100

  try {
    let endpoint = '/api/discord-audit?limit=' + limit
    if (tab === 'mod') endpoint = '/api/discord-audit/mod-actions?limit=' + limit
    if (category) endpoint += '&category=' + encodeURIComponent(category)

    const r = await window.apiClient.get(endpoint)
    if (!r.ok) {
      showAuditError(r.error)
      return
    }
    _auditData = r.data || []

    const filtered = search
      ? _auditData.filter(
          (e) =>
            (e.action || '').toLowerCase().includes(search) ||
            (e.executor?.tag || '').toLowerCase().includes(search) ||
            (e.target?.tag || '').toLowerCase().includes(search) ||
            (e.reason || '').toLowerCase().includes(search) ||
            (e.category || '').toLowerCase().includes(search),
        )
      : _auditData

    renderAuditTable(filtered)
    const countEl = document.getElementById('al-count')
    if (countEl)
      countEl.textContent = `${filtered.length} entr${filtered.length === 1 ? 'y' : 'ies'}`
  } catch (e) {
    console.error('Audit logs error:', e)
    showAuditError(e.message)
  }
}

function showAuditError(msg) {
  const tbody = document.querySelector('#al-table tbody')
  if (tbody)
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#f87171;padding:2rem;">${escHtml(msg || 'Failed to load audit logs')}</td></tr>`
}

function renderAuditTable(data) {
  const tbody = document.querySelector('#al-table tbody')
  if (!tbody) return

  if (!data.length) {
    tbody.innerHTML =
      '<tr><td colspan="6" style="text-align:center;color:var(--text-secondary);padding:2rem;">No entries match this filter.</td></tr>'
    return
  }

  tbody.innerHTML = data
    .map((e) => {
      const colors = CATEGORY_COLORS[e.category] || CATEGORY_COLORS.Other
      const catPill = `<span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:4px;background:${colors.bg};color:${colors.text};border:1px solid ${colors.border};white-space:nowrap;">${escHtml(e.category)}</span>`
      const time = e.createdAt ? new Date(e.createdAt).toLocaleString() : '—'
      const timeRel = e.createdAt ? relativeTime(e.createdAt) : '—'
      const executor = e.executor
        ? `<span title="${escHtml(e.executor.id)}">${escHtml(e.executor.tag)}</span>`
        : '<span style="color:var(--text-muted)">—</span>'
      const target = e.target
        ? `<span title="${escHtml(e.target.id)}">${escHtml(e.target.tag)}</span>`
        : '<span style="color:var(--text-muted)">—</span>'
      const reason = e.reason
        ? `<span title="${escHtml(e.reason)}">${escHtml(e.reason.slice(0, 40))}${e.reason.length > 40 ? '…' : ''}</span>`
        : '<span style="color:var(--text-muted)">—</span>'
      return `
      <tr class="al-row" data-id="${escAttr(e.id)}" style="cursor:pointer;">
        <td>${catPill}</td>
        <td>${escHtml(e.action)}</td>
        <td>${executor}</td>
        <td>${target}</td>
        <td>${reason}</td>
        <td title="${time}" style="white-space:nowrap;">${timeRel}</td>
      </tr>`
    })
    .join('')

  tbody.querySelectorAll('.al-row').forEach((row) => {
    row.addEventListener('click', () => {
      const id = row.getAttribute('data-id')
      const entry = _auditData.find((e) => e.id === id)
      if (entry) openAuditModal(entry)
    })
  })
}

function openAuditModal(e) {
  const existing = document.querySelector('.modal')
  if (existing) existing.remove()

  const colors = CATEGORY_COLORS[e.category] || CATEGORY_COLORS.Other
  const changesHtml = e.changes?.length
    ? e.changes
        .map(
          (c) => `
        <tr>
          <td style="font-family:var(--font-mono);font-size:11px;color:var(--text-secondary);padding:4px 8px;">${escHtml(c.key)}</td>
          <td style="font-size:12px;padding:4px 8px;color:#f87171;">${c.old != null ? escHtml(String(c.old).slice(0, 80)) : '<em>—</em>'}</td>
          <td style="font-size:12px;padding:4px 8px;color:#34d399;">${c.new != null ? escHtml(String(c.new).slice(0, 80)) : '<em>—</em>'}</td>
        </tr>`,
        )
        .join('')
    : '<tr><td colspan="3" style="padding:4px 8px;color:var(--text-muted);">No field changes recorded.</td></tr>'

  const modal = document.createElement('div')
  modal.className = 'modal'
  modal.innerHTML = `
    <div class="modal-content" style="max-width:620px;">
      <div class="modal-header">
        <div>
          <h2 style="margin:0;font-size:1rem;">${escHtml(e.action)}</h2>
          <div style="font-size:11px;color:var(--text-secondary);margin-top:3px;">
            <span style="font-size:10px;font-weight:700;padding:1px 6px;border-radius:4px;background:${colors.bg};color:${colors.text};border:1px solid ${colors.border};">${escHtml(e.category)}</span>
            &nbsp;·&nbsp;${new Date(e.createdAt).toLocaleString()}
          </div>
        </div>
        <button class="modal-close" onclick="this.closest('.modal').remove()">×</button>
      </div>
      <div class="modal-body">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;margin-bottom:1rem;">
          <div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:8px;padding:0.625rem 0.75rem;">
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-tertiary);margin-bottom:4px;">Executor</div>
            <div style="font-size:13px;font-weight:600;">${e.executor ? escHtml(e.executor.tag) : '—'}</div>
            ${e.executor ? `<div style="font-size:11px;color:var(--text-secondary);font-family:var(--font-mono);">${escHtml(e.executor.id)}</div>` : ''}
          </div>
          <div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:8px;padding:0.625rem 0.75rem;">
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-tertiary);margin-bottom:4px;">Target</div>
            <div style="font-size:13px;font-weight:600;">${e.target ? escHtml(e.target.tag) : '—'}</div>
            ${e.target ? `<div style="font-size:11px;color:var(--text-secondary);font-family:var(--font-mono);">${escHtml(e.target.id)}</div>` : ''}
          </div>
        </div>
        ${e.reason ? `<div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:8px;padding:0.625rem 0.75rem;margin-bottom:1rem;"><div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-tertiary);margin-bottom:4px;">Reason</div><div style="font-size:13px;">${escHtml(e.reason)}</div></div>` : ''}
        ${e.extra ? `<div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:8px;padding:0.625rem 0.75rem;margin-bottom:1rem;"><div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-tertiary);margin-bottom:4px;">Extra</div><div style="font-size:13px;">${escHtml(e.extra)}</div></div>` : ''}
        ${
          e.changes?.length
            ? `
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-tertiary);margin-bottom:6px;">Changes</div>
        <div style="overflow-x:auto;border:1px solid var(--border);border-radius:8px;">
          <table style="width:100%;border-collapse:collapse;">
            <thead><tr style="border-bottom:1px solid var(--border);">
              <th style="padding:4px 8px;font-size:10px;color:var(--text-tertiary);text-align:left;">Field</th>
              <th style="padding:4px 8px;font-size:10px;color:#f87171;text-align:left;">Before</th>
              <th style="padding:4px 8px;font-size:10px;color:#34d399;text-align:left;">After</th>
            </tr></thead>
            <tbody>${changesHtml}</tbody>
          </table>
        </div>`
            : ''
        }
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="this.closest('.modal').remove()">Close</button>
      </div>
    </div>`
  document.body.appendChild(modal)
  modal.onclick = (ev) => {
    if (ev.target === modal) modal.remove()
  }
}

function setupAuditToolbar() {
  // Tab bar
  const tabs = document.querySelectorAll('#al-tab-bar button')
  tabs.forEach((btn) => {
    if (btn.dataset.wiredAl) return
    btn.dataset.wiredAl = '1'
    btn.addEventListener('click', () => {
      tabs.forEach((b) => b.classList.remove('active'))
      btn.classList.add('active')
      loadAuditLogs()
    })
  })

  // Search
  const search = document.getElementById('al-search')
  if (search && !search.dataset.wiredAl) {
    search.dataset.wiredAl = '1'
    search.addEventListener('input', () => {
      const q = search.value.toLowerCase()
      const filtered = q
        ? _auditData.filter(
            (e) =>
              (e.action || '').toLowerCase().includes(q) ||
              (e.executor?.tag || '').toLowerCase().includes(q) ||
              (e.target?.tag || '').toLowerCase().includes(q) ||
              (e.reason || '').toLowerCase().includes(q),
          )
        : _auditData
      renderAuditTable(filtered)
    })
  }

  // Category filter
  const cat = document.getElementById('al-filter-category')
  if (cat && !cat.dataset.wiredAl) {
    cat.dataset.wiredAl = '1'
    cat.addEventListener('change', loadAuditLogs)
  }

  // Export button
  const exp = document.getElementById('al-export-btn')
  if (exp && !exp.dataset.wiredAl) {
    exp.dataset.wiredAl = '1'
    exp.addEventListener('click', () => {
      window.open('/api/discord-audit/export', '_blank')
    })
  }

  // Refresh button
  const ref = document.getElementById('al-refresh-btn')
  if (ref && !ref.dataset.wiredAl) {
    ref.dataset.wiredAl = '1'
    ref.addEventListener('click', () => loadAuditLogs())
  }
}

function relativeTime(ts) {
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return Math.floor(diff / 60_000) + 'm ago'
  if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + 'h ago'
  return Math.floor(diff / 86_400_000) + 'd ago'
}

function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
function escAttr(s) {
  return String(s ?? '')
    .replace(/'/g, '&apos;')
    .replace(/"/g, '&quot;')
}

window.initAuditLogs = initAuditLogs
