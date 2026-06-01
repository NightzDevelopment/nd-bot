/**
 * Configuration Page
 * Full v1-compatible config editor + data files + logs + health status
 */

let _cfgData = {}
let _cfgDirty = false
let _cfgInitDone = false
let _cfgActiveTab = null // currently selected manifest tab (null = first)
let _cfgExpanded = null // Set<categoryKey> tracking expanded categories

/**
 * Manifest tabs grouped into top-level categories.
 * Any tab not listed here lands in __orphan__ which is shown flat at the bottom.
 */
const CATEGORY_GROUPS = [
  {
    key: 'core',
    label: 'Core',
    icon: '⚙',
    tabs: ['General', 'API keys and models', 'Dashboard', 'Data and DMs', 'Feature tier'],
  },
  {
    key: 'ai',
    label: 'AI',
    icon: '✦',
    tabs: ['AI behavior', 'AI AutoMod', 'Context and keywords', 'Codebase'],
  },
  {
    key: 'mod',
    label: 'Moderation',
    icon: '◈',
    tabs: [
      'Moderation',
      'Security',
      'Rule AutoMod',
      'Raid',
      'URL risk',
      'Profile scan',
      'Traffic Control',
      'User reports',
    ],
  },
  {
    key: 'comm',
    label: 'Community',
    icon: '◇',
    tabs: [
      'Community',
      'Community+',
      'Welcome and mod',
      'Tickets',
      'Polls',
      'Staff and feedback',
      'Temp VC',
    ],
  },
  {
    key: 'ops',
    label: 'Operations',
    icon: '⊡',
    tabs: ['Content and product', 'Logs and audit', 'Automation'],
  },
]
function findCategoryFor(tabName) {
  for (const c of CATEGORY_GROUPS) if (c.tabs.includes(tabName)) return c.key
  return '__orphan__'
}

async function initConfiguration() {
  if (_cfgInitDone) return // already wired up
  _cfgInitDone = true

  // Restore expanded categories from localStorage
  try {
    const saved = localStorage.getItem('cfgExpandedCategories')
    _cfgExpanded = new Set(saved ? JSON.parse(saved) : ['core'])
  } catch {
    _cfgExpanded = new Set(['core'])
  }

  setupCfgTabs()
  setupDataFileEditor()
  setupLogViewer()
  setupRequestLog()
  setupHealthRefresh()
  await loadConfig()
  refreshBotStatePill()
  // Refresh state pill periodically
  setInterval(refreshBotStatePill, 10000)
}

function persistExpanded() {
  try {
    localStorage.setItem('cfgExpandedCategories', JSON.stringify([..._cfgExpanded]))
  } catch {}
}

// ── Tab switching ─────────────────────────────────────────────────────────────
function setupCfgTabs() {
  document.querySelectorAll('[data-ctab]').forEach((btn) => {
    btn.addEventListener('click', () => switchCfgTab(btn.getAttribute('data-ctab')))
  })
}

function switchCfgTab(name) {
  document.querySelectorAll('[data-ctab]').forEach((b) => b.classList.remove('active'))
  document.querySelectorAll('.config-tab-content').forEach((c) => c.classList.remove('active'))
  const btn = document.querySelector(`[data-ctab="${name}"]`)
  const pane = document.getElementById(`ctab-${name}`)
  if (btn) btn.classList.add('active')
  if (pane) pane.classList.add('active')

  if (name === 'health') refreshHealth()
}

// ── Bot Config ────────────────────────────────────────────────────────────────
async function loadConfig() {
  const container = document.getElementById('config-fields')
  if (!container) return
  container.innerHTML = '<p style="color:var(--text-secondary)">Loading…</p>'

  try {
    _cfgData = await window.apiClient.get('/api/config')
    renderConfigFields()
    setupCfgSearch()
  } catch (e) {
    container.innerHTML = `<p style="color:var(--error)">Failed to load config: ${e.message}</p>`
  }
}

