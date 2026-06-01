/**
 * Scheduler / Reminders Page
 * Create and manage scheduled messages.
 */

async function initScheduler() {
  await loadSchedules()
}
window.initScheduler = initScheduler

async function loadSchedules() {
  const root = document.getElementById('scheduler-list')
  if (!root) return
  root.innerHTML = '<div style="text-align:center;color:#64748b;padding:2rem;">Loading…</div>'
  try {
    const res = await window.apiClient.getSchedules()
    if (!res.ok) throw new Error(res.error)
    const list = res.data || []
    if (!list.length) {
      root.innerHTML =
        '<div style="text-align:center;color:#64748b;padding:2rem;">No scheduled messages. Click "Schedule Message" to create one.</div>'
      return
    }
    // Fetch channel names
    const chRes = await window.apiClient.getGuildChannels().catch(() => ({ ok: false }))
    const channelsById = {}
    if (chRes.ok) for (const c of chRes.data || []) channelsById[c.id] = c.name
    root.innerHTML = list
      .map((s) => {
        const channelName = channelsById[s.channelId] || s.channelId
        const isPast = s.runAt < Date.now()
        const stateColor = isPast ? '#fb923c' : '#34d399'
        return `<div style="background:rgba(15,18,40,0.6);border:1px solid rgba(148,163,184,0.1);border-left:3px solid ${stateColor};border-radius:8px;padding:.75rem 1rem;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;">
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.25rem;">
              <span style="color:#60a5fa;font-weight:600;">#${window.esc(channelName)}</span>
              <span style="color:${stateColor};font-size:11px;">${isPast ? 'Due now' : window.fmtRelative(s.runAt)}</span>
              ${s.repeatMs ? `<span style="font-size:10px;background:rgba(167,139,250,0.1);color:#a78bfa;padding:1px 6px;border-radius:3px;border:1px solid rgba(167,139,250,0.2);">Repeats every ${window.fmtDuration(s.repeatMs)}</span>` : ''}
            </div>
            <div style="color:#cbd5e1;font-size:12px;white-space:pre-wrap;max-height:60px;overflow:hidden;text-overflow:ellipsis;">${window.esc(s.content)}</div>
            <div style="color:#475569;font-size:10px;margin-top:.25rem;font-family:monospace;">${window.esc(s.id)} · ${window.fmtAbsolute(s.runAt)}</div>
          </div>
          <button class="btn btn-sm" onclick="deleteSchedule('${window.esc(s.id)}')" style="color:#f87171;border-color:rgba(248,113,113,0.3);background:rgba(248,113,113,0.08);">Delete</button>
        </div>
      </div>`
      })
      .join('')
  } catch (e) {
    root.innerHTML = `<div style="color:#f87171;padding:1rem;">${window.esc(e.message)}</div>`
  }
}

