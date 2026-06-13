/**
 * Run before any code reads `process.env` (import from `config.ts` first line).
 * 1) Loads .env
 * 2) Applies `data/dashboard-overrides.json` (string values merged into `process.env`)
 *
 * On parse error of the overrides file, logs and sets `ND_DASH_OVERRIDES_BROKEN=1`
 * so the dashboard can surface the problem to the operator instead of silently
 * starting with stale values and saving over the broken file.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { config } from 'dotenv'

config()

const dataDir = process.env.DATA_DIR?.trim() || './data'
const overrideFile = join(dataDir, 'dashboard-overrides.json')
if (existsSync(overrideFile)) {
  try {
    const raw = readFileSync(overrideFile, 'utf8')
    const o = JSON.parse(raw) as Record<string, unknown>
    if (!o || typeof o !== 'object') throw new Error('not a JSON object at top level')
    let appliedCount = 0
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        process.env[k] = String(v)
        appliedCount++
      }
    }
    if (appliedCount > 0) {
      console.log(`[config-bootstrap] applied ${appliedCount} key(s) from ${overrideFile}`)
    }
  } catch (e) {
    process.env.ND_DASH_OVERRIDES_BROKEN = '1'
    process.env.ND_DASH_OVERRIDES_ERROR = String((e as Error)?.message ?? e).slice(0, 240)
    console.error(
      `[config-bootstrap] FAILED to read ${overrideFile}, bot is starting with .env values only.`,
    )
    console.error(`[config-bootstrap] cause: ${process.env.ND_DASH_OVERRIDES_ERROR}`)
    console.error(
      '[config-bootstrap] saving from the dashboard will rewrite the file; until then runtime values come from .env only.',
    )
  }
}
