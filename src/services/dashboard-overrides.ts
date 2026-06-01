import { readFile } from 'node:fs/promises'
import { DATA_DIR } from '../config.ts'
import {
  type ConfigField,
  type ConfigFieldType,
  getConfigManifest,
  isManifestKey,
  isSensitiveKey,
} from '../dashboard/config-manifest.ts'
import { dataPath, ensureDataDir, writeFileAtomic } from './data-store.ts'

const FILE = 'dashboard-overrides.json'

export function overridesPath(): string {
  return dataPath(FILE)
}

export async function readOverridesFile(): Promise<Record<string, string>> {
  try {
    const raw = await readFile(overridesPath(), 'utf8')
    const o = JSON.parse(raw) as unknown
    if (!o || typeof o !== 'object') return {}
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (!isManifestKey(k)) continue
      if (v === null || v === undefined) continue
      out[k] = String(v)
    }
    return out
  } catch {
    return {}
  }
}

/**
 * Returns true when the override file exists but failed to parse on the most
 * recent boot (config-bootstrap sets ND_DASH_OVERRIDES_BROKEN=1 in that case).
 */
export function overridesAreBroken(): boolean {
  return process.env.ND_DASH_OVERRIDES_BROKEN === '1'
}

function coerceForType(
  t: ConfigFieldType,
  raw: unknown,
): { ok: true; value: string } | { ok: false; error: string } {
  if (raw === null || raw === undefined) return { ok: false, error: 'missing value' }
  if (t === 'bool') {
    if (typeof raw === 'boolean') return { ok: true, value: raw ? '1' : '0' }
    const s = String(raw).trim().toLowerCase()
    if (['1', 'true', 'yes', 'on'].includes(s)) return { ok: true, value: '1' }
    if (['0', 'false', 'no', 'off', ''].includes(s)) return { ok: true, value: '0' }
    return { ok: false, error: 'expected boolean' }
  }
  if (t === 'number') {
    const n = typeof raw === 'number' ? raw : parseFloat(String(raw).trim())
    if (Number.isNaN(n)) return { ok: false, error: 'expected number' }
    return { ok: true, value: String(n) }
  }
  if (t === 'text' || t === 'string') {
    return { ok: true, value: String(raw) }
  }
  // Exhaustive: future ConfigFieldType additions become a compile error here.
  const _exhaustive: never = t
  return { ok: false, error: `unsupported type ${String(_exhaustive)}` }
}

export function validateAndMergePatch(
  patch: Record<string, unknown>,
  fields: ConfigField[],
): { merged: Record<string, string> | null; errors: string[] } {
  const byKey = new Map(fields.map((f) => [f.key, f]))
  const errors: string[] = []
  const out: Record<string, string> = {}
  for (const [k, raw] of Object.entries(patch)) {
    if (!isManifestKey(k)) {
      errors.push(`Unknown key: ${k}`)
      continue
    }
    const f = byKey.get(k)
    if (!f) {
      errors.push(`No manifest field: ${k}`)
      continue
    }
    if (isSensitiveKey(k) && (raw === '***' || raw === '')) {
      // Treat as "leave unchanged" — UI re-sends masked sentinel.
      continue
    }
    const c = coerceForType(f.type, raw)
    if (!c.ok) {
      errors.push(`${k}: ${c.error}`)
      continue
    }
    out[k] = c.value
  }
  if (errors.length) return { merged: null, errors }
  return { merged: out, errors: [] }
}

export async function writeMergedOverrides(
  existing: Record<string, string>,
  patch: Record<string, string>,
): Promise<void> {
  const next = { ...existing, ...patch }
  for (const k of Object.keys(next)) {
    if (!isManifestKey(k)) delete next[k]
  }
  await ensureDataDir()
  await writeFileAtomic(overridesPath(), JSON.stringify(next, null, 2) + '\n')
  for (const [k, v] of Object.entries(patch)) {
    process.env[k] = v
  }
  // The override file is no longer broken, even if it was on boot.
  if (process.env.ND_DASH_OVERRIDES_BROKEN === '1') {
    delete process.env.ND_DASH_OVERRIDES_BROKEN
  }
}

export function getEffectiveStringValues(
  fields: ConfigField[],
  maskSensitive: boolean,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of fields) {
    const v = process.env[f.key] ?? ''
    if (maskSensitive && f.sensitive) {
      out[f.key] = v.trim() ? '***' : ''
    } else {
      out[f.key] = v
    }
  }
  return out
}

/**
 * Returns the manifest keys whose effective value differs from what the bot
 * was originally launched with. Used by the UI to highlight "unsaved relative
 * to .env" / "needs restart for these N keys".
 */
export function changedFromBoot(fields: ConfigField[]): string[] {
  const snap = getBootEnvSnapshot()
  const out: string[] = []
  for (const f of fields) {
    const cur = process.env[f.key] ?? ''
    const orig = snap[f.key] ?? ''
    if (cur !== orig) out.push(f.key)
  }
  return out
}

let bootSnapshot: Readonly<Record<string, string>> | null = null

/**
 * Snapshot of process.env at first call (taken just before the first manifest
 * fetch). `dashboard-overrides.json` has already been merged into process.env
 * by config-bootstrap by then, so this represents the bot's launch state.
 */
function getBootEnvSnapshot(): Readonly<Record<string, string>> {
  if (bootSnapshot) return bootSnapshot
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === 'string') out[k] = v
  }
  bootSnapshot = Object.freeze(out)
  return bootSnapshot
}

export function allManifestFields(): ConfigField[] {
  return getConfigManifest()
}

// Exported so the dashboard server can prime the snapshot at startup, before
// any user-driven mutations land.
export function primeBootSnapshot(): void {
  void getBootEnvSnapshot()
}
