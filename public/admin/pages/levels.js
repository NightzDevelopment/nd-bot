/**
 * Levels Page
 * XP leaderboard with editing + Level Role Rewards tab
 */

let _levelsData = []
let _userCache = {}
let _levelRolesData = []
let _levelsGuildId = ''
let _activeTab = 'leaderboard'

async function initLevels() {
  injectLevelsModal()
  injectLevelRolesModal()
  showLevelsTab('leaderboard')

  document.querySelectorAll('[data-levels-tab]').forEach((btn) => {
    btn.addEventListener('click', () => showLevelsTab(btn.dataset.levelsTab))
  })
}

function showLevelsTab(tab) {
  _activeTab = tab
  document
    .querySelectorAll('[data-levels-tab]')
    .forEach((b) => b.classList.toggle('active', b.dataset.levelsTab === tab))
  document.getElementById('levels-tab-leaderboard').style.display =
    tab === 'leaderboard' ? '' : 'none'
  document.getElementById('levels-tab-roles').style.display = tab === 'roles' ? '' : 'none'
  if (tab === 'leaderboard' && !_levelsData.length) loadLevelsData()
  if (tab === 'roles') loadLevelRoles()
}

// ── Leaderboard tab ──────────────────────────────────────────────────────────

async function loadLevelsData() {
  const tbody = document.querySelector('#levels-table tbody')
  if (!tbody) return
  tbody.innerHTML =
    '<tr><td colspan="5" style="text-align:center;color:#64748b;padding:1.5rem;">Loading…</td></tr>'
  try {
    const r = await window.apiClient.getLevelsList()
    if (!r.ok) throw new Error(r.error)
    _levelsData = r.data || []
    if (_levelsData.length) _levelsGuildId = _levelsData[0].guildId || ''

    const ids = _levelsData.map((r) => r.userId)
    if (ids.length) {
      const resolved = await window.apiClient.resolveUsers(ids).catch(() => ({ ok: false }))
      if (resolved.ok) _userCache = { ..._userCache, ...resolved.data }
    }

    renderLevelsTable(_levelsData)
  } catch (e) {
    if (tbody)
      tbody.innerHTML = `<tr><td colspan="5" style="color:#f87171;padding:1rem;">${e.message}</td></tr>`
  }
}

function renderLevelsTable(data) {
  const tbody = document.querySelector('#levels-table tbody')
  if (!tbody) return
  if (!data.length) {
    tbody.innerHTML =
      '<tr><td colspan="5" style="text-align:center;color:#64748b;padding:1.5rem;">No level data yet.</td></tr>'
    return
  }
  const medals = ['🥇', '🥈', '🥉']
  tbody.innerHTML = data
    .map((r, i) => {
      const medal = medals[i] ?? `${i + 1}.`
      const info = _userCache[r.userId]
      const xpBar = buildXpBar(r.xp, r.level)
      const avatar = info?.avatarUrl
        ? `<img src="${escapeAttr(info.avatarUrl)}" style="width:24px;height:24px;border-radius:50%;margin-right:7px;vertical-align:middle;" />`
        : ''
      const nameBlock = info
        ? `<span style="cursor:pointer;" onclick="openMemberCard('${escapeAttr(r.userId)}')">${avatar}<span style="color:#e2e8f0;font-weight:500;">${escapeHtml(info.displayName)}</span>
         <span style="color:#64748b;font-size:11px;margin-left:4px;">@${escapeHtml(info.username)}</span>
         <br><code style="font-size:10px;color:#475569;">${escapeHtml(r.userId)}</code></span>`
        : `<code style="font-size:11px;color:#94a3b8;cursor:pointer;" onclick="openMemberCard('${escapeAttr(r.userId)}')">${escapeHtml(r.userId)}</code>`
      return `<tr>
      <td style="color:#94a3b8;font-size:12px;vertical-align:middle;">${medal}</td>
      <td style="vertical-align:middle;line-height:1.5;">${nameBlock}</td>
      <td style="text-align:center;vertical-align:middle;">
        <span style="font-weight:700;color:#60a5fa;font-size:18px;">${r.level}</span>
      </td>
      <td style="vertical-align:middle;min-width:180px;">
        <div style="font-size:11px;color:#94a3b8;margin-bottom:3px;">${(r.xp ?? 0).toLocaleString()} XP · ${(r.messages ?? 0).toLocaleString()} msgs</div>
        ${xpBar}
      </td>
      <td style="vertical-align:middle;white-space:nowrap;">
        <button class="btn btn-sm" onclick="openLevelEdit('${escapeAttr(r.userId)}','${escapeAttr(r.guildId ?? '')}',${r.level},${r.xp ?? 0},${r.messages ?? 0})"
          style="margin-right:4px;">Edit</button>
        <button class="btn btn-sm" onclick="confirmLevelReset('${escapeAttr(r.userId)}','${escapeAttr(r.guildId ?? '')}')"
          style="color:#f87171;border-color:rgba(248,113,113,0.3);background:rgba(248,113,113,0.08);">Reset</button>
      </td>
    </tr>`
    })
    .join('')
}

