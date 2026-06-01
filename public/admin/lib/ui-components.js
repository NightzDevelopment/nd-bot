/**
 * Shared UI components — modal, channel picker, datetime picker, markdown preview.
 * All functions exposed on window.
 */

// ── Channel cache ──────────────────────────────────────────────────────────
let _channelCache = null
let _channelCachePromise = null

async function loadChannels() {
  if (_channelCache) return _channelCache
  if (_channelCachePromise) return _channelCachePromise
  _channelCachePromise = window.apiClient
    .getGuildChannels()
    .then((r) => {
      _channelCache = r.ok ? r.data || [] : []
      return _channelCache
    })
    .catch(() => {
      _channelCache = []
      return _channelCache
    })
  return _channelCachePromise
}

window.refreshChannelCache = function refreshChannelCache() {
  _channelCache = null
  _channelCachePromise = null
}

/**
 * uiChannelPicker({ id, selected, includeBlank=true, onChange })
 * Returns a Promise<HTMLSelectElement> populated from the channel cache.
 */
window.uiChannelPicker = async function uiChannelPicker(opts = {}) {
  const channels = await loadChannels()
  const sel = document.createElement('select')
  sel.className = 'ui-channel-picker'
  if (opts.id) sel.id = opts.id
  sel.style.cssText =
    'width:100%;padding:.5rem .6rem;border-radius:6px;border:1px solid rgba(148,163,184,0.2);background:#0a0e1f;color:#e2e8f0;font-size:13px;'

  if (opts.includeBlank !== false) {
    const blank = document.createElement('option')
    blank.value = ''
    blank.textContent = opts.placeholder || '— select channel —'
    sel.appendChild(blank)
  }

  // Group by parent category for readability
  const grouped = {}
  for (const ch of channels) {
    const parent = ch.parentName || 'Uncategorized'
    if (!grouped[parent]) grouped[parent] = []
    grouped[parent].push(ch)
  }
  for (const parentName of Object.keys(grouped).sort()) {
    const og = document.createElement('optgroup')
    og.label = parentName
    for (const ch of grouped[parentName]) {
      const op = document.createElement('option')
      op.value = ch.id
      op.textContent = '#' + ch.name
      if (opts.selected && opts.selected === ch.id) op.selected = true
      og.appendChild(op)
    }
    sel.appendChild(og)
  }

  if (opts.onChange) sel.addEventListener('change', (e) => opts.onChange(e.target.value))
  return sel
}

/**
 * uiOpenModal({ id, title, body, footer, width='560px' })
 * Creates and appends a modal. body/footer can be HTML strings or HTMLElements.
 * Returns the modal root element.
 */
window.uiOpenModal = function uiOpenModal({ id, title, body, footer, width = '560px' }) {
  // Remove existing with same ID
  if (id) document.getElementById(id)?.remove()

  const modal = document.createElement('div')
  if (id) modal.id = id
  modal.className = 'ui-modal'
  modal.style.cssText =
    'position:fixed;inset:0;background:rgba(0,0,0,0.65);z-index:9999;display:flex;align-items:center;justify-content:center;'

  const card = document.createElement('div')
  card.style.cssText = `background:#0f1228;border:1px solid rgba(96,165,250,0.2);border-radius:12px;width:${width};max-width:95vw;max-height:88vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.5);`

  const header = document.createElement('div')
  header.style.cssText =
    'padding:1rem 1.5rem;border-bottom:1px solid rgba(148,163,184,0.1);display:flex;justify-content:space-between;align-items:center;flex-shrink:0;'
  header.innerHTML = `
    <div style="font-size:14px;font-weight:700;color:#e2e8f0;letter-spacing:.02em;">${window.esc(title || '')}</div>
    <button class="ui-modal-x" style="background:none;border:none;color:#64748b;font-size:18px;cursor:pointer;padding:0 .25rem;line-height:1;">×</button>
  `
  card.appendChild(header)

  const bodyEl = document.createElement('div')
  bodyEl.style.cssText = 'padding:1.25rem 1.5rem;overflow-y:auto;flex:1;'
  if (typeof body === 'string') bodyEl.innerHTML = body
  else if (body instanceof HTMLElement) bodyEl.appendChild(body)
  card.appendChild(bodyEl)

  if (footer) {
    const footerEl = document.createElement('div')
    footerEl.style.cssText =
      'padding:1rem 1.5rem;border-top:1px solid rgba(148,163,184,0.1);display:flex;gap:.75rem;justify-content:flex-end;flex-shrink:0;'
    if (typeof footer === 'string') footerEl.innerHTML = footer
    else if (footer instanceof HTMLElement) footerEl.appendChild(footer)
    card.appendChild(footerEl)
  }

  modal.appendChild(card)
  document.body.appendChild(modal)

  modal.onclick = (e) => {
    if (e.target === modal) window.uiCloseModal(id || modal)
  }
  header.querySelector('.ui-modal-x').onclick = () => window.uiCloseModal(id || modal)

  return modal
}

