/**
 * Unified Member Card
 * Shared modal callable from any page via window.openMemberCard(userId)
 * Replaces page-specific member modals.
 */

window.openMemberCard = async function openMemberCard(userId, opts = {}) {
  if (!userId) return
  const mount = document.getElementById('member-card-modal-root') || document.body

  // Show loading modal immediately
  const modal = window.uiOpenModal({
    id: 'member-card-modal',
    title: 'Loading member…',
    body: '<div style="text-align:center;color:#64748b;padding:2rem;">Loading…</div>',
    width: '640px',
  })

  try {
    const [memberRes, ticketsRes, econRes, usersRes] = await Promise.all([
      window.apiClient.getMember(userId).catch((e) => ({ ok: false, error: String(e) })),
      window.apiClient
        .get(`/api/members/${encodeURIComponent(userId)}/tickets`)
        .catch(() => ({ ok: false })),
      window.apiClient.getEconomyUser(userId).catch(() => ({ ok: false })),
      window.apiClient.resolveUsers([userId]).catch(() => ({ ok: false })),
    ])

    if (!memberRes.ok) {
      modal.querySelector('div[style*="overflow-y:auto"]').innerHTML =
        `<div style="color:#f87171;padding:1rem;">${window.esc(memberRes.error || 'Failed to load member')}</div>`
      return
    }

    const data = memberRes.data
    const tickets = ticketsRes?.ok ? ticketsRes.data || [] : []
    const econ = econRes?.ok ? econRes.data || null : null
    const userInfo = usersRes?.ok ? usersRes.data?.[userId] || {} : {}
    render(modal, userId, data, tickets, econ, userInfo)
  } catch (e) {
    modal.querySelector('div[style*="overflow-y:auto"]').innerHTML =
      `<div style="color:#f87171;padding:1rem;">${window.esc(String(e))}</div>`
  }
}

