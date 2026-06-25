/**
 * Auto-Delete + Auto-Purge Rule Builders
 * Visual editors that read/write AUTO_DELETE_RULES_JSON and AUTO_PURGE_RULES_JSON
 * via the existing config API.
 */

let _autoDeleteRules = []
let _autoPurgeRules = []
let _channelsCache = null

async function ensureChannels() {
  if (_channelsCache) return _channelsCache
  const r = await window.apiClient.getGuildChannels().catch(() => ({ ok: false }))
  _channelsCache = r.ok ? r.data || [] : []
  return _channelsCache
}

// ── Auto-Delete ────────────────────────────────────────────────────────────

async function loadAutoDeleteRules() {
  const cfg = await window.apiClient.get('/api/config').catch(() => ({ ok: false }))
  const raw = cfg?.data?.AUTO_DELETE_RULES_JSON || ''
  try {
    _autoDeleteRules = raw ? JSON.parse(raw) : []
    if (!Array.isArray(_autoDeleteRules)) _autoDeleteRules = []
  } catch {
    _autoDeleteRules = []
  }
  await renderAutoDeleteRules()
}

async function renderAutoDeleteRules() {
  const root = document.getElementById('auto-delete-rules-list')
  if (!root) return
  await ensureChannels()
  if (!_autoDeleteRules.length) {
    root.innerHTML =
      '<div style="text-align:center;color:#64748b;padding:2rem;border:1px dashed rgba(148,163,184,0.2);border-radius:8px;">No auto-delete rules. Click "+ Add Rule" to create one.</div>'
    return
  }
  const channelOpts = _channelsCache
    .map((c) => `<option value="${window.esc(c.id)}">#${window.esc(c.name)}</option>`)
    .join('')
  root.innerHTML = _autoDeleteRules
    .map(
      (rule, idx) => `
    <div style="background:rgba(15,18,40,0.6);border:1px solid rgba(148,163,184,0.15);border-radius:8px;padding:1rem;">
      <div style="display:flex;justify-content:space-between;margin-bottom:.75rem;align-items:center;">
        <input type="text" value="${window.esc(rule.name || '')}" placeholder="Rule name (optional)" onchange="updateAutoDeleteRule(${idx},'name',this.value)"
          style="flex:1;padding:.35rem .6rem;background:transparent;border:none;border-bottom:1px solid rgba(148,163,184,0.15);color:#e2e8f0;font-weight:700;font-size:13px;">
        <button onclick="removeAutoDeleteRule(${idx})" style="background:rgba(248,113,113,0.1);border:1px solid rgba(248,113,113,0.3);color:#f87171;padding:.3rem .6rem;border-radius:4px;cursor:pointer;font-size:11px;margin-left:.5rem;">Remove</button>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem;">
        <div>
          <label style="font-size:10px;color:#64748b;text-transform:uppercase;display:block;margin-bottom:.25rem;">Channel</label>
          <select onchange="updateAutoDeleteRule(${idx},'channelId',this.value)" style="width:100%;padding:.4rem;background:#0a0e1f;border:1px solid rgba(148,163,184,0.2);border-radius:4px;color:#e2e8f0;font-size:12px;">
            <option value="">Any channel</option>${channelOpts.replace(`value="${window.esc(rule.channelId || '')}"`, `value="${window.esc(rule.channelId || '')}" selected`)}
          </select>
        </div>
        <div>
          <label style="font-size:10px;color:#64748b;text-transform:uppercase;display:block;margin-bottom:.25rem;">Delete after (seconds)</label>
          <input type="number" min="0" value="${rule.delaySec ?? 0}" onchange="updateAutoDeleteRule(${idx},'delaySec',parseInt(this.value,10)||0)"
            style="width:100%;padding:.4rem;background:#0a0e1f;border:1px solid rgba(148,163,184,0.2);border-radius:4px;color:#e2e8f0;font-size:12px;">
        </div>
      </div>
      <div style="margin-top:.75rem;">
        <label style="font-size:10px;color:#64748b;text-transform:uppercase;display:block;margin-bottom:.4rem;">Triggers (delete if message matches ANY)</label>
        <div style="display:flex;flex-wrap:wrap;gap:.4rem;">
          ${toggle(idx, 'links', 'Has link', rule.links)}
          ${toggle(idx, 'invites', 'Has invite', rule.invites)}
          ${toggle(idx, 'attachments', 'Has attachment', rule.attachments)}
          ${toggle(idx, 'bots', 'From bot', rule.bots)}
        </div>
      </div>
      <div style="margin-top:.75rem;display:grid;grid-template-columns:1fr 1fr;gap:.75rem;">
        <div>
          <label style="font-size:10px;color:#64748b;text-transform:uppercase;display:block;margin-bottom:.25rem;">Contains (comma-separated)</label>
          <input type="text" value="${window.esc((rule.contains || []).join(', '))}" onchange="updateAutoDeleteRule(${idx},'contains',this.value.split(',').map(s=>s.trim()).filter(Boolean))"
            style="width:100%;padding:.4rem;background:#0a0e1f;border:1px solid rgba(148,163,184,0.2);border-radius:4px;color:#e2e8f0;font-size:12px;">
        </div>
        <div>
          <label style="font-size:10px;color:#64748b;text-transform:uppercase;display:block;margin-bottom:.25rem;">Max length</label>
          <input type="number" min="0" placeholder="0 = no limit" value="${rule.maxLength || ''}" onchange="updateAutoDeleteRule(${idx},'maxLength',parseInt(this.value,10)||0)"
            style="width:100%;padding:.4rem;background:#0a0e1f;border:1px solid rgba(148,163,184,0.2);border-radius:4px;color:#e2e8f0;font-size:12px;">
        </div>
      </div>
    </div>
  `,
    )
    .join('')
}

