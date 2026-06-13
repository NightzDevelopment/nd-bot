/**
 * Shared formatting helpers, exposed on window for any page to use.
 */

window.esc = function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

window.fmtRelative = function fmtRelative(ts) {
  if (!ts) return '-'
  const d = Date.now() - ts
  if (d < 0) {
    // future
    const ad = -d
    if (ad < 60_000) return 'in <1m'
    if (ad < 3_600_000) return 'in ' + Math.floor(ad / 60_000) + 'm'
    if (ad < 86_400_000) return 'in ' + Math.floor(ad / 3_600_000) + 'h'
    if (ad < 604_800_000) return 'in ' + Math.floor(ad / 86_400_000) + 'd'
    return new Date(ts).toLocaleDateString()
  }
  if (d < 60_000) return 'just now'
  if (d < 3_600_000) return Math.floor(d / 60_000) + 'm ago'
  if (d < 86_400_000) return Math.floor(d / 3_600_000) + 'h ago'
  if (d < 604_800_000) return Math.floor(d / 86_400_000) + 'd ago'
  return new Date(ts).toLocaleDateString()
}

window.fmtAbsolute = function fmtAbsolute(ts) {
  if (!ts) return '-'
  return new Date(ts).toLocaleString()
}

window.fmtDuration = function fmtDuration(ms) {
  if (!ms || ms < 0) return '-'
  const s = Math.floor(ms / 1000)
  if (s < 60) return s + 's'
  const m = Math.floor(s / 60)
  if (m < 60) return m + 'm ' + (s % 60) + 's'
  const h = Math.floor(m / 60)
  if (h < 24) return h + 'h ' + (m % 60) + 'm'
  const d = Math.floor(h / 24)
  return d + 'd ' + (h % 24) + 'h'
}

window.copyText = function copyText(text) {
  navigator.clipboard
    .writeText(text)
    .then(() => {
      if (window.showToast) window.showToast('Copied to clipboard', 'success')
    })
    .catch(() => {
      if (window.showToast) window.showToast('Copy failed', 'error')
    })
}
