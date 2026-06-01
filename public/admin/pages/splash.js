/**
 * Splash page (login) for dashboard v2.
 * Handles email/password and Discord OAuth authentication.
 */

const passwordForm = document.getElementById('passwordForm')
const oauthForm = document.getElementById('oauthForm')
const loadingState = document.getElementById('loadingState')
const errorBanner = document.getElementById('errorBanner')
const serverSelect = document.getElementById('serverSelect')
const emailInput = document.getElementById('email-input')
const passwordInput = document.getElementById('password-input')
const serverDropdown = document.getElementById('server-dropdown')
const continueBtn = document.getElementById('continueBtn')

// Tab switching
document.querySelectorAll('.auth-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    const tabName = tab.dataset.tab
    document.querySelectorAll('.auth-tab').forEach((t) => t.classList.remove('active'))
    document.querySelectorAll('.auth-form').forEach((f) => (f.style.display = 'none'))
    tab.classList.add('active')
    document.querySelector(`[data-tab="${tabName}"]`).style.display = 'block'
  })
})

/**
 * Show error message
 */
function showError(msg) {
  errorBanner.textContent = msg
  errorBanner.style.display = 'block'
  loadingState.style.display = 'none'
}

/**
 * Show loading state
 */
function showLoading(msg = 'Signing in...') {
  loadingState.querySelector('p').textContent = msg
  loadingState.style.display = 'block'
  errorBanner.style.display = 'none'
}

/**
 * Handle password login
 */
passwordForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  const email = emailInput.value
  const password = passwordInput.value

  showLoading('Signing in...')

  try {
    const res = await fetch('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })

    const data = await res.json()

    if (!res.ok) {
      showError(data.error || 'Login failed')
      return
    }

    // Store token
    sessionStorage.setItem('token', data.token)
    if (data.refreshToken) {
      localStorage.setItem('refreshToken', data.refreshToken)
    }

    // Load servers
    await loadServers()
  } catch (err) {
    showError(`Network error: ${err.message}`)
  }
})

/**
 * Load user's accessible servers
 */
async function loadServers() {
  showLoading('Loading servers...')

  try {
    const token = sessionStorage.getItem('token')
    const res = await fetch('/api/servers', {
      headers: { authorization: `Bearer ${token}` },
    })

    const data = await res.json()

    if (!res.ok) {
      showError(data.error || 'Failed to load servers')
      return
    }

    // Populate dropdown
    serverDropdown.innerHTML = data.servers
      .map((s) => `<option value="${s.id}">${s.name}</option>`)
      .join('')

    // Show server selection
    passwordForm.style.display = 'none'
    oauthForm.style.display = 'none'
    loadingState.style.display = 'none'
    errorBanner.style.display = 'none'
    serverSelect.style.display = 'block'

    // Auto-select first or previously selected
    const lastServerId = sessionStorage.getItem('lastServerId')
    if (lastServerId) {
      serverDropdown.value = lastServerId
    }
  } catch (err) {
    showError(`Network error: ${err.message}`)
  }
}

/**
 * Handle server selection
 */
continueBtn.addEventListener('click', () => {
  const serverId = serverDropdown.value
  if (!serverId) {
    showError('Please select a server')
    return
  }

  sessionStorage.setItem('lastServerId', serverId)
  sessionStorage.setItem('currentServerId', serverId)

  // Redirect to dashboard
  window.location.href = '/dashboard'
})

/**
 * Handle Discord OAuth callback
 */
function checkOAuthCallback() {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  const state = params.get('state')

  if (code) {
    showLoading('Completing Discord sign-in...')

    fetch('/auth/callback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, state }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.token) {
          sessionStorage.setItem('token', data.token)
          if (data.refreshToken) {
            localStorage.setItem('refreshToken', data.refreshToken)
          }
          // Redirect to dashboard or server selection
          window.location.href = '/dashboard'
        } else {
          showError(data.error || 'OAuth failed')
        }
      })
      .catch((err) => showError(`Network error: ${err.message}`))
  }
}

// Check for OAuth callback on page load
checkOAuthCallback()

// Set version
document.getElementById('version').textContent =
  `v${typeof ND_VERSION !== 'undefined' ? ND_VERSION : '2.0.0'}`

// Show/hide password toggle
const togglePw = document.getElementById('toggle-pw')
if (togglePw) {
  togglePw.addEventListener('click', () => {
    const input = document.getElementById('password-input')
    const isHidden = input.type === 'password'
    input.type = isHidden ? 'text' : 'password'
    togglePw.textContent = isHidden ? 'Hide' : 'Show'
  })
}
