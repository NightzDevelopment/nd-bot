/**
 * Members Page
 * Live member list with Discord names, avatars, stats, and detail modal
 */

let _membersData = []
let _membersSort = 'lastActivityAt'
let _membersGuildId = ''

async function initMembers() {
  await loadMembers()
  setupMembersSearch()
  setupMembersSort()
}

async function loadMembers() {
  const tbody = document.querySelector('#members-table tbody')
  if (tbody)
    tbody.innerHTML =
      '<tr><td colspan="9" style="text-align:center;color:#64748b;padding:2rem;">Loading…</td></tr>'
  try {
    const result = await window.apiClient.getMembersFull(_membersSort, 200)
    if (!result.ok) throw new Error(result.error)
    _membersData = result.data || []
    _membersGuildId = result.guildId || ''
    renderMembersTable(_membersData)
    const countEl = document.getElementById('members-count')
    if (countEl)
      countEl.textContent = `${_membersData.length} member${_membersData.length === 1 ? '' : 's'}`
  } catch (error) {
    console.error('Members error:', error)
    if (tbody)
      tbody.innerHTML = `<tr><td colspan="9" style="color:#f87171;padding:1.5rem;">${error.message}</td></tr>`
    showToast(`Error loading members: ${error.message}`, 'error')
  }
}
window.loadMembers = loadMembers

function renderMembersTable(data) {
  const tbody = document.querySelector('#members-table tbody')
  if (!tbody) return

  const q = (document.getElementById('members-search')?.value || '').toLowerCase()
  const filtered = q
    ? data.filter(
        (m) =>
          (m.displayName || '').toLowerCase().includes(q) ||
          (m.username || '').toLowerCase().includes(q) ||
          m.userId.includes(q) ||
          (m.bio || '').toLowerCase().includes(q),
      )
    : data

  if (!filtered.length) {
    tbody.innerHTML =
      '<tr><td colspan="9" style="text-align:center;color:#64748b;padding:2rem;">No members found.</td></tr>'
    return
  }

  tbody.innerHTML = filtered
    .map((m) => {
      const avatar = m.avatarUrl
        ? `<img src="${m.avatarUrl}" alt="" style="width:28px;height:28px;border-radius:50%;margin-right:8px;vertical-align:middle;object-fit:cover;" onerror="this.style.display='none'">`
        : `<span style="display:inline-block;width:28px;height:28px;border-radius:50%;background:rgba(96,165,250,0.2);margin-right:8px;vertical-align:middle;text-align:center;line-height:28px;font-size:11px;color:#60a5fa;">${(m.displayName || m.userId).charAt(0).toUpperCase()}</span>`

      const nameHtml = m.displayName
        ? `${avatar}<span style="color:#e2e8f0;font-weight:600;">${esc(m.displayName)}</span>` +
          (m.username && m.username !== m.displayName
            ? `<span style="color:#475569;font-size:11px;margin-left:4px;">@${esc(m.username)}</span>`
            : '') +
          `<br><code style="font-size:10px;color:#475569;margin-left:36px;">${m.userId}</code>`
        : `<code style="color:#94a3b8;">${m.userId}</code>`

      const warnColor =
        m.warnings >= 5
          ? '#f87171'
          : m.warnings >= 3
            ? '#fbbf24'
            : m.warnings >= 1
              ? '#fb923c'
              : '#475569'
      const warnHtml =
        m.warnings > 0
          ? `<span style="color:${warnColor};font-weight:700;">${m.warnings}</span>`
          : `<span style="color:#475569;">0</span>`

      const lastActive = m.lastActivityAt ? fmtRelative(m.lastActivityAt) : '—'

      return `<tr style="cursor:pointer;" onclick="viewMemberDetails('${m.userId}')">
      <td style="padding:.6rem 1rem;">${nameHtml}</td>
      <td style="text-align:right;color:#94a3b8;">${m.messages.toLocaleString()}</td>
      <td style="text-align:center;color:${m.level >= 10 ? '#a78bfa' : m.level >= 5 ? '#60a5fa' : '#94a3b8'};font-weight:${m.level >= 5 ? '700' : '400'};">${m.level}</td>
      <td style="text-align:center;color:#fbbf24;">${m.reputation || 0}</td>
      <td style="text-align:center;">${warnHtml}</td>
      <td style="text-align:center;color:#64748b;">${m.notesCount || 0}</td>
      <td style="text-align:center;">${m.badgeCount > 0 ? `<span style="background:rgba(167,139,250,0.12);color:#a78bfa;border:1px solid rgba(167,139,250,0.3);border-radius:999px;padding:1px 8px;font-size:11px;font-weight:700;">${m.badgeCount}</span>` : '<span style="color:#475569;">0</span>'}</td>
      <td style="color:#64748b;font-size:12px;white-space:nowrap;" title="${m.lastActivityAt ? new Date(m.lastActivityAt).toLocaleString() : ''}">${lastActive}</td>
      <td><button class="btn btn-sm" onclick="event.stopPropagation();viewMemberDetails('${m.userId}')">View</button></td>
    </tr>`
    })
    .join('')
}

