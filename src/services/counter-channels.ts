/**
 * ServerStats-style "counter" channels: update channel **names** with a live {count} from guild stats.
 * Data: data/counters.json, not controlled by the local admin HTTP UI.
 */
import {
  ChannelType,
  type ChatInputCommandInteraction,
  type Client,
  type Guild,
  type GuildChannel,
  type GuildMember,
  MessageFlags,
} from 'discord.js'
import { counterChannelsEnabled, counterChannelsUpdateMs } from '../config.ts'
import { isGuildMod } from '../utils/permissions.ts'
import { readJson, writeJson } from './data-store.ts'

const FILE = 'counters.json'
const MAX_PER_GUILD = 15
const MAX_ROWS = 200
const STAGGER_MS = 1_500

type StatKind =
  | 'members'
  | 'humans'
  | 'bots'
  | 'boosts'
  | 'roles'
  | 'emojis'
  | 'stickers'
  | 'text_channels'
  | 'voice_channels'
  | 'all_channels'
  | 'online'

type CounterRow = { guildId: string; channelId: string; stat: StatKind; template: string }

type StoreV1 = { v: 1; rows: CounterRow[] }

const defaultTemplates: Record<StatKind, string> = {
  members: 'Members: {count}',
  humans: 'Humans: {count}',
  bots: 'Bots: {count}',
  boosts: 'Boosts: {count}',
  roles: 'Roles: {count}',
  emojis: 'Emojis: {count}',
  stickers: 'Stickers: {count}',
  text_channels: 'Text channels: {count}',
  voice_channels: 'Voice channels: {count}',
  all_channels: 'Channels: {count}',
  online: 'Online: {count}',
}

const textTypes = new Set([
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildForum,
])
const voiceTypes = new Set([ChannelType.GuildVoice, ChannelType.GuildStageVoice])

function emptyStore(): StoreV1 {
  return { v: 1, rows: [] }
}

async function loadStore(): Promise<StoreV1> {
  return readJson<StoreV1>(FILE, emptyStore())
}

async function saveStore(s: StoreV1): Promise<void> {
  await writeJson(FILE, s)
}

function formatCount(n: number): string {
  return n.toLocaleString('en-US')
}

function countTextChannels(g: Guild): number {
  let n = 0
  for (const c of g.channels.cache.values()) {
    if (textTypes.has(c.type) && c.isTextBased() && c.guildId === g.id) n++
  }
  return n
}

function countVoiceChannels(g: Guild): number {
  let n = 0
  for (const c of g.channels.cache.values()) {
    if (voiceTypes.has(c.type) && c.guildId === g.id) n++
  }
  return n
}

function countOnline(guild: Guild): number {
  let n = 0
  for (const m of guild.members.cache.values()) {
    const s = m.presence?.status
    if (s && s !== 'offline' && s !== 'invisible') n++
  }
  return n
}

function resolveStat(g: Guild, stat: StatKind): number {
  switch (stat) {
    case 'members':
      return g.memberCount
    case 'humans':
      return [...g.members.cache.values()].filter((m) => !m.user.bot).length
    case 'bots':
      return [...g.members.cache.values()].filter((m) => m.user.bot).length
    case 'boosts':
      return g.premiumSubscriptionCount ?? 0
    case 'roles':
      return g.roles.cache.size
    case 'emojis':
      return g.emojis.cache.size
    case 'stickers':
      return g.stickers.cache.size
    case 'text_channels':
      return countTextChannels(g)
    case 'voice_channels':
      return countVoiceChannels(g)
    case 'all_channels':
      return g.channels.cache.size
    case 'online':
      return countOnline(g)
    default:
      return 0
  }
}

function buildName(template: string, value: number): string {
  const t = template.replace(/\{count\}/g, formatCount(value))
  return t.length > 100 ? t.slice(0, 100) : t
}

