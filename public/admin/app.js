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

function showPage(pageName) {
  if (!PAGES[pageName]) return

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
  // 1) URL hash takes priority (allows linking)
  const hash = window.location.hash.replace('#', '')
  if (hash && PAGES[hash]) return hash
  // 2) Then localStorage
  try {
    const saved = localStorage.getItem('dashboardPage')
    if (saved && PAGES[saved]) return saved
  } catch {}
  // 3) Default
  return 'dashboard'
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
    { info: 'SENTINEL', success: 'SENTINEL ✓', warning: 'SENTINEL ⚠', error: 'SENTINEL ✗' }[type] ||
    'SENTINEL'
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
  const navLinks = document.querySelectorAll('[data-page]')
  navLinks.forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault()
      const page = link.getAttribute('data-page')
      showPage(page)
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
  initializeTheme()
  setupNavigation()
  setupThemeToggle()
  showPage(getInitialPage())
})

// Handle browser back/forward — sync with hash
window.addEventListener('hashchange', () => {
  const page = window.location.hash.replace('#', '')
  if (PAGES[page] && page !== currentPage) showPage(page)
})

// Export for use in page scripts
window.showPage = showPage
window.showToast = showToast
