/**
 * Dashboard App
 * Main application router and initialization
 */

const PAGES = {
  dashboard: { title: 'Command', selector: '#page-dashboard' },
  analytics: { title: 'Telemetry', selector: '#page-analytics' },
  members: { title: 'Members', selector: '#page-members' },
  moderation: { title: 'Enforcement', selector: '#page-moderation' },
  commands: { title: 'Commands', selector: '#page-commands' },
  tickets: { title: 'Tickets', selector: '#page-tickets' },
  policies: { title: 'Rules & Policies', selector: '#page-policies' },
  levels: { title: 'Levels', selector: '#page-levels' },
  economy: { title: 'Economy', selector: '#page-economy' },
  shop: { title: 'Shop', selector: '#page-shop' },
  counters: { title: 'Counters', selector: '#page-counters' },
  suggestions: { title: 'Suggestions', selector: '#page-suggestions' },
  giveaways: { title: 'Giveaways', selector: '#page-giveaways' },
  polls: { title: 'Polls', selector: '#page-polls' },
  scheduler: { title: 'Scheduler', selector: '#page-scheduler' },
  'audit-logs': { title: 'Audit Logs', selector: '#page-audit-logs' },
  terminal: { title: 'Terminal', selector: '#page-terminal' },
  'rag-manager': { title: 'RAG Manager', selector: '#page-rag-manager' },
  'db-editor': { title: 'Database Edit', selector: '#page-db-editor' },
  'theme-builder': { title: 'Theme Builder', selector: '#page-theme-builder' },
  configuration: { title: 'Configuration', selector: '#page-configuration' },
  settings: { title: 'Preferences', selector: '#page-settings' },
}

let currentPage = 'dashboard'
let currentGroup = null

// Merged nav: a "group" is one sidebar item that shows a tab bar to switch
// between several existing sub-pages (their markup + init logic are unchanged).
const GROUPS = {
  mod: {
    title: 'Moderation',
    tabs: [
      { id: 'members', label: 'Members' },
      { id: 'moderation', label: 'Enforcement' },
    ],
  },
  econ: {
    title: 'Economy',
    tabs: [
      { id: 'levels', label: 'Levels' },
      { id: 'economy', label: 'Economy' },
      { id: 'shop', label: 'Shop' },
    ],
  },
  community: {
    title: 'Community',
    tabs: [
      { id: 'suggestions', label: 'Suggestions' },
      { id: 'giveaways', label: 'Giveaways' },
      { id: 'polls', label: 'Polls' },
      { id: 'counters', label: 'Counters' },
    ],
  },
  tools: {
    title: 'Developer Tools',
    tabs: [
      { id: 'terminal', label: 'Terminal' },
      { id: 'rag-manager', label: 'RAG Manager' },
      { id: 'db-editor', label: 'Database' },
      { id: 'theme-builder', label: 'Theme' },
    ],
  },
  sys: {
    title: 'Settings',
    tabs: [
      { id: 'configuration', label: 'Configuration' },
      { id: 'settings', label: 'Preferences' },
    ],
  },
}

function ensureTabbar() {
  let bar = document.getElementById('group-tabbar')
  if (!bar) {
    bar = document.createElement('div')
    bar.id = 'group-tabbar'
    bar.className = 'group-tabbar'
    const content = document.querySelector('.dashboard-content')
    if (content) content.insertBefore(bar, content.firstChild)
  }
  return bar
}

function showGroup(groupKey, subId) {
  const group = GROUPS[groupKey]
  if (!group) return
  currentGroup = groupKey

  let saved = null
  try {
    saved = localStorage.getItem(`group-${groupKey}`)
  } catch {}
  const valid = (id) => group.tabs.some((t) => t.id === id)
  const sub = valid(subId) ? subId : valid(saved) ? saved : group.tabs[0].id
  try {
    localStorage.setItem(`group-${groupKey}`, sub)
  } catch {}

  // Tab bar
  const bar = ensureTabbar()
  bar.innerHTML = group.tabs
    .map((t) => `<button class="group-tab${t.id === sub ? ' active' : ''}" data-sub="${t.id}">${t.label}</button>`)
    .join('')
  bar.style.display = 'flex'
  bar.querySelectorAll('.group-tab').forEach((btn) => {
    btn.addEventListener('click', () => showGroup(groupKey, btn.dataset.sub))
  })

  // Show the active sub-page
  Object.keys(PAGES).forEach((name) => {
    const el = document.querySelector(PAGES[name].selector)
    if (el) el.style.display = 'none'
  })
  const pageElem = document.querySelector(PAGES[sub] ? PAGES[sub].selector : `#page-${sub}`)
  if (pageElem) pageElem.style.display = 'block'

  // Active nav = the group button
  document.querySelectorAll('.nav-link').forEach((l) => l.classList.remove('active'))
  const navBtn = document.querySelector(`[data-group="${groupKey}"]`)
  if (navBtn) navBtn.classList.add('active')

  const titleEl = document.getElementById('topbar-title')
  if (titleEl) titleEl.textContent = group.title

  try {
    localStorage.setItem('dashboardPage', `g:${groupKey}`)
  } catch {}
  if (window.location.hash !== `#${groupKey}`) {
    history.replaceState(null, '', `#${groupKey}`)
  }

  loadPageLogic(sub)
}