function buildXpBar(xp, level) {
  const xpForLevel = (l) => 100 * l * l
  const thisXp = xpForLevel(level)
  const nextXp = xpForLevel(level + 1)
  const range = nextXp - thisXp
  const pct =
    range <= 0 ? 100 : Math.min(100, Math.max(0, Math.round(((xp - thisXp) / range) * 100)))
  const into = Math.max(0, xp - thisXp)
  return `<div title="${into.toLocaleString()} / ${range.toLocaleString()} XP"
    style="background:rgba(96,165,250,0.15);border-radius:4px;height:7px;overflow:hidden;cursor:default;">
    <div style="background:linear-gradient(90deg,#3b82f6,#60a5fa);width:${pct}%;height:100%;transition:width .3s;"></div>
  </div>
  <div style="font-size:10px;color:#475569;margin-top:2px;">${pct}% to level ${level + 1}</div>`
}

// ── Level edit modal ─────────────────────────────────────────────────────────

function injectLevelsModal() {
  if (document.getElementById('levels-edit-modal')) return
  const modal = document.createElement('div')
  modal.id = 'levels-edit-modal'
  modal.style.cssText =
    'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;align-items:center;justify-content:center;'
  modal.innerHTML = `
    <div style="background:#0f1228;border:1px solid rgba(96,165,250,0.25);border-radius:12px;padding:1.75rem;width:420px;max-width:95vw;box-shadow:0 20px 60px rgba(0,0,0,0.5);">
      <h3 id="lm-title" style="margin:0 0 1.25rem;color:#e2e8f0;font-size:15px;"></h3>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1rem;">
        <label style="display:flex;flex-direction:column;gap:4px;">
          <span style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;">Level</span>
          <input id="lm-level" type="number" min="0" max="999"
            style="background:rgba(15,18,40,0.8);border:1px solid rgba(96,165,250,0.25);color:#e2e8f0;padding:0.5rem 0.65rem;border-radius:6px;font-size:14px;width:100%;box-sizing:border-box;" />
          <span style="font-size:10px;color:#475569;">Adjusts XP floor automatically</span>
        </label>
        <label style="display:flex;flex-direction:column;gap:4px;">
          <span style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;">Total XP</span>
          <input id="lm-xp" type="number" min="0"
            style="background:rgba(15,18,40,0.8);border:1px solid rgba(96,165,250,0.25);color:#e2e8f0;padding:0.5rem 0.65rem;border-radius:6px;font-size:14px;width:100%;box-sizing:border-box;" />
          <span style="font-size:10px;color:#475569;">Recalculates level automatically</span>
        </label>
      </div>
      <label style="display:flex;flex-direction:column;gap:4px;margin-bottom:1.25rem;">
        <span style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;">Message Count</span>
        <input id="lm-msgs" type="number" min="0"
          style="background:rgba(15,18,40,0.8);border:1px solid rgba(96,165,250,0.25);color:#e2e8f0;padding:0.5rem 0.65rem;border-radius:6px;font-size:14px;width:100%;box-sizing:border-box;" />
      </label>
      <div id="lm-xp-preview" style="background:rgba(96,165,250,0.07);border-radius:8px;padding:0.6rem 0.85rem;font-size:12px;color:#94a3b8;margin-bottom:1.25rem;min-height:36px;"></div>
      <div style="display:flex;gap:0.75rem;justify-content:flex-end;">
        <button class="btn" onclick="closeLevelModal()" style="color:#64748b;border-color:rgba(100,116,139,0.3);">Cancel</button>
        <button class="btn" id="lm-save" onclick="saveLevelEdit()"
          style="background:rgba(96,165,250,0.15);border-color:rgba(96,165,250,0.4);color:#60a5fa;">Save Changes</button>
      </div>
    </div>`
  document.body.appendChild(modal)

  const lvlInput = document.getElementById('lm-level')
  const xpInput = document.getElementById('lm-xp')
  let lastChanged = 'xp'
  lvlInput.addEventListener('input', () => {
    lastChanged = 'level'
    updateXpPreview()
  })
  xpInput.addEventListener('input', () => {
    lastChanged = 'xp'
    updateXpPreview()
  })

  function updateXpPreview() {
    const xpForLvl = (l) => 100 * l * l
    const lvl = parseInt(lvlInput.value, 10)
    const xp = parseInt(xpInput.value, 10)
    const el = document.getElementById('lm-xp-preview')
    if (lastChanged === 'level' && !isNaN(lvl)) {
      xpInput.value = xpForLvl(lvl)
      el.textContent = `Level ${lvl} starts at ${xpForLvl(lvl).toLocaleString()} XP (next at ${xpForLvl(lvl + 1).toLocaleString()})`
    } else if (!isNaN(xp)) {
      let cl = 0
      while (xp >= xpForLvl(cl + 1)) cl++
      lvlInput.value = cl
      const into = xp - xpForLvl(cl),
        need = xpForLvl(cl + 1) - xpForLvl(cl)
      el.textContent = `Level ${cl} · ${into.toLocaleString()} / ${need.toLocaleString()} XP · ${Math.round((into / need) * 100)}% to next`
    }
  }
}