function render(modal, userId, data, tickets, econ, userInfo) {
  const profile = data.profile || {}
  const stats = profile.stats || {}
  const badges = data.badges || []
  const warningHistory = data.warningHistory || []
  const notesList = data.notesList || []
  const reputationHistory = data.reputationHistory || []

  const displayName = userInfo.displayName || userInfo.username || userId
  const username = userInfo.username || ''
  const avatarUrl = userInfo.avatarUrl

  const avatar = avatarUrl
    ? `<img src="${window.esc(avatarUrl)}" style="width:56px;height:56px;border-radius:50%;margin-right:14px;object-fit:cover;border:2px solid rgba(96,165,250,0.3);" onerror="this.style.display='none'">`
    : `<span style="display:inline-flex;align-items:center;justify-content:center;width:56px;height:56px;border-radius:50%;background:rgba(96,165,250,0.2);margin-right:14px;font-size:20px;font-weight:700;color:#60a5fa;flex-shrink:0;border:2px solid rgba(96,165,250,0.3);">${window.esc(displayName.charAt(0).toUpperCase())}</span>`

  const warnCount = data.warnings ?? 0
  const warnColor =
    warnCount >= 5 ? '#f87171' : warnCount >= 3 ? '#fbbf24' : warnCount >= 1 ? '#fb923c' : '#34d399'
  const level = stats.level ?? 0
  const xp = stats.xp ?? 0
  const xpForNext = stats.xpForNextLevel ?? (level + 1) * 100
  const xpPct = Math.min(100, Math.max(0, (xp / xpForNext) * 100))
  const ndcBalance = econ?.balance ?? 0
  const ndcBank = econ?.bank ?? 0

  // Header
  const header = `
    <div style="display:flex;align-items:center;margin-bottom:1.25rem;">
      ${avatar}
      <div style="flex:1;min-width:0;">
        <div style="font-size:18px;font-weight:700;color:#e2e8f0;">${window.esc(displayName)}</div>
        ${username && username !== displayName ? `<div style="font-size:12px;color:#64748b;">@${window.esc(username)}</div>` : ''}
        <div style="font-size:11px;color:#475569;font-family:monospace;margin-top:2px;">${window.esc(userId)}
          <button onclick="copyText('${window.esc(userId)}')" style="background:none;border:none;color:#60a5fa;cursor:pointer;font-size:10px;margin-left:4px;">📋</button>
        </div>
      </div>
    </div>`

  // Stats grid (5 columns)
  const statsGrid = `
    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:.5rem;margin-bottom:1rem;">
      ${stat('Messages', (stats.messages ?? 0).toLocaleString(), '#60a5fa')}
      ${stat('Level', level, '#a78bfa')}
      ${stat('Rep', data.reputation ?? 0, '#fbbf24')}
      ${stat('Warns', warnCount, warnColor)}
      ${stat('NDC', ndcBalance.toLocaleString(), '#34d399')}
    </div>
    <div style="margin-bottom:1rem;background:rgba(15,18,40,0.6);border:1px solid rgba(148,163,184,0.1);border-radius:6px;padding:.5rem .75rem;">
      <div style="display:flex;justify-content:space-between;font-size:10px;color:#64748b;margin-bottom:4px;text-transform:uppercase;letter-spacing:.05em;">
        <span>Level ${level} progress</span><span>${xp}/${xpForNext} XP</span>
      </div>
      <div style="height:6px;background:rgba(148,163,184,0.1);border-radius:3px;overflow:hidden;">
        <div style="height:100%;width:${xpPct}%;background:linear-gradient(90deg,#a78bfa,#60a5fa);"></div>
      </div>
      ${econ ? `<div style="display:flex;justify-content:space-between;margin-top:.5rem;font-size:11px;color:#94a3b8;"><span>Wallet: <strong style="color:#34d399;">${ndcBalance.toLocaleString()} NDC</strong></span><span>Bank: <strong style="color:#34d399;">${ndcBank.toLocaleString()} NDC</strong></span></div>` : ''}
    </div>`

  const bioBlock = profile.bio
    ? `<div style="background:rgba(96,165,250,0.05);border:1px solid rgba(96,165,250,0.15);border-radius:6px;padding:.75rem;margin-bottom:1rem;font-size:13px;color:#94a3b8;font-style:italic;">${window.esc(profile.bio)}</div>`
    : ''

  const badgesBlock =
    badges.length > 0
      ? `<div style="margin-bottom:1rem;">
        <strong style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;">Badges (${badges.length})</strong>
        <div style="margin-top:.5rem;display:flex;flex-wrap:wrap;gap:.4rem;">
          ${badges.map((b) => `<span style="background:rgba(167,139,250,0.1);color:#a78bfa;border:1px solid rgba(167,139,250,0.25);border-radius:999px;padding:2px 10px;font-size:11px;" title="${window.esc(typeof b === 'object' ? b.description || '' : '')}">${typeof b === 'object' ? window.esc(b.icon || '') + ' ' + window.esc(b.name || b.id || '') : window.esc(b)}</span>`).join('')}
        </div>
      </div>`
      : ''

  const ticketsBlock =
    tickets.length > 0
      ? `<div style="margin-bottom:1rem;">
        <strong style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;">Open Tickets (${tickets.length})</strong>
        <div style="margin-top:.5rem;display:flex;flex-direction:column;gap:.3rem;">
          ${tickets
            .map(
              (t) => `
            <div style="background:rgba(15,18,40,0.6);border-left:3px solid #60a5fa;border-radius:4px;padding:.5rem .75rem;font-size:12px;">
              <div style="color:#e2e8f0;">${window.esc(t.reason || 'No reason')}</div>
              <div style="color:#64748b;font-size:10px;margin-top:2px;">${t.createdAt ? window.fmtRelative(t.createdAt) : ''}${t.priority ? ' · <span style="color:#fbbf24;">' + window.esc(t.priority) + '</span>' : ''}</div>
            </div>`,
            )
            .join('')}
        </div>
      </div>`
      : ''

  const warningsBlock =
    warningHistory.length > 0
      ? `<div style="margin-bottom:1rem;">
        <strong style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;">Warning History (${warningHistory.length})</strong>
        <div style="margin-top:.5rem;display:flex;flex-direction:column;gap:.3rem;">
          ${warningHistory
            .map(
              (w) => `
            <div style="background:rgba(251,191,36,0.06);border-left:3px solid rgba(251,191,36,0.5);border-radius:4px;padding:.5rem .75rem;font-size:12px;">
              <div style="display:flex;justify-content:space-between;color:#64748b;margin-bottom:2px;font-size:10px;">
                <span>Mod: <code>${window.esc(w.moderatorId || '?')}</code></span>
                <span>${window.fmtRelative(w.at)}</span>
              </div>
              <div style="color:#e2e8f0;">${window.esc(w.reason || 'No reason')}</div>
            </div>`,
            )
            .join('')}
        </div>
      </div>`
      : ''

  const notesBlock =
    notesList.length > 0
      ? `<div style="margin-bottom:1rem;">
        <strong style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;">Staff Notes (${notesList.length})</strong>
        <div style="margin-top:.5rem;display:flex;flex-direction:column;gap:.3rem;">
          ${notesList
            .map((n) => {
              const borderColor =
                n.severity === 'high'
                  ? '#f87171'
                  : n.severity === 'medium'
                    ? '#fbbf24'
                    : 'rgba(148,163,184,0.3)'
              return `<div style="background:rgba(15,18,40,0.6);border-left:3px solid ${borderColor};border-radius:4px;padding:.5rem .75rem;font-size:12px;">
              <div style="display:flex;justify-content:space-between;color:#64748b;margin-bottom:2px;font-size:10px;">
                <span>By: <code>${window.esc(n.by || '?')}</code>${n.severity ? ' · <strong style="color:' + borderColor + ';">' + window.esc(n.severity) + '</strong>' : ''}</span>
                <span>${window.fmtRelative(n.at)}</span>
              </div>
              <div style="color:#e2e8f0;">${window.esc(n.text || '')}</div>
            </div>`
            })
            .join('')}
        </div>
      </div>`
      : ''

  const repHistoryBlock =
    reputationHistory.length > 0
      ? `<div style="margin-bottom:1rem;">
        <strong style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;">Recent Reputation</strong>
        <div style="margin-top:.5rem;display:flex;flex-direction:column;gap:.2rem;">
          ${reputationHistory
            .map(
              (r) => `
            <div style="display:flex;justify-content:space-between;font-size:11px;padding:.25rem 0;border-bottom:1px solid rgba(148,163,184,0.08);">
              <span style="color:#34d399;font-weight:700;min-width:40px;">+${r.points ?? 1}</span>
              <span style="flex:1;padding:0 .5rem;color:#94a3b8;">${window.esc(r.reason || '')}</span>
              <span style="color:#475569;">${window.fmtRelative(r.at)}</span>
            </div>`,
            )
            .join('')}
        </div>
      </div>`
      : ''

  const bodyHtml =
    header +
    statsGrid +
    bioBlock +
    badgesBlock +
    ticketsBlock +
    repHistoryBlock +
    warningsBlock +
    notesBlock

  // Footer with quick actions
  const footerHtml = `
    <button class="btn btn-sm" onclick="memberCardAction('warn','${window.esc(userId)}')" style="background:rgba(251,191,36,0.1);border:1px solid rgba(251,191,36,0.3);color:#fbbf24;padding:.4rem .8rem;border-radius:6px;cursor:pointer;font-size:12px;">⚠ Warn</button>
    <button class="btn btn-sm" onclick="memberCardAction('note','${window.esc(userId)}')" style="background:rgba(148,163,184,0.1);border:1px solid rgba(148,163,184,0.3);color:#94a3b8;padding:.4rem .8rem;border-radius:6px;cursor:pointer;font-size:12px;">📝 Add Note</button>
    <button class="btn btn-sm" onclick="memberCardAction('balance','${window.esc(userId)}')" style="background:rgba(52,211,153,0.1);border:1px solid rgba(52,211,153,0.3);color:#34d399;padding:.4rem .8rem;border-radius:6px;cursor:pointer;font-size:12px;">$ Edit Balance</button>
    <button class="btn btn-sm" onclick="memberCardAction('resetLevel','${window.esc(userId)}')" style="background:rgba(167,139,250,0.1);border:1px solid rgba(167,139,250,0.3);color:#a78bfa;padding:.4rem .8rem;border-radius:6px;cursor:pointer;font-size:12px;">↺ Reset Level</button>
    <div style="flex:1;"></div>
    <button class="btn" onclick="uiCloseModal('member-card-modal')" style="background:rgba(96,165,250,0.1);border:1px solid rgba(96,165,250,0.3);color:#60a5fa;padding:.4rem 1rem;border-radius:6px;cursor:pointer;font-size:12px;">Close</button>
  `

  // Update modal contents
  modal.querySelector('div[style*="overflow-y:auto"]').innerHTML = bodyHtml
  // Update title
  const headerEl = modal.querySelector('div[style*="border-bottom"]')
  if (headerEl) headerEl.querySelector('div').textContent = displayName
  // Add or replace footer
  const card = modal.firstElementChild
  const existingFooter = card.querySelector('div[style*="border-top"]')
  if (existingFooter) existingFooter.remove()
  const footerEl = document.createElement('div')
  footerEl.style.cssText =
    'padding:.75rem 1.25rem;border-top:1px solid rgba(148,163,184,0.1);display:flex;gap:.4rem;align-items:center;flex-wrap:wrap;flex-shrink:0;'
  footerEl.innerHTML = footerHtml
  card.appendChild(footerEl)
}

