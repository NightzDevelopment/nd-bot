/**
 * Environment and ND branding, single source of truth for the bot.
 */
import './config-bootstrap.ts'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export const TOKEN = requiredEnv('DISCORD_BOT_TOKEN')
export const GOOGLE_KEY = requiredEnv('GOOGLE_API_KEY')
export const MODEL_ID = process.env.GEMINI_MODEL ?? 'gemini-3-flash-preview'
const DEFAULT_GEMINI_FALLBACK_MODELS = [
  'gemini-3.1-pro-preview',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash-lite',
  'gemini-1.5-flash',
]
/** Comma-separated model IDs tried after GEMINI_MODEL. */
export const geminiFallbackModels = (
  process.env.GEMINI_FALLBACK_MODELS?.trim()
    ? process.env.GEMINI_FALLBACK_MODELS.split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : DEFAULT_GEMINI_FALLBACK_MODELS
) as readonly string[]
/** Optional secondary provider: OpenAI. */
export const openaiApiKey = process.env.OPENAI_API_KEY?.trim() || undefined
export const openaiEnabled = Boolean(openaiApiKey)
export const openaiBaseUrl = process.env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1'
export const openaiModel = process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini'
const DEFAULT_OPENAI_FALLBACK_MODELS = ['gpt-4.1-mini']
export const openaiFallbackModels = (
  process.env.OPENAI_FALLBACK_MODELS?.trim()
    ? process.env.OPENAI_FALLBACK_MODELS.split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : DEFAULT_OPENAI_FALLBACK_MODELS
) as readonly string[]
export const openaiRequestTimeoutMs = Math.max(
  3000,
  parseInt(process.env.OPENAI_TIMEOUT_MS ?? '45000', 10) || 45_000,
)
/** Optional tertiary provider: Anthropic Claude. */
export const claudeApiKey = process.env.CLAUDE_API_KEY?.trim() || undefined
export const claudeEnabled = Boolean(claudeApiKey)
export const claudeModel = process.env.CLAUDE_MODEL?.trim() || 'claude-sonnet-4-5-20250929'
const DEFAULT_CLAUDE_FALLBACK_MODELS = ['claude-opus-4-5-20251101', 'claude-haiku-4-5-20251001']
export const claudeFallbackModels = (
  process.env.CLAUDE_FALLBACK_MODELS?.trim()
    ? process.env.CLAUDE_FALLBACK_MODELS.split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : DEFAULT_CLAUDE_FALLBACK_MODELS
) as readonly string[]
export const claudeRequestTimeoutMs = Math.max(
  3000,
  parseInt(process.env.CLAUDE_TIMEOUT_MS ?? '45000', 10) || 45_000,
)
/** Max image size (bytes) for vision; Discord CDN fetch, default ~3 MiB. */
export const IMAGE_ATTACHMENT_MAX_BYTES = Math.min(
  4 * 1024 * 1024,
  Math.max(
    256 * 1024,
    parseInt(process.env.IMAGE_ATTACHMENT_MAX_BYTES ?? `${3 * 1024 * 1024}`, 10) || 3 * 1024 * 1024,
  ),
)
/** Max ZIP size (bytes) for attachment analysis. */
export const ZIP_ATTACHMENT_MAX_BYTES = Math.min(
  25 * 1024 * 1024,
  Math.max(
    512 * 1024,
    parseInt(process.env.ZIP_ATTACHMENT_MAX_BYTES ?? `${10 * 1024 * 1024}`, 10) || 10 * 1024 * 1024,
  ),
)
/** Max ZIP entries scanned for summaries. */
export const ZIP_ATTACHMENT_MAX_FILES = Math.min(
  200,
  Math.max(5, parseInt(process.env.ZIP_ATTACHMENT_MAX_FILES ?? '40', 10) || 40),
)
/** Max chars captured per text file when summarizing ZIP contents. */
export const ZIP_ATTACHMENT_MAX_FILE_CHARS = Math.min(
  2000,
  Math.max(120, parseInt(process.env.ZIP_ATTACHMENT_MAX_FILE_CHARS ?? '600', 10) || 600),
)

const DEFAULT_GUILD_PROMPT = `You are [ND] Nightz Development Support, powered by Google Gemini. Nightz Development sells and distributes FiveM scripts and resources.

Help users with: installation, dependencies, fxmanifest, config (Lua/JSON), ESX/QBCore/standalone compatibility, common runtime errors, updates, and licensing questions.

Rules:
- Never paste raw source code, full file contents, or long code blocks in your replies. Explain in plain language and reference file names only.
- Never share API keys, tokens, license bypasses, or internal credentials.
- If unsure, say so and suggest checking documentation or opening a support ticket.
- Stay professional and concise in public channels.
- **No emojis:** Do not use emojis, emoticons, or decorative symbols in replies unless the user explicitly asks for them. Plain text only.
- **Light humor allowed:** If the conversation is playful, you may use short clean humor while still being useful. Avoid humor in moderation/safety actions, disputes, or when the user is frustrated.
- **Lists vs essays:** If the user asks for a **list** of ND scripts, products, resources, modules, or "what do you have", answer with a **short bullet list** (markdown \`- \` lines), **one line per item** (resource name + optional few words). Prefer **distinct product folders** from indexed dev builds (e.g. \`ND_DiscordUnified\`, \`ND_Scenes\`) over long enumerations of internal \`.lua\` files unless they asked about **one** product’s internals. Do **not** write a long paragraph per item or full feature write-ups unless they ask for details on a specific item. After a list, you may add one sentence inviting them to name what they want help with.
- **Indexed product names:** Build lists from **injected codebase context** only (distinct \`RootFolder\` / top-level product directory names in snippets). Do **not** invent or guess product names (for example do not cite \`ND_Money\` or other scripts unless they appear in context). If context shows several roots, list those. If context shows only one product, say so and mention the official store or site for the full catalog without claiming you have no products.
- **One topic, one resource:** Answer about the product or script the user is actually asking about. Do not chain unrelated ND resources in one reply (for example mixing Discord bridge, weapons, parking, and menu scripts) unless the user clearly tied them together. If injected context spans different products, ignore what does not match the question and say you are focusing on the named resource only.
- **Indexed paths:** Dev-build snippets use paths like \`RootFolder/ResourceName/config/...\` where RootFolder is the indexed directory name. Prefer citing those paths when telling users where a setting lives.
- **ND_DiscordUnified layout:** Ship **AutoMod** and **AltDetection** as built-in **module configs** under \`config/modules/\`, e.g. \`automod.lua\`, \`altdetection.lua\`, together with other modules (\`notifications.lua\`, \`welcome.lua\`, \`moderation.lua\`, etc.). Point users there first. The **Extension System** (\`extensions/\`, optional \`config/extensions/\`) is for **additional** custom extensions, do **not** claim AutoMod or AltDetection are only available as user-made extensions or that their main config is only under \`config/extensions/\` unless the indexed files for that question clearly show otherwise.
- **Unreleased / internal:** Do not provide setup docs, feature lists, or support for ND_Menu, ND_Framework, or other unreleased internal resources. If asked, say they are not public yet and point to released products or a ticket.`

const DEFAULT_DM_PROMPT = `You are [ND] Nightz Development private DM support, powered by Google Gemini. ND provides FiveM scripts and resources.

Be warm and helpful. Same rules as public support: never paste raw source code in Discord, describe and reference filenames only. Never share secrets or bypass licensing.
- **No emojis:** Do not use emojis or emoticons in replies unless the user asks. Plain text only.
- **Light humor allowed:** If chat becomes playful, you may add brief clean humor while keeping help accurate. Avoid jokes in moderation/safety or conflict-heavy situations.
- **Lists vs essays:** If they want a **list** of scripts/products/modules, reply with a **compact bullet list** (one line per item, names first). Prefer **product/resource folder names** from indexed context over many internal filenames unless they asked about one product’s code layout. Do not expand every item into paragraphs unless they ask for depth on one item. Only name products that appear in injected context; do not invent names.
- **One topic, one resource:** Stay focused on the script or issue the user named; do not jump across unrelated ND products in one answer unless they asked you to compare or link them.
- **Indexed paths:** Snippets may show \`RootFolder/ResourceName/...\`; cite those when pointing to config files.
- **ND_DiscordUnified:** For **AutoMod** and **AltDetection**, direct users to \`config/modules/automod.lua\` and \`config/modules/altdetection.lua\` first; extensions are extra, not the primary place for those two unless snippets say otherwise.
- **Unreleased / internal:** Do not document or troubleshoot ND_Menu, ND_Framework, or other unreleased resources; say they are not public and offer general guidance or a ticket instead.`

