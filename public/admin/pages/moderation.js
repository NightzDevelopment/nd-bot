/**
 * Moderation Page
 * Warnings, attention list, high-severity notes, bans, AI AutoMod strikes
 */

async function initModeration() {
  injectAddWarningModal()
  document.querySelectorAll('[data-tab]').forEach((tab) => {
    tab.addEventListener('click', (e) => {
      e.preventDefault()
      showModerationTab(tab.getAttribute('data-tab'))
    })
  })
  await showModerationTab('warnings')
}

async function showModerationTab(tabName) {
  document.querySelectorAll('[data-tab]').forEach((t) => t.classList.remove('active'))
  document.querySelector(`[data-tab="${tabName}"]`)?.classList.add('active')

  const panelMap = {
    warnings: 'mod-warnings-content',
    'needs-attention': 'mod-attention-content',
    'high-notes': 'mod-notes-content',
    bans: 'mod-bans-content',
    'ai-strikes': 'mod-strikes-content',
  }
  Object.values(panelMap).forEach((id) => document.getElementById(id)?.classList.remove('active'))
  document.getElementById(panelMap[tabName])?.classList.add('active')

  try {
    switch (tabName) {
      case 'warnings':
        await loadWarningsTab()
        break
      case 'needs-attention':
        await loadNeedsAttentionTab()
        break
      case 'high-notes':
        await loadHighNotesTab()
        break
      case 'bans':
        await loadBans()
        break
      case 'ai-strikes':
        await loadAiStrikesTab()
        break
    }
  } catch (e) {
    console.error(`Tab load error (${tabName}):`, e)
    showToast(`Error loading ${tabName}: ${e.message}`, 'error')
  }
}

// ── Warnings Tab ───────────────────────────────────────────────────────────

let _resolvedWarningUsers = {}

async function loadWarningsTab() {
  const container = document.getElementById('mod-warnings-content')
  if (!container) return
  container.innerHTML = '<p style="color:#64748b;padding:1rem;">Loading…</p>'
  try {
    const result = await window.apiClient.getModerationWarnings(50)
    if (!result.ok) throw new Error(result.error)
    const data = result.data

    // Batch-resolve user IDs
    const ids = data.map((w) => w.userId)
    if (ids.length && window.apiClient.resolveUsers) {
      const r = await window.apiClient.resolveUsers(ids).catch(() => ({ ok: false }))
      if (r.ok) _resolvedWarningUsers = { ..._resolvedWarningUsers, ...r.data }
    }

    if (!data.length) {
      container.innerHTML = '<p class="empty-state">No warnings recorded.</p>'
      return
    }

    const WARN_AT = 3,
      KICK_AT = 5,
      BAN_AT = 7
    container.innerHTML = `
      <div style="display:flex;justify-content:flex-end;margin-bottom:.75rem;">
        <button class="btn" onclick="openAddWarningModal()"
          style="background:rgba(251,191,36,0.1);border-color:rgba(251,191,36,0.3);color:#fbbf24;">+ Add Warning</button>
      </div>
      <div style="overflow-x:auto;">
        <table class="data-table">
          <thead><tr><th>User</th><th>Count</th><th>Escalation</th><th>Latest Reason</th><th>Last Warning</th><th></th></tr></thead>
          <tbody>
            ${data
              .map((w) => {
                const u = _resolvedWarningUsers[w.userId]
                const name = u
                  ? `<strong style="color:#e2e8f0;cursor:pointer;" onclick="openMemberCard('${w.userId}')">${escHtml(u.displayName || u.username)}</strong><br><code style="font-size:10px;color:#64748b;">${w.userId}</code>`
                  : `<code style="cursor:pointer;" onclick="openMemberCard('${w.userId}')">${w.userId}</code>`
                const pct = Math.min(100, (w.count / BAN_AT) * 100)
                const barColor =
                  w.count >= BAN_AT
                    ? '#f87171'
                    : w.count >= KICK_AT
                      ? '#fbbf24'
                      : w.count >= WARN_AT
                        ? '#fb923c'
                        : '#34d399'
                const label =
                  w.count >= BAN_AT
                    ? '🚫 Ban'
                    : w.count >= KICK_AT
                      ? '⚠️ Kick'
                      : w.count >= WARN_AT
                        ? '⚠️ Warn'
                        : '👁 Watch'
                return `<tr>
                <td>${name}</td>
                <td style="font-weight:700;font-size:1.1rem;color:${barColor};">${w.count}</td>
                <td style="min-width:120px;">
                  <div style="font-size:11px;margin-bottom:3px;color:${barColor};">${label}</div>
                  <div style="background:rgba(255,255,255,0.07);border-radius:4px;height:4px;width:100px;">
                    <div style="background:${barColor};height:4px;border-radius:4px;width:${pct}%;"></div>
                  </div>
                </td>
                <td style="color:#94a3b8;font-size:12px;">${escHtml((w.latestReason || 'N/A').slice(0, 60))}</td>
                <td style="color:#64748b;font-size:12px;white-space:nowrap;">${w.lastWarningAt ? new Date(w.lastWarningAt).toLocaleDateString() : '—'}</td>
                <td><button class="btn btn-sm" onclick="clearUserWarnings('${w.userId}')"
                  style="color:#34d399;border-color:rgba(52,211,153,0.3);background:rgba(52,211,153,0.08);">Clear</button></td>
              </tr>`
              })
              .join('')}
          </tbody>
        </table>
      </div>`
  } catch (e) {
    container.innerHTML = `<p style="color:#f87171;padding:1rem;">${e.message}</p>`
  }
}

