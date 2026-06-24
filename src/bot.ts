/**
 * ND Discord bot, Nightz Development + Google Gemini.
 * Run: bun install && copy .env.example to .env, fill keys, bun start
 */
import { installProcessGuards } from './process-guards.ts'

installProcessGuards()

import { Client, Events, GatewayIntentBits, Partials } from 'discord.js'
import { registerInteractionHandler, registerSlashCommands } from './commands/index.ts'
import {
  allowedDmUsers,
  embeddingRefreshMinutes,
  enableDmSupport,
  guildAiTicketCategoryIds,
  guildChannelIds,
  MODEL_ID,
  persistentMemoryEnabled,
  profileScanCustomStatus,
  profileScanEnabled,
  storePageRefreshMinutes,
  TOKEN,
  vectorRetrievalEnabled,
} from './config.ts'
import {
  setDiscordClient,
  setDiscordPresenceStats,
  setDiscordReady,
  setDiscordStatus,
} from './dashboard/runtime-state.ts'
import { isLocalDashboardConfigured, startDashboard } from './dashboard/server.ts'
import { registerAiFeedbackHandler } from './handlers/ai-feedback.ts'
import { initAuditChannel, registerAuditHandler } from './handlers/audit.ts'
import { registerMessageHandler } from './handlers/messages.ts'
import { registerTempVc, startGiveawayLoop, startScheduleLoop } from './handlers/prefix-extra.ts'
import { registerReactionRoles } from './handlers/roles-reaction.ts'
import { registerWelcomeHandler } from './handlers/welcome.ts'
import { registerAfk } from './services/afk.ts'
import { registerRaidTracking, startAiAutomodProcessor } from './services/ai-automod.ts'
import { registerAutoDelete } from './services/auto-delete.ts'
import { startAutoPurgeLoop } from './services/auto-purge.ts'
import { refreshCodebaseIndex, startCodebaseRefreshLoop } from './services/codebase.ts'
import { validateConfigOrExit } from './services/config-validate.ts'
import { startCounterChannelLoop } from './services/counter-channels.ts'
import { ensureDataDir } from './services/data-store.ts'
import { registerAltDetection } from './services/alt-detection.ts'
import { registerQuarantineRoleSwap } from './services/quarantine-roleswap.ts'
import { startScheduledActionsLoop } from './services/scheduled-actions-store.ts'
import { registerStarboard } from './services/starboard.ts'
import { registerVerification } from './services/verification.ts'
import { rebuildEmbeddingIndex } from './services/embeddings.ts'
import { refreshFaqOnce, startFaqLoop } from './services/faq.ts'
import { registerLevels } from './services/levels.ts'
import { initLogChannels } from './services/logging.ts'
import { initConversationMemory } from './services/memory.ts'
import { registerPollMonitor } from './services/poll-monitor.ts'
import { refreshProductDocs, startProductDocsRefreshLoop } from './services/product-docs.ts'
import { registerProfileScan } from './services/profile-scan.ts'
import { refreshStoreSnapshot, startStorePageSnapshotLoop } from './services/store-snapshot.ts'
import {
  deployTicketPanel,
  startTicketAutoCloseLoop,
  startTicketSlaWatchLoop,
} from './services/ticket-system.ts'
import { acquireInstanceLock } from './utils/single-instance.ts'

validateConfigOrExit()
/** Listens as soon as env is valid; does not wait for Discord `ready` (so you can use it with an invalid/missing bot token). */
// The dashboard is secondary: a bind failure (e.g. port already in use by another
// instance) must NOT crash the bot - Discord connectivity is the primary job.
try {
  startDashboard()
} catch (e) {
  console.error(
    '[dashboard] failed to start (continuing without it; is the port already in use?):',
    e instanceof Error ? e.message : e,
  )
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.DirectMessageReactions,
    GatewayIntentBits.DirectMessageTyping,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    ...(profileScanEnabled && profileScanCustomStatus ? [GatewayIntentBits.GuildPresences] : []),
  ],
  partials: [Partials.Channel, Partials.Message, Partials.User, Partials.Reaction],
})

