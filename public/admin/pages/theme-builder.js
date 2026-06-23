/**
 * Theme Builder Page
 * Live HSL CSS Custom Properties color selector with rank card mockup preview
 */

// Default custom properties values
const DEFAULT_THEME_PROPS = {
  '--bg-main': '#020617',
  '--bg-sidebar': '#090d1f',
  '--bg-card': 'rgba(15, 23, 42, 0.45)',
  '--accent': '#60a5fa',
  '--accent-rgb': '96, 165, 250',
  '--text-primary': '#f1f5f9',
  '--text-secondary': '#94a3b8',
  '--border-color': 'rgba(255, 255, 255, 0.05)',
  '--card-glow': 'rgba(96, 165, 250, 0.15)',
}

let activeThemeProps = {}

async function initThemeBuilder() {
  loadSavedCustomTheme()
  setupThemeBuilderControls()
  updateThemeInputs()
  renderRankCardMockup()
}

function loadSavedCustomTheme() {
  const saved = localStorage.getItem('ndCustomTheme')
  if (saved) {
    try {
      activeThemeProps = JSON.parse(saved)
    } catch {
      activeThemeProps = { ...DEFAULT_THEME_PROPS }
    }
  } else {
    activeThemeProps = { ...DEFAULT_THEME_PROPS }
  }
}

