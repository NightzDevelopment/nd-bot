/**
 * Settings Page
 * Handles dashboard preferences and settings
 */

async function initSettings() {
  setupThemeSelector()
  setupFeatureToggles()
}

function setupThemeSelector() {
  const themeSelects = document.querySelectorAll('[data-theme-option]')
  const currentTheme = localStorage.getItem('dashboardTheme') || 'auto'

  themeSelects.forEach((btn) => {
    const theme = btn.getAttribute('data-theme-option')
    if (theme === currentTheme) {
      btn.classList.add('active')
    }

    btn.addEventListener('click', () => {
      themeSelects.forEach((b) => b.classList.remove('active'))
      btn.classList.add('active')
      applyTheme(theme)
      showToast(`Theme changed to ${theme}`, 'success')
    })
  })
}

function setupFeatureToggles() {
  const toggles = document.querySelectorAll('[data-feature-toggle]')
  toggles.forEach((toggle) => {
    const feature = toggle.getAttribute('data-feature-toggle')
    const savedState = localStorage.getItem(`feature-${feature}`) !== 'false'

    toggle.checked = savedState
    toggle.addEventListener('change', () => {
      localStorage.setItem(`feature-${feature}`, toggle.checked)
      showToast(`${feature} ${toggle.checked ? 'enabled' : 'disabled'}`, 'info')
    })
  })
}

window.initSettings = initSettings
