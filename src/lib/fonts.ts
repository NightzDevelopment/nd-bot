/**
 * Canvas font registration for Linux.
 *
 * The card renderers (profile-card, stock-market, casino/loot/receipt cards) set
 * ctx.font to 'Arial' / 'Courier New'. Those exist on Windows but NOT on a fresh
 * Linux VPS, where @napi-rs/canvas would render missing-glyph boxes / blank text.
 *
 * We register metric-compatible system fonts (Liberation, then DejaVu as a
 * fallback) UNDER the alias families the renderers ask for, so the existing code
 * works unchanged. On Windows the system already has Arial, so registration is a
 * harmless best-effort no-op. Install on the VPS with:
 *   apt-get install -y fonts-liberation fontconfig
 */
import { existsSync } from 'node:fs'
import { childLogger } from './logger.ts'

const log = childLogger('fonts')

// Sans candidates (regular + bold) to register as the 'Arial' family.
const SANS = [
  '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
  '/usr/share/fonts/liberation/LiberationSans-Regular.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/TTF/DejaVuSans.ttf',
]
const SANS_BOLD = [
  '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
  '/usr/share/fonts/liberation/LiberationSans-Bold.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
]
// Monospace candidates to register as the 'Courier New' family.
const MONO = [
  '/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf',
  '/usr/share/fonts/liberation/LiberationMono-Regular.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',
]

let registered = false

export function registerCanvasFonts(): void {
  if (registered) return
  registered = true
  // Windows ships Arial/Courier New, so skip there (and avoid loading the native
  // module unnecessarily). Only do the work on non-win32 hosts.
  if (process.platform === 'win32') return
  try {
    // Dynamic import so a missing native module never crashes boot.
    const { GlobalFonts } = require('@napi-rs/canvas') as typeof import('@napi-rs/canvas')
    const registerFirst = (paths: string[], family: string): boolean => {
      for (const p of paths) {
        if (existsSync(p)) {
          try {
            GlobalFonts.registerFromPath(p, family)
            return true
          } catch {
            /* try next */
          }
        }
      }
      return false
    }
    const sans = registerFirst(SANS, 'Arial')
    registerFirst(SANS_BOLD, 'Arial')
    const mono = registerFirst(MONO, 'Courier New')
    if (!sans || !mono) {
      log.warn(
        'No system fonts found for canvas cards. Run: apt-get install -y fonts-liberation fontconfig (image cards will be blank until then).',
      )
    } else {
      log.info('Registered canvas fonts (Arial/Courier New aliases) for image cards.')
    }
  } catch (e) {
    log.warn({ err: e }, 'canvas font registration skipped')
  }
}