function stat(label, value, color = '#e2e8f0') {
  return `<div style="background:rgba(15,18,40,0.6);border:1px solid rgba(148,163,184,0.1);border-radius:8px;padding:.5rem .6rem;text-align:center;">
    <div style="font-size:9px;color:#475569;text-transform:uppercase;letter-spacing:.05em;margin-bottom:2px;">${label}</div>
    <div style="font-size:1rem;font-weight:700;color:${color};">${value}</div>
  </div>`
}

// ── Quick Action Handlers ──────────────────────────────────────────────────

window.memberCardAction = async function memberCardAction(action, userId) {
  switch (action) {
    case 'warn':
      return promptWarn(userId)
    case 'note':
      return promptNote(userId)
    case 'balance':
      return promptBalance(userId)
    case 'resetLevel':
      return promptResetLevel(userId)
  }
}

function promptWarn(userId) {
  const body = `
    <div style="display:flex;flex-direction:column;gap:.75rem;">
      <label style="font-size:11px;color:#64748b;text-transform:uppercase;">Reason</label>
      <textarea id="mc-warn-reason" rows="3" placeholder="Why are you warning this user?" style="width:100%;padding:.5rem;background:#0a0e1f;border:1px solid rgba(148,163,184,0.2);border-radius:6px;color:#e2e8f0;font-family:inherit;font-size:13px;resize:vertical;"></textarea>
    </div>`
  const footer = `
    <button onclick="uiCloseModal('mc-action-modal')" style="background:transparent;border:1px solid rgba(148,163,184,0.3);color:#94a3b8;padding:.4rem 1rem;border-radius:6px;cursor:pointer;">Cancel</button>
    <button onclick="submitWarn('${window.esc(userId)}')" style="background:rgba(251,191,36,0.15);border:1px solid rgba(251,191,36,0.4);color:#fbbf24;padding:.4rem 1rem;border-radius:6px;cursor:pointer;font-weight:700;">Issue Warning</button>
  `
  window.uiOpenModal({ id: 'mc-action-modal', title: 'Warn User', body, footer, width: '480px' })
}