function toggle(idx, field, label, value) {
  return `<label style="cursor:pointer;background:${value ? 'rgba(96,165,250,0.15)' : 'rgba(148,163,184,0.05)'};border:1px solid ${value ? 'rgba(96,165,250,0.3)' : 'rgba(148,163,184,0.15)'};padding:.3rem .6rem;border-radius:999px;font-size:11px;color:${value ? '#60a5fa' : '#94a3b8'};">
    <input type="checkbox" ${value ? 'checked' : ''} onchange="updateAutoDeleteRule(${idx},'${field}',this.checked); renderAutoDeleteRulesAsync()" style="margin-right:4px;vertical-align:middle;">
    ${label}
  </label>`
}

window.renderAutoDeleteRulesAsync = () => {
  renderAutoDeleteRules()
}

window.updateAutoDeleteRule = (idx, field, value) => {
  if (!_autoDeleteRules[idx]) return
  if (value === false || value === '' || value === 0 || (Array.isArray(value) && !value.length)) {
    delete _autoDeleteRules[idx][field]
  } else {
    _autoDeleteRules[idx][field] = value
  }
}

window.addAutoDeleteRule = () => {
  _autoDeleteRules.push({ name: 'New rule', delaySec: 0 })
  renderAutoDeleteRules()
}

window.removeAutoDeleteRule = (idx) => {
  if (!confirm('Remove this rule?')) return
  _autoDeleteRules.splice(idx, 1)
  renderAutoDeleteRules()
}

window.saveAutoDeleteRules = async () => {
  try {
    const r = await window.apiClient.request('PUT', '/api/config', {
      AUTO_DELETE_RULES_JSON: JSON.stringify(_autoDeleteRules),
    })
    if (r.errors) throw new Error(JSON.stringify(r.errors))
    window.showToast('Saved. Restart bot to apply', 'success')
  } catch (e) {
    window.showToast('Failed: ' + e.message, 'error')
  }
}

// ── Auto-Purge ─────────────────────────────────────────────────────────────

async function loadAutoPurgeRules() {
  const cfg = await window.apiClient.get('/api/config').catch(() => ({ ok: false }))
  const raw = cfg?.data?.AUTO_PURGE_RULES_JSON || ''
  try {
    _autoPurgeRules = raw ? JSON.parse(raw) : []
    if (!Array.isArray(_autoPurgeRules)) _autoPurgeRules = []
  } catch {
    _autoPurgeRules = []
  }
  await renderAutoPurgeRules()
}

