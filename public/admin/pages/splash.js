/**
 * Login page (Discord-only OAuth) for the Nightz Development control panel.
 *
 * Flow: "Login with Discord" -> GET /auth/discord -> Discord -> GET
 * /auth/discord/callback (server verifies admin) -> redirects back here with
 * either #token=<jwt> (success) or ?error=<reason> (failure).
 */

const loadingState = document.getElementById('loadingState')
const oauthForm = document.getElementById('oauthForm')
const errorBanner = document.getElementById('errorBanner')

function showError(msg) {
  if (!errorBanner) return
  errorBanner.textContent = msg
  errorBanner.style.display = 'block'
  if (loadingState) loadingState.style.display = 'none'
  if (oauthForm) oauthForm.style.display = 'block'
}

function showLoading(msg = 'Signing in...') {
  if (loadingState) {
    const p = loadingState.querySelector('p')
    if (p) p.textContent = msg
    loadingState.style.display = 'block'
  }
  if (oauthForm) oauthForm.style.display = 'none'
  if (errorBanner) errorBanner.style.display = 'none'
}

const ERROR_MESSAGES = {
  not_authorized: 'That Discord account is not authorized for the dashboard.',
  oauth_state: 'Sign-in session expired or was tampered with. Please try again.',
  oauth_exchange: 'Could not complete Discord sign-in. Please try again.',
  oauth_user: 'Could not read your Discord profile. Please try again.',
  oauth_not_configured: 'Discord login is not configured yet. Contact an admin.',
}

// 1. Success: the callback handed us a token in the URL fragment.
function handleTokenFragment() {
  const hash = window.location.hash || ''
  const m = hash.match(/token=([^&]+)/)
  if (!m) return false
  const token = decodeURIComponent(m[1])
  sessionStorage.setItem('token', token)
  // Scrub the token out of the address bar, then enter the dashboard.
  history.replaceState(null, '', window.location.pathname)
  showLoading('Loading dashboard...')
  window.location.href = '/dashboard'
  return true
}

// 2. Failure: the callback bounced back with ?error=<reason>.
function handleErrorParam() {
  const reason = new URLSearchParams(window.location.search).get('error')
  if (!reason) return false
  showError(ERROR_MESSAGES[reason] || `Sign-in failed (${reason}).`)
  history.replaceState(null, '', window.location.pathname)
  return true
}

// 3. Already signed in? Skip straight to the dashboard.
function handleExistingSession() {
  if (sessionStorage.getItem('token')) {
    window.location.href = '/dashboard'
    return true
  }
  return false
}

if (!handleTokenFragment() && !handleErrorParam()) {
  handleExistingSession()
}

const versionEl = document.getElementById('version')
if (versionEl) {
  versionEl.textContent = `v${typeof ND_VERSION !== 'undefined' ? ND_VERSION : '2.0.0'}`
}