/** Built-in ND / FiveM vocabulary (always appended unless ND_KEYWORDS_APPEND=0). */
const DEFAULT_ND_KEYWORDS_BLOCK = `
- **ND** = Nightz Development; products often use the \`ND_\` prefix (e.g. \`ND_DiscordUnified\`, \`ND_Scenes\`, \`ND_AFKV3\`).
- **FiveM:** a **resource** is a folder with \`fxmanifest.lua\`; install in \`server.cfg\` with \`ensure ResourceName\`. **F8** = in-game client console; server console is separate.
- **Stacks:** users may say **ESX**, **QBCore**, **standalone**, **ox_lib**, **oxmysql**; match their framework when giving steps.
- **Common pain points:** \`SCRIPT ERROR\` lines (Lua path + line), **permissions** (ACE/Discord roles), **SQL** migrations, **artifacts** (FiveM server build), **OneSync** / entity limits for large servers.
- **ND_DiscordUnified:** Discord integration resource; **modules** live under \`config/modules/\` (e.g. automod, notifications); **extensions** are optional add-ons.
- **This Discord:** direct users to **pinned FAQ**, **#tickets / ticket panel**, or **product updates** when policy or store info is involved; you are the in-channel support bot, so be accurate and avoid inventing channel names (use generic wording if unsure).
`.trim()

function ndKeywordsAppendEnabled(): boolean {
  const v = process.env.ND_KEYWORDS_APPEND ?? '1'
  return !v.trim() || !['0', 'false', 'no', 'off'].includes(v.trim().toLowerCase())
}

function loadNdKeywordsFromFile(): string {
  const p = process.env.ND_KEYWORDS_FILE?.trim()
  if (!p) return ''
  try {
    const abs = resolve(process.cwd(), p)
    if (!existsSync(abs)) {
      console.warn(`[config] ND_KEYWORDS_FILE not found: ${abs}`)
      return ''
    }
    return readFileSync(abs, 'utf8').trim()
  } catch (e) {
    console.warn('[config] ND_KEYWORDS_FILE read failed:', e)
    return ''
  }
}

function buildNdKeywordsExtra(): string {
  const chunks: string[] = []
  const file = loadNdKeywordsFromFile()
  if (file) chunks.push(file)
  const env = process.env.ND_KEYWORDS_CONTEXT?.trim()
  if (env) chunks.push(env)
  return chunks.join('\n\n')
}

const ND_KEYWORDS_EXTRA = buildNdKeywordsExtra()

function appendNdKeywords(base: string): string {
  if (!ndKeywordsAppendEnabled()) return base
  const parts = [DEFAULT_ND_KEYWORDS_BLOCK]
  if (ND_KEYWORDS_EXTRA) parts.push(ND_KEYWORDS_EXTRA)
  const block = parts.filter(Boolean).join('\n\n')
  return `${base}\n\n---\n**ND vocabulary, keywords, and Discord context (use consistently):**\n${block}`
}

const guildPromptBase =
  process.env.SYSTEM_PROMPT_GUILD?.trim() ||
  process.env.SYSTEM_PROMPT?.trim() ||
  DEFAULT_GUILD_PROMPT

const dmPromptBase = process.env.SYSTEM_PROMPT_DM?.trim() || DEFAULT_DM_PROMPT

export const SYSTEM_PROMPT_GUILD = appendNdKeywords(guildPromptBase)
export const SYSTEM_PROMPT_DM = appendNdKeywords(dmPromptBase)
/** Alias for guild system instruction (includes ND keyword block). */
export const SYSTEM_PROMPT = SYSTEM_PROMPT_GUILD

export const enableDmSupport = !isEnvOff(process.env.ENABLE_DM_SUPPORT ?? '1')
export const allowedDmUsers = parseIdSet(process.env.ALLOWED_DM_USER_IDS)
export const guildChannelIds = parseIdSet(process.env.GUILD_CHANNEL_IDS)

/**
 * Parent **category** IDs (comma-separated). In channels or threads under one of these
 * categories, a user’s **first** message in that channel always gets an AI reply (no @mention).
 */
export const guildAiTicketCategoryIds = parseIdSet(process.env.GUILD_AI_TICKET_CATEGORY_IDS)

export const WELCOME_CHANNEL_ID = process.env.WELCOME_CHANNEL_ID?.trim() || undefined
export const WELCOME_ROLE_ID = process.env.WELCOME_ROLE_ID?.trim() || undefined
/** Welcome embed links: env overrides; defaults match Nightz Development Discord layout. */
const WELCOME_CH = {
  rules: '1034938354187391039',
  announcement: '1034938354652950572',
  updates: '1477283391757090906',
  support: '1360369708125126798',
  ticket: '1364400105423114250',
} as const
export const WELCOME_RULES_CHANNEL_ID =
  process.env.WELCOME_RULES_CHANNEL_ID?.trim() || WELCOME_CH.rules
export const WELCOME_NEW_PRODUCTS_CHANNEL_ID =
  process.env.WELCOME_NEW_PRODUCTS_CHANNEL_ID?.trim() || WELCOME_CH.announcement
export const WELCOME_UPDATES_CHANNEL_ID =
  process.env.WELCOME_UPDATES_CHANNEL_ID?.trim() || WELCOME_CH.updates
export const WELCOME_GENERAL_CHANNEL_ID =
  process.env.WELCOME_GENERAL_CHANNEL_ID?.trim() || undefined
export const WELCOME_SUPPORT_CHANNEL_ID =
  process.env.WELCOME_SUPPORT_CHANNEL_ID?.trim() || WELCOME_CH.support
export const WELCOME_TICKET_CHANNEL_ID =
  process.env.WELCOME_TICKET_CHANNEL_ID?.trim() || WELCOME_CH.ticket
export const FAQ_CHANNEL_ID = process.env.FAQ_CHANNEL_ID?.trim() || undefined

export const CONVERSATION_HISTORY_LIMIT = Math.max(
  4,
  Math.min(40, parseInt(process.env.CONVERSATION_HISTORY_LIMIT ?? '30', 10) || 30),
)

/** Persist per-channel chat turns under DATA_DIR (JSON). Survives bot restarts. */
export const persistentMemoryEnabled = !isEnvOff(process.env.PERSISTENT_MEMORY ?? '1')
export const conversationMemoryFile =
  process.env.CONVERSATION_MEMORY_FILE?.trim() || 'conversation-memory.json'

/** Curated per-product markdown under this folder (e.g. data/products/ND_Foo.md). */
export const productDocsDir = process.env.PRODUCT_DOCS_DIR?.trim() || 'data/products'
export const productDocsMaxFiles = Math.min(
  8,
  Math.max(1, parseInt(process.env.PRODUCT_DOCS_MAX_FILES ?? '3', 10) || 3),
)

/**
 * Fetch public store listing (HTML→text) for AI context; refresh on a timer.
 * Nightz uses **FaxStore** (Weblutions): https://weblutions.com/store/faxstore — storefront URL is still your public `STORE_PAGE_URL`.
 */
export const storePageSnapshotEnabled = !isEnvOff(process.env.STORE_PAGE_SNAPSHOT_ENABLED ?? '1')
export const storePageUrl = process.env.STORE_PAGE_URL?.trim() || 'https://store.nightz.dev/store'
export const storePageRefreshMinutes = Math.max(
  15,
  parseInt(process.env.STORE_PAGE_REFRESH_MINUTES ?? '60', 10) || 60,
)
export const storePageMaxChars = Math.min(
  100_000,
  Math.max(2000, parseInt(process.env.STORE_PAGE_MAX_CHARS ?? '16000', 10) || 16_000),
)
export const storePageFetchTimeoutMs = Math.max(
  5000,
  parseInt(process.env.STORE_PAGE_FETCH_TIMEOUT_MS ?? '25000', 10) || 25_000,
)