function setupMembersSearch() {
  const searchInput = document.getElementById('members-search')
  if (!searchInput || searchInput.dataset.wired) return
  searchInput.addEventListener('input', () => renderMembersTable(_membersData))
  searchInput.dataset.wired = '1'
}

function setupMembersSort() {
  const sortSel = document.getElementById('members-sort')
  if (!sortSel || sortSel.dataset.wired) return
  sortSel.value = _membersSort
  sortSel.addEventListener('change', async (e) => {
    _membersSort = e.target.value
    await loadMembers()
  })
  sortSel.dataset.wired = '1'
}

// ── Member Detail Modal ────────────────────────────────────────────────────

async function viewMemberDetails(userId) {
  return window.openMemberCard(userId)
}
window.viewMemberDetails = viewMemberDetails

function showMemberModal(data, userId) {
  const row = _membersData.find((m) => m.userId === userId) || {}
  _activeModalData = { data, userId, row }
  const profile = data.profile || {}
  const stats = profile.stats || {}
  const badges = data.badges || []
  const warningHistory = data.warningHistory || []
  const notesList = data.notesList || []
  const reputationHistory = data.reputationHistory || []

  const avatar = row.avatarUrl
    ? `<img src="${row.avatarUrl}" style="width:48px;height:48px;border-radius:50%;margin-right:12px;object-fit:cover;" onerror="this.style.display='none'">`
    : `<span style="display:inline-flex;align-items:center;justify-content:center;width:48px;height:48px;border-radius:50%;background:rgba(96,165,250,0.2);margin-right:12px;font-size:18px;color:#60a5fa;flex-shrink:0;">${(row.displayName || userId).charAt(0).toUpperCase()}</span>`

  const nameBlock = `
    <div style="display:flex;align-items:center;margin-bottom:1.25rem;">
      ${avatar}
      <div>
        <div style="font-size:16px;font-weight:700;color:#e2e8f0;">${esc(row.displayName || userId)}</div>
        ${row.username && row.username !== row.displayName ? `<div style="font-size:12px;color:#64748b;">@${esc(row.username)}</div>` : ''}
        <div style="font-size:11px;color:#475569;font-family:monospace;">${esc(userId)}</div>
      </div>
    </div>`

  const warningsHtml =
    warningHistory.length > 0
      ? `<div style="margin-top:1.25rem;">
        <strong style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;">Warning History (${warningHistory.length})</strong>
        <div style="margin-top:.5rem;display:flex;flex-direction:column;gap:.4rem;">
          ${warningHistory
            .map(
              (w) => `
            <div style="background:rgba(251,191,36,0.06);border-left:3px solid rgba(251,191,36,0.5);border-radius:4px;padding:.5rem .75rem;font-size:12px;">
              <div style="display:flex;justify-content:space-between;color:#64748b;margin-bottom:2px;">
                <span>Mod: <code style="font-size:10px;">${esc(w.moderatorId)}</code></span>
                <span>${w.at ? new Date(w.at).toLocaleDateString() : '—'}</span>
              </div>
              <div style="color:#e2e8f0;">${esc(w.reason || 'No reason')}</div>
            </div>`,
            )
            .join('')}
        </div>
      </div>`
      : ''

  const notesHtml =
    notesList.length > 0
      ? `<div style="margin-top:1.25rem;">
        <strong style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;">Staff Notes (${notesList.length})</strong>
        <div style="margin-top:.5rem;display:flex;flex-direction:column;gap:.4rem;">
          ${notesList
            .map((n) => {
              const borderColor =
                n.severity === 'high'
                  ? '#f87171'
                  : n.severity === 'medium'
                    ? '#fbbf24'
                    : 'rgba(148,163,184,0.2)'
              return `<div style="background:rgba(15,18,40,0.6);border-left:3px solid ${borderColor};border-radius:4px;padding:.5rem .75rem;font-size:12px;">
              <div style="display:flex;justify-content:space-between;color:#64748b;margin-bottom:2px;">
                <span>By: <code style="font-size:10px;">${esc(n.by)}</code>${n.severity ? ` · <strong style="color:${borderColor};">${n.severity}</strong>` : ''}</span>
                <span>${n.at ? new Date(n.at).toLocaleDateString() : '—'}</span>
              </div>
              <div style="color:#e2e8f0;">${esc(n.text)}</div>
            </div>`
            })
            .join('')}
        </div>
      </div>`
      : ''

  const repHistoryHtml =
    reputationHistory.length > 0
      ? `<div style="margin-top:1.25rem;">
        <strong style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;">Recent Reputation</strong>
        <div style="margin-top:.5rem;display:flex;flex-direction:column;gap:.25rem;">
          ${reputationHistory
            .map(
              (r) => `
            <div style="display:flex;justify-content:space-between;font-size:12px;padding:.3rem 0;border-bottom:1px solid rgba(148,163,184,0.08);">
              <span style="color:#34d399;font-weight:600;">+${r.points ?? 1}</span>
              <span style="flex:1;padding:0 .5rem;color:#94a3b8;">${esc(r.reason || '')}</span>
              <span style="color:#475569;">${r.at ? new Date(r.at).toLocaleDateString() : ''}</span>
            </div>`,
            )
            .join('')}
        </div>
      </div>`
      : ''

  const warnCount = data.warnings ?? 0
  const warnColor = warnCount >= 5 ? '#f87171' : warnCount >= 3 ? '#fbbf24' : '#34d399'

  // Remove existing modal if open
  document.getElementById('member-detail-modal')?.remove()

  const modal = document.createElement('div')
  modal.id = 'member-detail-modal'
  modal.style.cssText =
    'position:fixed;inset:0;background:rgba(0,0,0,0.65);z-index:9999;display:flex;align-items:center;justify-content:center;'
  modal.innerHTML = `
    <div style="background:#0f1228;border:1px solid rgba(96,165,250,0.2);border-radius:12px;width:600px;max-width:95vw;max-height:88vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.5);">
      <div style="padding:1.5rem 1.5rem 1rem;border-bottom:1px solid rgba(148,163,184,0.1);flex-shrink:0;">
        ${nameBlock}
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:.75rem;">
          ${stat('Messages', (stats.messages ?? row.messages ?? 0).toLocaleString(), '#60a5fa')}
          ${stat('Level', stats.level ?? row.level ?? 0, '#a78bfa')}
          ${stat('Reputation', data.reputation ?? 0, '#fbbf24')}
          ${stat('Warnings', warnCount, warnColor)}
        </div>
      </div>
      <div style="padding:1rem 1.5rem;overflow-y:auto;flex:1;">
        ${profile.bio ? `<div style="background:rgba(96,165,250,0.05);border:1px solid rgba(96,165,250,0.15);border-radius:6px;padding:.75rem;margin-bottom:1rem;font-size:13px;color:#94a3b8;">${esc(profile.bio)}</div>` : ''}
        ${
          badges.length > 0
            ? `
          <div style="margin-bottom:1rem;">
            <strong style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;">Badges (${badges.length})</strong>
            <div style="margin-top:.5rem;display:flex;flex-wrap:wrap;gap:.4rem;">
              ${badges.map((b) => `<span style="background:rgba(167,139,250,0.1);color:#a78bfa;border:1px solid rgba(167,139,250,0.25);border-radius:999px;padding:2px 10px;font-size:11px;">${esc(typeof b === 'string' ? b : b.name || b.id || 'badge')}</span>`).join('')}
            </div>
          </div>`
            : ''
        }
        ${repHistoryHtml}
        ${warningsHtml}
        ${notesHtml}
        
        <!-- Staff Controls Grid -->
        <div style="margin-top:1.5rem;padding-top:1.25rem;border-top:1px solid rgba(148,163,184,0.1);">
          <strong style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:.75rem;">Staff Controls</strong>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:.5rem;margin-bottom:1rem;">
            <button class="btn btn-sm" onclick="showActionForm('add-note')" style="border-color:rgba(96,165,250,0.3);color:#60a5fa;background:rgba(96,165,250,0.05);padding:6px 8px;">Add Note</button>
            <button class="btn btn-sm" onclick="showActionForm('warn')" style="border-color:rgba(251,191,36,0.3);color:#fbbf24;background:rgba(251,191,36,0.05);padding:6px 8px;">Warn User</button>
            <button class="btn btn-sm" onclick="showActionForm('edit-economy')" style="border-color:rgba(167,139,250,0.3);color:#a78bfa;background:rgba(167,139,250,0.05);padding:6px 8px;">Edit Balance</button>
            <button class="btn btn-sm" onclick="showActionForm('edit-level')" style="border-color:rgba(96,165,250,0.3);color:#60a5fa;background:rgba(96,165,250,0.05);padding:6px 8px;">Edit Level/XP</button>
            <button class="btn btn-sm" onclick="showActionForm('kick')" style="border-color:rgba(248,113,113,0.3);color:#f87171;background:rgba(248,113,113,0.05);padding:6px 8px;">Kick Member</button>
            <button class="btn btn-sm" onclick="showActionForm('ban')" style="border-color:rgba(248,113,113,0.4);color:#f87171;background:rgba(248,113,113,0.12);padding:6px 8px;">Ban Member</button>
          </div>
          
          <!-- Inline Action Form Container -->
          <div id="staff-action-form-container" style="display:none;background:rgba(15,18,40,0.7);border:1px solid rgba(148,163,184,0.15);border-radius:8px;padding:1rem;">
          </div>
        </div>
      </div>
      <div style="padding:1rem 1.5rem;border-top:1px solid rgba(148,163,184,0.1);display:flex;gap:.75rem;justify-content:flex-end;flex-shrink:0;">
        <button class="btn" onclick="copyText('${userId}')" style="color:#64748b;border-color:rgba(100,116,139,0.3);">Copy ID</button>
        <button class="btn" onclick="document.getElementById('member-detail-modal').remove()"
          style="background:rgba(96,165,250,0.1);border-color:rgba(96,165,250,0.3);color:#60a5fa;">Close</button>
      </div>
    </div>`
  document.body.appendChild(modal)
  modal.onclick = (e) => {
    if (e.target === modal) modal.remove()
  }
}

