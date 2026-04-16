/**
 * ND Discord bot, Nightz Development + Google Gemini.
 * Run: bun install && copy .env.example to .env, fill keys, bun start
 */
import {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
} from 'discord.js'
import {
  MODEL_ID,
  TOKEN,
  embeddingRefreshMinutes,
  enableDmSupport,
  allowedDmUsers,
  guildAiTicketCategoryIds,
  guildChannelIds,
  persistentMemoryEnabled,
  vectorRetrievalEnabled,
} from './config.ts'
import { registerSlashCommands, registerInteractionHandler } from './commands/index.ts'
import { registerAiFeedbackHandler } from './handlers/ai-feedback.ts'
import { registerMessageHandler } from './handlers/messages.ts'
import { registerWelcomeHandler } from './handlers/welcome.ts'
import { refreshFaqOnce, startFaqLoop } from './services/faq.ts'
import { refreshCodebaseIndex, startCodebaseRefreshLoop } from './services/codebase.ts'
import { rebuildEmbeddingIndex } from './services/embeddings.ts'
import { initConversationMemory } from './services/memory.ts'
import {
  refreshProductDocs,
  startProductDocsRefreshLoop,
} from './services/product-docs.ts'
import { initLogChannels } from './services/logging.ts'
import { registerAuditHandler, initAuditChannel } from './handlers/audit.ts'
import { registerReactionRoles } from './handlers/roles-reaction.ts'
import {
  registerTempVc,
  startScheduleLoop,
} from './handlers/prefix-extra.ts'
import { registerRaidTracking, startAiAutomodProcessor } from './services/ai-automod.ts'
import { ensureDataDir } from './services/data-store.ts'
import { deployTicketPanel, startTicketAutoCloseLoop } from './services/ticket-system.ts'

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
  ],
  partials: [Partials.Channel, Partials.Message, Partials.User, Partials.Reaction],
})

registerMessageHandler(client)
registerWelcomeHandler(client)
registerInteractionHandler(client)
registerAuditHandler(client)
registerReactionRoles(client)
registerTempVc(client)
registerAiFeedbackHandler(client)

client.once(Events.ClientReady, async (c) => {
  await ensureDataDir()
  await initConversationMemory()
  await refreshFaqOnce(c)
  await refreshCodebaseIndex()
  await refreshProductDocs()
  if (vectorRetrievalEnabled) {
    await rebuildEmbeddingIndex()
    setInterval(
      () => void rebuildEmbeddingIndex(),
      embeddingRefreshMinutes * 60 * 1000,
    ).unref()
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
    console.log(
      `Ticket category AI (first msg): ${[...guildAiTicketCategoryIds].join(', ')}`,
    )
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
  await registerSlashCommands(client)
  await initLogChannels(client)
  await initAuditChannel(client)
  startFaqLoop(client)
  startCodebaseRefreshLoop()
  startProductDocsRefreshLoop()
  registerRaidTracking(client)
  startAiAutomodProcessor(client)
  startScheduleLoop(client)
  await deployTicketPanel(c)
  startTicketAutoCloseLoop(c)
})

client.login(TOKEN).catch((e) => {
  console.error('Discord login failed:', e)
  process.exit(1)
})