registerMessageHandler(client)
registerWelcomeHandler(client)
registerVerification(client)
registerAltDetection(client)
registerQuarantineRoleSwap(client)
registerStarboard(client)
registerInteractionHandler(client)
registerAuditHandler(client)
registerReactionRoles(client)
registerTempVc(client)
registerAiFeedbackHandler(client)
registerPollMonitor(client)
registerAutoDelete(client)
registerAfk(client)
registerLevels(client)

client.on(Events.Error, (err) => {
  console.error('[discord] client error (gateway):', err)
  setDiscordStatus('disconnected', err)
})
client.on(Events.Warn, (msg) => {
  console.warn('[discord] client warn:', msg)
})

setDiscordStatus('connecting')

function syncPresenceStats(c: Client): void {
  const gc = c.guilds.cache.size
  const raw = c.ws.ping
  const wsPingMs = Number.isFinite(raw) && raw >= 0 ? Math.round(raw) : null
  setDiscordPresenceStats({ guildCount: gc, wsPingMs })
}

client.once(Events.ClientReady, async (c) => {
  // Each startup step is isolated: a single failure (a bad slash-command schema, a
  // transient Discord 5xx, one init throwing) must not abort the rest of startup or
  // escape as an unhandledRejection, which the process guard counts toward a force-exit.
  const step = async (name: string, fn: () => unknown): Promise<void> => {
    try {
      await fn()
    } catch (e) {
      console.error(`[startup] ${name} failed:`, e)
    }
  }

  setDiscordReady(c.user.tag)
  setDiscordClient(c)
  // Register canvas fonts (Arial/Courier New aliases) so image cards render on Linux.
  const { registerCanvasFonts } = await import('./lib/fonts.ts')
  registerCanvasFonts()
  syncPresenceStats(c)
  setInterval(() => syncPresenceStats(c), 30_000).unref?.()
  await step('ensureDataDir', () => ensureDataDir())
  await step('initConversationMemory', () => initConversationMemory())
  await step('refreshFaqOnce', () => refreshFaqOnce(c))
  await step('refreshCodebaseIndex', () => refreshCodebaseIndex())
  await step('refreshProductDocs', () => refreshProductDocs())
  await step('refreshStoreSnapshot', () => refreshStoreSnapshot())
  if (vectorRetrievalEnabled) {
    await step('rebuildEmbeddingIndex', () => rebuildEmbeddingIndex())
    setInterval(() => void rebuildEmbeddingIndex(), embeddingRefreshMinutes * 60 * 1000).unref()
  }
  console.log(`Logged in as ${c.user.tag}`)
  console.log(`Model: ${MODEL_ID}`)
  console.log(
    !enableDmSupport
      ? 'DM support: OFF (set ENABLE_DM_SUPPORT=1 to enable)'
      : allowedDmUsers.size
        ? `DM support: ON, allowlist ${allowedDmUsers.size} user(s)`
        : 'DM support: ON, open to anyone who can DM the bot',
  )
  console.log(
    guildChannelIds.size
      ? `Guild channels: ${[...guildChannelIds].join(', ')}`
      : 'Guild channels: ALL (set GUILD_CHANNEL_IDS to restrict)',
  )
  if (guildAiTicketCategoryIds.size) {
    console.log(`Ticket category AI (first msg): ${[...guildAiTicketCategoryIds].join(', ')}`)
  }
  console.log(
    persistentMemoryEnabled
      ? 'Conversation memory: persisted to disk (DATA_DIR)'
      : 'Conversation memory: RAM only (set PERSISTENT_MEMORY=1)',
  )
  console.log(
    vectorRetrievalEnabled
      ? `Vector retrieval: ON (embeddings every ${embeddingRefreshMinutes}m)`
      : 'Vector retrieval: OFF (set VECTOR_RETRIEVAL_ENABLED=1 for semantic search)',
  )
  await step('registerSlashCommands', () => registerSlashCommands(client))
  await step('initLogChannels', () => initLogChannels(client))
  await step('initAuditChannel', () => initAuditChannel(client))
  await step('startFaqLoop', () => startFaqLoop(client))
  await step('startCodebaseRefreshLoop', () => startCodebaseRefreshLoop())
  await step('startProductDocsRefreshLoop', () => startProductDocsRefreshLoop())
  await step('startStorePageSnapshotLoop', () =>
    startStorePageSnapshotLoop(storePageRefreshMinutes * 60 * 1000),
  )
  await step('registerRaidTracking', () => registerRaidTracking(client))
  await step('registerProfileScan', () => registerProfileScan(client))
  await step('startAiAutomodProcessor', () => startAiAutomodProcessor(client))
  await step('startAutoPurgeLoop', () => startAutoPurgeLoop(client))
  await step('startScheduleLoop', () => startScheduleLoop(client))
  await step('startGiveawayLoop', () => startGiveawayLoop(client))
  await step('deployTicketPanel', () => deployTicketPanel(c))
  await step('startTicketAutoCloseLoop', () => startTicketAutoCloseLoop(c))
  await step('startTicketSlaWatchLoop', () => startTicketSlaWatchLoop(c))
  // Seed default ticket reply templates if store is empty
  await step('ensureDefaultTemplates', async () => {
    const { ensureDefaultTemplates } = await import('./services/ticket-templates.ts')
    await ensureDefaultTemplates()
  })
  await step('startCounterChannelLoop', () => startCounterChannelLoop(c))
  await step('startScheduledActionsLoop', () => startScheduledActionsLoop(c))
  await step('restoreLockdownState', async () => {
    const { restoreLockdownState } = await import('./services/lockdown.ts')
    await restoreLockdownState()
  })
  await step('startStreamingAlertsLoop', async () => {
    const { startStreamingAlertsLoop } = await import('./services/streaming-alerts.ts')
    startStreamingAlertsLoop(c)
  })
  await step('startLeaderboardSnapshotLoop', async () => {
    const { startLeaderboardSnapshotLoop } = await import('./services/leaderboard-snapshots.ts')
    startLeaderboardSnapshotLoop(c)
  })
  await step('initSeasonalEvents', async () => {
    const { initSeasonalEvents } = await import('./services/seasonal-events.ts')
    await initSeasonalEvents()
  })
  await step('startWeeklyModReportLoop', async () => {
    const { startWeeklyModReportLoop } = await import('./services/weekly-mod-report.ts')
    startWeeklyModReportLoop(c)
  })
  // Start timezone reminder background loop
  await step('startReminderLoop', async () => {
    const { startReminderLoop } = await import('./services/timezone-scheduler.ts')
    startReminderLoop(c)
  })
  // Audit alert poller: posts security alerts to staff channel
  await step('startAuditAlertPoller', async () => {
    const { startAuditAlertPoller } = await import('./services/audit-alert-poller.ts')
    startAuditAlertPoller(c)
  })
})

