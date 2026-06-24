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

      const lastActive = m.lastActivityAt ? fmtRelative(m.lastActivityAt) : '-'

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
