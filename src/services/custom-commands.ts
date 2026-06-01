/**
 * Custom Commands
 * Allows users to create simple text-based commands
 *
 * Storage: data/custom-commands.json
 * {
 *   "command_name": {
 *     "response": "response text",
 *     "aliases": ["alias1", "alias2"],
 *     "createdBy": "user-id",
 *     "createdAt": 1234567890,
 *     "cooldown": 0,
 *     "permissions": "everyone"
 *   }
 * }
 */

import { readJson, writeJson } from './data-store.ts'

const COMMANDS_FILE = 'data/custom-commands.json'

export interface CustomCommand {
  response: string
  aliases: string[]
  createdBy: string
  createdAt: number
  cooldown: number // seconds, 0 = no cooldown
  permissions: 'everyone' | 'members' | 'moderators' | 'admins'
  usageCount: number
  lastUsedAt?: number
}

type CommandsStore = Record<string, CustomCommand>

let commands: CommandsStore = {}

/**
 * Load custom commands from storage
 */
export async function loadCustomCommands(): Promise<void> {
  try {
    commands = await readJson<CommandsStore>(COMMANDS_FILE, {})
    console.log(`[commands] loaded ${Object.keys(commands).length} custom command(s)`)
  } catch (e) {
    console.warn('[commands] load failed:', e)
    commands = {}
  }
}

/**
 * Save custom commands to storage
 */
async function saveCommands(): Promise<void> {
  try {
    await writeJson(COMMANDS_FILE, commands)
  } catch (e) {
    console.error('[commands] save failed:', e)
  }
}

/**
 * Add a new custom command
 */
export async function addCommand(
  name: string,
  response: string,
  userId: string,
  aliases: string[] = [],
): Promise<{ ok: boolean; error?: string }> {
  const normalized = name.toLowerCase()

  // Validation
  if (!normalized.match(/^[a-z0-9_-]{1,32}$/)) {
    return {
      ok: false,
      error: 'Command name must be 1-32 chars, alphanumeric/underscore/dash only',
    }
  }

  if (response.length > 2000) {
    return { ok: false, error: 'Response must be under 2000 characters' }
  }

  if (commands[normalized]) {
    return { ok: false, error: `Command \`${normalized}\` already exists` }
  }

  // Check aliases don't conflict
  for (const alias of aliases) {
    if (commands[alias.toLowerCase()]) {
      return { ok: false, error: `Alias \`${alias}\` conflicts with existing command` }
    }
  }

  commands[normalized] = {
    response,
    aliases: aliases.map((a) => a.toLowerCase()),
    createdBy: userId,
    createdAt: Date.now(),
    cooldown: 0,
    permissions: 'everyone',
    usageCount: 0,
  }

  await saveCommands()
  return { ok: true }
}

/**
 * Get command by name or alias
 */
export function getCommand(name: string): CustomCommand | null {
  return commands[name.toLowerCase()] ?? null
}

/**
 * List all commands
 */
export function listCommands(): Array<{ name: string; command: CustomCommand }> {
  return Object.entries(commands).map(([name, command]) => ({ name, command }))
}

/**
 * Delete a custom command
 */
export async function deleteCommand(
  name: string,
  userId: string,
): Promise<{ ok: boolean; error?: string }> {
  const normalized = name.toLowerCase()
  const cmd = commands[normalized]

  if (!cmd) {
    return { ok: false, error: `Command \`${normalized}\` not found` }
  }

  // Only creator or admin can delete
  if (cmd.createdBy !== userId) {
    return { ok: false, error: 'Only the creator can delete this command' }
  }

  delete commands[normalized]
  await saveCommands()
  return { ok: true }
}

/**
 * Update command response
 */
export async function updateCommand(
  name: string,
  response: string,
  userId: string,
): Promise<{ ok: boolean; error?: string }> {
  const normalized = name.toLowerCase()
  const cmd = commands[normalized]

  if (!cmd) {
    return { ok: false, error: `Command \`${normalized}\` not found` }
  }

  if (cmd.createdBy !== userId) {
    return { ok: false, error: 'Only the creator can update this command' }
  }

  if (response.length > 2000) {
    return { ok: false, error: 'Response must be under 2000 characters' }
  }

  cmd.response = response
  await saveCommands()
  return { ok: true }
}

/**
 * Execute command and track usage
 */
export async function executeCommand(
  name: string,
): Promise<{ ok: boolean; response?: string; error?: string }> {
  const cmd = getCommand(name)

  if (!cmd) {
    return { ok: false, error: `Command \`${name}\` not found` }
  }

  // Check cooldown
  if (cmd.cooldown > 0 && cmd.lastUsedAt) {
    const elapsed = (Date.now() - cmd.lastUsedAt) / 1000
    if (elapsed < cmd.cooldown) {
      const remaining = Math.ceil(cmd.cooldown - elapsed)
      return { ok: false, error: `Command on cooldown for ${remaining} more seconds` }
    }
  }

  // Update usage
  cmd.usageCount++
  cmd.lastUsedAt = Date.now()
  await saveCommands()

  return { ok: true, response: cmd.response }
}

/** Admin force-delete: bypasses creator check (for dashboard use). */
export async function forceDeleteCommand(name: string): Promise<boolean> {
  const normalized = name.toLowerCase()
  if (!commands[normalized]) return false
  delete commands[normalized]
  await saveCommands()
  return true
}

/** Admin force-update: bypasses creator check and allows setting all fields. */
export async function forceUpdateCommand(
  name: string,
  patch: Partial<Pick<CustomCommand, 'response' | 'cooldown' | 'permissions' | 'aliases'>>,
): Promise<{ ok: boolean; error?: string }> {
  const normalized = name.toLowerCase()
  if (!commands[normalized]) return { ok: false, error: `Command \`${normalized}\` not found` }
  if (patch.response !== undefined && patch.response.length > 2000)
    return { ok: false, error: 'Response must be under 2000 characters' }
  Object.assign(commands[normalized], patch)
  await saveCommands()
  return { ok: true }
}

/**
 * Get command stats
 */
export function getCommandStats(): {
  total: number
  mostUsed: string
  recentlyUsed: string[]
} {
  const cmds = Object.entries(commands)
  const mostUsed = cmds.sort(([, a], [, b]) => b.usageCount - a.usageCount)[0]?.[0] ?? 'none'
  const recent = cmds
    .filter(([, c]) => c.lastUsedAt)
    .sort(([, a], [, b]) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0))
    .slice(0, 5)
    .map(([name]) => name)

  return {
    total: cmds.length,
    mostUsed,
    recentlyUsed: recent,
  }
}

/**
 * Generate help text for all commands
 */
export function generateHelpText(): string {
  const cmds = listCommands()
  if (cmds.length === 0) {
    return 'No custom commands found. Use `/addcommand` to create one!'
  }

  const list = cmds.map(({ name, command }) => {
    const aliases = command.aliases.length > 0 ? ` (aliases: ${command.aliases.join(', ')})` : ''
    return `• \`${name}\`${aliases} - ${command.response.slice(0, 50)}${command.response.length > 50 ? '...' : ''}`
  })

  return `**Custom Commands** (${cmds.length} total):\n${list.join('\n')}`
}

// Initialize on module load
await loadCustomCommands()