window.openSchedulerCreate = async function openSchedulerCreate() {
  const body = document.createElement('div')
  body.style.cssText = 'display:flex;flex-direction:column;gap:1rem;'
  body.innerHTML = `
    <div><label style="font-size:11px;color:#64748b;text-transform:uppercase;display:block;margin-bottom:.4rem;">Channel</label><div id="sch-channel-mount"></div></div>
    <div><label style="font-size:11px;color:#64748b;text-transform:uppercase;display:block;margin-bottom:.4rem;">When (your local time)</label><div id="sch-datetime-mount"></div></div>
    <div>
      <label style="font-size:11px;color:#64748b;text-transform:uppercase;display:block;margin-bottom:.4rem;">Message content (markdown)</label>
      <textarea id="sch-content" rows="5" placeholder="Hello @everyone! Reminder that..." style="width:100%;padding:.5rem .6rem;border-radius:6px;border:1px solid rgba(148,163,184,0.2);background:#0a0e1f;color:#e2e8f0;font-family:inherit;font-size:13px;resize:vertical;"></textarea>
    </div>
    <div>
      <label style="font-size:11px;color:#64748b;text-transform:uppercase;display:block;margin-bottom:.4rem;">Preview</label>
      <div id="sch-preview" style="padding:.6rem;background:rgba(15,18,40,0.8);border:1px solid rgba(148,163,184,0.1);border-radius:6px;color:#e2e8f0;font-size:13px;min-height:40px;"></div>
    </div>
    <div>
      <label style="font-size:11px;color:#64748b;text-transform:uppercase;display:block;margin-bottom:.4rem;">Repeat (optional)</label>
      <select id="sch-repeat" style="width:100%;padding:.5rem .6rem;border-radius:6px;border:1px solid rgba(148,163,184,0.2);background:#0a0e1f;color:#e2e8f0;">
        <option value="">No repeat</option>
        <option value="${60 * 60_000}">Every hour</option>
        <option value="${24 * 60 * 60_000}">Daily</option>
        <option value="${7 * 24 * 60 * 60_000}">Weekly</option>
      </select>
    </div>
  `

  const footer = document.createElement('div')
  footer.style.cssText = 'display:flex;gap:.5rem;justify-content:flex-end;width:100%;'
  footer.innerHTML = `
    <button onclick="uiCloseModal('sch-modal')" style="background:transparent;border:1px solid rgba(148,163,184,0.3);color:#94a3b8;padding:.4rem 1rem;border-radius:6px;cursor:pointer;">Cancel</button>
    <button onclick="saveSchedule()" style="background:rgba(96,165,250,0.15);border:1px solid rgba(96,165,250,0.4);color:#60a5fa;padding:.4rem 1rem;border-radius:6px;cursor:pointer;font-weight:700;">Schedule</button>
  `
  window.uiOpenModal({ id: 'sch-modal', title: 'Schedule a Message', body, footer, width: '560px' })

  // Wire dynamic mounts
  const chMount = document.getElementById('sch-channel-mount')
  if (chMount) chMount.appendChild(await window.uiChannelPicker({ id: 'sch-channel-picker' }))
  const dtMount = document.getElementById('sch-datetime-mount')
  if (dtMount) dtMount.appendChild(window.uiDatetimePicker({ id: 'sch-datetime' }))
  const textarea = document.getElementById('sch-content')
  const preview = document.getElementById('sch-preview')
  if (textarea && preview) window.uiMarkdownPreview(textarea, preview)
}

window.saveSchedule = async function saveSchedule() {
  const channelId = document.getElementById('sch-channel-picker')?.value
  const dtEl = document.getElementById('sch-datetime-mount')?.firstElementChild
  const runAt = dtEl?.asTimestamp
  const content = document.getElementById('sch-content')?.value?.trim()
  const repeatRaw = document.getElementById('sch-repeat')?.value
  const repeatMs = repeatRaw ? parseInt(repeatRaw, 10) : null
  if (!channelId) {
    window.showToast('Pick a channel', 'warning')
    return
  }
  if (!runAt) {
    window.showToast('Pick a time', 'warning')
    return
  }
  if (!content) {
    window.showToast('Message required', 'warning')
    return
  }
  if (runAt <= Date.now()) {
    window.showToast('Time must be in the future', 'warning')
    return
  }
  try {
    const r = await window.apiClient.createSchedule({ channelId, runAt, content, repeatMs })
    if (!r.ok) throw new Error(r.error)
    window.showToast('Scheduled', 'success')
    window.uiCloseModal('sch-modal')
    loadSchedules()
  } catch (e) {
    window.showToast('Failed: ' + e.message, 'error')
  }
}

window.deleteSchedule = async function deleteSchedule(id) {
  if (!confirm('Delete this scheduled message?')) return
  try {
    const r = await window.apiClient.deleteSchedule(id)
    if (!r.ok) throw new Error(r.error)
    window.showToast('Deleted', 'success')
    loadSchedules()
  } catch (e) {
    window.showToast('Failed: ' + e.message, 'error')
  }
}
