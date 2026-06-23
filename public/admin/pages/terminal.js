/**
 * Live Terminal Page
 * Polished, glassmorphic terminal log viewer for Nightz
 */

let terminalPollInterval = null
let terminalKind = 'out'
let terminalLines = 150
let terminalAutoScroll = true
let terminalFilterText = ''

async function initTerminal() {
  terminalKind = 'out'
  terminalLines = 150
  terminalAutoScroll = true
  terminalFilterText = ''

  setupTerminalControls()
  await refreshLogs()

  // Clear any existing interval
  if (terminalPollInterval) clearInterval(terminalPollInterval)

  // Set up polling (every 3 seconds) for a lively live feed
  terminalPollInterval = setInterval(async () => {
    // Only poll if the terminal page is currently visible
    const terminalPage = document.getElementById('page-terminal')
    if (terminalPage && terminalPage.style.display !== 'none') {
      await refreshLogs()
    } else {
      clearInterval(terminalPollInterval)
      terminalPollInterval = null
    }
  }, 3000)
}

function setupTerminalControls() {
  const container = document.getElementById('terminal-controls')
  if (!container) return

  container.innerHTML = `
    <div class="terminal-ctrl-group" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:15px;background:rgba(255,255,255,0.03);padding:10px;border-radius:8px;border:1px solid rgba(255,255,255,0.05);">
      <div style="display:flex;align-items:center;gap:6px;">
        <span style="font-size:11px;text-transform:uppercase;color:var(--text-tertiary);letter-spacing:0.05em;">Source:</span>
        <button class="btn btn-sm ${terminalKind === 'out' ? 'btn-active' : ''}" id="term-btn-out" onclick="setTerminalKind('out')" style="font-family:var(--font-mono);font-size:11px;">[STDOUT]</button>
        <button class="btn btn-sm ${terminalKind === 'err' ? 'btn-active' : ''}" id="term-btn-err" onclick="setTerminalKind('err')" style="font-family:var(--font-mono);font-size:11px;color:#f87171;border-color:rgba(248,113,113,0.3);">[STDERR]</button>
      </div>
      
      <div style="display:flex;align-items:center;gap:6px;margin-left:auto;">
        <span style="font-size:11px;text-transform:uppercase;color:var(--text-tertiary);letter-spacing:0.05em;">Lines:</span>
        <select id="term-lines-select" onchange="setTerminalLines(this.value)" style="background:#0a0e1f;border:1px solid rgba(255,255,255,0.1);color:#e2e8f0;padding:4px 8px;border-radius:4px;font-family:var(--font-mono);font-size:11px;cursor:pointer;">
          <option value="50" ${terminalLines === 50 ? 'selected' : ''}>50</option>
          <option value="150" ${terminalLines === 150 ? 'selected' : ''}>150</option>
          <option value="300" ${terminalLines === 300 ? 'selected' : ''}>300</option>
          <option value="500" ${terminalLines === 500 ? 'selected' : ''}>500</option>
        </select>
      </div>
      
      <div style="display:flex;align-items:center;gap:6px;">
        <span style="font-size:11px;text-transform:uppercase;color:var(--text-tertiary);letter-spacing:0.05em;">Filter:</span>
        <input type="text" id="term-filter" placeholder="Filter logs..." oninput="setTerminalFilter(this.value)" 
          style="background:#0a0e1f;border:1px solid rgba(255,255,255,0.1);color:#e2e8f0;padding:4px 8px;border-radius:4px;font-family:var(--font-mono);font-size:11px;width:150px;">
      </div>
      
      <div style="display:flex;align-items:center;gap:10px;">
        <label style="display:inline-flex;align-items:center;gap:6px;font-size:11px;color:var(--text-secondary);cursor:pointer;user-select:none;">
          <input type="checkbox" id="term-autoscroll" ${terminalAutoScroll ? 'checked' : ''} onchange="setTerminalAutoScroll(this.checked)" style="accent-color:var(--accent);">
          Auto-Scroll
        </label>
        
        <button class="btn btn-sm" onclick="clearTerminalScreen()" style="font-size:11px;">[CLEAR]</button>
      </div>
    </div>
  `
}