function showActionForm(action) {
  const container = document.getElementById('staff-action-form-container')
  if (!container || !_activeModalData) return
  container.style.display = 'block'

  const userId = _activeModalData.userId
  const row = _activeModalData.row
  const data = _activeModalData.data
  const stats = data.profile?.stats || {}

  let html = ''
  if (action === 'add-note') {
    html = `
      <div style="display:flex;flex-direction:column;gap:.75rem;">
        <div style="font-size:12px;font-weight:700;color:#e2e8f0;">Add Staff Note</div>
        <textarea id="action-note-text" placeholder="Enter staff note..." style="background:rgba(2,6,23,0.6);border:1px solid rgba(96,165,250,0.3);border-radius:6px;padding:.5rem;color:#e2e8f0;font:inherit;font-size:13px;min-height:60px;resize:vertical;"></textarea>
        <div style="display:flex;gap:.5rem;align-items:center;">
          <span style="font-size:11px;color:#64748b;">Severity:</span>
          <select id="action-note-severity" style="background:rgba(2,6,23,0.6);border:1px solid rgba(96,165,250,0.3);border-radius:6px;padding:3px 8px;color:#e2e8f0;font:inherit;font-size:12px;">
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </div>
        <div style="display:flex;gap:.5rem;justify-content:flex-end;">
          <button class="btn btn-sm" onclick="cancelActionForm()" style="color:#64748b;border-color:rgba(100,116,139,0.3);">Cancel</button>
          <button id="action-submit-btn" class="btn btn-sm" onclick="submitAddNote()" style="background:rgba(96,165,250,0.15);border-color:rgba(96,165,250,0.4);color:#60a5fa;">Save Note</button>
        </div>
      </div>`
  } else if (action === 'warn') {
    html = `
      <div style="display:flex;flex-direction:column;gap:.75rem;">
        <div style="font-size:12px;font-weight:700;color:#e2e8f0;">Issue Warning</div>
        <input id="action-warn-reason" type="text" placeholder="Enter warning reason..." style="background:rgba(2,6,23,0.6);border:1px solid rgba(96,165,250,0.3);border-radius:6px;padding:.5rem;color:#e2e8f0;font:inherit;font-size:13px;" />
        <div style="display:flex;gap:.5rem;justify-content:flex-end;">
          <button class="btn btn-sm" onclick="cancelActionForm()" style="color:#64748b;border-color:rgba(100,116,139,0.3);">Cancel</button>
          <button id="action-submit-btn" class="btn btn-sm" onclick="submitWarning()" style="background:rgba(251,191,36,0.15);border-color:rgba(251,191,36,0.4);color:#fbbf24;">Issue Warning</button>
        </div>
      </div>`
  } else if (action === 'edit-economy') {
    const bal = row.reputation || data.reputation || 0
    html = `
      <div style="display:flex;flex-direction:column;gap:.75rem;">
        <div style="font-size:12px;font-weight:700;color:#e2e8f0;">Edit Economy Balance</div>
        <label style="display:flex;flex-direction:column;gap:4px;">
          <span style="font-size:11px;color:#64748b;">Balance (Wallet)</span>
          <input id="action-eco-balance" type="number" value="${bal}" style="background:rgba(2,6,23,0.6);border:1px solid rgba(96,165,250,0.3);border-radius:6px;padding:.5rem;color:#e2e8f0;font:inherit;font-size:13px;" />
        </label>
        <div style="display:flex;gap:.5rem;justify-content:flex-end;">
          <button class="btn btn-sm" onclick="cancelActionForm()" style="color:#64748b;border-color:rgba(100,116,139,0.3);">Cancel</button>
          <button id="action-submit-btn" class="btn btn-sm" onclick="submitEconomy()" style="background:rgba(167,139,250,0.15);border-color:rgba(167,139,250,0.4);color:#a78bfa;">Update Balance</button>
        </div>
      </div>`
  } else if (action === 'edit-level') {
    const lvl = stats.level ?? row.level ?? 0
    const xp = stats.xp ?? 100 * lvl * lvl
    const msgs = stats.messages ?? row.messages ?? 0
    html = `
      <div style="display:flex;flex-direction:column;gap:.75rem;">
        <div style="font-size:12px;font-weight:700;color:#e2e8f0;">Edit Levels and XP</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:.5rem;">
          <label style="display:flex;flex-direction:column;gap:4px;">
            <span style="font-size:11px;color:#64748b;">Level</span>
            <input id="action-lvl-level" type="number" value="${lvl}" style="background:rgba(2,6,23,0.6);border:1px solid rgba(96,165,250,0.3);border-radius:6px;padding:.5rem;color:#e2e8f0;font:inherit;font-size:13px;" />
          </label>
          <label style="display:flex;flex-direction:column;gap:4px;">
            <span style="font-size:11px;color:#64748b;">Total XP</span>
            <input id="action-lvl-xp" type="number" value="${xp}" style="background:rgba(2,6,23,0.6);border:1px solid rgba(96,165,250,0.3);border-radius:6px;padding:.5rem;color:#e2e8f0;font:inherit;font-size:13px;" />
          </label>
        </div>
        <label style="display:flex;flex-direction:column;gap:4px;">
          <span style="font-size:11px;color:#64748b;">Message Count</span>
          <input id="action-lvl-messages" type="number" value="${msgs}" style="background:rgba(2,6,23,0.6);border:1px solid rgba(96,165,250,0.3);border-radius:6px;padding:.5rem;color:#e2e8f0;font:inherit;font-size:13px;" />
        </label>
        <div style="display:flex;gap:.5rem;justify-content:flex-end;">
          <button class="btn btn-sm" onclick="cancelActionForm()" style="color:#64748b;border-color:rgba(100,116,139,0.3);">Cancel</button>
          <button id="action-submit-btn" class="btn btn-sm" onclick="submitLevel()" style="background:rgba(96,165,250,0.15);border-color:rgba(96,165,250,0.4);color:#60a5fa;">Save Level</button>
        </div>
      </div>`
  } else if (action === 'kick') {
    html = `
      <div style="display:flex;flex-direction:column;gap:.75rem;">
        <div style="font-size:12px;font-weight:700;color:#f87171;">Kick Member</div>
        <input id="action-kick-reason" type="text" placeholder="Enter kick reason..." style="background:rgba(2,6,23,0.6);border:1px solid rgba(248,113,113,0.3);border-radius:6px;padding:.5rem;color:#e2e8f0;font:inherit;font-size:13px;" />
        <div style="display:flex;gap:.5rem;justify-content:flex-end;">
          <button class="btn btn-sm" onclick="cancelActionForm()" style="color:#64748b;border-color:rgba(100,116,139,0.3);">Cancel</button>
          <button id="action-submit-btn" class="btn btn-sm" onclick="submitKick()" style="background:rgba(248,113,113,0.15);border-color:rgba(248,113,113,0.4);color:#f87171;">Confirm Kick</button>
        </div>
      </div>`
  } else if (action === 'ban') {
    html = `
      <div style="display:flex;flex-direction:column;gap:.75rem;">
        <div style="font-size:12px;font-weight:700;color:#f87171;">Ban Member</div>
        <input id="action-ban-reason" type="text" placeholder="Enter ban reason..." style="background:rgba(2,6,23,0.6);border:1px solid rgba(248,113,113,0.3);border-radius:6px;padding:.5rem;color:#e2e8f0;font:inherit;font-size:13px;" />
        <div style="display:flex;gap:.5rem;justify-content:flex-end;">
          <button class="btn btn-sm" onclick="cancelActionForm()" style="color:#64748b;border-color:rgba(100,116,139,0.3);">Cancel</button>
          <button id="action-submit-btn" class="btn btn-sm" onclick="submitBan()" style="background:rgba(248,113,113,0.25);border-color:rgba(248,113,113,0.5);color:#f87171;">Confirm Ban</button>
        </div>
      </div>`
  }

  container.innerHTML = html
}