// ── Sentinel performance/validation hints for sensitive RAG fields ──
const PERFORMANCE_HINTS = {
  EMBEDDING_MAX_CHUNK_CHARS: {
    tip: 'Higher = fewer, larger chunks. Lower = more precise retrieval but slower indexing. Recommended: 800–1500.',
    validate: (v) => {
      const n = parseInt(v, 10)
      if (Number.isNaN(n)) return null
      if (n < 200) return { level: 'error', msg: 'Minimum 200 chars enforced by RAG pipeline.' }
      if (n > 4000)
        return { level: 'warning', msg: 'Very large chunks reduce retrieval precision.' }
      return null
    },
  },
  EMBEDDING_MAX_CORPUS_CHUNKS: {
    tip: 'Caps total memory footprint. Each chunk ~6KB. 10k chunks ≈ 60MB RAM.',
    validate: (v) => {
      const n = parseInt(v, 10)
      if (Number.isNaN(n)) return null
      if (n > 50000)
        return { level: 'warning', msg: 'Above 50k chunks may slow startup significantly.' }
      return null
    },
  },
  EMBEDDING_REFRESH_MINUTES: {
    tip: 'How often the corpus is re-indexed. Lower = fresher data, higher API cost.',
  },
  EMBEDDING_MODEL: {
    tip: 'Google embedding model. text-embedding-004 is current generation.',
  },
  ACTIVE_CONVERSATION_MS: {
    tip: 'Window after which a channel returns to passive monitoring. 60–300s typical.',
  },
  HEATED_SLOWMODE_COOLDOWN_MS: {
    tip: 'Re-arm window for the heated-channel detector. Keep ≥ 60s to avoid flicker.',
  },
}