let _lmUserId = '',
  _lmGuildId = ''

window.openLevelEdit = (userId, guildId, level, xp, msgs) => {
  _lmUserId = userId
  _lmGuildId = guildId
  const info = _userCache[userId]
  document.getElementById('lm-title').textContent =
    `Edit levels: ${info ? info.displayName + ' (@' + info.username + ')' : userId.slice(0, 14) + '…'}`
  document.getElementById('lm-level').value = level
  document.getElementById('lm-xp').value = xp
  document.getElementById('lm-msgs').value = msgs
  const xpForLvl = (l) => 100 * l * l
  const into = xp - xpForLvl(level),
    need = xpForLvl(level + 1) - xpForLvl(level)
  document.getElementById('lm-xp-preview').textContent =
    `Level ${level} · ${into.toLocaleString()} / ${need.toLocaleString()} XP · ${Math.round((into / need) * 100)}% to next`
  document.getElementById('levels-edit-modal').style.display = 'flex'
}

window.closeLevelModal = () => {
  document.getElementById('levels-edit-modal').style.display = 'none'
}

window.saveLevelEdit = async () => {
  const level = parseInt(document.getElementById('lm-level').value, 10)
  const xp = parseInt(document.getElementById('lm-xp').value, 10)
  const msgs = parseInt(document.getElementById('lm-msgs').value, 10)
  if (isNaN(level) || isNaN(xp) || isNaN(msgs)) {
    showToast('Fill in all fields', 'error')
    return
  }
  if (!_lmGuildId) {
    showToast('No guild ID for this user', 'error')
    return
  }
  const btn = document.getElementById('lm-save')
  btn.textContent = 'Saving…'
  btn.disabled = true
  try {
    const r = await window.apiClient.setLevelRecord(_lmUserId, _lmGuildId, {
      level,
      xp,
      messageCount: msgs,
    })
    if (!r.ok) throw new Error(r.error)
    showToast('Saved', 'success')
    closeLevelModal()
    await loadLevelsData()
  } catch (e) {
    showToast('Error: ' + e.message, 'error')
  } finally {
    btn.textContent = 'Save Changes'
    btn.disabled = false
  }
}

