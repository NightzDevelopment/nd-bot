/**
 * Commands Page
 * Manage custom commands and staff macros
 */

let _commands = []
let _macros = []
let _cmdEditName = null
let _macroEditKey = null

async function initCommands() {
  injectCommandModal()
  injectMacroModal()
  showCommandsTab('commands')
}

function showCommandsTab(tab) {
  document.querySelectorAll('[data-commands-tab]').forEach((btn) => {
    const isActive = btn.getAttribute('data-commands-tab') === tab
    btn.style.color = isActive ? '#60a5fa' : '#64748b'
    btn.style.borderBottomColor = isActive ? '#60a5fa' : 'transparent'
    btn.style.fontWeight = isActive ? '600' : '400'
  })
  document.getElementById('commands-tab-list').style.display = tab === 'commands' ? 'block' : 'none'
  document.getElementById('commands-tab-macros').style.display = tab === 'macros' ? 'block' : 'none'
  if (tab === 'commands') loadCommandsTable()
  if (tab === 'macros') loadMacrosTable()
}
window.showCommandsTab = showCommandsTab

// ── Custom Commands ────────────────────────────────────────────────────────

async function loadCommandsTable() {
  const tbody = document.querySelector('#commands-table tbody')
  if (!tbody) return
  tbody.innerHTML =
    '<tr><td colspan="6" style="text-align:center;color:#64748b;padding:1.5rem;">Loading…</td></tr>'
  try {
    const r = await window.apiClient.getCustomCommands()
    if (!r.ok) throw new Error(r.error)
    _commands = r.data || []
    renderCommandsTable(_commands)
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="6" style="color:#f87171;padding:1rem;">${e.message}</td></tr>`
  }
}

function renderCommandsTable(cmds) {
  const tbody = document.querySelector('#commands-table tbody')
  if (!tbody) return
  const search = document.getElementById('commands-search')?.value?.toLowerCase() || ''
  const filtered = search
    ? cmds.filter((c) => c.name.includes(search) || c.response.toLowerCase().includes(search))
    : cmds
  if (!filtered.length) {
    tbody.innerHTML =
      '<tr><td colspan="6" style="text-align:center;color:#64748b;padding:1.5rem;">No commands. Click <strong>+ Add Command</strong> to create one.</td></tr>'
    return
  }
  const permColor = {
    everyone: '#34d399',
    members: '#60a5fa',
    moderators: '#fbbf24',
    admins: '#f87171',
  }
  tbody.innerHTML = filtered
    .map(
      (cmd) => `<tr>
    <td style="font-weight:700;color:#e2e8f0;font-family:monospace;">/${escHtml(cmd.name)}</td>
    <td style="color:#94a3b8;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escHtml(cmd.response)}">${escHtml(cmd.response.slice(0, 80))}${cmd.response.length > 80 ? '…' : ''}</td>
    <td><span style="color:${permColor[cmd.permissions] || '#94a3b8'};font-size:11px;font-weight:600;text-transform:uppercase;">${escHtml(cmd.permissions)}</span></td>
    <td style="color:#64748b;font-size:12px;">${cmd.cooldown > 0 ? cmd.cooldown + 's' : '—'}</td>
    <td style="color:#64748b;font-size:12px;">${(cmd.usageCount || 0).toLocaleString()}</td>
    <td style="white-space:nowrap;">
      <button class="btn btn-sm" onclick="openCommandEdit(${JSON.stringify(cmd.name)})" style="margin-right:4px;">Edit</button>
      <button class="btn btn-sm" onclick="deleteCommand(${JSON.stringify(cmd.name)})"
        style="color:#f87171;border-color:rgba(248,113,113,0.3);background:rgba(248,113,113,0.08);">Delete</button>
    </td>
  </tr>`,
    )
    .join('')
}

document.addEventListener('input', (e) => {
  if (e.target?.id === 'commands-search') renderCommandsTable(_commands)
})

// ── Command Modal ──────────────────────────────────────────────────────────

function injectCommandModal() {
  if (document.getElementById('cmd-modal')) return
  const el = document.createElement('div')
  el.id = 'cmd-modal'
  el.style.cssText =
    'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.65);z-index:9999;align-items:center;justify-content:center;'
  el.innerHTML = `
    <div style="background:#0f1228;border:1px solid rgba(96,165,250,0.25);border-radius:12px;padding:1.75rem;width:520px;max-width:95vw;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.5);">
      <h3 id="cmd-title" style="margin:0 0 1.25rem;color:#e2e8f0;font-size:15px;"></h3>
      <label style="display:flex;flex-direction:column;gap:4px;margin-bottom:1rem;">
        <span style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;">Command Name *</span>
        <input id="cmd-name" type="text" maxlength="32" placeholder="e.g. rules"
          style="background:rgba(15,18,40,0.8);border:1px solid rgba(96,165,250,0.25);color:#e2e8f0;padding:.5rem .65rem;border-radius:6px;font-size:14px;font-family:monospace;" />
        <span style="font-size:10px;color:#475569;">Alphanumeric, underscore, dash — used as /commandname</span>
      </label>
      <label style="display:flex;flex-direction:column;gap:4px;margin-bottom:1rem;">
        <span style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;">Response * <span id="cmd-char-count" style="color:#475569;font-weight:400;"></span></span>
        <textarea id="cmd-response" rows="5" maxlength="2000" placeholder="The text the bot will reply with…"
          style="background:rgba(15,18,40,0.8);border:1px solid rgba(96,165,250,0.25);color:#e2e8f0;padding:.5rem .65rem;border-radius:6px;font-size:13px;resize:vertical;font-family:inherit;width:100%;box-sizing:border-box;"></textarea>
      </label>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1rem;">
        <label style="display:flex;flex-direction:column;gap:4px;">
          <span style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;">Permissions</span>
          <select id="cmd-perms" style="background:rgba(15,18,40,0.8);border:1px solid rgba(96,165,250,0.25);color:#e2e8f0;padding:.5rem .65rem;border-radius:6px;font-size:14px;">
            <option value="everyone">Everyone</option>
            <option value="members">Members</option>
            <option value="moderators">Moderators</option>
            <option value="admins">Admins</option>
          </select>
        </label>
        <label style="display:flex;flex-direction:column;gap:4px;">
          <span style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;">Cooldown (seconds)</span>
          <input id="cmd-cooldown" type="number" min="0" max="3600" placeholder="0 = no cooldown"
            style="background:rgba(15,18,40,0.8);border:1px solid rgba(96,165,250,0.25);color:#e2e8f0;padding:.5rem .65rem;border-radius:6px;font-size:14px;" />
        </label>
      </div>
      <label style="display:flex;flex-direction:column;gap:4px;margin-bottom:1rem;">
        <span style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;">Aliases (comma-separated)</span>
        <input id="cmd-aliases" type="text" placeholder="e.g. rule, serverrules"
          style="background:rgba(15,18,40,0.8);border:1px solid rgba(96,165,250,0.25);color:#e2e8f0;padding:.5rem .65rem;border-radius:6px;font-size:14px;" />
      </label>
      <div id="cmd-error" style="display:none;background:rgba(248,113,113,0.1);border:1px solid rgba(248,113,113,0.3);border-radius:6px;padding:.5rem .75rem;font-size:12px;color:#f87171;margin-bottom:1rem;"></div>
      <div style="display:flex;gap:.75rem;justify-content:flex-end;">
        <button class="btn" onclick="closeCmdModal()" style="color:#64748b;border-color:rgba(100,116,139,0.3);">Cancel</button>
        <button class="btn" id="cmd-save" onclick="saveCommand()"
          style="background:rgba(96,165,250,0.15);border-color:rgba(96,165,250,0.4);color:#60a5fa;">Save Command</button>
      </div>
    </div>`
  document.body.appendChild(el)
  document.addEventListener('click', (e) => {
    if (e.target === el) closeCmdModal()
  })
  document.getElementById('cmd-response').addEventListener('input', function () {
    document.getElementById('cmd-char-count').textContent = `${this.value.length}/2000`
  })
}

window.openCommandAdd = () => {
  _cmdEditName = null
  document.getElementById('cmd-title').textContent = 'Add Custom Command'
  document.getElementById('cmd-name').value = ''
  document.getElementById('cmd-name').disabled = false
  document.getElementById('cmd-response').value = ''
  document.getElementById('cmd-char-count').textContent = '0/2000'
  document.getElementById('cmd-perms').value = 'everyone'
  document.getElementById('cmd-cooldown').value = '0'
  document.getElementById('cmd-aliases').value = ''
  document.getElementById('cmd-error').style.display = 'none'
  document.getElementById('cmd-modal').style.display = 'flex'
}

window.openCommandEdit = (name) => {
  const cmd = _commands.find((c) => c.name === name)
  if (!cmd) return
  _cmdEditName = name
  document.getElementById('cmd-title').textContent = `Edit — /${name}`
  document.getElementById('cmd-name').value = name
  document.getElementById('cmd-name').disabled = true
  document.getElementById('cmd-response').value = cmd.response
  document.getElementById('cmd-char-count').textContent = `${cmd.response.length}/2000`
  document.getElementById('cmd-perms').value = cmd.permissions || 'everyone'
  document.getElementById('cmd-cooldown').value = cmd.cooldown || 0
  document.getElementById('cmd-aliases').value = (cmd.aliases || []).join(', ')
  document.getElementById('cmd-error').style.display = 'none'
  document.getElementById('cmd-modal').style.display = 'flex'
}

window.closeCmdModal = () => {
  document.getElementById('cmd-modal').style.display = 'none'
}

window.saveCommand = async () => {
  const name = document.getElementById('cmd-name').value.trim()
  const response = document.getElementById('cmd-response').value.trim()
  const permissions = document.getElementById('cmd-perms').value
  const cooldown = Math.max(0, parseInt(document.getElementById('cmd-cooldown').value || '0', 10))
  const aliasRaw = document.getElementById('cmd-aliases').value.trim()
  const aliases = aliasRaw
    ? aliasRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : []
  const errEl = document.getElementById('cmd-error')
  if (!response) {
    showCmdErr('Response is required.')
    return
  }
  if (!_cmdEditName && !name) {
    showCmdErr('Command name is required.')
    return
  }
  const btn = document.getElementById('cmd-save')
  btn.textContent = 'Saving…'
  btn.disabled = true
  errEl.style.display = 'none'
  try {
    let r
    if (_cmdEditName) {
      r = await window.apiClient.updateCustomCommand(_cmdEditName, {
        response,
        permissions,
        cooldown,
        aliases,
      })
    } else {
      r = await window.apiClient.addCustomCommand({
        name,
        response,
        permissions,
        cooldown,
        aliases,
      })
    }
    if (!r.ok) throw new Error(r.error)
    showToast(_cmdEditName ? 'Command updated' : 'Command added', 'success')
    closeCmdModal()
    await loadCommandsTable()
  } catch (e) {
    showCmdErr(e.message)
  } finally {
    btn.textContent = 'Save Command'
    btn.disabled = false
  }
  function showCmdErr(msg) {
    errEl.textContent = msg
    errEl.style.display = 'block'
  }
}

window.deleteCommand = async (name) => {
  if (!confirm(`Delete /${name}? This cannot be undone.`)) return
  try {
    const r = await window.apiClient.deleteCustomCommand(name)
    if (!r.ok) throw new Error(r.error)
    showToast(`/${name} deleted`, 'success')
    await loadCommandsTable()
  } catch (e) {
    showToast('Error: ' + e.message, 'error')
  }
}

// ── Macros ─────────────────────────────────────────────────────────────────

async function loadMacrosTable() {
  const tbody = document.querySelector('#macros-table tbody')
  if (!tbody) return
  tbody.innerHTML =
    '<tr><td colspan="3" style="text-align:center;color:#64748b;padding:1.5rem;">Loading…</td></tr>'
  try {
    const r = await window.apiClient.getMacros()
    if (!r.ok) throw new Error(r.error)
    _macros = r.data || []
    renderMacrosTable()
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="3" style="color:#f87171;padding:1rem;">${e.message}</td></tr>`
  }
}