function cancelActionForm() {
  const container = document.getElementById('staff-action-form-container')
  if (container) {
    container.style.display = 'none'
    container.innerHTML = ''
  }
}

async function submitAddNote() {
  if (!_activeModalData) return
  const text = document.getElementById('action-note-text')?.value.trim()
  const severity = document.getElementById('action-note-severity')?.value
  if (!text) {
    showToast('Please enter a note', 'error')
    return
  }
  const btn = document.getElementById('action-submit-btn')
  if (btn) {
    btn.textContent = 'Saving…'
    btn.disabled = true
  }
  try {
    const res = await window.apiClient.addModNote(_activeModalData.userId, text, severity)
    if (!res.ok) throw new Error(res.error)
    showToast('Note added successfully', 'success')
    cancelActionForm()
    const fresh = await window.apiClient.getMember(_activeModalData.userId)
    if (fresh.ok) showMemberModal(fresh.data, _activeModalData.userId)
    await loadMembers()
  } catch (err) {
    showToast('Error: ' + err.message, 'error')
  } finally {
    if (btn) {
      btn.textContent = 'Save Note'
      btn.disabled = false
    }
  }
}

async function submitWarning() {
  if (!_activeModalData) return
  const reason = document.getElementById('action-warn-reason')?.value.trim()
  if (!reason) {
    showToast('Please enter warning reason', 'error')
    return
  }
  const btn = document.getElementById('action-submit-btn')
  if (btn) {
    btn.textContent = 'Issuing…'
    btn.disabled = true
  }
  try {
    const res = await window.apiClient.addWarning(_activeModalData.userId, reason)
    if (!res.ok) throw new Error(res.error)
    showToast('Warning issued successfully', 'success')
    cancelActionForm()
    const fresh = await window.apiClient.getMember(_activeModalData.userId)
    if (fresh.ok) showMemberModal(fresh.data, _activeModalData.userId)
    await loadMembers()
  } catch (err) {
    showToast('Error: ' + err.message, 'error')
  } finally {
    if (btn) {
      btn.textContent = 'Issue Warning'
      btn.disabled = false
    }
  }
}

