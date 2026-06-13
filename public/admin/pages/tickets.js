/**
 * Tickets Page
 * Live stats, filterable list, priority/SLA visualization
 */

let _ticketsData = []
let _ticketsRefreshInt = null

async function initTickets() {
  if (_ticketsRefreshInt) clearInterval(_ticketsRefreshInt)

  await loadTicketStats()
  await loadTicketList()
  setupTicketsToolbar()

  // Live refresh every 30s while the user is on this page
  _ticketsRefreshInt = setInterval(() => {
    if (document.querySelector('#page-tickets')?.style.display !== 'none') {
      loadTicketStats()
      loadTicketList()
    }
  }, 30000)
}

async function loadTicketStats() {
  try {
    const r = await window.apiClient.getTicketStats()
    if (!r.ok) throw new Error(r.error)
    const s = r.data
    setText('tk-stat-open', s.totalOpen ?? 0)
    setText('tk-stat-closed', s.totalClosed ?? 0)
    setText('tk-stat-avg', s.avgResolutionMs != null ? formatDuration(s.avgResolutionMs) : '-')
    setText(
      'tk-stat-median',
      s.medianMsToFirstStaffReply != null ? formatDuration(s.medianMsToFirstStaffReply) : '-',
    )
    setText('tk-stat-reopen', s.reopenedTickets ?? 0)
    if (s.reopenRate != null) {
      setText('tk-stat-reopen-rate', `${Math.round(s.reopenRate * 100)}% rate`)
    } else {
      setText('tk-stat-reopen-rate', '')
    }
  } catch (error) {
    console.error('Ticket stats error:', error)
  }
}

async function loadTicketList() {
  try {
    const status = document.getElementById('tk-filter-status')?.value || 'open'
    const r = await window.apiClient.getTicketList(status, 200)
    if (!r.ok) throw new Error(r.error)
    _ticketsData = r.data || []
    renderTicketTable(_ticketsData)
    const countEl = document.getElementById('tk-count')
    if (countEl)
      countEl.textContent = `${_ticketsData.length} ticket${_ticketsData.length === 1 ? '' : 's'}`
  } catch (error) {
    console.error('Ticket list error:', error)
    showToast(`Error loading tickets: ${error.message}`, 'error')
  }
}

function renderTicketTable(data) {
  const tbody = document.querySelector('#tk-table tbody')
  if (!tbody) return
  if (!data.length) {
    tbody.innerHTML =
      '<tr><td colspan="8" style="text-align:center;color:var(--text-secondary);padding:2rem;">No tickets match this filter.</td></tr>'
    return
  }
  tbody.innerHTML = data
    .map((t) => {
      const priorityClass = `tk-priority-${t.priority || 'normal'}`
      const priority = (t.priority || 'normal').toUpperCase()
      const statusClass = `tk-status-${t.status}`
      const opened = t.openedAt ? formatRelative(t.openedAt) : '-'
      const slaBreached = t.status === 'open' && !t.firstStaffReplyAt && t.slaBreachedAt
      const claimedBy = t.claimedByTag || '-'
      const userTag = t.userTag || t.userId || '-'
      return `
      <tr data-channel-id="${escapeAttr(t.channelId)}" class="tk-row" style="cursor:pointer;">
        <td><code>#${String(t.id).padStart(4, '0')}</code></td>
        <td><span title="${escapeAttr(t.userId)}">${escapeHtml(userTag)}</span></td>
        <td>${escapeHtml(t.reason || '-')}</td>
        <td><span class="tk-priority-pill ${priorityClass}">${priority}</span></td>
        <td><span class="${statusClass}">${escapeHtml(t.status)}${slaBreached ? ' <span class="tk-sla-bad">⚠ SLA</span>' : ''}</span></td>
        <td>${escapeHtml(claimedBy)}</td>
        <td title="${t.openedAt ? new Date(t.openedAt).toLocaleString() : ''}">${opened}</td>
        <td>${t.messageCount ?? 0}</td>
      </tr>`
    })
    .join('')

  // Click handlers
  tbody.querySelectorAll('.tk-row').forEach((row) => {
    row.addEventListener('click', () => {
      const channelId = row.getAttribute('data-channel-id')
      const ticket = _ticketsData.find((t) => t.channelId === channelId)
      if (ticket) openTicketModal(ticket)
    })
  })
}