window.confirmLevelReset = async (userId, guildId) => {
  const info = _userCache[userId]
  const label = info ? `${info.displayName} (@${info.username})` : userId
  if (!confirm(`Reset ALL level data for ${label}?\n\nThis cannot be undone.`)) return
  if (!guildId) {
    showToast('No guild ID', 'error')
    return
  }
  try {
    const r = await window.apiClient.resetLevelRecord(userId, guildId)
    if (!r.ok) throw new Error(r.error)
    showToast(`${label} reset to level 0`, 'success')
    await loadLevelsData()
  } catch (e) {
    showToast('Error: ' + e.message, 'error')
  }
}

document.addEventListener('click', (e) => {
  const m = document.getElementById('levels-edit-modal')
  if (m && e.target === m) closeLevelModal()
})

// ── Level Roles tab ──────────────────────────────────────────────────────────

async function loadLevelRoles() {
  const tbody = document.querySelector('#levelroles-table tbody')
  if (!tbody) return
  tbody.innerHTML =
    '<tr><td colspan="4" style="text-align:center;color:#64748b;padding:1.5rem;">Loading…</td></tr>'
  try {
    const r = await window.apiClient.getLevelRoles()
    if (!r.ok) throw new Error(r.error)
    _levelRolesData = r.data || []
    _levelsGuildId = r.guildId || _levelsGuildId
    renderLevelRolesTable(_levelRolesData)
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="4" style="color:#f87171;padding:1rem;">${e.message}</td></tr>`
  }
}

function renderLevelRolesTable(data) {
  const tbody = document.querySelector('#levelroles-table tbody')
  if (!tbody) return
  if (!data.length) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:#64748b;padding:1.5rem;">
      No level role rewards yet. Click <strong>+ Add Reward</strong> to assign a role when members reach a level.
    </td></tr>`
    return
  }
  tbody.innerHTML = data
    .map(
      (r) => `
    <tr>
      <td style="text-align:center;font-weight:700;color:#60a5fa;font-size:20px;">Lv.${r.level}</td>
      <td>
        <span style="display:inline-block;background:rgba(167,139,250,0.15);border:1px solid rgba(167,139,250,0.3);
          border-radius:12px;padding:3px 10px;font-size:13px;color:#a78bfa;">${escapeHtml(r.roleName)}</span>
        <br><code style="font-size:10px;color:#475569;">${escapeHtml(r.roleId)}</code>
      </td>
      <td style="color:#64748b;font-size:12px;">Members reaching level ${r.level} automatically get this role</td>
      <td>
        <button class="btn btn-sm" onclick="deleteLevelRole(${r.level}, '${escapeAttr(r.roleName)}')"
          style="color:#f87171;border-color:rgba(248,113,113,0.3);background:rgba(248,113,113,0.08);">Remove</button>
      </td>
    </tr>`,
    )
    .join('')
}