// Graceful shutdown: PM2 sends SIGINT on restart and SIGTERM on stop/reboot. Flush
// the audit buffer, close the Discord gateway, and checkpoint+close SQLite cleanly
// so restarts don't drop audit entries, leave a zombie session, or grow the WAL.
// A hard-timeout fallback guarantees we still exit even if a step hangs.
let shuttingDown = false
async function gracefulShutdown(signal: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`[bot] ${signal} received; shutting down gracefully...`)
  const hardExit = setTimeout(() => process.exit(0), 5000)
  hardExit.unref?.()
  try {
    const { flushAuditBuffer } = await import('./dashboard/audit.ts')
    await flushAuditBuffer().catch(() => {})
  } catch {
    /* audit optional */
  }
  try {
    await client.destroy()
  } catch {
    /* best-effort */
  }
  try {
    const { closeDb } = await import('./services/nd-db.ts')
    closeDb()
  } catch {
    /* best-effort */
  }
  process.exit(0)
}
process.once('SIGINT', () => void gracefulShutdown('SIGINT'))
process.once('SIGTERM', () => void gracefulShutdown('SIGTERM'))

void (async () => {
  await ensureDataDir()
  acquireInstanceLock()
  await client.login(TOKEN)
})().catch((e) => {
  console.error('Discord login failed:', e)
  setDiscordStatus('login_failed', e)
  if (isLocalDashboardConfigured()) {
    console.error(
      '[bot] Localhost dashboard is still running; fix DISCORD_BOT_TOKEN and run `bunx pm2 restart nd-bot` (or restart the process).',
    )
    return
  }
  process.exit(1)
})