function showPage(pageName) {
  if (!PAGES[pageName]) return
  currentGroup = null
  const tabbar = document.getElementById('group-tabbar')
  if (tabbar) tabbar.style.display = 'none'

  // Hide all pages
  Object.keys(PAGES).forEach((name) => {
    const elem = document.querySelector(PAGES[name].selector)
    if (elem) elem.style.display = 'none'
  })

  // Show selected page
  const pageElem = document.querySelector(PAGES[pageName].selector)
  if (pageElem) pageElem.style.display = 'block'

  // Update active nav
  document.querySelectorAll('.nav-link').forEach((link) => {
    link.classList.remove('active')
  })
  const activeLink = document.querySelector(`[data-page="${pageName}"]`)
  if (activeLink) activeLink.classList.add('active')

  currentPage = pageName

  // Update topbar title
  const titleEl = document.getElementById('topbar-title')
  if (titleEl && PAGES[pageName]) titleEl.textContent = PAGES[pageName].title

  // Persist current page so refresh / back-button stay here
  try {
    localStorage.setItem('dashboardPage', pageName)
  } catch {}
  if (window.location.hash !== `#${pageName}`) {
    history.replaceState(null, '', `#${pageName}`)
  }

  // Load page-specific logic
  loadPageLogic(pageName)
}

function getInitialPage() {
  // 1) URL hash takes priority (page OR group)
  const hash = window.location.hash.replace('#', '')
  if (hash && (PAGES[hash] || GROUPS[hash])) return hash
  // 2) Then localStorage (groups stored as "g:<key>")
  try {
    const saved = localStorage.getItem('dashboardPage')
    if (saved) {
      if (saved.startsWith('g:') && GROUPS[saved.slice(2)]) return saved.slice(2)
      if (PAGES[saved]) return saved
    }
  } catch {}
  // 3) Default
  return 'dashboard'
}

// Dispatch a target to the right handler (group tab page vs single page).
function navigateTo(target) {
  if (GROUPS[target]) showGroup(target)
  else if (PAGES[target]) showPage(target)
  else showPage('dashboard')
}

async function loadPageLogic(pageName) {
  try {
    switch (pageName) {
      case 'dashboard':
        if (window.initDashboard) await window.initDashboard()
        break
      case 'analytics':
        if (window.initAnalytics) await window.initAnalytics()
        break
      case 'members':
        if (window.initMembers) await window.initMembers()
        break
      case 'moderation':
        if (window.initModeration) await window.initModeration()
        break
      case 'tickets':
        if (window.initTickets) await window.initTickets()
        break
      case 'policies':
        if (window.initPolicies) await window.initPolicies()
        break
      case 'levels':
        if (window.initLevels) await window.initLevels()
        break
      case 'economy':
        if (window.initEconomy) await window.initEconomy()
        break
      case 'shop':
        if (window.initShop) await window.initShop()
        break
      case 'counters':
        if (window.initCounters) await window.initCounters()
        break
      case 'suggestions':
        if (window.initSuggestions) await window.initSuggestions()
        break
      case 'giveaways':
        if (window.initGiveaways) await window.initGiveaways()
        break
      case 'polls':
        if (window.initPolls) await window.initPolls()
        break
      case 'scheduler':
        if (window.initScheduler) await window.initScheduler()
        break
      case 'commands':
        if (window.initCommands) await window.initCommands()
        break
      case 'configuration':
        if (window.initConfiguration) await window.initConfiguration()
        break
      case 'audit-logs':
        if (window.initAuditLogs) await window.initAuditLogs()
        break
      case 'terminal':
        if (window.initTerminal) await window.initTerminal()
        break
      case 'rag-manager':
        if (window.initRagManager) await window.initRagManager()
        break
      case 'db-editor':
        if (window.initDbEditor) await window.initDbEditor()
        break
      case 'theme-builder':
        if (window.initThemeBuilder) await window.initThemeBuilder()
        break
      case 'settings':
        if (window.initSettings) await window.initSettings()
        break
    }
  } catch (error) {
    console.error(`Error loading page logic for ${pageName}:`, error)
    showToast(`Error loading ${pageName}: ${error.message}`, 'error')
  }
}