window.clearUserWarnings = async (userId) => {
  if (!confirm(`Clear all warnings for user ${userId}? This cannot be undone.`)) return
  try {
    const r = await window.apiClient.clearWarnings(userId)
    if (!r.ok) throw new Error(r.error)
    showToast('Warnings cleared', 'success')
    await loadWarningsTab()
  } catch (e) {
    showToast('Error: ' + e.message, 'error')
  }
}

// ── Add Warning Modal ──────────────────────────────────────────────────────

function injectAddWarningModal() {
  if (document.getElementById('add-warning-modal')) return
  const el = document.createElement('div')
  el.id = 'add-warning-modal'
  el.style.cssText =
    'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.65);z-index:9999;align-items:center;justify-content:center;'
  el.innerHTML = `
    <div style="background:#0f1228;border:1px solid rgba(251,191,36,0.25);border-radius:12px;padding:1.75rem;width:420px;max-width:95vw;box-shadow:0 20px 60px rgba(0,0,0,0.5);">
      <h3 style="margin:0 0 1.25rem;color:#e2e8f0;font-size:15px;">Add Warning</h3>
      <label style="display:flex;flex-direction:column;gap:4px;margin-bottom:1rem;">
        <span style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;">User ID *</span>
        <input id="aw-userid" type="text" placeholder="Discord user ID (18-digit number)"
          style="background:rgba(15,18,40,0.8);border:1px solid rgba(96,165,250,0.25);color:#e2e8f0;padding:.5rem .65rem;border-radius:6px;font-size:14px;font-family:monospace;" />
      </label>
      <label style="display:flex;flex-direction:column;gap:4px;margin-bottom:1rem;">
        <span style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;">Reason *</span>
        <input id="aw-reason" type="text" maxlength="200" placeholder="e.g. Spamming in #general"
          style="background:rgba(15,18,40,0.8);border:1px solid rgba(96,165,250,0.25);color:#e2e8f0;padding:.5rem .65rem;border-radius:6px;font-size:14px;" />
      </label>
      <div id="aw-error" style="display:none;background:rgba(248,113,113,0.1);border:1px solid rgba(248,113,113,0.3);border-radius:6px;padding:.5rem .75rem;font-size:12px;color:#f87171;margin-bottom:1rem;"></div>
      <div style="display:flex;gap:.75rem;justify-content:flex-end;">
        <button class="btn" onclick="closeAddWarningModal()" style="color:#64748b;border-color:rgba(100,116,139,0.3);">Cancel</button>
        <button class="btn" id="aw-save" onclick="submitWarning()"
          style="background:rgba(251,191,36,0.15);border-color:rgba(251,191,36,0.4);color:#fbbf24;">Add Warning</button>
      </div>
    </div>`
  document.body.appendChild(el)
  document.addEventListener('click', (e) => {
    if (e.target === el) closeAddWarningModal()
  })
}