function parseStoreFeaturedLines(): string[] {
  const raw = process.env.STORE_FEATURED_LINES?.trim()
  if (!raw) return []
  return raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Curated bullets for `/store` / `nd!store` (one line per row). Overrides auto-parsed “featured” list. */
export const storeFeaturedLines = parseStoreFeaturedLines()
export const storeFeaturedCount = Math.min(
  10,
  Math.max(1, parseInt(process.env.STORE_FEATURED_COUNT ?? '3', 10) || 3),
)
export const storeLookupMaxResults = Math.min(
  15,
  Math.max(1, parseInt(process.env.STORE_LOOKUP_MAX_RESULTS ?? '5', 10) || 5),
)
/** Snapshot considered “stale” in health UI after this many minutes without a successful refresh. */
export const storeSnapshotStaleMinutes = Math.max(
  30,
  parseInt(
    process.env.STORE_SNAPSHOT_STALE_MINUTES ?? String(Math.max(storePageRefreshMinutes * 2, 90)),
    10,
  ) || Math.max(storePageRefreshMinutes * 2, 90),
)

/** Gemini embedding retrieval over chunked FAQ + product docs + dev index (optional). */
export const vectorRetrievalEnabled = !isEnvOff(process.env.VECTOR_RETRIEVAL_ENABLED ?? '0')
export const embeddingModel = process.env.EMBEDDING_MODEL?.trim() || 'text-embedding-004'
export const vectorTopK = Math.min(
  12,
  Math.max(1, parseInt(process.env.VECTOR_TOP_K ?? '5', 10) || 5),
)
export const embeddingRefreshMinutes = Math.max(
  5,
  parseInt(process.env.EMBEDDING_REFRESH_MINUTES ?? '30', 10) || 30,
)
export const embeddingMaxChunkChars = Math.min(
  2000,
  Math.max(200, parseInt(process.env.EMBEDDING_MAX_CHUNK_CHARS ?? '800', 10) || 800),
)
export const embeddingMaxCorpusChunks = Math.min(
  800,
  Math.max(50, parseInt(process.env.EMBEDDING_MAX_CORPUS_CHUNKS ?? '400', 10) || 400),
)

/** Staff react on bot AI replies; negative sends details to staff log. */
export const aiFeedbackReactionsEnabled = !isEnvOff(
  process.env.AI_FEEDBACK_REACTIONS_ENABLED ?? '1',
)
export const aiFeedbackPositiveEmoji = process.env.AI_FEEDBACK_POSITIVE_EMOJI?.trim() || '\u2705'
export const aiFeedbackNegativeEmoji = process.env.AI_FEEDBACK_NEGATIVE_EMOJI?.trim() || '\u274c'
export const AI_FEEDBACK_LOG_CHANNEL_ID =
  process.env.AI_FEEDBACK_LOG_CHANNEL_ID?.trim() || undefined

const DEFAULT_DEV_BUILD_PATH = String.raw`D:\Nightz Development\Nightz Development Scripts\[ND_Discord]\[Dev Build]`

function parseDevBuildPaths(): string[] {
  const multi = process.env.DEV_BUILD_PATHS?.trim()
  if (multi) {
    const out: string[] = []
    for (const line of multi.split(/\r?\n/)) {
      for (const part of line.split(',')) {
        const p = part.trim()
        if (p) out.push(p)
      }
    }
    const uniq = [...new Set(out)]
    if (uniq.length > 0) return uniq
  }
  const single = process.env.DEV_BUILD_PATH?.trim()
  if (single) return [single]
  return [DEFAULT_DEV_BUILD_PATH]
}

/** All local roots scanned for AI context. Set `DEV_BUILD_PATHS` (comma or newline) to index every product folder; when empty, `DEV_BUILD_PATH` (single) is used. */
export const devBuildPaths = parseDevBuildPaths()

/** First root, backward compatible alias for logs and legacy .env */
export const DEV_BUILD_PATH = devBuildPaths[0] ?? DEFAULT_DEV_BUILD_PATH
export const CODEBASE_REFRESH_MINUTES = Math.max(
  1,
  parseInt(process.env.CODEBASE_REFRESH_MINUTES ?? '10', 10) || 10,
)
export const CODEBASE_MAX_FILE_BYTES = 100 * 1024
/** Substrings matched against indexed relative paths (case-insensitive); excluded from AI context. */
export const codebaseExcludePathSubstrings = (
  process.env.CODEBASE_EXCLUDE_PATH_SUBSTRINGS?.trim()
    ? process.env.CODEBASE_EXCLUDE_PATH_SUBSTRINGS.split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : ['ND_Menu', 'ND_Framework']
) as readonly string[]
/** Max dev-build files injected per reply (all from one resource folder when single-resource mode is on). */
export const codebaseMaxFiles = Math.min(
  12,
  Math.max(1, parseInt(process.env.CODEBASE_MAX_FILES ?? '6', 10) || 6),
)
/** When on, only files under the single best-matching top-level resource folder are injected. */
export const codebaseSingleResourceMode = !isEnvOff(
  process.env.CODEBASE_SINGLE_RESOURCE_MODE ?? '1',
)
export const EXTRA_BANNED_WORDS = parseCommaList(process.env.EXTRA_BANNED_WORDS)

/** Short-circuit AI with random “coming soon” replies when user text matches these products (normalized, substring). */
export const comingSoonRepliesEnabled = !isEnvOff(process.env.COMING_SOON_REPLIES_ENABLED ?? '1')
const DEFAULT_COMING_SOON_RESOURCES = 'ND_Menu,ND_Framework,ND_Fuel,ND_Inventory,ND_Shops,ND_Taser'

function parseComingSoonNeedles(): string[] {
  const raw = process.env.COMING_SOON_RESOURCES?.trim() || DEFAULT_COMING_SOON_RESOURCES
  const seen = new Set<string>()
  for (const part of raw.split(',')) {
    const p = part.trim()
    if (!p) continue
    const n = p.toLowerCase().replace(/[^a-z0-9]/g, '')
    if (n.length >= 4) seen.add(n)
  }
  return [...seen]
}

export const comingSoonNormalizedNeedles: readonly string[] = parseComingSoonNeedles()

export const FAQ_REFRESH_MS = Math.max(
  60_000,
  parseInt(process.env.FAQ_REFRESH_MS ?? `${30 * 60 * 1000}`, 10) || 30 * 60 * 1000,
)

/** Channel where profanity/abuse alerts are sent to staff */
export const STAFF_LOG_CHANNEL_ID = process.env.STAFF_LOG_CHANNEL_ID?.trim() || undefined
/** Channel where all DM conversations are recorded (for staff review) */
export const DM_LOG_CHANNEL_ID = process.env.DM_LOG_CHANNEL_ID?.trim() || undefined

/** Native Discord polls: vote logs to staff + “last hour” reminder in the poll channel */
export const pollMonitorEnabled = !isEnvOff(process.env.POLL_MONITOR_ENABLED ?? '0')
/**
 * Your **polls** channel(s) only — same place vote logs apply and last-hour pings go.
 * Prefer `POLL_REMINDER_CHANNEL_IDS`; `POLL_MONITOR_CHANNEL_IDS` is still read for compatibility.
 */
export const pollReminderChannelIds = (() => {
  const s = new Set<string>()
  for (const id of parseIdSet(process.env.POLL_REMINDER_CHANNEL_IDS)) s.add(id)
  for (const id of parseIdSet(process.env.POLL_MONITOR_CHANNEL_IDS)) s.add(id)
  return s
})()
/** Defaults to STAFF_LOG_CHANNEL_ID */
export const pollStaffLogChannelId =
  process.env.POLL_STAFF_LOG_CHANNEL_ID?.trim() || STAFF_LOG_CHANNEL_ID
/** When remaining time is at or below this many hours, send one reminder ping (default 1). */
export const pollReminderHoursBefore = Math.max(
  0.05,
  parseFloat(process.env.POLL_REMINDER_HOURS_BEFORE ?? '1') || 1,
)
/** Reminder ping in the poll channel: `here` or `everyone` */
export const pollReminderPingMode =
  process.env.POLL_REMINDER_PING?.trim().toLowerCase() === 'everyone' ? 'everyone' : 'here'
export const pollLogVotes = !isEnvOff(process.env.POLL_LOG_VOTES ?? '1')

/** When posting with `/polls create` / `nd!polls create`, prepend this text on the **same message** as the native poll (plus optional @everyone). Use `{poll_channel}` for `#votes`-style ping, `{question}` for the poll question. Empty = poll only (backward compatible). */
export const pollCreateAnnouncementTemplate = (
  process.env.POLL_CREATE_ANNOUNCEMENT_TEMPLATE ?? ''
).trim()
/** If template is non-empty (or standalone ping): prefix with `@everyone` (needs Mention Everyone bot perm in that channel). */
export const pollCreateAnnouncementPingEveryone = !isEnvOff(
  process.env.POLL_CREATE_ANNOUNCEMENT_PING_EVERYONE ?? '0',
)

/** Guild AI: respond only when @mentioned / reply / active window; window duration in ms */
export const ACTIVE_CONVERSATION_MS = Math.max(
  30_000,
  parseInt(process.env.ACTIVE_CONVERSATION_MS ?? '120000', 10) || 120_000,
)

/** Moderation role IDs (optional, comma-separated) */
/** Moderation role IDs (optional, comma-separated) */
export const modRoleIds = parseIdSet(process.env.MOD_ROLE_ID)
export const WARN_TIMEOUT_THRESHOLD = Math.max(
  1,
  parseInt(process.env.WARN_TIMEOUT_THRESHOLD ?? '3', 10) || 3,
)
export const WARN_KICK_THRESHOLD = Math.max(
  1,
  parseInt(process.env.WARN_KICK_THRESHOLD ?? '5', 10) || 5,
)

/** Scan username / global name / nickname for profanity & optional terms; optional Gemini vision on avatars. Discord does not expose user “About Me” bios to bots. */
export const profileScanEnabled = !isEnvOff(process.env.PROFILE_SCAN_ENABLED ?? '0')
export const profileScanText = !isEnvOff(process.env.PROFILE_SCAN_TEXT ?? '1')
/**
 * Include **custom status** (the short line under the username when set) in text checks.
 * Not the same as About Me — bios are still unavailable to bots. Requires **Presence Intent**
 * (Developer Portal → Bot → Privileged Gateway Intents) and `GuildPresences` in code.
 */
export const profileScanCustomStatus = !isEnvOff(process.env.PROFILE_SCAN_CUSTOM_STATUS ?? '0')
/** Uses Gemini (cost); only when PROFILE_SCAN_ENABLED=1 */
export const profileScanAvatarVision = !isEnvOff(process.env.PROFILE_SCAN_AVATAR_VISION ?? '0')
export const profileScanDefaultAvatars = !isEnvOff(process.env.PROFILE_SCAN_DEFAULT_AVATARS ?? '0')
export const profileScanInviteInName = !isEnvOff(process.env.PROFILE_SCAN_INVITE_IN_NAME ?? '1')
export const profileScanMinConfidence = Math.min(
  0.99,
  Math.max(0.5, parseFloat(process.env.PROFILE_SCAN_MIN_CONFIDENCE ?? '0.75') || 0.75),
)
export const profileScanCooldownSec = Math.max(
  30,
  parseInt(process.env.PROFILE_SCAN_COOLDOWN_SEC ?? '120', 10) || 120,
)
export const profileScanMaxPerMinute = Math.max(
  1,
  parseInt(process.env.PROFILE_SCAN_MAX_PER_MINUTE ?? '20', 10) || 20,
)

function parseProfileFlagTerms(): string[] {
  const raw = process.env.PROFILE_FLAG_TERMS?.trim()
  if (!raw) return []
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length >= 2)
}

