/**
 * Guild lockdown state. The in-memory Set is the source of truth (checked on
 * the hot message path); changes are persisted so lockdown survives restarts.
 */
import { readJson, writeJson } from './data-store.ts'

const FILE = 'lockdown.json'

/** Guild IDs in lockdown (nd!lockdown or raid auto-lock). Non-mods are restricted. */
export const lockdownGuilds = new Set<string>()

type Store = { guilds: string[] }

/** Load persisted lockdown state into memory. Call once on boot. */
export async function restoreLockdownState(): Promise<void> {
  const data = await readJson<Store>(FILE, { guilds: [] })
  for (const g of data.guilds ?? []) lockdownGuilds.add(g)
}

async function persist(): Promise<void> {
  await writeJson(FILE, { guilds: [...lockdownGuilds] })
}

export function isLockedDown(guildId: string): boolean {
  return lockdownGuilds.has(guildId)
}

/** Turn lockdown on/off for a guild and persist the change. */
export async function setLockdown(guildId: string, on: boolean): Promise<void> {
  if (on) lockdownGuilds.add(guildId)
  else lockdownGuilds.delete(guildId)
  await persist()
}