window.setTerminalKind = (kind) => {
  terminalKind = kind
  document.getElementById('term-btn-out')?.classList.toggle('btn-active', kind === 'out')
  document.getElementById('term-btn-err')?.classList.toggle('btn-active', kind === 'err')
  refreshLogs()
}

window.setTerminalLines = (val) => {
  terminalLines = parseInt(val, 10)
  refreshLogs()
}

window.setTerminalFilter = (val) => {
  terminalFilterText = val.toLowerCase().trim()
  renderLogs(window.lastLogsContent || '')
}

window.setTerminalAutoScroll = (checked) => {
  terminalAutoScroll = checked
}

window.clearTerminalScreen = () => {
  const display = document.getElementById('terminal-display')
  if (display) display.innerHTML = `<span style="color:#64748b;">[CONSOLE CLEARED]</span>\n`
}

async function refreshLogs() {
  try {
    const res = await window.apiClient.get(`/api/logs?kind=${terminalKind}&lines=${terminalLines}`)
    if (res && res.ok) {
      window.lastLogsContent = res.content
      renderLogs(res.content)
    } else {
      showTerminalError(res?.error || 'Unknown error retrieving logs')
    }
  } catch (e) {
    showTerminalError(e.message)
  }
}

function renderLogs(rawText) {
  const display = document.getElementById('terminal-display')
  if (!display) return

  if (!rawText || !rawText.trim()) {
    display.innerHTML = `<span style="color:#64748b;">[NO LOG ENTRIES FOUND]</span>\n`
    return
  }

  let lines = rawText.split('\n')

  // Apply filter if any
  if (terminalFilterText) {
    lines = lines.filter((line) => line.toLowerCase().includes(terminalFilterText))
  }

  if (lines.length === 0) {
    display.innerHTML = `<span style="color:#64748b;">[NO MATCHING LOGS FOR "${terminalFilterText.toUpperCase()}"]</span>\n`
    return
  }

  // Format log lines beautifully with simple patterns
  const formattedHtml = lines
    .map((line) => {
      // Escape HTML first
      let escaped = window.esc(line)

      // Highlight bracket tags
      escaped = escaped.replace(
        /(\[SUCCESS\])/g,
        '<span style="color:#4ade80;font-weight:700;">$1</span>',
      )
      escaped = escaped.replace(
        /(\[ERROR\]|\[WARN-ND-\d+\])/g,
        '<span style="color:#f87171;font-weight:700;">$1</span>',
      )
      escaped = escaped.replace(/(\[INFO\])/g, '<span style="color:#60a5fa;">$1</span>')
      escaped = escaped.replace(/(\[WARN\])/g, '<span style="color:#fbbf24;">$1</span>')
      escaped = escaped.replace(/(\[DEBUG\])/g, '<span style="color:#a78bfa;">$1</span>')
      escaped = escaped.replace(
        /(ERR-\w+-\d+)/g,
        '<span style="color:#ef4444;font-weight:700;">$1</span>',
      )
      escaped = escaped.replace(
        /(Nightz)/g,
        '<span style="color:#f472b6;font-weight:700;">$1</span>',
      )

      // Color timestamps (e.g. 2026-05-22 05:25:44)
      escaped = escaped.replace(
        /^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[+-]\d{2}:?\d{2}|Z)?)/g,
        '<span style="color:#64748b;">$1</span>',
      )

      return `<div class="terminal-line">${escaped}</div>`
    })
    .join('')

  display.innerHTML = formattedHtml

  if (terminalAutoScroll) {
    display.scrollTop = display.scrollHeight
  }
}

function showTerminalError(msg) {
  const display = document.getElementById('terminal-display')
  if (display) {
    display.innerHTML = `<div style="color:#ef4444;font-weight:bold;">[ERROR-RETRIEVING-LOGS] ${window.esc(msg)}</div>`
  }
}

window.initTerminal = initTerminal