export const profileFlagTerms: readonly string[] = parseProfileFlagTerms()

/** Rule-based automod */
export const automodEnabled = !isEnvOff(process.env.AUTOMOD_ENABLED ?? '1')
export const automodBlockInvites = !isEnvOff(process.env.AUTOMOD_BLOCK_INVITES ?? '1')
export const automodMaxMentions = Math.max(
  1,
  parseInt(process.env.AUTOMOD_MAX_MENTIONS ?? '5', 10) || 5,
)
export const automodMaxLinks = Math.max(1, parseInt(process.env.AUTOMOD_MAX_LINKS ?? '4', 10) || 4)
export const automodMaxDupes = Math.max(2, parseInt(process.env.AUTOMOD_MAX_DUPES ?? '3', 10) || 3)
export const automodDupeWindowSec = Math.max(
  3,
  parseInt(process.env.AUTOMOD_DUPE_WINDOW_SEC ?? '10', 10) || 10,
)
export const automodFastMsgCount = Math.max(
  5,
  parseInt(process.env.AUTOMOD_FAST_MSG_COUNT ?? '6', 10) || 6,
)
export const automodFastMsgWindowSec = Math.max(
  2,
  parseInt(process.env.AUTOMOD_FAST_MSG_WINDOW_SEC ?? '5', 10) || 5,
)

/** Heuristic URL / phishing risk (rule automod, no Gemini) */
export const urlRiskEnabled = !isEnvOff(process.env.URL_RISK_ENABLED ?? '1')
export const urlRiskBlockScore = Math.min(
  100,
  Math.max(25, parseInt(process.env.URL_RISK_BLOCK_SCORE ?? '70', 10) || 70),
)
export const urlRiskDeleteMessage = !isEnvOff(process.env.URL_RISK_DELETE_MESSAGE ?? '1')
export const urlRiskTrustedHosts = (
  process.env.URL_RISK_TRUSTED_HOSTS?.trim()
    ? process.env.URL_RISK_TRUSTED_HOSTS.split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : ['nightz.dev', 'github.com', 'google.com', 'youtube.com', 'imgur.com']
) as readonly string[]

/** AI AutoMod: raise channel slowmode when verdict is HEATED (0 = off) */
export const heatedSlowmodeSeconds = Math.min(
  21600,
  Math.max(0, parseInt(process.env.HEATED_SLOWMODE_SECONDS ?? '0', 10) || 0),
)
export const heatedSlowmodeCooldownMs = Math.max(
  60_000,
  parseInt(process.env.HEATED_SLOWMODE_COOLDOWN_MS ?? '300000', 10) || 300_000,
)

/** Post copy-paste staff draft to STAFF_LOG when bot replies in these channels */
export const staffDraftSourceChannelIds = parseIdSet(process.env.STAFF_DRAFT_SOURCE_CHANNEL_IDS)

/** nd!translate rate limits */
export const translateCooldownMs = Math.max(
  3000,
  parseInt(process.env.TRANSLATE_COOLDOWN_MS ?? '15000', 10) || 15_000,
)
export const translateHourlyMax = Math.max(
  1,
  parseInt(process.env.TRANSLATE_HOURLY_MAX ?? '12', 10) || 12,
)

/** AI automod */
export const aiAutomodEnabled = !isEnvOff(process.env.AI_AUTOMOD_ENABLED ?? '1')
export const aiAutomodToxicity = !isEnvOff(process.env.AI_AUTOMOD_TOXICITY ?? '1')
export const aiAutomodScam = !isEnvOff(process.env.AI_AUTOMOD_SCAM ?? '1')
export const aiAutomodNsfw = !isEnvOff(process.env.AI_AUTOMOD_NSFW ?? '1')
export const aiAutomodRaid = !isEnvOff(process.env.AI_AUTOMOD_RAID ?? '1')
export const aiAutomodSentiment = !isEnvOff(process.env.AI_AUTOMOD_SENTIMENT ?? '1')
export const aiAutomodImpersonation = !isEnvOff(process.env.AI_AUTOMOD_IMPERSONATION ?? '1')
export const aiAutomodHate = !isEnvOff(process.env.AI_AUTOMOD_HATE ?? '1')
export const aiAutomodSelfharm = !isEnvOff(process.env.AI_AUTOMOD_SELFHARM ?? '1')
export const aiAutomodDoxxing = !isEnvOff(process.env.AI_AUTOMOD_DOXXING ?? '1')
export const aiAutomodSpamAd = !isEnvOff(process.env.AI_AUTOMOD_SPAM_AD ?? '1')
export const aiAutomodCryptoScam = !isEnvOff(process.env.AI_AUTOMOD_CRYPTO_SCAM ?? '1')

