/**
 * Polls History Page
 * Read-only view of past + active polls with vote breakdown.
 */

async function initPolls() {
  await loadPolls('all')
}
window.initPolls = initPolls

window.loadPolls = async function loadPolls(status = 'all') {
  const root = document.getElementById('polls-list')
  if (!root) return
  root.innerHTML = '<div style="text-align:center;color:#64748b;padding:2rem;">Loading…</div>'
  try {
    const res = await window.apiClient.getPolls(status)
    if (!res.ok) throw new Error(res.error)
    const list = res.data || []
    if (!list.length) {
      root.innerHTML =
        '<div style="text-align:center;color:#64748b;padding:2rem;">No polls found.</div>'
      return
    }
    root.innerHTML = list
      .map((p) => {
        const stateColor = p.ended ? '#64748b' : '#34d399'
        const stateLabel = p.ended ? 'ENDED' : 'ACTIVE'
        const answers = (p.answers || []).map((a) => {
          const text = typeof a === 'string' ? a : a.text || a.answer || ''
          const votes = typeof a === 'object' && 'votes' in a ? a.votes : 0
          return { text, votes }
        })
        const totalVotes = answers.reduce((s, a) => s + (a.votes || 0), 0)
        const bars = answers
          .map((a) => {
            const pct = totalVotes > 0 ? Math.round((a.votes / totalVotes) * 100) : 0
            return `<div style="margin-bottom:.3rem;">
          <div style="display:flex;justify-content:space-between;font-size:11px;color:#94a3b8;margin-bottom:2px;">
            <span>${window.esc(a.text || '—')}</span>
            <span><strong style="color:#60a5fa;">${a.votes}</strong> · ${pct}%</span>
          </div>
          <div style="height:5px;background:rgba(148,163,184,0.1);border-radius:3px;overflow:hidden;">
            <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,#60a5fa,#a78bfa);"></div>
          </div>
        </div>`
          })
          .join('')
        return `<div style="background:rgba(15,18,40,0.6);border:1px solid rgba(148,163,184,0.1);border-radius:8px;padding:1rem;">
        <div style="display:flex;justify-content:space-between;margin-bottom:.5rem;">
          <div style="color:#e2e8f0;font-weight:700;flex:1;">${window.esc(p.question || '(no question)')}</div>
          <span style="font-size:10px;color:${stateColor};text-transform:uppercase;font-weight:700;letter-spacing:.05em;">${stateLabel}</span>
        </div>
        <div style="margin:.5rem 0;">${bars || '<span style="color:#475569;">No answers</span>'}</div>
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;color:#475569;">
          <span>${totalVotes} total vote${totalVotes === 1 ? '' : 's'}</span>
          ${p.jumpUrl ? `<a href="${window.esc(p.jumpUrl)}" target="_blank" style="color:#60a5fa;">View in Discord →</a>` : ''}
        </div>
      </div>`
      })
      .join('')
  } catch (e) {
    root.innerHTML = `<div style="color:#f87171;padding:1rem;">${window.esc(e.message)}</div>`
  }
}