function injectLevelRolesModal() {
  if (document.getElementById('levelroles-modal')) return
  const modal = document.createElement('div')
  modal.id = 'levelroles-modal'
  modal.style.cssText =
    'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;align-items:center;justify-content:center;'
  modal.innerHTML = `
    <div style="background:#0f1228;border:1px solid rgba(167,139,250,0.25);border-radius:12px;padding:1.75rem;width:400px;max-width:95vw;box-shadow:0 20px 60px rgba(0,0,0,0.5);">
      <h3 style="margin:0 0 1.25rem;color:#e2e8f0;font-size:15px;">Add Level Role Reward</h3>
      <label style="display:flex;flex-direction:column;gap:4px;margin-bottom:1rem;">
        <span style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;">Level (when to award)</span>
        <input id="lr-level" type="number" min="1" placeholder="e.g. 5"
          style="background:rgba(15,18,40,0.8);border:1px solid rgba(167,139,250,0.25);color:#e2e8f0;padding:0.5rem 0.65rem;border-radius:6px;font-size:14px;width:100%;box-sizing:border-box;" />
      </label>
      <label style="display:flex;flex-direction:column;gap:4px;margin-bottom:1.25rem;">
        <span style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;">Role ID</span>
        <input id="lr-roleid" type="text" placeholder="Paste Discord role ID"
          style="background:rgba(15,18,40,0.8);border:1px solid rgba(167,139,250,0.25);color:#e2e8f0;padding:0.5rem 0.65rem;border-radius:6px;font-size:14px;width:100%;box-sizing:border-box;" />
        <span style="font-size:10px;color:#475569;">Right-click role in Discord → Copy ID (requires Developer Mode)</span>
      </label>
      <div id="lr-error" style="display:none;background:rgba(248,113,113,0.1);border:1px solid rgba(248,113,113,0.3);border-radius:6px;padding:0.5rem 0.75rem;font-size:12px;color:#f87171;margin-bottom:1rem;"></div>
      <div style="display:flex;gap:0.75rem;justify-content:flex-end;">
        <button class="btn" onclick="closeLevelRolesModal()" style="color:#64748b;border-color:rgba(100,116,139,0.3);">Cancel</button>
        <button class="btn" id="lr-save" onclick="saveLevelRole()"
          style="background:rgba(167,139,250,0.15);border-color:rgba(167,139,250,0.4);color:#a78bfa;">Add Reward</button>
      </div>
    </div>`
  document.body.appendChild(modal)
  document.addEventListener('click', (e) => {
    if (e.target === modal) closeLevelRolesModal()
  })
}

window.openAddLevelRole = () => {
  document.getElementById('lr-level').value = ''
  document.getElementById('lr-roleid').value = ''
  document.getElementById('lr-error').style.display = 'none'
  document.getElementById('levelroles-modal').style.display = 'flex'
}

window.closeLevelRolesModal = () => {
  document.getElementById('levelroles-modal').style.display = 'none'
}

window.saveLevelRole = async () => {
  const level = parseInt(document.getElementById('lr-level').value, 10)
  const roleId = document.getElementById('lr-roleid').value.trim()
  const errEl = document.getElementById('lr-error')
  if (isNaN(level) || level < 1) {
    showErr('Enter a valid level (1 or higher).')
    return
  }
  if (!roleId) {
    showErr('Role ID is required.')
    return
  }
  if (!_levelsGuildId) {
    showErr('Guild ID not loaded yet, try refreshing.')
    return
  }

  const btn = document.getElementById('lr-save')
  btn.textContent = 'Adding…'
  btn.disabled = true
  errEl.style.display = 'none'
  try {
    const r = await window.apiClient.setLevelRole(_levelsGuildId, level, roleId)
    if (!r.ok) throw new Error(r.error)
    showToast(`Level ${level} role reward added`, 'success')
    closeLevelRolesModal()
    await loadLevelRoles()
  } catch (e) {
    showErr(e.message)
  } finally {
    btn.textContent = 'Add Reward'
    btn.disabled = false
  }

  function showErr(msg) {
    errEl.textContent = msg
    errEl.style.display = 'block'
  }
}

window.deleteLevelRole = async (level, roleName) => {
  if (!confirm(`Remove the role reward for Level ${level} (${roleName})?`)) return
  if (!_levelsGuildId) {
    showToast('Guild ID not loaded', 'error')
    return
  }
  try {
    const r = await window.apiClient.removeLevelRole(_levelsGuildId, level)
    if (!r.ok) throw new Error(r.error)
    showToast(`Level ${level} reward removed`, 'success')
    await loadLevelRoles()
  } catch (e) {
    showToast('Error: ' + e.message, 'error')
  }
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
function escapeAttr(s) {
  return String(s ?? '')
    .replace(/'/g, '&apos;')
    .replace(/"/g, '&quot;')
}

window.initLevels = initLevels
window.loadLevelsData = loadLevelsData
window.showLevelsTab = showLevelsTab