/** Optional multiline rules appended to the AI AutoMod classifier prompt */
export const aiAutomodServerRules = process.env.AI_AUTOMOD_SERVER_RULES?.trim() || ''

export const aiAutomodIncludeReplyContext = !isEnvOff(
  process.env.AI_AUTOMOD_INCLUDE_REPLY_CONTEXT ?? '1',
)
export const aiAutomodIncludeChannelSnippet = !isEnvOff(
  process.env.AI_AUTOMOD_INCLUDE_CHANNEL_SNIPPET ?? '0',
)

export const aiAutomodVisionEnabled = !isEnvOff(process.env.AI_AUTOMOD_VISION ?? '0')
export const aiAutomodVisionMaxPerMinute = Math.max(
  1,
  parseInt(process.env.AI_AUTOMOD_VISION_MAX_PER_MINUTE ?? '5', 10) || 5,
)

export const aiAutomodMinConfidence = Math.min(
  0.99,
  Math.max(0.5, parseFloat(process.env.AI_AUTOMOD_MIN_CONFIDENCE ?? '0.80') || 0.8),
)
export const aiAutomodBatchSize = Math.min(
  12,
  Math.max(1, parseInt(process.env.AI_AUTOMOD_BATCH_SIZE ?? '5', 10) || 5),
)
/** Poll interval when the queue is idle (work is also triggered immediately on enqueue). */
export const aiAutomodBatchIntervalMs = Math.max(
  250,
  parseInt(process.env.AI_AUTOMOD_BATCH_INTERVAL_MS ?? '500', 10) || 500,
)
export const aiAutomodMaxCallsPerMinute = Math.max(
  1,
  parseInt(process.env.AI_AUTOMOD_MAX_CALLS_PER_MINUTE ?? '10', 10) || 10,
)
/** If >0, skip duplicate staff-log embeds for same author + similar message within this many seconds (stops multi-channel spam floods). */
export const aiAutomodStaffLogDedupeSec = Math.max(
  0,
  parseInt(process.env.AI_AUTOMOD_STAFF_LOG_DEDUPE_SEC ?? '0', 10) || 0,
)
/**
 * If >0, skip duplicate staff-log embeds for the same Discord message ID within this window (guards against
 * double-processing / duplicate verdict rows). Set to 0 to disable. Default 90s when unset.
 */
const reportMsgDedupeParsed = parseInt(process.env.AI_AUTOMOD_REPORT_MSG_DEDUPE_SEC ?? '90', 10)
export const aiAutomodReportMsgDedupeSec =
  Number.isFinite(reportMsgDedupeParsed) && reportMsgDedupeParsed >= 0 ? reportMsgDedupeParsed : 90

/** Progressive auto warn → kick → ban after N AI AutoMod “strikes” (one per flagged message). Requires warn < kick < ban. */
export const aiAutomodEscalationEnabled = !isEnvOff(
  process.env.AI_AUTOMOD_ESCALATION_ENABLED ?? '0',
)
function parseEscalationThresholds(): {
  warnAt: number
  kickAt: number
  banAt: number
} {
  let w = Math.max(1, parseInt(process.env.AI_AUTOMOD_ESCALATION_WARN_AT ?? '4', 10) || 4)
  let k = Math.max(1, parseInt(process.env.AI_AUTOMOD_ESCALATION_KICK_AT ?? '7', 10) || 7)
  let b = Math.max(1, parseInt(process.env.AI_AUTOMOD_ESCALATION_BAN_AT ?? '12', 10) || 12)
  const arr = [w, k, b].sort((a, b) => a - b)
  ;[w, k, b] = arr
  if (w === k || k === b) {
    w = 4
    k = 7
    b = 12
  }
  return { warnAt: w, kickAt: k, banAt: b }
}
export const {
  warnAt: aiAutomodEscalationWarnAt,
  kickAt: aiAutomodEscalationKickAt,
  banAt: aiAutomodEscalationBanAt,
} = parseEscalationThresholds()

/** After this many days without an AI AutoMod strike, reset strike count (0 = never). */
export const aiAutomodEscalationDecayDays = Math.max(
  0,
  parseInt(process.env.AI_AUTOMOD_ESCALATION_DECAY_DAYS ?? '0', 10) || 0,
)

/** Verdicts that do not add an escalation strike (comma-separated), e.g. HEATED,TOXICITY_LOW */
export const aiAutomodEscalationSkipVerdicts: Set<string> = (() => {
  const raw =
    process.env.AI_AUTOMOD_ESCALATION_SKIP_VERDICTS?.trim() || 'HEATED,TOXICITY_LOW,SELFHARM'
  const s = new Set<string>()
  for (const p of raw.split(',')) {
    const x = p.trim().toUpperCase()
    if (x) s.add(x)
  }
  return s
})()

export const raidJoinThreshold = Math.max(
  4,
  parseInt(process.env.RAID_JOIN_THRESHOLD ?? '10', 10) || 10,
)
export const raidJoinWindowSec = Math.max(
  10,
  parseInt(process.env.RAID_JOIN_WINDOW_SEC ?? '60', 10) || 60,
)
/** Auto-enable lockdown when the raid join threshold is crossed. */
export const raidAutolockEnabled = !isEnvOff(process.env.RAID_AUTOLOCK_ENABLED ?? '1')
/** Auto-unlock after this many ms (0 = stay locked until staff unlock). */
export const raidAutolockDurationMs = Math.max(
  0,
  parseInt(process.env.RAID_AUTOLOCK_DURATION_MS ?? '600000', 10) || 600000,
)
export const raidNewAccountDays = Math.max(
  1,
  parseInt(process.env.RAID_NEW_ACCOUNT_DAYS ?? '7', 10) || 7,
)
/** Log joins where the Discord account is newer than RAID_NEW_ACCOUNT_DAYS */
export const raidNewAccountAlertEnabled = !isEnvOff(
  process.env.RAID_NEW_ACCOUNT_ALERT_ENABLED ?? '1',
)

/** Rule AutoMod: comma-separated extensions (no dot) to block on attachments */
export const automodBlockedAttachmentExtensions = (
  process.env.AUTOMOD_BLOCKED_ATTACHMENT_EXT?.trim()
    ? process.env.AUTOMOD_BLOCKED_ATTACHMENT_EXT.split(',')
        .map((s) => s.trim().toLowerCase().replace(/^\./, ''))
        .filter(Boolean)
    : ['exe', 'scr', 'bat', 'cmd', 'msi', 'ps1', 'hta', 'jar', 'com', 'vbs', 'reg']
) as readonly string[]

/** Optional: single regex (no flags) matched against full URLs in messages; if match, same as high URL risk */
export function automodUrlBlocklistRegex(): RegExp | null {
  const raw = process.env.AUTOMOD_URL_BLOCKLIST_REGEX?.trim()
  if (!raw) return null
  try {
    return new RegExp(raw, 'i')
  } catch {
    console.warn('[config] invalid AUTOMOD_URL_BLOCKLIST_REGEX, ignoring')
    return null
  }
}

/**
 * Comma-separated substrings (case-insensitive). If any http(s) URL in the message contains a
 * substring, rule AutoMod deletes the message (simpler than escaping AUTOMOD_URL_BLOCKLIST_REGEX).
 * Minimum substring length 4.
 */
export function automodUrlBlocklistSubstrings(): readonly string[] {
  const raw = process.env.AUTOMOD_URL_BLOCKLIST_SUBSTRINGS?.trim()
  if (!raw) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of raw.split(',')) {
    const s = p.trim()
    if (s.length < 4) continue
    const key = s.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(s)
  }
  return out
}