/** Update one counter row; no-op if name unchanged. */
export async function applyCounterForRow(
  client: Client,
  row: CounterRow,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const g = (await client.guilds.fetch(row.guildId).catch(() => null)) as Guild | null
  if (!g) return { ok: false, reason: 'Guild not found (bot removed?)' }
  const ch = (await g.channels.fetch(row.channelId).catch(() => null)) as GuildChannel | null
  if (!ch) return { ok: false, reason: 'Channel not found' }
  if (!ch.manageable)
    return { ok: false, reason: 'Missing **Manage Channel** (or role hierarchy) for this channel' }

  const n = resolveStat(g, row.stat)
  const next = buildName(row.template, n)
  if (ch.name === next) return { ok: true }

  try {
    await ch.setName(next, 'Nightz counter: stat channel update')
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e)
    return { ok: false, reason: `Rename failed: ${err.slice(0, 200)}` }
  }
  return { ok: true }
}

export async function refreshAllForGuild(
  client: Client,
  guildId: string,
  rowsFilter?: (r: CounterRow) => boolean,
): Promise<void> {
  const store = await loadStore()
  const rows = store.rows.filter(
    (r) => r.guildId === guildId && (rowsFilter ? rowsFilter(r) : true),
  )
  for (const row of rows) {
    const r = await applyCounterForRow(client, row)
    if (!r.ok) {
      console.warn(`[counters] ${row.channelId} in ${guildId}: ${r.reason}`)
    }
    if (STAGGER_MS > 0) {
      await new Promise((x) => setTimeout(x, STAGGER_MS))
    }
  }
}

export async function refreshAllGlobal(client: Client): Promise<void> {
  const store = await loadStore()
  const guildIds = new Set(store.rows.map((r) => r.guildId))
  for (const gid of guildIds) {
    await refreshAllForGuild(client, gid)
  }
}

let loop: ReturnType<typeof setInterval> | null = null

export function startCounterChannelLoop(client: Client): void {
  if (!counterChannelsEnabled) {
    console.info('[counters] off: set COUNTER_CHANNELS_ENABLED=1 to run stat channel updates')
    return
  }
  if (loop) return
  const ms = counterChannelsUpdateMs
  const tick = () => {
    void refreshAllGlobal(client).catch((e) => console.warn('[counters] refresh failed:', e))
  }
  loop = setInterval(tick, ms)
  loop.unref?.()
  void loadStore()
    .then((s) => {
      console.log(
        `[counters] enabled: ${s.rows.length} row(s), refresh ~every ${Math.round(ms / 60_000)}m (set COUNTER_CHANNELS_UPDATE_MS)`,
      )
    })
    .catch(() => {})
  void tick()
}

// ────────────────────────────────────────────────────────────────────────
// Module-level CRUD API (used by dashboard endpoints)
// ────────────────────────────────────────────────────────────────────────

export type CounterRowWithPreview = CounterRow & {
  preview?: string | undefined
  channelName?: string | undefined
}

export async function listCounters(): Promise<CounterRow[]> {
  const store = await loadStore()
  return store.rows
}

export async function listCountersWithPreview(client: Client): Promise<CounterRowWithPreview[]> {
  const store = await loadStore()
  const out: CounterRowWithPreview[] = []
  for (const row of store.rows) {
    const g = (await client.guilds.fetch(row.guildId).catch(() => null)) as Guild | null
    let preview: string | undefined
    let channelName: string | undefined
    if (g) {
      try {
        const n = resolveStat(g, row.stat)
        preview = buildName(row.template, n)
      } catch {
        /* ignore */
      }
      const ch = g.channels.cache.get(row.channelId)
      if (ch) channelName = ch.name
    }
    out.push({ ...row, preview, channelName })
  }
  return out
}