async function renderAutoPurgeRules() {
  const root = document.getElementById('auto-purge-rules-list')
  if (!root) return
  await ensureChannels()
  if (!_autoPurgeRules.length) {
    root.innerHTML =
      '<div style="text-align:center;color:#64748b;padding:2rem;border:1px dashed rgba(148,163,184,0.2);border-radius:8px;">No auto-purge rules. Click "+ Add Rule" to create one.</div>'
    return
  }
  const channelOpts = _channelsCache
    .map((c) => `<option value="${window.esc(c.id)}">#${window.esc(c.name)}</option>`)
    .join('')
  root.innerHTML = _autoPurgeRules
    .map(
      (rule, idx) => `
    <div style="background:rgba(15,18,40,0.6);border:1px solid rgba(148,163,184,0.15);border-radius:8px;padding:1rem;">
      <div style="display:flex;justify-content:space-between;margin-bottom:.75rem;align-items:center;">
        <input type="text" value="${window.esc(rule.name || '')}" placeholder="Rule name" onchange="_autoPurgeRules[${idx}].name=this.value"
          style="flex:1;padding:.35rem .6rem;background:transparent;border:none;border-bottom:1px solid rgba(148,163,184,0.15);color:#e2e8f0;font-weight:700;font-size:13px;">
        <button onclick="removeAutoPurgeRule(${idx})" style="background:rgba(248,113,113,0.1);border:1px solid rgba(248,113,113,0.3);color:#f87171;padding:.3rem .6rem;border-radius:4px;cursor:pointer;font-size:11px;margin-left:.5rem;">Remove</button>
      </div>
      <div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:.75rem;">
        <div>
          <label style="font-size:10px;color:#64748b;text-transform:uppercase;display:block;margin-bottom:.25rem;">Channel</label>
          <select onchange="_autoPurgeRules[${idx}].channelId=this.value" style="width:100%;padding:.4rem;background:#0a0e1f;border:1px solid rgba(148,163,184,0.2);border-radius:4px;color:#e2e8f0;font-size:12px;">
            <option value="">Pick channel</option>${channelOpts.replace(`value="${window.esc(rule.channelId || '')}"`, `value="${window.esc(rule.channelId || '')}" selected`)}
          </select>
        </div>
        <div>
          <label style="font-size:10px;color:#64748b;text-transform:uppercase;display:block;margin-bottom:.25rem;">Delete older than (days)</label>
          <input type="number" min="1" value="${rule.maxAgeDays || 30}" onchange="_autoPurgeRules[${idx}].maxAgeDays=parseInt(this.value,10)||30"
            style="width:100%;padding:.4rem;background:#0a0e1f;border:1px solid rgba(148,163,184,0.2);border-radius:4px;color:#e2e8f0;font-size:12px;">
        </div>
        <div>
          <label style="font-size:10px;color:#64748b;text-transform:uppercase;display:block;margin-bottom:.25rem;">Max per run</label>
          <input type="number" min="1" max="500" value="${rule.limitPerRun || 100}" onchange="_autoPurgeRules[${idx}].limitPerRun=parseInt(this.value,10)||100"
            style="width:100%;padding:.4rem;background:#0a0e1f;border:1px solid rgba(148,163,184,0.2);border-radius:4px;color:#e2e8f0;font-size:12px;">
        </div>
      </div>
    </div>
  `,
    )
    .join('')
}

window.addAutoPurgeRule = () => {
  _autoPurgeRules.push({ name: 'New purge rule', maxAgeDays: 30, limitPerRun: 100 })
  renderAutoPurgeRules()
}

window.removeAutoPurgeRule = (idx) => {
  if (!confirm('Remove this rule?')) return
  _autoPurgeRules.splice(idx, 1)
  renderAutoPurgeRules()
}

window.saveAutoPurgeRules = async () => {
  try {
    const r = await window.apiClient.request('PUT', '/api/config', {
      AUTO_PURGE_RULES_JSON: JSON.stringify(_autoPurgeRules),
    })
    if (r.errors) throw new Error(JSON.stringify(r.errors))
    window.showToast('Saved. Restart bot to apply', 'success')
  } catch (e) {
    window.showToast('Failed: ' + e.message, 'error')
  }
}

// ── Hook into existing configuration page tab switcher ─────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Wait for the page to initialize, then hook into tab buttons
  setTimeout(() => {
    document.querySelectorAll('.config-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.ctab
        if (tab === 'auto-delete') loadAutoDeleteRules()
        else if (tab === 'auto-purge') loadAutoPurgeRules()

        // Also activate the panel (in case configuration.js doesn't already)
        document
          .querySelectorAll('.config-tab-content')
          .forEach((p) => p.classList.remove('active'))
        document.getElementById('ctab-' + tab)?.classList.add('active')
        document.querySelectorAll('.config-tab-btn').forEach((b) => b.classList.remove('active'))
        btn.classList.add('active')
      })
    })
  }, 200)
})