async function openTicketModal(t) {
  const modal = document.createElement('div')
  modal.className = 'modal'
  const priorityClass = `tk-priority-${t.priority || 'normal'}`
  const priority = (t.priority || 'normal').toUpperCase()
  const opened = t.openedAt ? new Date(t.openedAt).toLocaleString() : '-'

  modal.innerHTML = `
    <div class="modal-content" style="max-width:760px;max-height:90vh;display:flex;flex-direction:column;">
      <div class="modal-header">
        <div>
          <h2 style="margin:0;font-size:1.05rem;color:#e2e8f0;">Ticket #${String(t.id).padStart(4, '0')} · ${escapeHtml(t.reason || '')}</h2>
          <div style="font-size:11px;color:var(--text-secondary);margin-top:4px;">
            Opener: <strong style="color:#e2e8f0;">${escapeHtml(t.userTag || t.userId)}</strong> · Opened: ${opened}
          </div>
        </div>
        <button class="modal-close" onclick="this.closest('.modal').remove()">×</button>
      </div>

      <!-- Tab bar -->
      <div style="display:flex;gap:0;border-bottom:1px solid var(--border,rgba(148,163,184,0.12));padding:0 1.25rem;">
        <button onclick="tkSwitchTab(this,'tk-tab-messages')" class="tk-modal-tab tk-modal-tab--active" style="padding:.6rem 1rem;border:none;background:none;cursor:pointer;font:inherit;font-size:12px;font-weight:600;color:#60a5fa;border-bottom:2px solid #60a5fa;margin-bottom:-1px;">Messages</button>
        <button onclick="tkSwitchTab(this,'tk-tab-reply')" class="tk-modal-tab" style="padding:.6rem 1rem;border:none;background:none;cursor:pointer;font:inherit;font-size:12px;font-weight:600;color:#94a3b8;border-bottom:2px solid transparent;margin-bottom:-1px;">Reply &amp; Actions</button>
      </div>

      <div class="modal-body" style="overflow-y:auto;flex:1;padding:1.25rem;">

        <!-- Messages tab -->
        <div id="tk-tab-messages">
          <div id="tk-messages-loading" style="text-align:center;color:#94a3b8;padding:2rem;font-size:13px;">Loading messages…</div>
          <div id="tk-messages-list" style="display:flex;flex-direction:column;gap:.5rem;"></div>
        </div>

        <!-- Reply & Actions tab -->
        <div id="tk-tab-reply" style="display:none;">
          <div style="display:flex;gap:.5rem;margin-bottom:1rem;flex-wrap:wrap;align-items:center;">
            <span class="tk-priority-pill ${priorityClass}">${priority}</span>
            <span class="tk-status-${t.status}" style="color:${t.status === 'open' ? '#34d399' : '#94a3b8'};font-weight:600;">${escapeHtml(t.status)}</span>
            ${t.claimedByTag ? `<span style="font-size:11px;color:#94a3b8;">· Claimed by ${escapeHtml(t.claimedByTag)}</span>` : ''}
            ${t.firstStaffReplyAt ? `<span style="font-size:11px;color:#34d399;">· Staff replied</span>` : ''}
          </div>

          ${t.staffNote ? `<div style="background:rgba(20,30,56,0.75);border:1px solid rgba(148,163,184,0.12);border-radius:8px;padding:0.625rem 0.75rem;margin-bottom:1rem;"><strong style="font-size:11px;color:#64748b;text-transform:uppercase;">Staff Note</strong><p style="margin:0.25rem 0 0;font-size:13px;color:#e2e8f0;">${escapeHtml(t.staffNote)}</p></div>` : ''}

          <label style="display:block;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#64748b;margin-bottom:0.4rem;">Reply as Bot</label>
          <textarea id="tk-reply-text" placeholder="Type a reply to post in the ticket channel…"
            style="width:100%;min-height:100px;padding:0.625rem;border:1px solid rgba(148,163,184,0.15);border-radius:6px;background:rgba(2,6,23,0.6);color:#e2e8f0;font:inherit;font-size:13px;resize:vertical;"></textarea>
          <div style="display:flex;gap:.5rem;margin-top:.5rem;flex-wrap:wrap;">
            <button class="btn btn-primary" onclick="window.tkSendReply('${escapeAttr(t.channelId)}')">Send Reply</button>
          </div>

          <hr style="margin:1.25rem 0;border:none;border-top:1px solid rgba(148,163,184,0.12);" />

          <label style="display:block;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#64748b;margin-bottom:0.4rem;">Actions</label>
          <div style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:center;">
            ${t.status === 'open' && !t.claimedBy ? `<button class="btn btn-secondary" onclick="window.tkClaim('${escapeAttr(t.channelId)}')">🛡️ Claim</button>` : ''}
            ${t.status === 'open' ? `<button class="btn" style="background:rgba(239,68,68,0.15);color:#f87171;border:1px solid rgba(239,68,68,0.3);" onclick="window.tkClose('${escapeAttr(t.channelId)}')">🔒 Close</button>` : ''}
            <select id="tk-priority-select" style="padding:6px 10px;border:1px solid rgba(148,163,184,0.15);border-radius:6px;background:rgba(2,6,23,0.6);color:#e2e8f0;font:inherit;font-size:12px;">
              <option value="low" ${t.priority === 'low' ? 'selected' : ''}>🔵 Low</option>
              <option value="normal" ${(t.priority ?? 'normal') === 'normal' ? 'selected' : ''}>🟢 Normal</option>
              <option value="high" ${t.priority === 'high' ? 'selected' : ''}>🔴 High</option>
              <option value="critical" ${t.priority === 'critical' ? 'selected' : ''}>🚨 Critical</option>
            </select>
            <button class="btn btn-secondary" onclick="window.tkSetPriority('${escapeAttr(t.channelId)}')">Set Priority</button>
          </div>
        </div>
      </div>

      <div class="modal-footer" style="border-top:1px solid rgba(148,163,184,0.12);">
        <button class="btn btn-secondary" onclick="this.closest('.modal').remove()">Close</button>
      </div>
    </div>`

  document.body.appendChild(modal)
  modal.onclick = (e) => {
    if (e.target === modal) modal.remove()
  }

  // Load messages
  loadTicketMessages(t.channelId)
}

