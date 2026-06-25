/**
 * Giveaways Page
 * Create, end early, reroll giveaways from the dashboard.
 */

async function initGiveaways() {
  await loadGiveaways()
}
window.initGiveaways = initGiveaways

async function loadGiveaways() {
  const activeEl = document.getElementById('giveaways-active')
  const endedEl = document.getElementById('giveaways-ended')
  if (!activeEl || !endedEl) return
  activeEl.innerHTML = '<div style="color:#64748b;padding:1rem;">Loading…</div>'
  endedEl.innerHTML = ''
  try {
    const res = await window.apiClient.getGiveaways()
    if (!res.ok) throw new Error(res.error)
    const all = res.data || []
    const active = all.filter((g) => !g.ended)
    const ended = all.filter((g) => g.ended).slice(0, 20)
    activeEl.innerHTML = active.length
      ? active.map(renderRow).join('')
      : '<div style="color:#64748b;padding:1rem;text-align:center;">No active giveaways.</div>'
    endedEl.innerHTML = ended.length
      ? ended.map(renderRow).join('')
      : '<div style="color:#64748b;padding:1rem;text-align:center;">No ended giveaways yet.</div>'
  } catch (e) {
    activeEl.innerHTML = `<div style="color:#f87171;padding:1rem;">${window.esc(e.message)}</div>`
  }
}

function renderRow(g) {
  const ending = g.ended ? null : g.endsAt
  const timeText = g.ended
    ? `Ended ${window.fmtRelative(g.endsAt)}`
    : `Ends ${window.fmtRelative(ending)}`
  return `<div style="background:rgba(15,18,40,0.6);border:1px solid rgba(148,163,184,0.1);border-left:3px solid ${g.ended ? '#64748b' : '#f472b6'};border-radius:8px;padding:.75rem 1rem;display:flex;justify-content:space-between;align-items:center;gap:1rem;">
    <div style="flex:1;min-width:0;">
      <div style="color:#e2e8f0;font-weight:700;">${window.esc(g.prize)}</div>
      <div style="color:#94a3b8;font-size:11px;margin-top:2px;">
        <span style="color:#fbbf24;">${g.winnerCount}</span> winner${g.winnerCount === 1 ? '' : 's'} ·
        ${timeText} ·
        <code style="color:#475569;">${window.esc(g.id)}</code>
      </div>
    </div>
    <div style="display:flex;gap:.4rem;flex-shrink:0;">
      ${!g.ended ? `<button class="btn btn-sm" onclick="endGiveawayNow('${window.esc(g.id)}')" style="background:rgba(96,165,250,0.1);border-color:rgba(96,165,250,0.3);color:#60a5fa;">End Now</button>` : ''}
      ${g.ended ? `<button class="btn btn-sm" onclick="rerollGiveaway('${window.esc(g.id)}')" style="background:rgba(167,139,250,0.1);border-color:rgba(167,139,250,0.3);color:#a78bfa;">Reroll</button>` : ''}
    </div>
  </div>`
}