export async function addCounter(
  guildId: string,
  channelId: string,
  stat: string,
  template?: string,
): Promise<{ ok: true; row: CounterRow } | { ok: false; error: string }> {
  const s = parseStat(stat)
  if (!s)
    return {
      ok: false,
      error: `Invalid stat. Allowed: ${Object.keys(defaultTemplates).join(', ')}`,
    }
  const tpl = (template ?? defaultTemplates[s]).trim()
  const tplErr = validateTemplate(tpl)
  if (tplErr) return { ok: false, error: tplErr }
  const store = await loadStore()
  if (store.rows.length >= MAX_ROWS) return { ok: false, error: 'Global counter limit reached' }
  if (store.rows.filter((r) => r.guildId === guildId).length >= MAX_PER_GUILD) {
    return { ok: false, error: `Per-guild limit (${MAX_PER_GUILD}) reached` }
  }
  if (store.rows.some((r) => r.channelId === channelId)) {
    return { ok: false, error: 'Channel already has a counter, delete it first' }
  }
  const row: CounterRow = { guildId, channelId, stat: s, template: tpl }
  store.rows.push(row)
  await saveStore(store)
  return { ok: true, row }
}

export async function updateCounter(
  channelId: string,
  patch: { stat?: string; template?: string },
): Promise<{ ok: true; row: CounterRow } | { ok: false; error: string }> {
  const store = await loadStore()
  const row = store.rows.find((r) => r.channelId === channelId)
  if (!row) return { ok: false, error: 'Counter not found' }
  if (patch.stat !== undefined) {
    const s = parseStat(patch.stat)
    if (!s) return { ok: false, error: 'Invalid stat' }
    row.stat = s
  }
  if (patch.template !== undefined) {
    const tplErr = validateTemplate(patch.template)
    if (tplErr) return { ok: false, error: tplErr }
    row.template = patch.template.trim()
  }
  await saveStore(store)
  return { ok: true, row }
}

export async function deleteCounter(channelId: string): Promise<boolean> {
  const store = await loadStore()
  const before = store.rows.length
  store.rows = store.rows.filter((r) => r.channelId !== channelId)
  if (store.rows.length === before) return false
  await saveStore(store)
  return true
}

export function listAvailableStats(): Array<{ key: string; defaultTemplate: string }> {
  return Object.entries(defaultTemplates).map(([key, defaultTemplate]) => ({
    key,
    defaultTemplate,
  }))
}

function parseStat(s: string | null): StatKind | null {
  if (!s) return null
  const v = s as StatKind
  if (v in defaultTemplates) return v
  return null
}

function validateTemplate(t: string): string | null {
  const s = t.trim()
  if (!s.includes('{count}')) {
    return 'Template must include `{count}` (e.g. `Members: {count}`).'
  }
  if (s.length > 90) return 'Template is too long (max 90).'
  return null
}