async function submitEconomy() {
  if (!_activeModalData) return
  const balRaw = document.getElementById('action-eco-balance')?.value
  const balance = parseInt(balRaw, 10)
  if (isNaN(balance)) {
    showToast('Please enter a valid balance', 'error')
    return
  }
  const btn = document.getElementById('action-submit-btn')
  if (btn) {
    btn.textContent = 'Updating…'
    btn.disabled = true
  }
  try {
    const res = await window.apiClient.setEconomyBalance(_activeModalData.userId, balance)
    if (!res.ok) throw new Error(res.error)
    showToast('Balance updated successfully', 'success')
    cancelActionForm()
    const fresh = await window.apiClient.getMember(_activeModalData.userId)
    if (fresh.ok) showMemberModal(fresh.data, _activeModalData.userId)
    await loadMembers()
  } catch (err) {
    showToast('Error: ' + err.message, 'error')
  } finally {
    if (btn) {
      btn.textContent = 'Update Balance'
      btn.disabled = false
    }
  }
}

async function submitLevel() {
  if (!_activeModalData) return
  const level = parseInt(document.getElementById('action-lvl-level')?.value, 10)
  const xp = parseInt(document.getElementById('action-lvl-xp')?.value, 10)
  const messages = parseInt(document.getElementById('action-lvl-messages')?.value, 10)
  if (isNaN(level) || isNaN(xp) || isNaN(messages)) {
    showToast('Please fill all level fields', 'error')
    return
  }
  if (!_membersGuildId) {
    showToast('Active Guild ID not found', 'error')
    return
  }
  const btn = document.getElementById('action-submit-btn')
  if (btn) {
    btn.textContent = 'Saving…'
    btn.disabled = true
  }
  try {
    const res = await window.apiClient.setLevelRecord(_activeModalData.userId, _membersGuildId, {
      level,
      xp,
      messageCount: messages,
    })
    if (!res.ok) throw new Error(res.error)
    showToast('Level updated successfully', 'success')
    cancelActionForm()
    const fresh = await window.apiClient.getMember(_activeModalData.userId)
    if (fresh.ok) showMemberModal(fresh.data, _activeModalData.userId)
    await loadMembers()
  } catch (err) {
    showToast('Error: ' + err.message, 'error')
  } finally {
    if (btn) {
      btn.textContent = 'Save Level'
      btn.disabled = false
    }
  }
}