window.uiCloseModal = function uiCloseModal(idOrEl) {
  if (typeof idOrEl === 'string') document.getElementById(idOrEl)?.remove()
  else if (idOrEl instanceof HTMLElement) idOrEl.remove()
}

/**
 * uiDatetimePicker({ id, value, presets=true })
 * Returns a container with <input type="datetime-local"> + optional preset buttons.
 * Use .value getter on the input child to read the chosen value.
 */
window.uiDatetimePicker = function uiDatetimePicker(opts = {}) {
  const wrap = document.createElement('div')
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:.5rem;'
  const input = document.createElement('input')
  input.type = 'datetime-local'
  if (opts.id) input.id = opts.id
  input.style.cssText =
    'width:100%;padding:.5rem .6rem;border-radius:6px;border:1px solid rgba(148,163,184,0.2);background:#0a0e1f;color:#e2e8f0;font-size:13px;'
  if (opts.value) {
    const d = new Date(opts.value)
    // Local ISO without seconds, YYYY-MM-DDTHH:mm
    const pad = (n) => String(n).padStart(2, '0')
    input.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  }
  wrap.appendChild(input)

  if (opts.presets !== false) {
    const presets = document.createElement('div')
    presets.style.cssText = 'display:flex;gap:.4rem;flex-wrap:wrap;'
    const presetOpts = [
      { label: '+15m', ms: 15 * 60_000 },
      { label: '+1h', ms: 60 * 60_000 },
      { label: '+6h', ms: 6 * 60 * 60_000 },
      { label: '+1d', ms: 24 * 60 * 60_000 },
      { label: '+1w', ms: 7 * 24 * 60 * 60_000 },
    ]
    for (const p of presetOpts) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.textContent = p.label
      btn.style.cssText =
        'padding:.3rem .6rem;background:rgba(96,165,250,0.08);border:1px solid rgba(96,165,250,0.2);color:#60a5fa;border-radius:4px;font-size:11px;cursor:pointer;'
      btn.onclick = () => {
        const d = new Date(Date.now() + p.ms)
        const pad = (n) => String(n).padStart(2, '0')
        input.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
      }
      presets.appendChild(btn)
    }
    wrap.appendChild(presets)
  }

  // Expose .value getter on wrapper
  Object.defineProperty(wrap, 'value', {
    get() {
      return input.value
    },
    set(v) {
      input.value = v
    },
  })
  Object.defineProperty(wrap, 'asTimestamp', {
    get() {
      return input.value ? new Date(input.value).getTime() : null
    },
  })

  return wrap
}

/**
 * uiMarkdownPreview(textareaEl, previewEl)
 * Minimal markdown→HTML pass: bold, italic, code, links, line breaks.
 */
window.uiMarkdownPreview = function uiMarkdownPreview(textareaEl, previewEl) {
  function render() {
    let s = window.esc(textareaEl.value)
    // code spans
    s = s.replace(
      /`([^`]+)`/g,
      '<code style="background:rgba(96,165,250,0.1);padding:1px 4px;border-radius:3px;font-size:12px;">$1</code>',
    )
    // bold
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    // italic
    s = s.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>')
    // links
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color:#60a5fa;">$1</a>')
    // line breaks
    s = s.replace(/\n/g, '<br>')
    previewEl.innerHTML = s || '<span style="color:#475569;">Preview…</span>'
  }
  textareaEl.addEventListener('input', render)
  render()
}