window.tkSwitchTab = (btn, tabId) => {
  const modal = btn.closest('.modal-content')
  modal.querySelectorAll('.tk-modal-tab').forEach((b) => {
    b.style.color = '#94a3b8'
    b.style.borderBottomColor = 'transparent'
  })
  btn.style.color = '#60a5fa'
  btn.style.borderBottomColor = '#60a5fa'
  modal
    .querySelectorAll('#tk-tab-messages, #tk-tab-reply')
    .forEach((t) => (t.style.display = 'none'))
  const tab = modal.querySelector(`#${tabId}`)
  if (tab) tab.style.display = 'block'
}

async function loadTicketMessages(channelId) {
  const listEl = document.getElementById('tk-messages-list')
  const loadingEl = document.getElementById('tk-messages-loading')
  try {
    const r = await window.apiClient.request('GET', `/api/tickets/${channelId}/messages?limit=50`)
    if (!r.ok) throw new Error(r.error)
    const msgs = r.data || []
    if (loadingEl) loadingEl.style.display = 'none'
    if (!listEl) return
    if (!msgs.length) {
      listEl.innerHTML =
        '<div style="text-align:center;color:#94a3b8;padding:2rem;font-size:13px;">No messages found.</div>'
      return
    }
    listEl.innerHTML = msgs
      .map((m) => {
        const isBot = m.authorBot
        const bubbleBg = isBot ? 'rgba(59,130,246,0.10)' : 'rgba(20,30,56,0.6)'
        const borderColor = isBot ? 'rgba(59,130,246,0.25)' : 'rgba(148,163,184,0.10)'
        const nameColor = isBot ? '#60a5fa' : '#e2e8f0'
        const time = m.createdAt
          ? new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : ''
        const date = m.createdAt ? new Date(m.createdAt).toLocaleDateString() : ''
        const embedsHtml =
          m.embeds
            ?.filter((e) => e.description || e.title)
            .map(
              (e) => `
        <div style="margin-top:.4rem;background:rgba(0,0,0,0.3);border-left:3px solid #60a5fa;border-radius:4px;padding:.4rem .6rem;font-size:11.5px;color:#94a3b8;">
          ${e.title ? `<div style="font-weight:700;color:#e2e8f0;margin-bottom:2px;">${escapeHtml(e.title)}</div>` : ''}
          ${e.description ? `<div>${escapeHtml(e.description.slice(0, 200))}${e.description.length > 200 ? '…' : ''}</div>` : ''}
        </div>`,
            )
            .join('') ?? ''
        return `
        <div style="background:${bubbleBg};border:1px solid ${borderColor};border-radius:8px;padding:.625rem .875rem;">
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:.3rem;">
            <span style="font-size:11.5px;font-weight:700;color:${nameColor};">${escapeHtml(m.authorTag)}${isBot ? ' 🤖' : ''}</span>
            <span style="font-size:10.5px;color:#475569;" title="${date}">${time}</span>
          </div>
          ${m.content ? `<div style="font-size:13px;color:#e2e8f0;white-space:pre-wrap;word-break:break-word;">${escapeHtml(m.content)}</div>` : ''}
          ${embedsHtml}
          ${m.attachments?.length ? `<div style="margin-top:.3rem;font-size:11px;color:#60a5fa;">📎 ${m.attachments.map((a) => escapeHtml(a.name)).join(', ')}</div>` : ''}
        </div>`
      })
      .join('')
    listEl.scrollTop = listEl.scrollHeight
  } catch (e) {
    if (loadingEl) loadingEl.textContent = 'Failed to load messages: ' + e.message
  }
}