function renderConfigFields(filter) {
  const container = document.getElementById('config-fields')
  const tabnav = document.getElementById('cfg-tabnav')
  if (!container) return

  const fields = _cfgData.manifest || []
  const values = _cfgData.values || {}
  const q = (filter || '').toLowerCase()
  const isSearching = q.length > 0

  const filtered = isSearching
    ? fields.filter(
        (f) =>
          f.key.toLowerCase().includes(q) ||
          (f.label || '').toLowerCase().includes(q) ||
          (f.tab || '').toLowerCase().includes(q) ||
          (f.description || '').toLowerCase().includes(q),
      )
    : fields

  // Build per-tab buckets (always from full manifest for the rail counts)
  const allTabs = {}
  for (const f of fields) {
    const t = f.tab || 'General'
    if (!allTabs[t]) allTabs[t] = []
    allTabs[t].push(f)
  }
  const tabNames = Object.keys(allTabs).sort((a, b) => {
    // Pin General first, alphabetize the rest
    if (a === 'General') return -1
    if (b === 'General') return 1
    return a.localeCompare(b)
  })

  // Render grouped tab rail
  if (tabnav) {
    const activeTabName = _cfgActiveTab || tabNames[0]
    const activeCat = findCategoryFor(activeTabName)
    // Always expand the category that holds the active tab
    if (activeCat && activeCat !== '__orphan__') _cfgExpanded.add(activeCat)

    const tabsByCat = {}
    for (const t of tabNames) {
      const cat = findCategoryFor(t)
      if (!tabsByCat[cat]) tabsByCat[cat] = []
      tabsByCat[cat].push(t)
    }

    const countFor = (t) =>
      isSearching ? filtered.filter((f) => (f.tab || 'General') === t).length : allTabs[t].length

    const renderCat = (group) => {
      const tabs = tabsByCat[group.key] || []
      if (tabs.length === 0) return ''
      const isExpanded = _cfgExpanded.has(group.key) || isSearching
      const totalCount = tabs.reduce((sum, t) => sum + countFor(t), 0)
      const visibleMatchCount = isSearching ? totalCount : null
      const dim = isSearching && totalCount === 0 ? 'opacity:.4;' : ''
      const arrow = isExpanded ? '▾' : '▸'

      const childrenHtml = isExpanded
        ? tabs
            .map((t) => {
              const c = countFor(t)
              const isActive = !isSearching && activeTabName === t
              const tabDim = isSearching && c === 0 ? 'opacity:.4;' : ''
              return `<button class="cfg-tab cfg-tab--child${isActive ? ' active' : ''}" data-tab="${escapeHtml(t)}" style="${tabDim}">
              <span>${escapeHtml(t)}</span>
              <span class="cfg-tab-count">${c}</span>
            </button>`
            })
            .join('')
        : ''

      return `
        <div class="cfg-category" style="${dim}">
          <button class="cfg-cat-header" data-cat="${group.key}">
            <span class="cfg-cat-arrow">${arrow}</span>
            <span class="cfg-cat-icon">${group.icon}</span>
            <span class="cfg-cat-label">${escapeHtml(group.label)}</span>
            ${visibleMatchCount !== null ? `<span class="cfg-tab-count">${visibleMatchCount}</span>` : ''}
          </button>
          <div class="cfg-cat-children">${childrenHtml}</div>
        </div>`
    }

    let html = CATEGORY_GROUPS.map(renderCat).join('')
    // Render any orphan tabs (manifest tabs not assigned to a group) flat
    if (tabsByCat['__orphan__']?.length) {
      html +=
        '<div style="margin-top:0.75rem;border-top:1px solid var(--border);padding-top:0.5rem;">'
      html += tabsByCat['__orphan__']
        .map((t) => {
          const c = countFor(t)
          const isActive = !isSearching && activeTabName === t
          return `<button class="cfg-tab${isActive ? ' active' : ''}" data-tab="${escapeHtml(t)}">
          <span>${escapeHtml(t)}</span>
          <span class="cfg-tab-count">${c}</span>
        </button>`
        })
        .join('')
      html += '</div>'
    }
    tabnav.innerHTML = html

    // Wire tab clicks
    tabnav.querySelectorAll('[data-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        _cfgActiveTab = btn.getAttribute('data-tab')
        const search = document.getElementById('cfg-search')
        if (search) search.value = ''
        renderConfigFields('')
      })
    })
    // Wire category collapse toggles
    tabnav.querySelectorAll('.cfg-cat-header').forEach((btn) => {
      btn.addEventListener('click', () => {
        const cat = btn.getAttribute('data-cat')
        if (_cfgExpanded.has(cat)) _cfgExpanded.delete(cat)
        else _cfgExpanded.add(cat)
        persistExpanded()
        renderConfigFields(document.getElementById('cfg-search')?.value || '')
      })
    })
  }

  // Decide what to show in the field area
  let visible
  if (isSearching) {
    visible = filtered
  } else {
    const active = _cfgActiveTab && allTabs[_cfgActiveTab] ? _cfgActiveTab : tabNames[0]
    _cfgActiveTab = active
    visible = allTabs[active] || []
  }

  if (visible.length === 0) {
    container.innerHTML =
      '<p style="color:var(--text-secondary);padding:1rem 0;">No fields match.</p>'
    return
  }

  // Group displayed fields by tab (when searching, may span tabs; when not, one tab only)
  const sections = {}
  for (const f of visible) {
    const sec = f.tab || 'General'
    if (!sections[sec]) sections[sec] = []
    sections[sec].push(f)
  }

  // Render using old-style .field cards from styles.css
  container.innerHTML = Object.entries(sections)
    .map(
      ([sec, fs]) => `
    <div class="scalar-deck-outer">
      ${isSearching || Object.keys(sections).length > 1 ? `<div style="padding:12px 0 6px;font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--text-muted);">${escapeHtml(sec)}</div>` : ''}
      <div class="scalar-deck">
        ${fs
          .map((f) => {
            const raw = values[f.key] ?? ''
            const isSensitive = f.sensitive
            const displayVal = isSensitive && raw === '***' ? '' : raw
            const needsRestart = f.requiresRestart || f.restartRequired
            const cardClass = needsRestart ? 'field field--needs-restart' : 'field'
            const perf = PERFORMANCE_HINTS[f.key]
            const perfBadge = perf?.tip
              ? `<span class="badge-perf" data-tip="${escapeHtml(perf.tip)}" title="${escapeHtml(perf.tip)}">⚡ perf</span>`
              : ''
            return `
            <div class="${cardClass}" data-field-key="${f.key}">
              <div class="field-header">
                <div class="field-title">${escapeHtml(f.label || f.key)}</div>
                <div class="field-badges">
                  ${isSensitive ? '<span class="pill sensitive">sensitive</span>' : ''}
                  ${perfBadge}
                  ${needsRestart ? '<span class="badge-restart" title="Sentinel must be restarted for this change to take effect">⚡ restart</span>' : ''}
                </div>
              </div>
              ${f.description ? `<p class="field-help">${escapeHtml(f.description)}</p>` : ''}
              <div class="field-keyline">
                <code>${escapeHtml(f.key)}</code>
                <button class="btn-copy btn-copy--tight" onclick="copyEnvKey('${escapeHtml(f.key)}','${escapeHtml(displayVal)}')" title="Copy KEY=value">copy</button>
              </div>
              <div class="field-control">
                <input
                  id="cfg-${f.key}"
                  data-key="${f.key}"
                  type="${isSensitive ? 'password' : 'text'}"
                  value="${escapeHtml(displayVal)}"
                  placeholder="${escapeHtml(f.placeholder || (isSensitive ? '(leave blank to keep current)' : ''))}"
                  autocomplete="off"
                />
                <div class="field-validation" id="val-${f.key}"></div>
              </div>
            </div>`
          })
          .join('')}
      </div>
    </div>`,
    )
    .join('')

  container.querySelectorAll('.field-control input').forEach((inp) => {
    inp.addEventListener('input', (e) => {
      cfgMarkDirty()
      runValidation(e.target)
    })
    runValidation(inp)
  })
}