function renderMacrosTable() {
  const tbody = document.querySelector('#macros-table tbody')
  if (!tbody) return
  if (!_macros.length) {
    tbody.innerHTML =
      '<tr><td colspan="3" style="text-align:center;color:#64748b;padding:1.5rem;">No macros yet. Click <strong>+ Add Macro</strong> to create one.</td></tr>'
    return
  }
  tbody.innerHTML = _macros
    .map(
      (m) => `<tr>
    <td style="font-weight:700;color:#e2e8f0;font-family:monospace;white-space:nowrap;">${escHtml(m.key)}</td>
    <td style="color:#94a3b8;max-width:400px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escHtml(m.body)}">${escHtml(m.body.slice(0, 120))}${m.body.length > 120 ? '…' : ''}</td>
    <td style="white-space:nowrap;">
      <button class="btn btn-sm" onclick="openMacroEdit(${JSON.stringify(m.key)})" style="margin-right:4px;">Edit</button>
      <button class="btn btn-sm" onclick="deleteMacroEntry(${JSON.stringify(m.key)})"
        style="color:#f87171;border-color:rgba(248,113,113,0.3);background:rgba(248,113,113,0.08);">Delete</button>
    </td>
  </tr>`,
    )
    .join('')
}

// ── Macro Modal ────────────────────────────────────────────────────────────