async function submitKick() {
  if (!_activeModalData) return
  const reason = document.getElementById('action-kick-reason')?.value.trim()
  const btn = document.getElementById('action-submit-btn')
  if (btn) {
    btn.textContent = 'Kicking…'
    btn.disabled = true
  }
  try {
    const res = await window.apiClient.kickUser(_activeModalData.userId, reason || undefined)
    if (!res.ok) throw new Error(res.error)
    showToast('User kicked successfully', 'success')
    document.getElementById('member-detail-modal')?.remove()
    await loadMembers()
  } catch (err) {
    showToast('Error: ' + err.message, 'error')
  } finally {
    if (btn) {
      btn.textContent = 'Confirm Kick'
      btn.disabled = false
    }
  }
}

async function submitBan() {
  if (!_activeModalData) return
  const reason = document.getElementById('action-ban-reason')?.value.trim()
  const btn = document.getElementById('action-submit-btn')
  if (btn) {
    btn.textContent = 'Banning…'
    btn.disabled = true
  }
  try {
    const res = await window.apiClient.banUser(_activeModalData.userId, reason || undefined)
    if (!res.ok) throw new Error(res.error)
    showToast('User banned successfully', 'success')
    document.getElementById('member-detail-modal')?.remove()
    await loadMembers()
  } catch (err) {
    showToast('Error: ' + err.message, 'error')
  } finally {
    if (btn) {
      btn.textContent = 'Confirm Ban'
      btn.disabled = false
    }
  }
}