window.openAddWarningModal = () => {
  document.getElementById('aw-userid').value = ''
  document.getElementById('aw-reason').value = ''
  document.getElementById('aw-error').style.display = 'none'
  document.getElementById('add-warning-modal').style.display = 'flex'
}
window.closeAddWarningModal = () => {
  document.getElementById('add-warning-modal').style.display = 'none'
}
window.submitWarning = async () => {
  const userId = document.getElementById('aw-userid').value.trim()
  const reason = document.getElementById('aw-reason').value.trim()
  const errEl = document.getElementById('aw-error')
  if (!userId) {
    showErr('User ID is required.')
    return
  }
  if (!reason) {
    showErr('Reason is required.')
    return
  }
  const btn = document.getElementById('aw-save')
  btn.textContent = 'Adding…'
  btn.disabled = true
  errEl.style.display = 'none'
  try {
    const r = await window.apiClient.addWarning(userId, reason)
    if (!r.ok) throw new Error(r.error)
    showToast('Warning added', 'success')
    closeAddWarningModal()
    await loadWarningsTab()
  } catch (e) {
    showErr(e.message)
  } finally {
    btn.textContent = 'Add Warning'
    btn.disabled = false
  }
  function showErr(msg) {
    errEl.textContent = msg
    errEl.style.display = 'block'
  }
}

// ── Needs Attention Tab ────────────────────────────────────────────────────

async function loadNeedsAttentionTab() {
  const container = document.getElementById('mod-attention-content')
  if (!container) return
  try {
    const result = await window.apiClient.getModerationNeedsAttention()
    if (!result.ok) throw new Error(result.error)
    const data = result.data
    container.innerHTML =
      data.length === 0
        ? '<p class="empty-state">No users needing attention.</p>'
        : `<div class="user-list">
        ${data
          .map((u) => {
            const action = u.action || 'watch'
            const actionColor =
              action === 'ban'
                ? '#f87171'
                : action === 'kick'
                  ? '#fbbf24'
                  : action === 'warn'
                    ? '#fb923c'
                    : '#94a3b8'
            return `
            <div class="user-card">
              <div class="user-id"><code>${u.userId}</code></div>
              <div class="user-stats">
                <span>Warnings: <strong>${u.count ?? 0}</strong></span>
                <span>Action: <strong style="color:${actionColor};text-transform:uppercase;">${action}</strong></span>
              </div>
              <div style="font-size:11px;color:#475569;margin-bottom:.5rem;">Last: ${u.lastWarningAt ? new Date(u.lastWarningAt).toLocaleDateString() : 'never'}</div>
              <button class="btn btn-sm" style="margin-right:4px;" onclick="clearUserWarnings('${u.userId}')">Clear Warnings</button>
            </div>`
          })
          .join('')}
      </div>`
  } catch (e) {
    container.innerHTML = `<p style="color:#f87171;">${e.message}</p>`
  }
}

// ── High Notes Tab ─────────────────────────────────────────────────────────

async function loadHighNotesTab() {
  const container = document.getElementById('mod-notes-content')
  if (!container) return
  try {
    const result = await window.apiClient.getModerationHighSeverityNotes()
    if (!result.ok) throw new Error(result.error)
    const data = result.data
    container.innerHTML =
      data.length === 0
        ? '<p class="empty-state">No high-severity notes.</p>'
        : `<table class="data-table">
        <thead><tr><th>User</th><th>High Notes</th><th>Total Notes</th><th>Latest Note</th></tr></thead>
        <tbody>
          ${data
            .map(
              (n) => `
            <tr>
              <td><code>${n.userId.substring(0, 8)}</code></td>
              <td><span class="badge badge-danger">${n.highCount}</span></td>
              <td>${n.noteCount}</td>
              <td style="color:#94a3b8;font-size:12px;">${escHtml(n.latestNote?.text?.substring(0, 60) || 'N/A')}</td>
            </tr>`,
            )
            .join('')}
        </tbody>
      </table>`
  } catch (e) {
    container.innerHTML = `<p style="color:#f87171;">${e.message}</p>`
  }
}

// ── Bans Tab ───────────────────────────────────────────────────────────────