window.tkSendReply = async (channelId) => {
  const ta = document.getElementById('tk-reply-text')
  const content = (ta?.value || '').trim()
  if (!content) {
    showToast('Type a reply first', 'warning')
    return
  }
  try {
    const r = await window.apiClient.ticketReply(channelId, content)
    if (r.ok) {
      showToast('Reply posted', 'success')
      document.querySelector('.modal')?.remove()
      await loadTicketList()
    } else {
      showToast('Reply failed: ' + r.error, 'error')
    }
  } catch (e) {
    showToast('Reply error: ' + e.message, 'error')
  }
}

window.tkClaim = async (channelId) => {
  try {
    const r = await window.apiClient.ticketClaim(channelId)
    if (r.ok) {
      showToast('Ticket claimed', 'success')
      document.querySelector('.modal')?.remove()
      await loadTicketList()
    } else {
      showToast('Claim failed: ' + r.error, 'error')
    }
  } catch (e) {
    showToast('Claim error: ' + e.message, 'error')
  }
}

window.tkClose = async (channelId) => {
  const reason = prompt('Close reason (optional):') || ''
  if (reason === null) return
  try {
    const r = await window.apiClient.ticketClose(channelId, reason)
    if (r.ok) {
      showToast('Ticket closed', 'success')
      document.querySelector('.modal')?.remove()
      await loadTicketList()
      await loadTicketStats()
    } else {
      showToast('Close failed: ' + r.error, 'error')
    }
  } catch (e) {
    showToast('Close error: ' + e.message, 'error')
  }
}

window.tkSetPriority = async (channelId) => {
  const sel = document.getElementById('tk-priority-select')
  if (!sel) return
  try {
    const r = await window.apiClient.ticketSetPriority(channelId, sel.value)
    if (r.ok) {
      showToast(`Priority set to ${sel.value}`, 'success')
      await loadTicketList()
    } else {
      showToast('Priority update failed: ' + r.error, 'error')
    }
  } catch (e) {
    showToast('Priority error: ' + e.message, 'error')
  }
}

function setupTicketsToolbar() {
  const filter = document.getElementById('tk-filter-status')
  if (filter && !filter.dataset.wired) {
    filter.addEventListener('change', loadTicketList)
    filter.dataset.wired = '1'
  }
  const search = document.getElementById('tk-search')
  if (search && !search.dataset.wired) {
    search.addEventListener('input', () => {
      const q = search.value.toLowerCase()
      const filtered = !q
        ? _ticketsData
        : _ticketsData.filter(
            (t) =>
              (t.userTag || '').toLowerCase().includes(q) ||
              (t.userId || '').toLowerCase().includes(q) ||
              (t.reason || '').toLowerCase().includes(q) ||
              String(t.id).includes(q),
          )
      renderTicketTable(filtered)
    })
    search.dataset.wired = '1'
  }
}

function setText(id, txt) {
  const el = document.getElementById(id)
  if (el) el.textContent = txt
}

function formatDuration(ms) {
  if (!ms || ms < 0) return '-'
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ${min % 60}m`
  const days = Math.floor(hr / 24)
  return `${days}d ${hr % 24}h`
}

function formatRelative(ts) {
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return Math.floor(diff / 60_000) + 'm ago'
  if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + 'h ago'
  if (diff < 604_800_000) return Math.floor(diff / 86_400_000) + 'd ago'
  return new Date(ts).toLocaleDateString()
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
function escapeAttr(s) {
  return String(s ?? '')
    .replace(/'/g, '&apos;')
    .replace(/"/g, '&quot;')
}

window.initTickets = initTickets
