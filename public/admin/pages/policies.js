/**
 * Rules & Policies Page
 * Edit the bot-owned policy sections (Rules, FAQ, Terms, IP, Links) and push
 * updates to the already-published Discord embeds.
 */

async function initPolicies() {
  const root = document.getElementById('policies-editors')
  if (!root) return
  root.innerHTML = '<div style="text-align:center;color:#64748b;padding:2rem;">Loading…</div>'
  try {
    const res = await window.apiClient.getPolicies()
    if (!res.ok) throw new Error(res.error || 'Failed to load')
    const order = res.order || Object.keys(res.sections || {})
    root.innerHTML = ''
    for (const key of order) {
      const sec = res.sections[key]
      if (sec) root.appendChild(renderPolicyEditor(key, sec))
    }
    if (!root.children.length) {
      root.innerHTML = '<div style="color:#64748b;padding:1rem;">No policy sections found.</div>'
    }
  } catch (e) {
    root.innerHTML = `<div style="color:#f87171;padding:1rem;">${window.esc(e.message)}</div>`
  }
}
window.initPolicies = initPolicies

function renderPolicyEditor(key, sec) {
  const card = document.createElement('div')
  card.style.cssText =
    'background:rgba(15,18,40,0.4);border:1px solid rgba(148,163,184,0.1);border-radius:8px;padding:1rem;margin-bottom:1rem;'
  const published = sec.channelId
    ? `Published in <code style="color:#60a5fa;">#${window.esc(sec.channelId)}</code>`
    : '<span style="color:#64748b;">Not published</span>'
  card.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.6rem;gap:1rem;flex-wrap:wrap;">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#a78bfa;font-weight:700;">${window.esc(key)}</div>
      <div style="font-size:11px;color:#64748b;">${published} · Updated ${window.esc(sec.updated || '-')}</div>
    </div>
    <label style="font-size:11px;color:#64748b;text-transform:uppercase;display:block;margin-bottom:.3rem;">Title</label>
    <input class="pol-title" type="text" style="width:100%;padding:.5rem .6rem;border-radius:6px;border:1px solid rgba(148,163,184,0.2);background:#0a0e1f;color:#e2e8f0;margin-bottom:.7rem;">
    <label style="font-size:11px;color:#64748b;text-transform:uppercase;display:block;margin-bottom:.3rem;">Body (Discord markdown)</label>
    <textarea class="pol-body" rows="12" style="width:100%;padding:.6rem;border-radius:6px;border:1px solid rgba(148,163,184,0.2);background:#0a0e1f;color:#e2e8f0;font-family:monospace;font-size:12px;line-height:1.55;resize:vertical;box-sizing:border-box;"></textarea>
    <div style="display:flex;justify-content:flex-end;margin-top:.6rem;">
      <button class="btn btn-primary pol-save">Save</button>
    </div>
  `
  const titleEl = card.querySelector('.pol-title')
  const bodyEl = card.querySelector('.pol-body')
  const metaEl = card.querySelector('div > div:last-child')
  titleEl.value = sec.title || ''
  bodyEl.value = sec.body || ''
  card.querySelector('.pol-save').addEventListener('click', async () => {
    try {
      const r = await window.apiClient.updatePolicy(key, {
        title: titleEl.value,
        body: bodyEl.value,
      })
      if (!r.ok) throw new Error(r.error || 'Save failed')
      window.showToast(`Saved ${key}. Click "Push to Discord" to update the live embed.`, 'success')
      if (r.data?.updated && metaEl) {
        metaEl.innerHTML = `${published} · Updated ${window.esc(r.data.updated)}`
      }
    } catch (e) {
      window.showToast('Save failed: ' + e.message, 'error')
    }
  })
  return card
}

window.publishPoliciesNow = async function publishPoliciesNow() {
  try {
    const r = await window.apiClient.publishPolicies()
    if (!r.ok) throw new Error(r.error || 'Push failed')
    if (r.updated > 0) {
      window.showToast(`Pushed ${r.updated} embed${r.updated === 1 ? '' : 's'} to Discord.`, 'success')
    } else {
      window.showToast('Nothing is published yet. Run nd!rules publish #rules in Discord once.', 'warning')
    }
  } catch (e) {
    window.showToast('Push failed: ' + e.message, 'error')
  }
}