function runValidation(inp) {
  const key = inp.getAttribute('data-key')
  const valEl = document.getElementById(`val-${key}`)
  if (!valEl) return
  const hint = PERFORMANCE_HINTS[key]
  if (!hint?.validate || inp.value === '') {
    valEl.innerHTML = ''
    return
  }
  const result = hint.validate(inp.value)
  if (!result) {
    valEl.innerHTML = ''
    return
  }
  const color = result.level === 'error' ? 'var(--error)' : 'var(--warning)'
  const icon = result.level === 'error' ? '✗' : '⚠'
  valEl.innerHTML = `<div style="margin-top:6px;font-size:11px;color:${color};">${icon} ${escapeHtml(result.msg)}</div>`
}

function copyEnvKey(key, value) {
  const text = value ? `${key}=${value}` : key
  navigator.clipboard.writeText(text).then(() => {
    showToast(`Copied ${key}`, 'success')
  })
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function cfgMarkDirty() {
  _cfgDirty = true
  const btn = document.getElementById('cfg-save-btn')
  if (btn) {
    btn.disabled = false
    btn.textContent = 'Save Changes*'
  }
  const msg = document.getElementById('cfg-status-msg')
  if (msg) msg.textContent = 'Unsaved changes'
}

function setupCfgSearch() {
  const inp = document.getElementById('cfg-search')
  if (!inp) return
  inp.addEventListener('input', () => renderConfigFields(inp.value))
}

window.cfgSave = async () => {
  const btn = document.getElementById('cfg-save-btn')
  const msg = document.getElementById('cfg-status-msg')
  if (btn) btn.disabled = true
  if (msg) msg.textContent = 'Saving…'

  const patch = {}
  document.querySelectorAll('.field-control input[data-key]').forEach((inp) => {
    const key = inp.getAttribute('data-key')
    if (key && inp.value !== '') patch[key] = inp.value
  })

  try {
    const result = await window.apiClient.put('/api/config', patch)
    if (result.ok) {
      showToast('Configuration saved', 'success')
      if (msg) msg.textContent = 'Saved ✓'
      _cfgDirty = false
      if (btn) btn.textContent = 'Save Changes'
      // reload to get masked values
      _cfgData = await window.apiClient.get('/api/config')
      const search = document.getElementById('cfg-search')
      renderConfigFields(search?.value)
    } else {
      showToast(
        'Save failed: ' + (result.errors ? JSON.stringify(result.errors) : result.error),
        'error',
      )
      if (msg) msg.textContent = 'Save failed'
      if (btn) btn.disabled = false
    }
  } catch (e) {
    showToast('Save error: ' + e.message, 'error')
    if (msg) msg.textContent = 'Error'
    if (btn) btn.disabled = false
  }
}

window.cfgRestart = async () => {
  if (!confirm('Restart the bot process now?')) return
  try {
    const result = await window.apiClient.restartBot()
    showToast(
      result.ok ? result.message : 'Restart error: ' + result.error,
      result.ok ? 'success' : 'error',
    )
  } catch (e) {
    showToast('Restart error: ' + e.message, 'error')
  }
}

window.cfgStop = async () => {
  if (!confirm('Pause the bot? Discord events will be ignored until resumed.')) return
  try {
    const r = await window.apiClient.pauseBot()
    showToast(r.ok ? r.message : 'Stop error: ' + r.error, r.ok ? 'success' : 'error')
    refreshBotStatePill()
  } catch (e) {
    showToast('Stop error: ' + e.message, 'error')
  }
}

window.cfgStart = async () => {
  try {
    const r = await window.apiClient.resumeBot()
    showToast(r.ok ? r.message : 'Start error: ' + r.error, r.ok ? 'success' : 'error')
    refreshBotStatePill()
  } catch (e) {
    showToast('Start error: ' + e.message, 'error')
  }
}

async function refreshBotStatePill() {
  try {
    const s = await window.apiClient.getBotState()
    const pill = document.getElementById('cfg-bot-state')
    const stopBtn = document.getElementById('cfg-stop-btn')
    const startBtn = document.getElementById('cfg-start-btn')
    if (!pill) return
    if (s.paused) {
      pill.textContent = 'PAUSED'
      pill.className = 'cfg-state-pill cfg-state-pill--paused'
      if (stopBtn) stopBtn.disabled = true
      if (startBtn) startBtn.disabled = false
    } else {
      pill.textContent = 'RUNNING'
      pill.className = 'cfg-state-pill cfg-state-pill--running'
      if (stopBtn) stopBtn.disabled = false
      if (startBtn) startBtn.disabled = true
    }
  } catch {
    /* ignore */
  }
}

// ── Data File Editor ──────────────────────────────────────────────────────────
function setupDataFileEditor() {
  const loadBtn = document.getElementById('data-load-btn')
  const saveBtn = document.getElementById('data-save-btn')
  const editor = document.getElementById('data-json-editor')
  const valid = document.getElementById('data-validity')

  if (editor) {
    editor.addEventListener('input', () => {
      try {
        JSON.parse(editor.value)
        if (valid) valid.textContent = '✓ valid JSON'
      } catch {
        if (valid) valid.textContent = '✗ invalid JSON'
      }
    })
  }

  if (loadBtn) {
    loadBtn.addEventListener('click', async () => {
      const file = document.getElementById('data-file-select')?.value
      if (!file) return
      try {
        const result = await window.apiClient.get(`/api/data/${file}`)
        if (editor) editor.value = JSON.stringify(result, null, 2)
        if (valid) valid.textContent = '✓ loaded'
        showToast(`Loaded ${file}.json`, 'success')
      } catch (e) {
        showToast('Load error: ' + e.message, 'error')
      }
    })
  }

  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const file = document.getElementById('data-file-select')?.value
      if (!file || !editor?.value) {
        showToast('Load a file first', 'warning')
        return
      }
      let data
      try {
        data = JSON.parse(editor.value)
      } catch {
        showToast('Invalid JSON — fix before saving', 'error')
        return
      }
      try {
        const result = await window.apiClient.put(`/api/data/${file}`, data)
        if (result.ok) showToast(`Saved ${file}.json`, 'success')
        else showToast('Save error: ' + result.error, 'error')
      } catch (e) {
        showToast('Save error: ' + e.message, 'error')
      }
    })
  }
}