window.submitWarn = async function submitWarn(userId) {
  const reason = document.getElementById('mc-warn-reason')?.value?.trim()
  if (!reason) {
    window.showToast('Reason required', 'warning')
    return
  }
  try {
    const r = await window.apiClient.addWarning(userId, reason)
    if (!r.ok) throw new Error(r.error)
    window.showToast('Warning issued', 'success')
    window.uiCloseModal('mc-action-modal')
    window.openMemberCard(userId) // refresh card
  } catch (e) {
    window.showToast('Failed: ' + e.message, 'error')
  }
}

function promptNote(userId) {
  const body = `
    <div style="display:flex;flex-direction:column;gap:.75rem;">
      <label style="font-size:11px;color:#64748b;text-transform:uppercase;">Severity</label>
      <select id="mc-note-severity" style="padding:.5rem;background:#0a0e1f;border:1px solid rgba(148,163,184,0.2);border-radius:6px;color:#e2e8f0;">
        <option value="low">Low</option>
        <option value="medium">Medium</option>
        <option value="high">High</option>
      </select>
      <label style="font-size:11px;color:#64748b;text-transform:uppercase;">Note</label>
      <textarea id="mc-note-text" rows="4" placeholder="Private staff note about this user…" style="width:100%;padding:.5rem;background:#0a0e1f;border:1px solid rgba(148,163,184,0.2);border-radius:6px;color:#e2e8f0;font-family:inherit;font-size:13px;resize:vertical;"></textarea>
    </div>`
  const footer = `
    <button onclick="uiCloseModal('mc-action-modal')" style="background:transparent;border:1px solid rgba(148,163,184,0.3);color:#94a3b8;padding:.4rem 1rem;border-radius:6px;cursor:pointer;">Cancel</button>
    <button onclick="submitNote('${window.esc(userId)}')" style="background:rgba(148,163,184,0.15);border:1px solid rgba(148,163,184,0.4);color:#cbd5e1;padding:.4rem 1rem;border-radius:6px;cursor:pointer;font-weight:700;">Save Note</button>
  `
  window.uiOpenModal({
    id: 'mc-action-modal',
    title: 'Add Staff Note',
    body,
    footer,
    width: '480px',
  })
}