let _allBans = []

window.loadBans = async () => {
  const tbody = document.querySelector('#bans-table tbody')
  if (!tbody) return
  tbody.innerHTML =
    '<tr><td colspan="4" style="text-align:center;color:#64748b;padding:1.5rem;">Loading…</td></tr>'
  try {
    const r = await window.apiClient.getGuildBans()
    if (!r.ok) throw new Error(r.error)
    _allBans = r.data || []
    renderBans(_allBans)
    const search = document.getElementById('bans-search')
    if (search && !search.dataset.wired) {
      search.addEventListener('input', () => {
        const q = search.value.toLowerCase()
        renderBans(
          !q
            ? _allBans
            : _allBans.filter(
                (b) => (b.userTag || '').toLowerCase().includes(q) || b.userId.includes(q),
              ),
        )
      })
      search.dataset.wired = '1'
    }
  } catch (e) {
    if (tbody)
      tbody.innerHTML = `<tr><td colspan="4" style="color:#f87171;padding:1rem;">${e.message}</td></tr>`
  }
}

function renderBans(bans) {
  const tbody = document.querySelector('#bans-table tbody')
  if (!tbody) return
  if (!bans.length) {
    tbody.innerHTML =
      '<tr><td colspan="4" style="text-align:center;color:#64748b;padding:1.5rem;">No bans found.</td></tr>'
    return
  }
  tbody.innerHTML = bans
    .map(
      (b) => `
    <tr>
      <td style="color:#e2e8f0;font-weight:500;">${escHtml(b.userTag || '—')}</td>
      <td><code style="font-size:11px;color:#94a3b8;">${escHtml(b.userId)}</code></td>
      <td style="color:#94a3b8;font-size:12px;">${escHtml(b.reason || 'No reason provided')}</td>
      <td><button class="btn btn-sm" style="color:#34d399;border-color:rgba(52,211,153,0.3);background:rgba(52,211,153,0.08);"
        onclick="window.unbanUser('${b.userId}', '${escAttr(b.userTag || b.userId)}')">Unban</button></td>
    </tr>`,
    )
    .join('')
}

window.unbanUser = async (userId, tag) => {
  if (!confirm(`Unban ${tag}?`)) return
  try {
    const r = await window.apiClient.unbanUser(userId)
    if (r.ok) {
      showToast(`${tag} unbanned`, 'success')
      await loadBans()
    } else showToast('Unban failed: ' + r.error, 'error')
  } catch (e) {
    showToast('Error: ' + e.message, 'error')
  }
}

// ── AI AutoMod Strikes Tab ─────────────────────────────────────────────────

let _resolvedStrikeUsers = {}

