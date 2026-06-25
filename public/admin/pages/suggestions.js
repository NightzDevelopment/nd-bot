/**
 * Suggestions Queue Page
 * View + moderate user-submitted suggestions.
 */

async function initSuggestions() {
  await Promise.all([loadSuggestions('open'), loadSuggestionStats()])
}
window.initSuggestions = initSuggestions

window.loadSuggestions = async function loadSuggestions(status = 'open') {
  const root = document.getElementById('suggestions-list')
  if (!root) return
  root.innerHTML = '<div style="text-align:center;color:#64748b;padding:2rem;">Loading…</div>'
  try {
    const res = await window.apiClient.getSuggestions(status)
    if (!res.ok) throw new Error(res.error)
    const list = res.data || []
    if (!list.length) {
      root.innerHTML = `<div style="text-align:center;color:#64748b;padding:2rem;">No ${window.esc(status)} suggestions.</div>`
      return
    }
    // Resolve user names
    const ids = [...new Set(list.map((s) => s.authorId))]
    const usersRes = await window.apiClient.resolveUsers(ids).catch(() => ({ ok: false }))
    const users = usersRes.ok ? usersRes.data || {} : {}

    root.innerHTML = list
      .map((s) => {
        const u = users[s.authorId] || {}
        const name = u.displayName || u.username || s.authorId
        const statusColor =
          s.status === 'approved' ? '#34d399' : s.status === 'denied' ? '#f87171' : '#fbbf24'
        return `<div style="background:rgba(15,18,40,0.6);border:1px solid rgba(148,163,184,0.1);border-left:3px solid ${statusColor};border-radius:8px;padding:1rem;">
        <div style="display:flex;justify-content:space-between;margin-bottom:.5rem;">
          <div style="display:flex;align-items:center;gap:.5rem;">
            ${u.avatarUrl ? `<img src="${window.esc(u.avatarUrl)}" style="width:24px;height:24px;border-radius:50%;">` : ''}
            <strong style="color:#e2e8f0;cursor:pointer;" onclick="openMemberCard('${window.esc(s.authorId)}')">${window.esc(name)}</strong>
          </div>
          <span style="font-size:11px;color:${statusColor};text-transform:uppercase;font-weight:700;letter-spacing:.05em;">${window.esc(s.status)}</span>
        </div>
        <div style="color:#cbd5e1;font-size:13px;line-height:1.5;margin-bottom:.75rem;white-space:pre-wrap;">${window.esc(s.content)}</div>
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <code style="font-size:10px;color:#475569;">${window.esc(s.id)}</code>
          <div style="display:flex;gap:.4rem;">
            ${s.status !== 'approved' ? `<button class="btn btn-sm" onclick="suggestionAction('${window.esc(s.id)}','approve')" style="background:rgba(52,211,153,0.1);border-color:rgba(52,211,153,0.3);color:#34d399;">Approve</button>` : ''}
            ${s.status !== 'denied' ? `<button class="btn btn-sm" onclick="suggestionAction('${window.esc(s.id)}','deny')" style="background:rgba(248,113,113,0.1);border-color:rgba(248,113,113,0.3);color:#f87171;">Deny</button>` : ''}
          </div>
        </div>
      </div>`
      })
      .join('')
  } catch (e) {
    root.innerHTML = `<div style="color:#f87171;padding:1rem;">${window.esc(e.message)}</div>`
  }
}

async function loadSuggestionStats() {
  const root = document.getElementById('suggestions-stats')
  if (!root) return
  try {
    const res = await window.apiClient.getSuggestionStats()
    if (!res.ok) return
    const s = res.data || {}
    root.innerHTML = `
      ${statCard('Total', s.total ?? 0, '#94a3b8')}
      ${statCard('Open', s.open ?? 0, '#fbbf24')}
      ${statCard('Approved', s.approved ?? 0, '#34d399')}
      ${statCard('Denied', s.denied ?? 0, '#f87171')}
    `
  } catch {
    /* ignore */
  }
}

function statCard(label, value, color) {
  return `<div style="background:rgba(15,18,40,0.6);border:1px solid rgba(148,163,184,0.1);border-radius:8px;padding:.75rem 1rem;">
    <div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;">${label}</div>
    <div style="font-size:1.4rem;font-weight:700;color:${color};">${value}</div>
  </div>`
}

window.suggestionAction = async function suggestionAction(id, action) {
  try {
    const r =
      action === 'approve'
        ? await window.apiClient.approveSuggestion(id)
        : action === 'deny'
          ? await window.apiClient.denySuggestion(id)
          : await window.apiClient.implementSuggestion(id)
    if (!r.ok) throw new Error(r.error)
    window.showToast(`Suggestion ${action}d`, 'success')
    const filter = document.getElementById('suggestions-filter')?.value || 'open'
    await Promise.all([loadSuggestions(filter), loadSuggestionStats()])
  } catch (e) {
    window.showToast('Failed: ' + e.message, 'error')
  }
}