window.openGiveawayCreate = async function openGiveawayCreate() {
  const body = document.createElement('div')
  body.style.cssText = 'display:flex;flex-direction:column;gap:1rem;'
  body.innerHTML = `
    <div><label style="font-size:11px;color:#64748b;text-transform:uppercase;display:block;margin-bottom:.4rem;">Channel</label><div id="gw-channel-mount"></div></div>
    <div><label style="font-size:11px;color:#64748b;text-transform:uppercase;display:block;margin-bottom:.4rem;">Prize</label>
      <input id="gw-prize" type="text" placeholder="Nitro Classic, $50 Steam card, etc." style="width:100%;padding:.5rem .6rem;border-radius:6px;border:1px solid rgba(148,163,184,0.2);background:#0a0e1f;color:#e2e8f0;"></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem;">
      <div><label style="font-size:11px;color:#64748b;text-transform:uppercase;display:block;margin-bottom:.4rem;">Duration</label>
        <select id="gw-duration" style="width:100%;padding:.5rem .6rem;border-radius:6px;border:1px solid rgba(148,163,184,0.2);background:#0a0e1f;color:#e2e8f0;">
          <option value="${15 * 60_000}">15 minutes</option>
          <option value="${60 * 60_000}">1 hour</option>
          <option value="${6 * 60 * 60_000}">6 hours</option>
          <option value="${24 * 60 * 60_000}" selected>1 day</option>
          <option value="${3 * 24 * 60 * 60_000}">3 days</option>
          <option value="${7 * 24 * 60 * 60_000}">7 days</option>
        </select></div>
      <div><label style="font-size:11px;color:#64748b;text-transform:uppercase;display:block;margin-bottom:.4rem;">Winners</label>
        <input id="gw-winners" type="number" min="1" value="1" style="width:100%;padding:.5rem .6rem;border-radius:6px;border:1px solid rgba(148,163,184,0.2);background:#0a0e1f;color:#e2e8f0;"></div>
    </div>
  `
  const footer = document.createElement('div')
  footer.style.cssText = 'display:flex;gap:.5rem;justify-content:flex-end;width:100%;'
  footer.innerHTML = `
    <button onclick="uiCloseModal('gw-modal')" style="background:transparent;border:1px solid rgba(148,163,184,0.3);color:#94a3b8;padding:.4rem 1rem;border-radius:6px;cursor:pointer;">Cancel</button>
    <button onclick="saveGiveawayNew()" style="background:rgba(244,114,182,0.15);border:1px solid rgba(244,114,182,0.4);color:#f472b6;padding:.4rem 1rem;border-radius:6px;cursor:pointer;font-weight:700;">Start Giveaway</button>
  `

  window.uiOpenModal({ id: 'gw-modal', title: 'New Giveaway', body, footer, width: '500px' })
  const mount = document.getElementById('gw-channel-mount')
  if (mount) {
    const picker = await window.uiChannelPicker({ id: 'gw-channel-picker' })
    mount.appendChild(picker)
  }
}

window.saveGiveawayNew = async function saveGiveawayNew() {
  const channelId = document.getElementById('gw-channel-picker')?.value
  const prize = document.getElementById('gw-prize')?.value?.trim()
  const durationMs = parseInt(document.getElementById('gw-duration')?.value, 10)
  const winnerCount = parseInt(document.getElementById('gw-winners')?.value, 10) || 1
  if (!channelId) {
    window.showToast('Pick a channel', 'warning')
    return
  }
  if (!prize) {
    window.showToast('Prize required', 'warning')
    return
  }
  try {
    const r = await window.apiClient.createGiveaway({ channelId, prize, durationMs, winnerCount })
    if (!r.ok) throw new Error(r.error)
    window.showToast('Giveaway started', 'success')
    window.uiCloseModal('gw-modal')
    loadGiveaways()
  } catch (e) {
    window.showToast('Failed: ' + e.message, 'error')
  }
}

window.endGiveawayNow = async function endGiveawayNow(id) {
  if (!confirm('End this giveaway now and draw winners?')) return
  try {
    const r = await window.apiClient.endGiveaway(id)
    if (!r.ok) throw new Error(r.error)
    const winners = (r.data?.winners || []).join(', ') || 'none'
    window.showToast('Ended. Winners: ' + winners, 'success')
    loadGiveaways()
  } catch (e) {
    window.showToast('Failed: ' + e.message, 'error')
  }
}

window.rerollGiveaway = async function rerollGiveaway(id) {
  if (!confirm('Pick new winners for this giveaway?')) return
  try {
    const r = await window.apiClient.rerollGiveaway(id)
    if (!r.ok) throw new Error(r.error)
    const winners = (r.data?.winners || []).join(', ') || 'none'
    window.showToast('Rerolled. New winners: ' + winners, 'success')
  } catch (e) {
    window.showToast('Failed: ' + e.message, 'error')
  }
}