// ── Log Viewer ────────────────────────────────────────────────────────────────
function setupLogViewer() {
  const fetchBtn = document.getElementById('log-fetch-btn')
  if (!fetchBtn) return
  fetchBtn.addEventListener('click', async () => {
    const kind = document.getElementById('log-kind-select')?.value || 'out'
    const lines = document.getElementById('log-lines-select')?.value || '100'
    try {
      const result = await window.apiClient.get(`/api/logs?kind=${kind}&lines=${lines}`)
      const ta = document.getElementById('log-tail-text')
      if (ta)
        ta.value = result.ok ? result.content : `Error: ${result.error || result.hint || 'unknown'}`
    } catch (e) {
      showToast('Log error: ' + e.message, 'error')
    }
  })
}

// ── Request Log ──────────────────────────────────────────────────────────────
let _reqLogData = []

function setupRequestLog() {
  const refresh = document.getElementById('reqlog-refresh-btn')
  const clear = document.getElementById('reqlog-clear-btn')
  const search = document.getElementById('reqlog-search')
  const filter = document.getElementById('reqlog-status-filter')
  if (!refresh) return

  const load = async () => {
    try {
      const r = await window.apiClient.getRequestLog(500)
      if (!r.ok) return
      _reqLogData = r.data || []
      renderRequestLog()
    } catch (e) {
      console.error('reqlog error', e)
    }
  }

  refresh.addEventListener('click', load)

  clear.addEventListener('click', async () => {
    if (!confirm('Clear the in-memory request log?')) return
    try {
      await window.apiClient.clearRequestLog()
      _reqLogData = []
      renderRequestLog()
    } catch (e) {
      showToast('Clear failed: ' + e.message, 'error')
    }
  })

  const rerender = () => renderRequestLog()
  search.addEventListener('input', rerender)
  filter.addEventListener('change', rerender)

  // Auto-load when logs tab is opened
  document.querySelectorAll('.config-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.ctab === 'logs') load()
    })
  })
}

