/**
 * UI Helpers — toasts, modals, copy-to-clipboard, keyboard shortcuts.
 * Zero dependencies, pure vanilla JS.
 */

// ─── Toast Notifications ────────────────────────────────────────────────────

let toastContainer = null

function getToastContainer() {
  if (!toastContainer) {
    toastContainer = document.createElement('div')
    toastContainer.id = 'toast-container'
    toastContainer.style.cssText = `
      position:fixed; bottom:24px; right:24px; z-index:9999;
      display:flex; flex-direction:column-reverse; gap:10px;
      pointer-events:none;
    `
    document.body.appendChild(toastContainer)
  }
  return toastContainer
}

/**
 * Show a toast notification.
 * @param {string} message
 * @param {'success'|'error'|'info'|'warning'} [type='info']
 * @param {number} [duration=3500]
 */
export function showToast(message, type = 'info', duration = 3500) {
  const colors = {
    success: { bg: '#16a34a', icon: '✓' },
    error: { bg: '#dc2626', icon: '✕' },
    warning: { bg: '#d97706', icon: '⚠' },
    info: { bg: '#2563eb', icon: 'ℹ' },
  }
  const { bg, icon } = colors[type] || colors.info

  const el = document.createElement('div')
  el.style.cssText = `
    display:flex; align-items:center; gap:10px;
    background:${bg}; color:#fff;
    padding:12px 18px; border-radius:8px;
    font-size:14px; font-weight:500;
    box-shadow:0 4px 16px rgba(0,0,0,.35);
    pointer-events:all; cursor:default;
    opacity:0; transform:translateX(20px);
    transition:opacity .2s ease, transform .2s ease;
    max-width:340px;
  `
  el.innerHTML = `<span style="font-size:16px;line-height:1">${icon}</span><span>${escapeHtml(message)}</span>`
  getToastContainer().appendChild(el)

  requestAnimationFrame(() => {
    el.style.opacity = '1'
    el.style.transform = 'translateX(0)'
  })

  const dismiss = () => {
    el.style.opacity = '0'
    el.style.transform = 'translateX(20px)'
    setTimeout(() => el.remove(), 250)
  }

  el.addEventListener('click', dismiss)
  setTimeout(dismiss, duration)
  return el
}

// ─── Modal ───────────────────────────────────────────────────────────────────

let activeModal = null

/**
 * Show a modal dialog.
 * @param {{ title:string, body:string|HTMLElement, actions?:Array<{label:string,type?:string,onClick:()=>void}> }} opts
 * @returns {{ close: () => void }}
 */
export function showModal({ title, body, actions = [] }) {
  closeModal()

  const overlay = document.createElement('div')
  overlay.style.cssText = `
    position:fixed; inset:0; z-index:8000;
    background:rgba(0,0,0,.6); display:flex;
    align-items:center; justify-content:center;
    padding:16px;
  `

  const box = document.createElement('div')
  box.style.cssText = `
    background:var(--bg-secondary, #1e2235);
    border:1px solid var(--border, #2d3352);
    border-radius:12px; padding:28px;
    max-width:560px; width:100%;
    box-shadow:0 24px 64px rgba(0,0,0,.6);
    animation:modalIn .15s ease;
  `

  const head = document.createElement('div')
  head.style.cssText = `display:flex;justify-content:space-between;align-items:center;margin-bottom:16px`
  head.innerHTML = `
    <h3 style="margin:0;font-size:18px;color:var(--text-primary,#e2e8f0)">${escapeHtml(title)}</h3>
    <button id="modal-close-btn" style="background:none;border:none;color:var(--text-muted,#94a3b8);font-size:22px;cursor:pointer;padding:0 4px;line-height:1">✕</button>
  `

  const content = document.createElement('div')
  content.style.cssText = `color:var(--text-secondary,#94a3b8);font-size:14px;line-height:1.6;margin-bottom:20px`
  if (typeof body === 'string') {
    content.innerHTML = body
  } else {
    content.appendChild(body)
  }

  const footer = document.createElement('div')
  footer.style.cssText = `display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap`

  actions.forEach(({ label, type = 'default', onClick }) => {
    const btn = document.createElement('button')
    const styles = {
      primary: 'background:#3b82f6;color:#fff;border:none',
      danger: 'background:#dc2626;color:#fff;border:none',
      default:
        'background:transparent;color:var(--text-secondary,#94a3b8);border:1px solid var(--border,#2d3352)',
    }
    btn.style.cssText = `
      ${styles[type] || styles.default};
      padding:9px 18px; border-radius:7px;
      font-size:14px; font-weight:500; cursor:pointer;
    `
    btn.textContent = label
    btn.addEventListener('click', () => {
      onClick()
      close()
    })
    footer.appendChild(btn)
  })

  box.appendChild(head)
  box.appendChild(content)
  box.appendChild(footer)
  overlay.appendChild(box)
  document.body.appendChild(overlay)

  const close = () => {
    overlay.remove()
    if (activeModal === overlay) activeModal = null
  }

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close()
  })
  box.querySelector('#modal-close-btn').addEventListener('click', close)
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') {
      close()
      document.removeEventListener('keydown', esc)
    }
  })

  activeModal = overlay

  // Inject animation keyframe once
  if (!document.getElementById('modal-anim')) {
    const s = document.createElement('style')
    s.id = 'modal-anim'
    s.textContent =
      '@keyframes modalIn{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:scale(1)}}'
    document.head.appendChild(s)
  }

  return { close }
}