function setupThemeBuilderControls() {
  const container = document.getElementById('theme-builder-inputs-container')
  if (!container) return

  container.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:15px;">
      ${Object.keys(DEFAULT_THEME_PROPS)
        .map((prop) => {
          const isRgb = prop.endsWith('-rgb')
          if (isRgb) return '' // Skip RGB secondary properties, compute them automatically

          const label = prop.replace('--', '').replace('-', ' ').toUpperCase()
          const currentVal = activeThemeProps[prop] || DEFAULT_THEME_PROPS[prop]
          const isColor = currentVal.startsWith('#') || currentVal.startsWith('rgb')

          return `
          <div style="display:flex;flex-direction:column;gap:5px;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <span style="font-size:11px;font-family:var(--font-mono);color:var(--text-secondary);letter-spacing:0.03em;">${label}</span>
              <span style="font-size:10px;font-family:var(--font-mono);color:var(--text-tertiary);">${prop}</span>
            </div>
            <div style="display:flex;gap:10px;align-items:center;">
              <input type="${isColor ? 'color' : 'text'}" 
                     id="theme-input-${prop}" 
                     value="${isColor ? convertToHexIfNeeded(currentVal) : currentVal}" 
                     oninput="updateThemeProp('${prop}', this.value)"
                     style="background:#0a0e1f;border:1px solid rgba(255,255,255,0.1);color:#e2e8f0;padding:4px;border-radius:4px;cursor:pointer;width:${isColor ? '40px' : '100%'};height:32px;">
              ${isColor ? `<input type="text" id="theme-text-${prop}" value="${currentVal}" oninput="updateThemeProp('${prop}', this.value)" style="background:#0a0e1f;border:1px solid rgba(255,255,255,0.1);color:#e2e8f0;padding:6px 10px;border-radius:6px;font-family:var(--font-mono);font-size:12px;flex:1;height:32px;">` : ''}
            </div>
          </div>
        `
        })
        .join('')}
      
      <div style="display:flex;gap:10px;margin-top:10px;">
        <button class="btn" onclick="resetThemeToDefault()" style="flex:1;">[RESET THEME]</button>
        <button class="btn" onclick="saveCustomTheme()" style="flex:1;color:#60a5fa;border-color:rgba(96,165,250,0.3);background:rgba(96,165,250,0.05);font-weight:700;">[SAVE CUSTOM THEME]</button>
      </div>
    </div>
  `
}

function convertToHexIfNeeded(val) {
  if (val.startsWith('#')) return val
  // Default values mapping
  if (val.includes('rgba(15, 23, 42')) return '#0f172a'
  if (val.includes('rgba(255, 255, 255')) return '#1e293b'
  if (val.includes('rgba(96, 165, 250')) return '#60a5fa'
  return '#60a5fa'
}

window.updateThemeProp = (prop, val) => {
  activeThemeProps[prop] = val

  // If editing hex color, update text input and compute auto variables
  const textInput = document.getElementById(`theme-text-${prop}`)
  if (textInput && textInput.value !== val) {
    textInput.value = val
  }

  // Compute RGB helper if accent changes
  if (prop === '--accent' && val.startsWith('#')) {
    const rgb = hexToRgb(val)
    if (rgb) {
      activeThemeProps['--accent-rgb'] = `${rgb.r}, ${rgb.g}, ${rgb.b}`
    }
  }

  applyActiveThemeToDom()
  renderRankCardMockup()
}

function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : null
}

function applyActiveThemeToDom() {
  const root = document.documentElement
  Object.keys(activeThemeProps).forEach((prop) => {
    root.style.setProperty(prop, activeThemeProps[prop])
  })
}

function updateThemeInputs() {
  Object.keys(activeThemeProps).forEach((prop) => {
    const input = document.getElementById(`theme-input-${prop}`)
    const textInput = document.getElementById(`theme-text-${prop}`)
    const val = activeThemeProps[prop]

    if (input) input.value = val.startsWith('#') ? val : convertToHexIfNeeded(val)
    if (textInput) textInput.value = val
  })
}

window.resetThemeToDefault = () => {
  if (!confirm('Reset dashboard styles to default Nightz Development system profile?')) return

  activeThemeProps = { ...DEFAULT_THEME_PROPS }
  localStorage.removeItem('ndCustomTheme')

  // Clear DOM overrides
  const root = document.documentElement
  Object.keys(DEFAULT_THEME_PROPS).forEach((prop) => {
    root.style.removeProperty(prop)
  })

  setupThemeBuilderControls()
  updateThemeInputs()
  renderRankCardMockup()
  window.showToast('Theme reset to default successfully', 'info')
}

window.saveCustomTheme = () => {
  localStorage.setItem('ndCustomTheme', JSON.stringify(activeThemeProps))
  applyActiveThemeToDom()
  window.showToast('Theme saved and active globally!', 'success')
}

function renderRankCardMockup() {
  const card = document.getElementById('theme-card-preview')
  if (!card) return

  const accent = activeThemeProps['--accent'] || '#60a5fa'
  const cardBg = activeThemeProps['--bg-card'] || 'rgba(15, 23, 42, 0.45)'
  const border = activeThemeProps['--border-color'] || 'rgba(255, 255, 255, 0.05)'
  const glow = activeThemeProps['--card-glow'] || 'rgba(96, 165, 250, 0.15)'
  const textPri = activeThemeProps['--text-primary'] || '#f1f5f9'
  const textSec = activeThemeProps['--text-secondary'] || '#94a3b8'

  card.innerHTML = `
    <div style="background:${cardBg}; border:1px solid ${border}; box-shadow:0 8px 32px 0 ${glow}; padding:25px; border-radius:12px; width:100%; max-width:480px; display:flex; gap:20px; align-items:center; position:relative; overflow:hidden; backdrop-filter:blur(8px); margin:0 auto;">
      <!-- Corner branding mark -->
      <div style="position:absolute; top:8px; right:12px; font-family:var(--font-mono); font-size:8px; color:${accent}; opacity:0.6; letter-spacing:0.1em; font-weight:700;">NIGHTZ DEV PROFILE</div>
      
      <!-- Avatar mock -->
      <div style="width:72px; height:72px; border-radius:50%; background:linear-gradient(135deg, ${accent}, #8b5cf6); border:2px solid ${accent}; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
        <span style="font-family:var(--font-mono); font-size:24px; font-weight:700; color:#fff;">ND</span>
      </div>
      
      <!-- Card content -->
      <div style="flex:1; display:flex; flex-direction:column; gap:8px;">
        <div style="display:flex; justify-content:space-between; align-items:baseline;">
          <span style="font-size:16px; font-weight:800; color:${textPri}; letter-spacing:-0.01em;">DeveloperNightz</span>
          <span style="font-size:11px; font-family:var(--font-mono); color:${accent}; font-weight:bold;">LEVEL 42</span>
        </div>
        
        <div style="display:flex; justify-content:space-between; align-items:center; font-size:11px; color:${textSec}; font-family:var(--font-mono);">
          <span>Rank [SYSTEM-ADMIN]</span>
          <span>7,840 / 10,000 XP</span>
        </div>
        
        <!-- Progress Bar -->
        <div style="width:100%; height:8px; background:rgba(0,0,0,0.3); border-radius:4px; overflow:hidden; border:1px solid ${border};">
          <div style="width:78%; height:100%; background:linear-gradient(90deg, ${accent}, #8b5cf6); border-radius:4px; box-shadow:0 0 8px ${accent};"></div>
        </div>
        
        <div style="display:flex; justify-content:space-between; font-size:10px; color:${textSec}; margin-top:2px;">
          <span>ND-Coin: [45,020]</span>
          <span>Daily Quest: [COMPLETED]</span>
        </div>
      </div>
    </div>
  `
}

// Proactively apply saved theme on boot
const savedTheme = localStorage.getItem('ndCustomTheme')
if (savedTheme) {
  try {
    const parsed = JSON.parse(savedTheme)
    const root = document.documentElement
    Object.keys(parsed).forEach((prop) => {
      root.style.setProperty(prop, parsed[prop])
    })
  } catch {}
}

window.initThemeBuilder = initThemeBuilder