/**
 * When enabled, rule AutoMod deletes messages that contain http(s) URLs whose host matches a
 * known GIF / short-loop / meme embed domain (plus optional AUTOMOD_GIF_BLOCK_HOSTS).
 * Default off — many communities allow Tenor/Giphy.
 */
export const automodBlockGifUrls = !isEnvOff(process.env.AUTOMOD_BLOCK_GIF_URLS ?? '0')

function normalizeGifHostSuffix(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/^\s*www\./, '')
    .replace(/^\./, '')
    .replace(/\/+$/, '')
}

function parseAutomodGifBlockExtraHosts(): string[] {
  const raw = process.env.AUTOMOD_GIF_BLOCK_HOSTS?.trim()
  if (!raw) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of raw.split(',')) {
    const h = normalizeGifHostSuffix(part)
    if (h.length < 3 || seen.has(h)) continue
    seen.add(h)
    out.push(h)
  }
  return out
}

/** Popular GIF / meme-loop / short video embed hosts (hostname suffix match; subdomains match) */
const DEFAULT_GIF_EMBED_HOST_SUFFIXES: readonly string[] = [
  'tenor.com',
  'tenor.co',
  'giphy.com',
  'gph.is',
  'giphy.media',
  'giphygifs.com',
  'gfycat.com',
  'redgifs.com',
  'klipy.com',
  'getyarn.io',
  'gyazo.com',
  'imgflip.com',
  'makeagif.com',
  'wifflegif.com',
  'reactiongifs.com',
  'picgifs.com',
  'ezgif.com',
  'discordemoji.com',
  'emoji.gg',
  'emoj.gg',
  'gifer.com',
  'gifbin.com',
  'bestanimations.com',
  'gifs.com',
  'popkey.co',
  'sharegif.com',
  'gifgif.io',
  'coub.com',
  'cliply.io',
  'streamable.com',
  'kapwing.com',
  'gifanimado.com',
  'gifgifgif.ai',
  'reactiongif.org',
  'animatedimages.org',
  'freegifmaker.me',
  'gifmagic.com',
  'gifkeyboard.com',
  'momento360.com',
  'giflytics.com',
  'gifprint.com',
  'gifimages.org',
  'animates.net',
  'animationsource.org',
  'giphy.world',
  'gliphy.com',
  'flipagram.com',
  'vsgif.com',
  'gifsgifs.com',
  'gifgifs.com',
  'gifmaker.org',
  'gifmaker.me',
  'lunapic.com',
  'onlinegifmaker.com',
  'picasion.com',
  'gifanimate.com',
  'gifimage.net',
  'gifrific.com',
  'memecreator.org',
]

/** Effective host suffix list when AUTOMOD_BLOCK_GIF_URLS is on */
export const automodGifUrlBlockHostSuffixes: readonly string[] = automodBlockGifUrls
  ? [...DEFAULT_GIF_EMBED_HOST_SUFFIXES, ...parseAutomodGifBlockExtraHosts()]
  : []

/** True if hostname is exactly a listed suffix or a subdomain of it (e.g. media.tenor.com) */
export function urlHostMatchesAutomodGifBlocklist(host: string): boolean {
  if (automodGifUrlBlockHostSuffixes.length === 0) return false
  const h = normalizeGifHostSuffix(host.split('/')[0] ?? host).split(':')[0] ?? ''
  if (!h) return false
  for (const suf of automodGifUrlBlockHostSuffixes) {
    if (h === suf || h.endsWith(`.${suf}`)) return true
  }
  return false
}

/** Ratio of non-ASCII letters to total letters; above this triggers delete (rule automod) */
export const automodHomoglyphScriptRatio = Math.min(
  1,
  Math.max(0.35, parseFloat(process.env.AUTOMOD_HOMOGLYPH_SCRIPT_RATIO ?? '0.55') || 0.55),
)

/** Ticket handoff after AI suggests opening a ticket */
export const ticketOfferEnabled = !isEnvOff(process.env.TICKET_OFFER_ENABLED ?? '1')
export const ticketOfferCooldownMs = Math.max(
  30_000,
  parseInt(process.env.TICKET_OFFER_COOLDOWN_MS ?? '120000', 10) || 120_000,
)
/** Forum or text channel where private threads are created; optional if using staff intake only */
export const ticketForumChannelId = process.env.TICKET_FORUM_CHANNEL_ID?.trim() || undefined
/** When set, post ticket requests to staff log instead of creating threads (safest default) */
export const ticketStaffIntakeOnly = !isEnvOff(process.env.TICKET_STAFF_INTAKE_ONLY ?? '1')
export const ticketAutoCreate = !isEnvOff(process.env.TICKET_AUTO_CREATE ?? '0')
export const ticketAutoCreateChannelIds = parseIdSet(process.env.TICKET_AUTO_CREATE_CHANNEL_IDS)

/** Built-in ticket system: panel channel, private text tickets, transcripts (replaces Ticket Tool when enabled). */
export const ticketSystemEnabled = !isEnvOff(process.env.TICKET_SYSTEM_ENABLED ?? '1')
export const TICKET_PANEL_CHANNEL_ID =
  process.env.TICKET_PANEL_CHANNEL_ID?.trim() || '1364400105423114250'
export const TICKET_OPEN_CATEGORY_ID =
  process.env.TICKET_OPEN_CATEGORY_ID?.trim() || '1364400365457510511'
export const TICKET_CLOSED_CATEGORY_ID =
  process.env.TICKET_CLOSED_CATEGORY_ID?.trim() || '1364400425121480756'
/** Ticket event log; defaults to staff log. */
export const ticketLogChannelId =
  process.env.TICKET_LOG_CHANNEL_ID?.trim() || STAFF_LOG_CHANNEL_ID || undefined

/** Channel where audit-log alerts (mass ban, mass kick, etc.) are posted. Defaults to staff log. */
export const auditAlertChannelId =
  process.env.AUDIT_ALERT_CHANNEL_ID?.trim() || STAFF_LOG_CHANNEL_ID || undefined

/** Channel where ban appeals are posted for staff review. Defaults to staff log. */
export const appealsChannelId =
  process.env.APPEALS_CHANNEL_ID?.trim() || STAFF_LOG_CHANNEL_ID || undefined

/** When true, DM banned users an appeal button on ban. */
export const appealsEnabled = !isEnvOff(process.env.APPEALS_ENABLED ?? '1')

/** Starboard: repost highly-reacted messages to a highlights channel. */
export const starboardEnabled = !isEnvOff(process.env.STARBOARD_ENABLED ?? '0')
export const starboardChannelId = process.env.STARBOARD_CHANNEL_ID?.trim() || undefined
export const starboardEmoji = process.env.STARBOARD_EMOJI?.trim() || '⭐'
export const starboardThreshold = Math.max(
  1,
  parseInt(process.env.STARBOARD_THRESHOLD ?? '3', 10) || 3,
)

/** Alt-account detection: score new joins for ban-evasion signals and alert staff. */
export const altDetectionEnabled = !isEnvOff(process.env.ALT_DETECTION_ENABLED ?? '0')
/** Risk score (0-7) at or above which an alt alert is posted. */
export const altAlertThreshold = Math.max(
  1,
  parseInt(process.env.ALT_ALERT_THRESHOLD ?? '3', 10) || 3,
)

/** Verification gate: new members must click a button before gaining access. */
export const verifyEnabled = !isEnvOff(process.env.VERIFY_ENABLED ?? '0')
export const verifyChannelId = process.env.VERIFY_CHANNEL_ID?.trim() || undefined
/** Role granted once verified. */
export const verifyRoleId = process.env.VERIFY_ROLE_ID?.trim() || undefined
/** Optional holding role assigned on join, removed on verify. */
export const verifyUnverifiedRoleId = process.env.VERIFY_UNVERIFIED_ROLE_ID?.trim() || undefined
/** Kick members who never verify after this many ms (0 = never kick). */
export const verifyKickAfterMs = Math.max(
  0,
  parseInt(process.env.VERIFY_KICK_AFTER_MS ?? '0', 10) || 0,
)