export function closeModal() {
  if (activeModal) {
    activeModal.remove()
    activeModal = null
  }
}

// ─── Confirm Dialog ───────────────────────────────────────────────────────────

/**
 * Simple confirm dialog. Returns a Promise<boolean>.
 */
export function confirm(message, { title = 'Confirm', danger = false } = {}) {
  return new Promise((resolve) => {
    showModal({
      title,
      body: `<p>${escapeHtml(message)}</p>`,
      actions: [
        { label: 'Cancel', type: 'default', onClick: () => resolve(false) },
        { label: 'Confirm', type: danger ? 'danger' : 'primary', onClick: () => resolve(true) },
      ],
    })
  })
}

// ─── Copy to Clipboard ───────────────────────────────────────────────────────

/**
 * Copy text to clipboard with a toast confirmation.
 * @param {string} text
 * @param {string} [label] - label for the toast message
 */
export async function copyToClipboard(text, label = 'value') {
  try {
    await navigator.clipboard.writeText(text)
    showToast(`Copied ${label} to clipboard`, 'success', 2000)
    return true
  } catch {
    // Fallback for older browsers
    const el = document.createElement('textarea')
    el.value = text
    el.style.position = 'fixed'
    el.style.opacity = '0'
    document.body.appendChild(el)
    el.select()
    try {
      document.execCommand('copy')
      showToast(`Copied ${label} to clipboard`, 'success', 2000)
      return true
    } catch {
      showToast('Failed to copy to clipboard', 'error')
      return false
    } finally {
      document.body.removeChild(el)
    }
  }
}

// ─── Loading Spinner ──────────────────────────────────────────────────────────

/**
 * Create a simple spinner element.
 */
export function createSpinner(size = 20) {
  const el = document.createElement('span')
  el.style.cssText = `
    display:inline-block;width:${size}px;height:${size}px;
    border:2px solid rgba(255,255,255,.2);
    border-top-color:#fff;border-radius:50%;
    animation:spin .7s linear infinite;
  `
  if (!document.getElementById('spin-anim')) {
    const s = document.createElement('style')
    s.id = 'spin-anim'
    s.textContent = '@keyframes spin{to{transform:rotate(360deg)}}'
    document.head.appendChild(s)
  }
  return el
}

// ─── Format helpers ───────────────────────────────────────────────────────────

export function escapeHtml(str) {
  if (!str) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function formatDate(timestamp) {
  if (!timestamp) return '—'
  const d = new Date(timestamp)
  return d.toLocaleString()
}

export function formatRelative(timestamp) {
  if (!timestamp) return '—'
  const diff = Date.now() - timestamp
  if (diff < 60000) return 'just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  return `${Math.floor(diff / 86400000)}d ago`
}

// ─── Badge ────────────────────────────────────────────────────────────────────

export function roleBadge(role) {
  const colors = { admin: '#ef4444', moderator: '#f59e0b', viewer: '#6b7280' }
  const color = colors[role] || '#6b7280'
  return `<span style="background:${color}20;color:${color};padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600;text-transform:uppercase">${role}</span>`
}