function injectMacroModal() {
  if (document.getElementById('macro-modal')) return
  const el = document.createElement('div')
  el.id = 'macro-modal'
  el.style.cssText =
    'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.65);z-index:9999;align-items:center;justify-content:center;'
  el.innerHTML = `
    <div style="background:#0f1228;border:1px solid rgba(96,165,250,0.25);border-radius:12px;padding:1.75rem;width:500px;max-width:95vw;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.5);">
      <h3 id="macro-title" style="margin:0 0 1.25rem;color:#e2e8f0;font-size:15px;"></h3>
      <label style="display:flex;flex-direction:column;gap:4px;margin-bottom:1rem;">
        <span style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;">Key *</span>
        <input id="macro-key" type="text" maxlength="64" placeholder="e.g. refund-policy"
          style="background:rgba(15,18,40,0.8);border:1px solid rgba(96,165,250,0.25);color:#e2e8f0;padding:.5rem .65rem;border-radius:6px;font-size:14px;font-family:monospace;" />
        <span style="font-size:10px;color:#475569;">Staff use /macro run [key] to send this text</span>
      </label>
      <label style="display:flex;flex-direction:column;gap:4px;margin-bottom:1rem;">
        <span style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;">Body *</span>
        <textarea id="macro-body" rows="6" placeholder="The full text to send…"
          style="background:rgba(15,18,40,0.8);border:1px solid rgba(96,165,250,0.25);color:#e2e8f0;padding:.5rem .65rem;border-radius:6px;font-size:13px;resize:vertical;font-family:inherit;width:100%;box-sizing:border-box;"></textarea>
      </label>
      <div id="macro-error" style="display:none;background:rgba(248,113,113,0.1);border:1px solid rgba(248,113,113,0.3);border-radius:6px;padding:.5rem .75rem;font-size:12px;color:#f87171;margin-bottom:1rem;"></div>
      <div style="display:flex;gap:.75rem;justify-content:flex-end;">
        <button class="btn" onclick="closeMacroModal()" style="color:#64748b;border-color:rgba(100,116,139,0.3);">Cancel</button>
        <button class="btn" id="macro-save" onclick="saveMacro()"
          style="background:rgba(96,165,250,0.15);border-color:rgba(96,165,250,0.4);color:#60a5fa;">Save Macro</button>
      </div>
    </div>`
  document.body.appendChild(el)
  document.addEventListener('click', (e) => {
    if (e.target === el) closeMacroModal()
  })
}