/** Modmail: relay user DMs to a private staff channel and back. */
export const modmailEnabled = !isEnvOff(process.env.MODMAIL_ENABLED ?? '0')
/** Category under which per-user modmail channels are created. */
export const modmailCategoryId = process.env.MODMAIL_CATEGORY_ID?.trim() || undefined
/** Extra role IDs (beyond MOD_ROLE_ID) that can see + reply in modmail channels. */
export const modmailStaffRoleIds = parseIdSet(process.env.MODMAIL_STAFF_ROLE_IDS)

/** How often (ms) to poll Discord audit logs for suspicious activity (default 5 min). */
export const auditAlertPollMs = Math.max(
  30_000,
  Number(process.env.AUDIT_ALERT_POLL_MS ?? '') || 5 * 60 * 1000,
)

/** Ticket SLA nudge: DM staff if first reply hasn't happened within this many hours (0 = off). */
export const ticketSlaStaffNudgeHours = Number(process.env.TICKET_SLA_STAFF_NUDGE_HOURS ?? '') || 0

const DEFAULT_TICKET_REASONS =
  'Pre-sale Question,Buying Product,Bug Report,Technical Help,Script Support,Account/Role Issues,Billing/Refund,Refund Request,Commission Inquiry,Suggestions,Report a Problem,Partnership/Collaboration,Other'

export function parseTicketReasons(): string[] {
  const raw = process.env.TICKET_REASONS?.trim() || DEFAULT_TICKET_REASONS
  const out: string[] = []
  for (const part of raw.split(',')) {
    const s = part.trim()
    if (s) out.push(s)
  }
  return out.length ? out : DEFAULT_TICKET_REASONS.split(',').map((s) => s.trim())
}

export const ticketMaxOpenPerUser = Math.max(
  1,
  parseInt(process.env.TICKET_MAX_OPEN_PER_USER ?? '3', 10) || 3,
)
export const ticketTranscriptEnabled = !isEnvOff(process.env.TICKET_TRANSCRIPT_ENABLED ?? '1')
/** Max messages to include in ticket transcripts (paginated, cap 5000). */
export const ticketTranscriptMaxMessages = Math.min(
  5000,
  Math.max(50, parseInt(process.env.TICKET_TRANSCRIPT_MAX_MESSAGES ?? '2000', 10) || 2000),
)
/** When ticket transcripts are on, also generate Ticket Tool–style HTML (default on). */
export const ticketTranscriptHtmlEnabled = !isEnvOff(process.env.TICKET_TRANSCRIPT_HTML ?? '1')
export const ticketDmOnClose = !isEnvOff(process.env.TICKET_DM_ON_CLOSE ?? '0')
export const ticketAutoCloseHours = Math.max(
  0,
  parseInt(process.env.TICKET_AUTO_CLOSE_HOURS ?? '0', 10) || 0,
)
export const ticketAutoCloseGraceHours = Math.max(
  1,
  parseInt(process.env.TICKET_AUTO_CLOSE_GRACE_HOURS ?? '12', 10) || 12,
)
/** Channel name prefix, e.g. ticket-0042 */
export const ticketNamingPrefix = process.env.TICKET_NAMING?.trim() || 'ticket'

const DEFAULT_TICKET_WORKFLOW_STATUSES =
  'Open,Claimed,In progress,Waiting on user,On hold,Resolved (ready to close)'

/** Labels staff can set on open tickets (dropdown on welcome message). Max 25. */
export function parseTicketWorkflowStatuses(): string[] {
  const raw = process.env.TICKET_WORKFLOW_STATUSES?.trim() || DEFAULT_TICKET_WORKFLOW_STATUSES
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of raw.split(',')) {
    const s = part.trim()
    if (!s || s.length > 100) continue
    const key = s.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(s)
    if (out.length >= 25) break
  }
  return out.length > 0 ? out : DEFAULT_TICKET_WORKFLOW_STATUSES.split(',').map((x) => x.trim())
}

/** User reports: defaults to staff log if REPORT_CHANNEL_ID unset */
export const REPORT_CHANNEL_ID = process.env.REPORT_CHANNEL_ID?.trim() || undefined

/** Trust & safety: max report body length */
export const reportMaxBodyLength = Math.min(
  2000,
  Math.max(100, parseInt(process.env.REPORT_MAX_BODY_LENGTH ?? '1500', 10) || 1500),
)
export const reportCooldownMs = Math.max(
  60_000,
  parseInt(process.env.REPORT_COOLDOWN_MS ?? '300000', 10) || 300_000,
)

/** Optional JSON array: [{"label":"Docs","url":"https://..."}] for nd!links */
export const supportLinksJson = process.env.SUPPORT_LINKS_JSON?.trim() || ''

/** Extra markdown appended to nd!safety / /safety */
export const safetyExtraMarkdown = process.env.SAFETY_EXTRA_MARKDOWN?.trim() || ''

/** Shown in /privacy, nd!privacy, automod public blurb, and mod automod status unless overridden. */
export const aiMonitoringNotice =
  process.env.AI_MONITORING_NOTICE?.trim() ||
  'This conversation is monitored by AI for safety purposes. Please avoid sharing sensitive personal data.'

/** Shown for nd!automod-public / /automod_public */
export const automodPublicBlurb =
  process.env.AUTOMOD_PUBLIC_BLURB?.trim() ||
  `${aiMonitoringNotice}\n\nWe may use automated filters (spam, scam patterns, risky links, and AI-assisted review). False positives happen; open a support ticket if something looks wrong.`

/** Optional comma aliases: ND_DU:https://..., keyed by uppercase normalized name */
export const productAliasUrls = parseProductAliases(process.env.PRODUCT_ALIAS_URLS)

/** Audit */
export const AUDIT_LOG_CHANNEL_ID = process.env.AUDIT_LOG_CHANNEL_ID?.trim() || undefined
/** Log user profile + server member updates to AUDIT_LOG (avatar, banner, names, roles, timeout, etc.) */
export const auditLogProfileUpdates = !isEnvOff(process.env.AUDIT_LOG_PROFILE_UPDATES ?? '1')
export const auditIgnoredChannels = parseIdSet(process.env.AUDIT_IGNORED_CHANNELS)
/** Parent category IDs, skip audit (and rule automod) for all channels under these categories */
export const auditIgnoredCategories = parseIdSet(process.env.AUDIT_IGNORED_CATEGORY_IDS)

/** Internal feature tier for this private Discord bot (not public billing). */
export type NightzFeatureTier = 'standard' | 'premium'
export const nightzFeatureTier: NightzFeatureTier =
  process.env.ND_BOT_TIER?.trim().toLowerCase() === 'standard' ? 'standard' : 'premium'

/** Feature gates for private/internal deployments. */
export const levelsEnabled = !isEnvOff(process.env.LEVELS_ENABLED ?? '1')
export const afkEnabled = !isEnvOff(process.env.AFK_ENABLED ?? '1')
export const autoDeleteEnabled = !isEnvOff(process.env.AUTO_DELETE_ENABLED ?? '0')
export const autoPurgeEnabled = !isEnvOff(process.env.AUTO_PURGE_ENABLED ?? '0')
export const tiktokNotificationsEnabled = !isEnvOff(process.env.TIKTOK_NOTIFICATIONS_ENABLED ?? '0')
export const twitchNotificationsEnabled = !isEnvOff(process.env.TWITCH_NOTIFICATIONS_ENABLED ?? '0')