function stat(label, value, color = '#e2e8f0') {
  return `<div style="background:rgba(15,18,40,0.6);border:1px solid rgba(148,163,184,0.1);border-radius:8px;padding:.6rem .75rem;">
    <div style="font-size:10px;color:#475569;text-transform:uppercase;letter-spacing:.05em;margin-bottom:2px;">${label}</div>
    <div style="font-size:1.15rem;font-weight:700;color:${color};">${value}</div>
  </div>`
}

function copyText(text) {
  navigator.clipboard.writeText(text).then(() => showToast('Copied', 'success'))
}

function fmtRelative(ts) {
  const d = Date.now() - ts
  if (d < 60_000) return 'just now'
  if (d < 3_600_000) return Math.floor(d / 60_000) + 'm ago'
  if (d < 86_400_000) return Math.floor(d / 3_600_000) + 'h ago'
  if (d < 604_800_000) return Math.floor(d / 86_400_000) + 'd ago'
  return new Date(ts).toLocaleDateString()
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

window.initMembers = initMembers
window.viewMemberDetails = viewMemberDetails
window.copyText = copyText
window.showActionForm = showActionForm
window.cancelActionForm = cancelActionForm
window.submitAddNote = submitAddNote
window.submitWarning = submitWarning
window.submitEconomy = submitEconomy
window.submitLevel = submitLevel
window.submitKick = submitKick
window.submitBan = submitBan