window.openMacroAdd = () => {
  _macroEditKey = null
  document.getElementById('macro-title').textContent = 'Add Macro'
  document.getElementById('macro-key').value = ''
  document.getElementById('macro-key').disabled = false
  document.getElementById('macro-body').value = ''
  document.getElementById('macro-error').style.display = 'none'
  document.getElementById('macro-modal').style.display = 'flex'
}

window.openMacroEdit = (key) => {
  const macro = _macros.find((m) => m.key === key)
  if (!macro) return
  _macroEditKey = key
  document.getElementById('macro-title').textContent = `Edit — ${key}`
  document.getElementById('macro-key').value = key
  document.getElementById('macro-key').disabled = true
  document.getElementById('macro-body').value = macro.body
  document.getElementById('macro-error').style.display = 'none'
  document.getElementById('macro-modal').style.display = 'flex'
}

window.closeMacroModal = () => {
  document.getElementById('macro-modal').style.display = 'none'
}

window.saveMacro = async () => {
  const key = document.getElementById('macro-key').value.trim()
  const body = document.getElementById('macro-body').value.trim()
  const errEl = document.getElementById('macro-error')
  if (!key) {
    showMErr('Key is required.')
    return
  }
  if (!body) {
    showMErr('Body text is required.')
    return
  }
  const btn = document.getElementById('macro-save')
  btn.textContent = 'Saving…'
  btn.disabled = true
  errEl.style.display = 'none'
  try {
    const r = await window.apiClient.setMacro(_macroEditKey || key, body)
    if (!r.ok) throw new Error(r.error)
    showToast(_macroEditKey ? 'Macro updated' : 'Macro added', 'success')
    closeMacroModal()
    await loadMacrosTable()
  } catch (e) {
    showMErr(e.message)
  } finally {
    btn.textContent = 'Save Macro'
    btn.disabled = false
  }
  function showMErr(msg) {
    errEl.textContent = msg
    errEl.style.display = 'block'
  }
}

window.deleteMacroEntry = async (key) => {
  if (!confirm(`Delete macro "${key}"? This cannot be undone.`)) return
  try {
    const r = await window.apiClient.deleteMacro(key)
    if (!r.ok) throw new Error(r.error)
    showToast(`Macro "${key}" deleted`, 'success')
    await loadMacrosTable()
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

window.initCommands = initCommands
window.loadCommandsTable = loadCommandsTable
window.loadMacrosTable = loadMacrosTable