async function loadAiStrikesTab() {
  const container = document.getElementById('mod-strikes-content')
  if (!container) return
  container.innerHTML = '<p style="color:#64748b;padding:1rem;">Loading AI strike data…</p>'
  try {
    const r = await window.apiClient.getAutomodStrikes()
    if (!r.ok) throw new Error(r.error)
    const rows = r.data || []

    if (!rows.length) {
      container.innerHTML = '<p class="empty-state">No AI AutoMod strike records yet.</p>'
      return
    }

    // Batch-resolve usernames
    const ids = rows.map((r) => r.userId)
    if (ids.length && window.apiClient.resolveUsers) {
      const res = await window.apiClient.resolveUsers(ids).catch(() => ({ ok: false }))
      if (res.ok) _resolvedStrikeUsers = { ..._resolvedStrikeUsers, ...res.data }
    }

    const warnAt = rows[0]?.warnAt ?? 4
    const kickAt = rows[0]?.kickAt ?? 7
    const banAt = rows[0]?.banAt ?? 12

    container.innerHTML = `
      <div style="background:rgba(96,165,250,0.06);border:1px solid rgba(96,165,250,0.15);border-radius:8px;padding:.75rem 1rem;margin-bottom:1rem;font-size:12px;color:#94a3b8;">
        Thresholds: <strong style="color:#fbbf24;">${warnAt} strikes</strong> → auto-warn &nbsp;·&nbsp;
        <strong style="color:#fb923c;">${kickAt}</strong> → auto-kick &nbsp;·&nbsp;
        <strong style="color:#f87171;">${banAt}</strong> → auto-ban.
        Strikes decay after the configured decay period.
      </div>
      <div style="overflow-x:auto;">
        <table class="data-table">
          <thead><tr><th>User</th><th>Strikes</th><th>Escalation Level</th><th>Last Strike</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${rows
              .map((row) => {
                const u = _resolvedStrikeUsers[row.userId]
                const name = u
                  ? `<strong style="color:#e2e8f0;cursor:pointer;" onclick="openMemberCard('${row.userId}')">${escHtml(u.displayName || u.username)}</strong><br><code style="font-size:10px;color:#64748b;">${row.userId}</code>`
                  : `<code style="font-size:11px;cursor:pointer;" onclick="openMemberCard('${row.userId}')">${row.userId}</code>`
                const pct = Math.min(100, (row.strikes / banAt) * 100)
                const barColor =
                  row.strikes >= banAt
                    ? '#f87171'
                    : row.strikes >= kickAt
                      ? '#fb923c'
                      : row.strikes >= warnAt
                        ? '#fbbf24'
                        : '#34d399'
                const level =
                  row.strikes >= banAt
                    ? '🚫 Ban threshold'
                    : row.strikes >= kickAt
                      ? '⚠️ Kick threshold'
                      : row.strikes >= warnAt
                        ? '⚠️ Warn threshold'
                        : '👁 Monitoring'
                const statusBadges = [
                  row.autoWarned
                    ? '<span style="font-size:10px;background:rgba(251,191,36,0.1);color:#fbbf24;padding:1px 5px;border-radius:3px;border:1px solid rgba(251,191,36,0.3);">Warned</span>'
                    : '',
                  row.autoKicked
                    ? '<span style="font-size:10px;background:rgba(251,146,60,0.1);color:#fb923c;padding:1px 5px;border-radius:3px;border:1px solid rgba(251,146,60,0.3);">Kicked</span>'
                    : '',
                  row.autoBanned
                    ? '<span style="font-size:10px;background:rgba(248,113,113,0.1);color:#f87171;padding:1px 5px;border-radius:3px;border:1px solid rgba(248,113,113,0.3);">Banned</span>'
                    : '',
                ]
                  .filter(Boolean)
                  .join(' ')
                const key = encodeURIComponent(`${row.guildId}:${row.userId}`)
                return `<tr>
                <td>${name}</td>
                <td style="font-weight:700;font-size:1.1rem;color:${barColor};">${row.strikes}</td>
                <td>
                  <div style="font-size:11px;margin-bottom:3px;color:${barColor};">${level}</div>
                  <div style="background:rgba(255,255,255,0.07);border-radius:4px;height:4px;width:100px;">
                    <div style="background:${barColor};height:4px;border-radius:4px;width:${pct}%;"></div>
                  </div>
                </td>
                <td style="color:#64748b;font-size:12px;">${row.lastStrikeAt ? new Date(row.lastStrikeAt).toLocaleDateString() : '—'}</td>
                <td>${statusBadges || '<span style="color:#475569;font-size:11px;">None</span>'}</td>
                <td><button class="btn btn-sm" onclick="resetStrike('${key}', '${row.userId}')"
                  style="color:#34d399;border-color:rgba(52,211,153,0.3);background:rgba(52,211,153,0.08);">Reset</button></td>
              </tr>`
              })
              .join('')}
          </tbody>
        </table>
      </div>`
  } catch (e) {
    container.innerHTML = `<p style="color:#f87171;padding:1rem;">${e.message}</p>`
  }
}

window.resetStrike = async (key, userId) => {
  if (!confirm(`Reset AI AutoMod strikes for ${userId}?`)) return
  try {
    const r = await window.apiClient.resetAutomodStrikes(decodeURIComponent(key))
    if (!r.ok) throw new Error(r.error)
    showToast('Strike record reset', 'success')
    await loadAiStrikesTab()
  } catch (e) {
    showToast('Error: ' + e.message, 'error')
  }
}

// ── Utilities ──────────────────────────────────────────────────────────────

function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
function escAttr(s) {
  return String(s ?? '')
    .replace(/'/g, '&apos;')
    .replace(/"/g, '&quot;')
}

window.initModeration = initModeration