function renderRequestLog() {
  const tbody = document.getElementById('reqlog-body')
  if (!tbody) return

  const q = document.getElementById('reqlog-search')?.value?.toLowerCase() || ''
  const sf = document.getElementById('reqlog-status-filter')?.value || ''

  const filtered = _reqLogData.filter((e) => {
    if (sf && !String(e.status).startsWith(sf)) return false
    if (
      q &&
      !(
        (e.path || '').toLowerCase().includes(q) ||
        (e.ip || '').toLowerCase().includes(q) ||
        (e.user || '').toLowerCase().includes(q) ||
        (e.method || '').toLowerCase().includes(q)
      )
    )
      return false
    return true
  })

  const countEl = document.getElementById('reqlog-count')
  if (countEl) countEl.textContent = `${filtered.length} entries`

  if (!filtered.length) {
    tbody.innerHTML =
      '<tr><td colspan="7" style="text-align:center;color:var(--text-secondary);padding:1.5rem;">No entries match.</td></tr>'
    return
  }

  tbody.innerHTML = filtered
    .map((e) => {
      const statusColor =
        e.status >= 500
          ? '#f87171'
          : e.status >= 400
            ? '#fbbf24'
            : e.status >= 300
              ? '#94a3b8'
              : '#34d399'
      const time = new Date(e.at).toLocaleTimeString()
      const dur = e.durationMs < 1000 ? `${e.durationMs}ms` : `${(e.durationMs / 1000).toFixed(1)}s`
      const method = e.method || '?'
      const methodColor =
        method === 'GET'
          ? '#60a5fa'
          : method === 'POST'
            ? '#34d399'
            : method === 'DELETE'
              ? '#f87171'
              : '#94a3b8'
      return `<tr>
      <td style="white-space:nowrap;color:var(--text-secondary);">${time}</td>
      <td style="color:${methodColor};font-weight:600;">${escRl(method)}</td>
      <td style="color:${statusColor};font-weight:700;">${e.status}</td>
      <td style="max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escRl(e.path)}">${escRl(e.path)}</td>
      <td style="color:var(--text-secondary);">${dur}</td>
      <td style="color:var(--text-tertiary);">${escRl(e.ip || '—')}</td>
      <td style="color:var(--text-tertiary);">${escRl(e.user || '—')}</td>
    </tr>`
    })
    .join('')
}

function escRl(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// ── Health ────────────────────────────────────────────────────────────────────
async function refreshHealth() {
  try {
    const h = await window.apiClient.get('/api/health')
    const set = (id, val) => {
      const el = document.getElementById(id)
      if (el) el.textContent = val
    }
    set('h-discord', h.discord || '—')
    set('h-uptime', h.uptimeSec != null ? fmtUptime(h.uptimeSec) : '—')
    set('h-version', h.botVersion || '—')
    set('h-ping', h.discordWsPingMs != null ? h.discordWsPingMs + ' ms' : '—')
    set('h-guilds', h.discordGuildCount ?? '—')
    set('h-pid', h.processPid ?? '—')
  } catch (e) {
    console.warn('Health fetch failed:', e)
  }
}

function setupHealthRefresh() {
  setInterval(() => {
    const pane = document.getElementById('ctab-health')
    if (pane && pane.classList.contains('active')) refreshHealth()
  }, 10000)
}

function fmtUptime(sec) {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m ${s}s`
}

window.initConfiguration = initConfiguration