/** Streaming live alerts (Twitch go-live + YouTube new uploads). */
export const streamingAlertsEnabled = !isEnvOff(process.env.STREAMING_ALERTS_ENABLED ?? '0')
export const streamAnnounceChannelId = process.env.STREAM_ANNOUNCE_CHANNEL_ID?.trim() || undefined
export const streamPollIntervalSec = Math.max(
  60,
  parseInt(process.env.STREAM_POLL_INTERVAL_SEC ?? '300', 10) || 300,
)
export const twitchClientId = process.env.TWITCH_CLIENT_ID?.trim() || undefined
export const twitchClientSecret = process.env.TWITCH_CLIENT_SECRET?.trim() || undefined
/** Twitch login names to watch (comma-separated). */
export const twitchWatchLogins = (process.env.TWITCH_WATCH_LOGINS ?? '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean)
/** YouTube channel IDs to watch for new uploads (comma-separated). */
export const youtubeWatchChannels = (process.env.YOUTUBE_WATCH_CHANNELS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

/** Levels / XP */
export const levelsXpMin = Math.max(1, parseInt(process.env.LEVELS_XP_MIN ?? '8', 10) || 8)
export const levelsXpMax = Math.max(
  levelsXpMin,
  parseInt(process.env.LEVELS_XP_MAX ?? '15', 10) || 15,
)
export const levelsCooldownMs = Math.max(
  5_000,
  (parseInt(process.env.LEVELS_COOLDOWN_SEC ?? '60', 10) || 60) * 1000,
)
export const levelsAlertChannelId = process.env.LEVELS_ALERT_CHANNEL_ID?.trim() || undefined
export const levelsDmEnabled = !isEnvOff(process.env.LEVELS_DM_ENABLED ?? '1')
export const levelsIgnoredChannels = parseIdSet(process.env.LEVELS_IGNORED_CHANNELS)
export const levelsIgnoredCategories = parseIdSet(process.env.LEVELS_IGNORED_CATEGORY_IDS)
export const levelsRoleMilestonesJson = process.env.LEVELS_ROLE_MILESTONES_JSON?.trim() || ''
export const levelsRemovePreviousRoles = !isEnvOff(process.env.LEVELS_REMOVE_PREVIOUS_ROLES ?? '1')

/** AFK */
export const afkAutoClear = !isEnvOff(process.env.AFK_AUTO_CLEAR ?? '1')
export const afkNicknamePrefix = process.env.AFK_NICKNAME_PREFIX?.trim() || ''

/** Delayed auto-delete rules (JSON array; see .env.example). */
export const autoDeleteRulesJson = process.env.AUTO_DELETE_RULES_JSON?.trim() || ''
export const autoPurgeRulesJson = process.env.AUTO_PURGE_RULES_JSON?.trim() || ''
export const autoPurgeIntervalMs = Math.max(
  60_000,
  (parseInt(process.env.AUTO_PURGE_INTERVAL_MIN ?? '15', 10) || 15) * 60_000,
)

/** Dedicated action log channels; fallback to AUDIT_LOG_CHANNEL_ID if unset. */
export const MESSAGE_LOG_CHANNEL_ID = process.env.MESSAGE_LOG_CHANNEL_ID?.trim() || undefined
export const MEMBER_LOG_CHANNEL_ID = process.env.MEMBER_LOG_CHANNEL_ID?.trim() || undefined
export const ROLE_LOG_CHANNEL_ID = process.env.ROLE_LOG_CHANNEL_ID?.trim() || undefined
export const CHANNEL_LOG_CHANNEL_ID = process.env.CHANNEL_LOG_CHANNEL_ID?.trim() || undefined

/** Temp VC */
export const TEMPVC_LOBBY_ID = process.env.TEMPVC_LOBBY_ID?.trim() || undefined
export const TEMPVC_CATEGORY_ID = process.env.TEMPVC_CATEGORY_ID?.trim() || undefined
export const TEMPVC_DEFAULT_LIMIT = parseInt(process.env.TEMPVC_DEFAULT_LIMIT ?? '0', 10) || 0

/** Suggestions */
export const SUGGESTION_CHANNEL_ID = process.env.SUGGESTION_CHANNEL_ID?.trim() || undefined

/**
 * Extra system prompt per channel ID (JSON object: `"channelId": "extra markdown lines"`).
 * Appended to guild AI instruction for that channel only.
 */
export function channelPromptExtraByChannelId(): Record<string, string> {
  const raw = process.env.CHANNEL_PROMPT_EXTRAS_JSON?.trim()
  if (!raw) return {}
  try {
    const o = JSON.parse(raw) as unknown
    if (!o || typeof o !== 'object') return {}
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (typeof v === 'string' && v.trim()) out[k.trim()] = v.trim()
    }
    return out
  } catch {
    return {}
  }
}

/** Comma-separated extra hosts trusted in `/scam_check` heuristics (merged with URL_RISK_TRUSTED_HOSTS idea). */
export const scamCheckExtraTrustedHosts = parseHostList(process.env.SCAM_CHECK_EXTRA_TRUSTED_HOSTS)

function parseHostList(raw: string | undefined): Set<string> {
  const s = new Set<string>()
  if (!raw?.trim()) return s
  for (const part of raw.split(',')) {
    const h = part
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .split('/')[0]
    if (h) s.add(h)
  }
  return s
}

/** Alert staff log if no first staff reply within this many ms after ticket open (0 = off). */
export const ticketFirstReplySlaMs = Math.max(
  0,
  parseInt(process.env.TICKET_FIRST_REPLY_SLA_MS ?? '0', 10) || 0,
)

/**
 * Workflow status labels (comma-separated) for which we skip SLA reminders while set
 * (case-insensitive; e.g. "Waiting on user").
 */
export function parseTicketSlaIgnoreWorkflows(): string[] {
  const raw = process.env.TICKET_SLA_IGNORE_WORKFLOWS?.trim()
  const fallback = 'Waiting on user'
  const src = raw || fallback
  const out: string[] = []
  const seen = new Set<string>()
  for (const part of src.split(',')) {
    const s = part.trim().toLowerCase()
    if (!s || seen.has(s)) continue
    seen.add(s)
    out.push(s)
  }
  return out
}

/**
 * After first SLA breach, post a second staff-log reminder this many ms later (0 = off).
 * Only if there is still no staff reply.
 */
export const ticketSlaSecondNudgeMs = Math.max(
  0,
  parseInt(process.env.TICKET_SLA_SECOND_NUDGE_MS ?? '0', 10) || 0,
)

/** Reject new ticket opens from the same user within this many ms (0 = off). */
export const ticketOpenCooldownMs = Math.max(
  0,
  parseInt(process.env.TICKET_OPEN_COOLDOWN_MS ?? '0', 10) || 0,
)

/** If set, register slash commands on this guild only (instant; dev/home server). Unset to use global registration. */
export const slashCommandsGuildId = process.env.SLASH_COMMANDS_GUILD_ID?.trim() || undefined

/** Data directory for JSON stores */
export const DATA_DIR = process.env.DATA_DIR?.trim() || './data'

/** ServerStats-style stat channels (`/counters`); renames channel names on an interval. */
export const counterChannelsEnabled = !isEnvOff(process.env.COUNTER_CHANNELS_ENABLED ?? '1')
export const counterChannelsUpdateMs = Math.max(
  60_000,
  parseInt(process.env.COUNTER_CHANNELS_UPDATE_MS ?? `${15 * 60 * 1000}`, 10) || 15 * 60 * 1000,
)

function requiredEnv(name: string): string {
  const v = process.env[name]?.trim()
  if (!v) {
    console.error(`Missing ${name} in .env`)
    process.exit(1)
  }
  return v
}

function parseIdSet(raw: string | undefined): Set<string> {
  const s = new Set<string>()
  if (!raw?.trim()) return s
  for (const part of raw.split(',')) {
    const id = part.trim()
    if (id) s.add(id)
  }
  return s
}

function parseCommaList(raw: string | undefined): string[] {
  if (!raw?.trim()) return []
  return raw
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean)
}

/** PRODUCT_ALIAS_URLS: `ND_DiscordUnified:https://...,ND_AFK:https://...` */
function parseProductAliases(raw: string | undefined): Map<string, string> {
  const m = new Map<string, string>()
  if (!raw?.trim()) return m
  for (const part of raw.split(',')) {
    const seg = part.trim()
    const idx = seg.indexOf(':')
    if (idx <= 0) continue
    const key = seg
      .slice(0, idx)
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9_]/g, '')
    const url = seg.slice(idx + 1).trim()
    if (key && /^https?:\/\//i.test(url)) m.set(key, url)
  }
  return m
}

export function isEnvOff(v: string): boolean {
  return ['0', 'false', 'no', 'off'].includes(v.trim().toLowerCase())
}