window.submitNote = async function submitNote(userId) {
  const text = document.getElementById('mc-note-text')?.value?.trim()
  const severity = document.getElementById('mc-note-severity')?.value || 'low'
  if (!text) {
    window.showToast('Note text required', 'warning')
    return
  }
  try {
    const r = await window.apiClient.post('/api/mod-notes', { userId, text, severity })
    if (!r.ok) throw new Error(r.error)
    window.showToast('Note saved', 'success')
    window.uiCloseModal('mc-action-modal')
    window.openMemberCard(userId) // refresh
  } catch (e) {
    window.showToast('Failed: ' + e.message, 'error')
  }
}

function promptBalance(userId) {
  const body = `
    <div style="display:flex;flex-direction:column;gap:.75rem;">
      <label style="font-size:11px;color:#64748b;text-transform:uppercase;">New Wallet Balance (NDC)</label>
      <input id="mc-balance" type="number" min="0" placeholder="0" style="width:100%;padding:.5rem;background:#0a0e1f;border:1px solid rgba(148,163,184,0.2);border-radius:6px;color:#e2e8f0;font-size:13px;">
      <div style="font-size:11px;color:#64748b;">This sets the wallet balance to an exact amount.</div>
    </div>`
  const footer = `
    <button onclick="uiCloseModal('mc-action-modal')" style="background:transparent;border:1px solid rgba(148,163,184,0.3);color:#94a3b8;padding:.4rem 1rem;border-radius:6px;cursor:pointer;">Cancel</button>
    <button onclick="submitBalance('${window.esc(userId)}')" style="background:rgba(52,211,153,0.15);border:1px solid rgba(52,211,153,0.4);color:#34d399;padding:.4rem 1rem;border-radius:6px;cursor:pointer;font-weight:700;">Save Balance</button>
  `
  window.uiOpenModal({ id: 'mc-action-modal', title: 'Edit Balance', body, footer, width: '420px' })
}

window.submitBalance = async function submitBalance(userId) {
  const v = parseInt(document.getElementById('mc-balance')?.value, 10)
  if (!Number.isFinite(v) || v < 0) {
    window.showToast('Valid number required', 'warning')
    return
  }
  try {
    const r = await window.apiClient.setEconomyBalance(userId, v)
    if (!r.ok) throw new Error(r.error)
    window.showToast('Balance updated', 'success')
    window.uiCloseModal('mc-action-modal')
    window.openMemberCard(userId)
  } catch (e) {
    window.showToast('Failed: ' + e.message, 'error')
  }
}

function promptResetLevel(userId) {
  const body = `<div style="color:#e2e8f0;line-height:1.5;">Reset this user's level, XP, and messages to zero? <strong style="color:#f87171;">This cannot be undone.</strong></div>`
  const footer = `
    <button onclick="uiCloseModal('mc-action-modal')" style="background:transparent;border:1px solid rgba(148,163,184,0.3);color:#94a3b8;padding:.4rem 1rem;border-radius:6px;cursor:pointer;">Cancel</button>
    <button onclick="submitResetLevel('${window.esc(userId)}')" style="background:rgba(248,113,113,0.15);border:1px solid rgba(248,113,113,0.4);color:#f87171;padding:.4rem 1rem;border-radius:6px;cursor:pointer;font-weight:700;">Reset Level</button>
  `
  window.uiOpenModal({ id: 'mc-action-modal', title: 'Reset Level', body, footer, width: '420px' })
}

window.submitResetLevel = async function submitResetLevel(userId) {
  try {
    // Get the primary guild from health endpoint
    const health = await window.apiClient.getDashboardHealth().catch(() => null)
    const guildId = health?.data?.guildId || ''
    const r = await window.apiClient.resetLevelRecord(userId, guildId)
    if (!r.ok) throw new Error(r.error)
    window.showToast('Level reset', 'success')
    window.uiCloseModal('mc-action-modal')
    window.openMemberCard(userId)
  } catch (e) {
    window.showToast('Failed: ' + e.message, 'error')
  }
}