export async function handleCountersSlash(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!counterChannelsEnabled) {
    await interaction.reply({
      content: 'Counter channels are disabled (`COUNTER_CHANNELS_ENABLED=0`).',
      flags: MessageFlags.Ephemeral,
    })
    return
  }

  if (!interaction.guild) {
    await interaction.reply({ content: 'Use this in a server.', flags: MessageFlags.Ephemeral })
    return
  }

  const modMember = await interaction.guild.members.fetch(interaction.user.id).catch(() => null)
  if (!isGuildMod(modMember)) {
    await interaction.reply({
      content: 'Moderator only (Manage Server / mod roles).',
      flags: MessageFlags.Ephemeral,
    })
    return
  }

  const sub = interaction.options.getSubcommand(false)
  const guild = interaction.guild
  const guildId = guild.id

  if (sub === 'add') {
    const ch = interaction.options.getChannel('channel', true)
    const stat = parseStat(interaction.options.getString('stat', true))
    if (!stat) {
      await interaction.reply({ content: 'Invalid stat.', flags: MessageFlags.Ephemeral })
      return
    }
    const rawT = interaction.options.getString('template')?.trim()
    const template = rawT && rawT.length > 0 ? rawT : defaultTemplates[stat]
    const e = validateTemplate(template)
    if (e) {
      await interaction.reply({ content: e, flags: MessageFlags.Ephemeral })
      return
    }

    if (!('name' in ch) || ch.guildId !== guildId) {
      await interaction.reply({
        content: 'Pick a channel in this server.',
        flags: MessageFlags.Ephemeral,
      })
      return
    }
    const t = ch.type
    const isSupported = textTypes.has(t) || voiceTypes.has(t)
    if (!isSupported) {
      await interaction.reply({
        content: 'That channel type is not supported.',
        flags: MessageFlags.Ephemeral,
      })
      return
    }
    if (!(ch as GuildChannel).manageable) {
      await interaction.reply({
        content: 'I need **Manage Channel** (and a role above the channel) to rename that channel.',
        flags: MessageFlags.Ephemeral,
      })
      return
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral })

    const store = await loadStore()
    if (store.rows.length >= MAX_ROWS) {
      await interaction.editReply({
        content: `This bot already has the maximum of **${MAX_ROWS}** stat channels. Remove one first.`,
      })
      return
    }
    const inGuild = store.rows.filter((r) => r.guildId === guildId)
    if (inGuild.length >= MAX_PER_GUILD) {
      await interaction.editReply({
        content: `This server is at the **${MAX_PER_GUILD}** counter limit. Remove one with \`/counters remove\`.`,
      })
      return
    }

    const existing = store.rows.findIndex((r) => r.guildId === guildId && r.channelId === ch.id)
    const row: CounterRow = { guildId, channelId: ch.id, stat, template }
    if (existing >= 0) store.rows[existing] = row
    else store.rows.push(row)
    await saveStore(store)

    const res = await applyCounterForRow(interaction.client, row)
    if (res.ok) {
      await interaction.editReply({
        content: `**Counter registered.** Channel <#${ch.id}> will show **${stat}** using: \`${template.replace(/`/g, '´')}\`. Updates run about every ${Math.round(
          counterChannelsUpdateMs / 60_000,
        )} minutes (or \`/counters refresh\`).`,
      })
    } else {
      await interaction.editReply({
        content: `Saved, but the first update failed: ${res.reason}`,
      })
    }
    return
  }

  if (sub === 'remove') {
    const ch = interaction.options.getChannel('channel', true)
    const store = await loadStore()
    const before = store.rows.length
    store.rows = store.rows.filter((r) => !(r.guildId === guildId && r.channelId === ch.id))
    if (store.rows.length === before) {
      await interaction.reply({
        content: 'That channel is not in the counter list.',
        flags: MessageFlags.Ephemeral,
      })
      return
    }
    await saveStore(store)
    await interaction.reply({
      content: `Removed <#${ch.id}> from stat counters.`,
      flags: MessageFlags.Ephemeral,
    })
    return
  }

  if (sub === 'list') {
    const store = await loadStore()
    const list = store.rows.filter((r) => r.guildId === guildId)
    if (list.length === 0) {
      await interaction.reply({
        content: 'No stat channels registered. Use `/counters add`.',
        flags: MessageFlags.Ephemeral,
      })
      return
    }
    const lines = list.map((r) => `• <#${r.channelId}> - **${r.stat}** - \`${r.template}\``)
    await interaction.reply({
      content: `**Stat channels (${list.length}):**\n${lines.join('\n').slice(0, 3900)}`,
      flags: MessageFlags.Ephemeral,
    })
    return
  }

  if (sub === 'refresh') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral })
    await refreshAllForGuild(interaction.client, guildId)
    await interaction.editReply({
      content: '**Refresh done.** (Check channel names; Discord may rate-limit rapid renames.)',
    })
    return
  }

  await interaction.reply({
    content:
      'Use a subcommand: **add**, **remove**, **list**, or **refresh**. If the command is missing, restart the bot and wait a bit for global commands to sync (or set `SLASH_COMMANDS_GUILD_ID` for your server during testing).',
    flags: MessageFlags.Ephemeral,
  })
}
