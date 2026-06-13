/**
 * Counter Channels Page
 * Live stat-channel renaming editor.
 */

let _availableStats = []

async function initCounters() {
  await loadCounters()
}
window.initCounters = initCounters

async function loadCounters() {
  const root = document.getElementById('counters-table-body')
  if (!root) return
  root.innerHTML =
    '<tr><td colspan="5" style="text-align:center;color:#64748b;padding:1.5rem;">Loading…</td></tr>'

  try {
    const res = await window.apiClient.getCounters()
    if (!res.ok) throw new Error(res.error)
    _availableStats = res.stats || []
    const rows = res.data || []

    if (!rows.length) {
      root.innerHTML =
        '<tr><td colspan="5" style="text-align:center;color:#64748b;padding:2rem;">No counter channels configured. Click "Add Counter" to create one.</td></tr>'
      return
    }

    root.innerHTML = rows
      .map(
        (r) => `
      <tr>
        <td style="padding:.6rem 1rem;">
          ${r.channelName ? `<strong style="color:#e2e8f0;">#${window.esc(r.channelName)}</strong><br>` : ''}
          <code style="font-size:10px;color:#475569;">${window.esc(r.channelId)}</code>
        </td>
        <td style="color:#a78bfa;font-weight:600;">${window.esc(r.stat)}</td>
        <td style="color:#94a3b8;font-size:12px;font-family:monospace;">${window.esc(r.template)}</td>
        <td style="color:#60a5fa;font-size:13px;">${r.preview ? window.esc(r.preview) : '<span style="color:#475569;">-</span>'}</td>
        <td style="white-space:nowrap;">
          <button class="btn btn-sm" onclick="editCounter('${window.esc(r.channelId)}','${window.esc(r.stat)}','${window.esc(r.template).replace(/'/g, '&#39;')}')" style="margin-right:4px;">Edit</button>
          <button class="btn btn-sm" onclick="deleteCounter('${window.esc(r.channelId)}')" style="color:#f87171;border-color:rgba(248,113,113,0.3);background:rgba(248,113,113,0.08);">Delete</button>
        </td>
      </tr>
    `,
      )
      .join('')
  } catch (e) {
    root.innerHTML = `<tr><td colspan="5" style="color:#f87171;padding:1rem;">${window.esc(e.message)}</td></tr>`
  }
}

window.openCounterAdd = function openCounterAdd() {
  showCounterModal()
}

window.editCounter = function editCounter(channelId, stat, template) {
  showCounterModal({ channelId, stat, template, isEdit: true })
}

async function showCounterModal({ channelId, stat, template, isEdit } = {}) {
  const statOpts = _availableStats
    .map(
      (s) =>
        `<option value="${window.esc(s.key)}" ${stat === s.key ? 'selected' : ''}>${window.esc(s.key)}</option>`,
    )
    .join('')

  const body = document.createElement('div')
  body.style.cssText = 'display:flex;flex-direction:column;gap:1rem;'
  body.innerHTML = `
    <div>
      <label style="font-size:11px;color:#64748b;text-transform:uppercase;display:block;margin-bottom:.4rem;">Channel</label>
      <div id="counter-channel-mount"></div>
      ${isEdit ? `<div style="font-size:11px;color:#64748b;margin-top:.25rem;">Channel: <code>${window.esc(channelId)}</code> (cannot be changed)</div>` : ''}
    </div>
    <div>
      <label style="font-size:11px;color:#64748b;text-transform:uppercase;display:block;margin-bottom:.4rem;">Stat</label>
      <select id="counter-stat" style="width:100%;padding:.5rem .6rem;border-radius:6px;border:1px solid rgba(148,163,184,0.2);background:#0a0e1f;color:#e2e8f0;">
        ${statOpts}
      </select>
    </div>
    <div>
      <label style="font-size:11px;color:#64748b;text-transform:uppercase;display:block;margin-bottom:.4rem;">Template (use <code>{count}</code>)</label>
      <input id="counter-template" type="text" value="${window.esc(template || 'Members: {count}')}" placeholder="Members: {count}"
        style="width:100%;padding:.5rem .6rem;border-radius:6px;border:1px solid rgba(148,163,184,0.2);background:#0a0e1f;color:#e2e8f0;font-family:monospace;font-size:13px;">
    </div>
  `

  const footer = document.createElement('div')
  footer.style.cssText = 'display:flex;gap:.5rem;justify-content:flex-end;width:100%;'
  footer.innerHTML = `
    <button onclick="uiCloseModal('counter-modal')" style="background:transparent;border:1px solid rgba(148,163,184,0.3);color:#94a3b8;padding:.4rem 1rem;border-radius:6px;cursor:pointer;">Cancel</button>
    <button onclick="${isEdit ? `saveCounterEdit('${window.esc(channelId)}')` : 'saveCounterNew()'}" style="background:rgba(96,165,250,0.15);border:1px solid rgba(96,165,250,0.4);color:#60a5fa;padding:.4rem 1rem;border-radius:6px;cursor:pointer;font-weight:700;">${isEdit ? 'Save' : 'Create'}</button>
  `

  window.uiOpenModal({
    id: 'counter-modal',
    title: isEdit ? 'Edit Counter' : 'Add Counter Channel',
    body,
    footer,
    width: '520px',
  })

  // Inject channel picker async (only for new)
  const mount = document.getElementById('counter-channel-mount')
  if (mount && !isEdit) {
    const picker = await window.uiChannelPicker({ id: 'counter-channel-picker' })
    mount.appendChild(picker)
  } else if (mount && isEdit) {
    mount.style.display = 'none'
  }
}

window.saveCounterNew = async function saveCounterNew() {
  const channelId = document.getElementById('counter-channel-picker')?.value
  const stat = document.getElementById('counter-stat')?.value
  const template = document.getElementById('counter-template')?.value
  if (!channelId) {
    window.showToast('Pick a channel', 'warning')
    return
  }
  if (!stat) {
    window.showToast('Pick a stat', 'warning')
    return
  }
  try {
    const r = await window.apiClient.addCounter({ channelId, stat, template })
    if (!r.ok) throw new Error(r.error)
    window.showToast('Counter added', 'success')
    window.uiCloseModal('counter-modal')
    loadCounters()
  } catch (e) {
    window.showToast('Failed: ' + e.message, 'error')
  }
}

window.saveCounterEdit = async function saveCounterEdit(channelId) {
  const stat = document.getElementById('counter-stat')?.value
  const template = document.getElementById('counter-template')?.value
  try {
    const r = await window.apiClient.updateCounter(channelId, { stat, template })
    if (!r.ok) throw new Error(r.error)
    window.showToast('Counter updated', 'success')
    window.uiCloseModal('counter-modal')
    loadCounters()
  } catch (e) {
    window.showToast('Failed: ' + e.message, 'error')
  }
}

window.deleteCounter = async function deleteCounter(channelId) {
  if (!confirm('Delete this counter channel? The Discord channel itself will not be deleted.'))
    return
  try {
    const r = await window.apiClient.deleteCounter(channelId)
    if (!r.ok) throw new Error(r.error)
    window.showToast('Counter deleted', 'success')
    loadCounters()
  } catch (e) {
    window.showToast('Failed: ' + e.message, 'error')
  }
}

window.refreshCountersNow = async function refreshCountersNow() {
  try {
    const r = await window.apiClient.refreshCounters()
    if (!r.ok) throw new Error(r.error)
    window.showToast('Refresh triggered, channel names update shortly', 'success')
  } catch (e) {
    window.showToast('Failed: ' + e.message, 'error')
  }
}