function showToast(message, type = 'info') {
  const toastContainer = document.getElementById('toast-container')
  if (!toastContainer) return

  const tag =
    { info: 'NIGHTZ', success: 'NIGHTZ Done', warning: 'NIGHTZ Warning', error: 'NIGHTZ Error' }[type] ||
    'NIGHTZ'
  const toast = document.createElement('div')
  toast.className = `toast toast--${type}`
  toast.innerHTML = `<div style="font-size:9px;font-weight:700;letter-spacing:0.12em;color:var(--text-tertiary);margin-bottom:3px;">${tag}</div><div>${message}</div>`
  toastContainer.appendChild(toast)

  setTimeout(() => {
    toast.classList.add('toast--show')
  }, 10)

  setTimeout(() => {
    toast.classList.remove('toast--show')
    setTimeout(() => toast.remove(), 300)
  }, 3000)
}

function initializeTheme() {
  const savedTheme = localStorage.getItem('dashboardTheme') || 'auto'
  applyTheme(savedTheme)
}

function applyTheme(theme) {
  const html = document.documentElement
  if (theme === 'dark') {
    html.setAttribute('data-theme', 'dark')
  } else if (theme === 'light') {
    html.setAttribute('data-theme', 'light')
  } else {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    html.setAttribute('data-theme', prefersDark ? 'dark' : 'light')
  }
  localStorage.setItem('dashboardTheme', theme)
}

function setupNavigation() {
  document.querySelectorAll('[data-page]').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault()
      showPage(link.getAttribute('data-page'))
    })
  })
  document.querySelectorAll('[data-group]').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault()
      showGroup(link.getAttribute('data-group'))
    })
  })
}

// Collapsible sidebar sections: click a section label to fold its group away.
function setupCollapsibleSections() {
  document.querySelectorAll('.sidebar-section-label[data-section]').forEach((label) => {
    const key = label.getAttribute('data-section')
    const body = document.querySelector(`[data-section-body="${key}"]`)
    if (!body) return
    let collapsed = false
    try {
      collapsed = localStorage.getItem(`section-${key}`) === '1'
    } catch {}
    const apply = () => {
      body.style.display = collapsed ? 'none' : ''
      label.classList.toggle('collapsed', collapsed)
    }
    apply()
    label.style.cursor = 'pointer'
    label.addEventListener('click', () => {
      collapsed = !collapsed
      try {
        localStorage.setItem(`section-${key}`, collapsed ? '1' : '0')
      } catch {}
      apply()
    })
  })
}

function setupThemeToggle() {
  const themeToggle = document.getElementById('theme-toggle')
  if (!themeToggle) return

  themeToggle.addEventListener('click', () => {
    const current = localStorage.getItem('dashboardTheme') || 'auto'
    const next = current === 'light' ? 'dark' : current === 'dark' ? 'auto' : 'light'
    applyTheme(next)
  })
}

// Initialize on DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
  // Auth gate: with no token (e.g. public deploy where the token is NOT injected),
  // send the user to the Discord login page instead of showing the dashboard.
  const hasToken = Boolean(
    window.__ND_DASH_CONFIG__?.preloadedToken || localStorage.getItem('dashboardToken'),
  )
  if (!hasToken) {
    window.location.href = '/pages/splash.html'
    return
  }
  initializeTheme()
  setupNavigation()
  setupCollapsibleSections()
  setupThemeToggle()
  setupAutoLogout()
  navigateTo(getInitialPage())
})

// ── Auto sign-out: clear the token and return to login after inactivity ──────
const IDLE_LOGOUT_MS = 30 * 60 * 1000 // 30 minutes
let lastActivity = Date.now()

function logout(reason) {
  try {
    localStorage.removeItem('dashboardToken')
    sessionStorage.clear()
  } catch {}
  window.location.replace(`/pages/splash.html${reason ? `?error=${reason}` : ''}`)
}
// Expose for a manual "Sign out" control if one is added.
window.ndLogout = () => logout()

function setupAutoLogout() {
  const mark = () => {
    lastActivity = Date.now()
  }
  for (const ev of ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart']) {
    window.addEventListener(ev, mark, { passive: true })
  }
  // Check once a minute; sign out after the idle window elapses.
  setInterval(() => {
    if (Date.now() - lastActivity > IDLE_LOGOUT_MS) logout('idle')
  }, 60 * 1000)
}

// Handle browser back/forward: sync with hash
window.addEventListener('hashchange', () => {
  const target = window.location.hash.replace('#', '')
  if (GROUPS[target] && target !== currentGroup) showGroup(target)
  else if (PAGES[target] && target !== currentPage) showPage(target)
})

// Export for use in page scripts
window.showPage = showPage
window.showToast = showToast
