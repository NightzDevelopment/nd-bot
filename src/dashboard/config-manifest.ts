/**
 * Every tunable env key the bot uses (from src/config.ts) plus required secrets
 * and DASHBOARD_* (localhost admin). Drives the admin UI and PUT validation.
 */
export type ConfigFieldType = 'string' | 'bool' | 'number' | 'text'

export type ConfigField = {
  key: string
  tab: string
  type: ConfigFieldType
  label: string
  /** Short operator-facing description shown under the title. */
  help?: string
  sensitive?: boolean
  /**
   * True when the value is captured at module-import time and a process
   * restart is required for a change to take effect. False for keys that
   * are re-read on each request (a few DASHBOARD_* knobs).
   */
  requiresRestart: boolean
}

const SENSITIVE = new Set([
  'DISCORD_BOT_TOKEN',
  'GOOGLE_API_KEY',
  'OPENAI_API_KEY',
  'DASHBOARD_TOKEN',
  'TWITCH_CLIENT_SECRET',
])

/**
 * The handful of keys that are re-read on each request rather than captured
 * at import time. Changing any of these via the dashboard takes effect
 * immediately without a process restart.
 */
const RUNTIME_KEYS = new Set<string>([
  'DASHBOARD_TOKEN',
  'DASHBOARD_RESTART_ENABLED',
  'DASHBOARD_RESTART_CMD',
  'DASHBOARD_PM2_APP',
])

/**
 * All keys: PowerShell (Select-String process.env.(\w+) src/config.ts) sorted unique,
 * plus requiredEnv names and DASHBOARD_*.
 */
const ALL_KEYS: readonly string[] = [
  'ACTIVE_CONVERSATION_MS',
  'AFK_AUTO_CLEAR',
  'AFK_ENABLED',
  'AFK_NICKNAME_PREFIX',
  'AI_AUTOMOD_BATCH_INTERVAL_MS',
  'AI_AUTOMOD_BATCH_SIZE',
  'AI_AUTOMOD_CRYPTO_SCAM',
  'AI_AUTOMOD_DOXXING',
  'AI_AUTOMOD_ENABLED',
  'AI_AUTOMOD_ESCALATION_BAN_AT',
  'AI_AUTOMOD_ESCALATION_DECAY_DAYS',
  'AI_AUTOMOD_ESCALATION_ENABLED',
  'AI_AUTOMOD_ESCALATION_KICK_AT',
  'AI_AUTOMOD_ESCALATION_SKIP_VERDICTS',
  'AI_AUTOMOD_ESCALATION_WARN_AT',
  'AI_AUTOMOD_HATE',
  'AI_AUTOMOD_IMPERSONATION',
  'AI_AUTOMOD_INCLUDE_CHANNEL_SNIPPET',
  'AI_AUTOMOD_INCLUDE_REPLY_CONTEXT',
  'AI_AUTOMOD_MAX_CALLS_PER_MINUTE',
  'AI_AUTOMOD_MIN_CONFIDENCE',
  'AI_AUTOMOD_NSFW',
  'AI_AUTOMOD_RAID',
  'AI_AUTOMOD_REPORT_MSG_DEDUPE_SEC',
  'AI_AUTOMOD_SCAM',
  'AI_AUTOMOD_SELFHARM',
  'AI_AUTOMOD_SENTIMENT',
  'AI_AUTOMOD_SERVER_RULES',
  'AI_AUTOMOD_SPAM_AD',
  'AI_AUTOMOD_STAFF_LOG_DEDUPE_SEC',
  'AI_AUTOMOD_TOXICITY',
  'AI_AUTOMOD_VISION',
  'AI_AUTOMOD_VISION_MAX_PER_MINUTE',
  'AI_FEEDBACK_LOG_CHANNEL_ID',
  'AI_FEEDBACK_NEGATIVE_EMOJI',
  'AI_FEEDBACK_POSITIVE_EMOJI',
  'AI_FEEDBACK_REACTIONS_ENABLED',
  'AI_MONITORING_NOTICE',
  'AI_REPLY_DISCLAIMER',
  'AI_REPLY_DISCLAIMER_ENABLED',
  'ALLOWED_DM_USER_IDS',
  'AUDIT_IGNORED_CATEGORY_IDS',
  'AUDIT_IGNORED_CHANNELS',
  'AUDIT_LOG_CHANNEL_ID',
  'AUDIT_LOG_PROFILE_UPDATES',
  'AUTO_DELETE_ENABLED',
  'AUTO_DELETE_RULES_JSON',
  'AUTO_PURGE_ENABLED',
  'AUTO_PURGE_INTERVAL_MIN',
  'AUTO_PURGE_RULES_JSON',
  'AUTOMOD_BLOCK_GIF_URLS',
  'AUTOMOD_BLOCK_INVITES',
  'AUTOMOD_BLOCKED_ATTACHMENT_EXT',
  'AUTOMOD_DUPE_WINDOW_SEC',
  'AUTOMOD_ENABLED',
  'AUTOMOD_FAST_MSG_COUNT',
  'AUTOMOD_FAST_MSG_WINDOW_SEC',
  'AUTOMOD_GIF_BLOCK_HOSTS',
  'AUTOMOD_HOMOGLYPH_SCRIPT_RATIO',
  'AUTOMOD_MAX_DUPES',
  'AUTOMOD_MAX_LINKS',
  'AUTOMOD_MAX_MENTIONS',
  'AUTOMOD_PUBLIC_BLURB',
  'AUTOMOD_URL_BLOCKLIST_REGEX',
  'AUTOMOD_URL_BLOCKLIST_SUBSTRINGS',
  'SCAM_LINK_AI_ENABLED',
  'SCAM_LINK_AI_DELETE',
  'SCAM_LINK_AI_MIN_CONFIDENCE',
  'SCAM_LINK_AI_MAX_PER_MIN',
  'CHANNEL_LOG_CHANNEL_ID',
  'CHANNEL_PROMPT_EXTRAS_JSON',
  'CODEBASE_EXCLUDE_PATH_SUBSTRINGS',
  'CODEBASE_MAX_FILES',
  'CODEBASE_REFRESH_MINUTES',
  'CODEBASE_SINGLE_RESOURCE_MODE',
  'COMING_SOON_REPLIES_ENABLED',
  'COMING_SOON_RESOURCES',
  'CONVERSATION_HISTORY_LIMIT',
  'CONVERSATION_MEMORY_FILE',
  'DASHBOARD_ENABLED',
  'DASHBOARD_HOST',
  'DASHBOARD_PM2_APP',
  'DASHBOARD_PORT',
  'DASHBOARD_READ_ONLY',
  'DASHBOARD_RESTART_CMD',
  'DASHBOARD_RESTART_ENABLED',
  'DASHBOARD_TOKEN',
  'DATA_DIR',
  'DEV_BUILD_PATH',
  'DEV_BUILD_PATHS',
  'DISCORD_BOT_TOKEN',
  'DM_LOG_CHANNEL_ID',
  'EMBEDDING_MAX_CHUNK_CHARS',
  'EMBEDDING_MAX_CORPUS_CHUNKS',
  'EMBEDDING_MODEL',
  'EMBEDDING_REFRESH_MINUTES',
  'ENABLE_DM_SUPPORT',
  'EXTRA_BANNED_WORDS',
  'FAQ_CHANNEL_ID',
  'FAQ_REFRESH_MS',
  'GEMINI_FALLBACK_MODELS',
  'GEMINI_MODEL',
  'GOOGLE_API_KEY',
  'GUILD_AI_TICKET_CATEGORY_IDS',
  'GUILD_CHANNEL_IDS',
  'HEATED_SLOWMODE_COOLDOWN_MS',
  'HEATED_SLOWMODE_SECONDS',
  'IMAGE_ATTACHMENT_MAX_BYTES',
  'LEVELS_ALERT_CHANNEL_ID',
  'LEVELS_COOLDOWN_SEC',
  'LEVELS_DM_ENABLED',
  'LEVELS_ENABLED',
  'LEVELS_IGNORED_CATEGORY_IDS',
  'LEVELS_IGNORED_CHANNELS',
  'LEVELS_REMOVE_PREVIOUS_ROLES',
  'LEVELS_ROLE_MILESTONES_JSON',
  'LEVELS_XP_MAX',
  'LEVELS_XP_MIN',
  'MEMBER_LOG_CHANNEL_ID',
  'MESSAGE_LOG_CHANNEL_ID',
  'MOD_ROLE_ID',
  'ND_BOT_TIER',
  'ND_KEYWORDS_APPEND',
  'ND_KEYWORDS_CONTEXT',
  'ND_KEYWORDS_FILE',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_FALLBACK_MODELS',
  'OPENAI_MODEL',
  'OPENAI_TIMEOUT_MS',
  'AI_RESPONSE_CACHE_ENABLED',
  'AI_RESPONSE_CACHE_TTL_SEC',
  'AI_RESPONSE_CACHE_MAX',
  'PERSISTENT_MEMORY',
  'POLL_CREATE_ANNOUNCEMENT_PING_EVERYONE',
  'POLL_CREATE_ANNOUNCEMENT_TEMPLATE',
  'POLL_LOG_VOTES',
  'POLL_MONITOR_CHANNEL_IDS',
  'POLL_MONITOR_ENABLED',
  'POLL_REMINDER_CHANNEL_IDS',
  'POLL_REMINDER_HOURS_BEFORE',
  'POLL_REMINDER_PING',
  'POLL_STAFF_LOG_CHANNEL_ID',
  'PRODUCT_ALIAS_URLS',
  'PRODUCT_DOCS_DIR',
  'PRODUCT_DOCS_MAX_FILES',
  'PROFILE_FLAG_TERMS',
  'PROFILE_SCAN_AVATAR_VISION',
  'PROFILE_SCAN_COOLDOWN_SEC',
  'PROFILE_SCAN_CUSTOM_STATUS',
  'PROFILE_SCAN_DEFAULT_AVATARS',
  'PROFILE_SCAN_ENABLED',
  'PROFILE_SCAN_INVITE_IN_NAME',
  'PROFILE_SCAN_MAX_PER_MINUTE',
  'PROFILE_SCAN_MIN_CONFIDENCE',
  'PROFILE_SCAN_TEXT',
  'RAID_JOIN_THRESHOLD',
  'RAID_JOIN_WINDOW_SEC',
  'RAID_NEW_ACCOUNT_ALERT_ENABLED',
  'RAID_NEW_ACCOUNT_DAYS',
  'REPORT_CHANNEL_ID',
  'REPORT_COOLDOWN_MS',
  'REPORT_MAX_BODY_LENGTH',
  'ROLE_LOG_CHANNEL_ID',
  'SAFETY_EXTRA_MARKDOWN',
  'SCAM_CHECK_EXTRA_TRUSTED_HOSTS',
  'STORE_FEATURED_COUNT',
  'STORE_FEATURED_LINES',
  'STORE_LOOKUP_MAX_RESULTS',
  'STORE_PAGE_FETCH_TIMEOUT_MS',
  'STORE_PAGE_MAX_CHARS',
  'STORE_PAGE_REFRESH_MINUTES',
  'STORE_PAGE_SNAPSHOT_ENABLED',
  'STORE_PAGE_URL',
  'STORE_SNAPSHOT_STALE_MINUTES',
  'STAFF_DRAFT_SOURCE_CHANNEL_IDS',
  'STAFF_LOG_CHANNEL_ID',
  'APPEALS_ENABLED',
  'APPEALS_AI_TRIAGE_ENABLED',
  'APPEALS_CHANNEL_ID',
  'WEEKLY_MOD_REPORT_ENABLED',
  'WEEKLY_MOD_REPORT_CHANNEL_ID',
  'MODMAIL_ENABLED',
  'MODMAIL_CATEGORY_ID',
  'MODMAIL_STAFF_ROLE_IDS',
  'VERIFY_ENABLED',
  'VERIFY_CHANNEL_ID',
  'VERIFY_ROLE_ID',
  'VERIFY_UNVERIFIED_ROLE_ID',
  'VERIFY_KICK_AFTER_MS',
  'STARBOARD_ENABLED',
  'STARBOARD_CHANNEL_ID',
  'STARBOARD_EMOJI',
  'STARBOARD_THRESHOLD',
  'RAID_AUTOLOCK_ENABLED',
  'RAID_AUTOLOCK_DURATION_MS',
  'ALT_DETECTION_ENABLED',
  'ALT_ALERT_THRESHOLD',
  'ALT_ACTION_ENABLED',
  'ALT_DRY_RUN',
  'ALT_QUARANTINE_AT',
  'ALT_KICK_AT',
  'ALT_BAN_AT',
  'ALT_QUARANTINE_ROLE_ID',
  'ALT_AUTOBAN_MAX_PER_MIN',
  'ALT_AVATAR_AI_CHECK',
  'ALT_AVATAR_AI_MIN_CONFIDENCE',
  'QUARANTINE_ROLESWAP_ENABLED',
  'QUARANTINE_ROLE_ID',
  'QUARANTINE_TOGGLE_ROLE_ID',
  'QUARANTINE_NAME_FILTER_ENABLED',
  'QUARANTINE_NAME_EXEMPT_USER_IDS',
  'STREAMING_ALERTS_ENABLED',
  'STREAM_ANNOUNCE_CHANNEL_ID',
  'STREAM_POLL_INTERVAL_SEC',
  'TWITCH_CLIENT_ID',
  'TWITCH_CLIENT_SECRET',
  'TWITCH_WATCH_LOGINS',
  'YOUTUBE_WATCH_CHANNELS',
  'SUGGESTION_CHANNEL_ID',
  'SUPPORT_LINKS_JSON',
  'SYSTEM_PROMPT',
  'SYSTEM_PROMPT_DM',
  'SYSTEM_PROMPT_GUILD',
  'TEMPVC_CATEGORY_ID',
  'TEMPVC_DEFAULT_LIMIT',
  'TEMPVC_LOBBY_ID',
  'TICKET_AUTO_CLOSE_GRACE_HOURS',
  'TICKET_AUTO_CLOSE_HOURS',
  'TICKET_AUTO_CREATE',
  'TICKET_AUTO_CREATE_CHANNEL_IDS',
  'TICKET_CATEGORY_ROLE_MAP',
  'TICKET_CLOSED_CATEGORY_ID',
  'TICKET_DM_ON_CLOSE',
  'TICKET_FIRST_REPLY_SLA_MS',
  'TICKET_FORUM_CHANNEL_ID',
  'TICKET_LOG_CHANNEL_ID',
  'TICKET_MAX_OPEN_PER_USER',
  'TICKET_NAMING',
  'TICKET_OFFER_COOLDOWN_MS',
  'TICKET_OFFER_ENABLED',
  'TICKET_OPEN_CATEGORY_ID',
  'TICKET_OPEN_COOLDOWN_MS',
  'TICKET_PANEL_CHANNEL_ID',
  'TICKET_REASONS',
  'TICKET_SLA_IGNORE_WORKFLOWS',
  'TICKET_SLA_SECOND_NUDGE_MS',
  'TICKET_STAFF_INTAKE_ONLY',
  'TICKET_SYSTEM_ENABLED',
  'TICKET_TRANSCRIPT_ENABLED',
  'TICKET_TRANSCRIPT_HTML',
  'TICKET_TRANSCRIPT_MAX_MESSAGES',
  'TICKET_WORKFLOW_STATUSES',
  'TIKTOK_NOTIFICATIONS_ENABLED',
  'TRANSLATE_COOLDOWN_MS',
  'TRANSLATE_HOURLY_MAX',
  'TWITCH_NOTIFICATIONS_ENABLED',
  'URL_RISK_BLOCK_SCORE',
  'URL_RISK_DELETE_MESSAGE',
  'URL_RISK_ENABLED',
  'URL_RISK_TRUSTED_HOSTS',
  'VECTOR_RETRIEVAL_ENABLED',
  'VECTOR_TOP_K',
  'WARN_KICK_THRESHOLD',
  'WARN_TIMEOUT_THRESHOLD',
  'WELCOME_CHANNEL_ID',
  'WELCOME_GENERAL_CHANNEL_ID',
  'WELCOME_NEW_PRODUCTS_CHANNEL_ID',
  'WELCOME_ROLE_ID',
  'WELCOME_RULES_CHANNEL_ID',
  'WELCOME_SUPPORT_CHANNEL_ID',
  'WELCOME_TICKET_CHANNEL_ID',
  'WELCOME_UPDATES_CHANNEL_ID',
  'ZIP_ATTACHMENT_MAX_BYTES',
  'ZIP_ATTACHMENT_MAX_FILE_CHARS',
  'ZIP_ATTACHMENT_MAX_FILES',
] as const

const BOOL_KEYS = new Set<string>([
  'PERSISTENT_MEMORY',
  'ENABLE_DM_SUPPORT',
  'AI_FEEDBACK_REACTIONS_ENABLED',
  'AI_REPLY_DISCLAIMER_ENABLED',
  'AI_RESPONSE_CACHE_ENABLED',
  'VECTOR_RETRIEVAL_ENABLED',
  'COMING_SOON_REPLIES_ENABLED',
  'CODEBASE_SINGLE_RESOURCE_MODE',
  'POLL_MONITOR_ENABLED',
  'POLL_LOG_VOTES',
  'POLL_CREATE_ANNOUNCEMENT_PING_EVERYONE',
  'AUDIT_LOG_PROFILE_UPDATES',
  'ND_KEYWORDS_APPEND',
  'PROFILE_SCAN_ENABLED',
  'PROFILE_SCAN_TEXT',
  'PROFILE_SCAN_CUSTOM_STATUS',
  'PROFILE_SCAN_AVATAR_VISION',
  'PROFILE_SCAN_DEFAULT_AVATARS',
  'PROFILE_SCAN_INVITE_IN_NAME',
  'URL_RISK_ENABLED',
  'URL_RISK_DELETE_MESSAGE',
  'STORE_PAGE_SNAPSHOT_ENABLED',
  'AUTOMOD_ENABLED',
  'AUTOMOD_BLOCK_INVITES',
  'AUTOMOD_BLOCK_GIF_URLS',
  'AI_AUTOMOD_ENABLED',
  'AI_AUTOMOD_TOXICITY',
  'AI_AUTOMOD_SCAM',
  'AI_AUTOMOD_NSFW',
  'AI_AUTOMOD_RAID',
  'AI_AUTOMOD_SENTIMENT',
  'AI_AUTOMOD_IMPERSONATION',
  'AI_AUTOMOD_HATE',
  'AI_AUTOMOD_SELFHARM',
  'AI_AUTOMOD_DOXXING',
  'AI_AUTOMOD_SPAM_AD',
  'AI_AUTOMOD_CRYPTO_SCAM',
  'AI_AUTOMOD_INCLUDE_REPLY_CONTEXT',
  'AI_AUTOMOD_INCLUDE_CHANNEL_SNIPPET',
  'AI_AUTOMOD_VISION',
  'AI_AUTOMOD_ESCALATION_ENABLED',
  'RAID_NEW_ACCOUNT_ALERT_ENABLED',
  'TICKET_OFFER_ENABLED',
  'TICKET_STAFF_INTAKE_ONLY',
  'TICKET_AUTO_CREATE',
  'TICKET_SYSTEM_ENABLED',
  'TICKET_TRANSCRIPT_ENABLED',
  'TICKET_TRANSCRIPT_HTML',
  'TICKET_DM_ON_CLOSE',
  'APPEALS_ENABLED',
  'APPEALS_AI_TRIAGE_ENABLED',
  'WEEKLY_MOD_REPORT_ENABLED',
  'MODMAIL_ENABLED',
  'VERIFY_ENABLED',
  'RAID_AUTOLOCK_ENABLED',
  'ALT_DETECTION_ENABLED',
  'ALT_ACTION_ENABLED',
  'ALT_DRY_RUN',
  'ALT_AVATAR_AI_CHECK',
  'SCAM_LINK_AI_ENABLED',
  'SCAM_LINK_AI_DELETE',
  'QUARANTINE_ROLESWAP_ENABLED',
  'QUARANTINE_NAME_FILTER_ENABLED',
  'STARBOARD_ENABLED',
  'STREAMING_ALERTS_ENABLED',
  'LEVELS_ENABLED',
  'LEVELS_DM_ENABLED',
  'LEVELS_REMOVE_PREVIOUS_ROLES',
  'AFK_ENABLED',
  'AFK_AUTO_CLEAR',
  'AUTO_DELETE_ENABLED',
  'AUTO_PURGE_ENABLED',
  'TIKTOK_NOTIFICATIONS_ENABLED',
  'TWITCH_NOTIFICATIONS_ENABLED',
  'DASHBOARD_ENABLED',
  'DASHBOARD_READ_ONLY',
  'DASHBOARD_RESTART_ENABLED',
])

const TEXT_KEYS = new Set<string>([
  'SYSTEM_PROMPT',
  'SYSTEM_PROMPT_DM',
  'SYSTEM_PROMPT_GUILD',
  'AI_AUTOMOD_SERVER_RULES',
  'AI_AUTOMOD_ESCALATION_SKIP_VERDICTS',
  'ND_KEYWORDS_CONTEXT',
  'CHANNEL_PROMPT_EXTRAS_JSON',
  'AUTO_DELETE_RULES_JSON',
  'AUTO_PURGE_RULES_JSON',
  'LEVELS_ROLE_MILESTONES_JSON',
  'SUPPORT_LINKS_JSON',
  'SAFETY_EXTRA_MARKDOWN',
  'AI_MONITORING_NOTICE',
  'AUTOMOD_PUBLIC_BLURB',
  'COMING_SOON_RESOURCES',
  'PROFILE_FLAG_TERMS',
  'TICKET_REASONS',
  'TICKET_WORKFLOW_STATUSES',
  'TICKET_SLA_IGNORE_WORKFLOWS',
  'AUTOMOD_URL_BLOCKLIST_SUBSTRINGS',
  'AUTOMOD_URL_BLOCKLIST_REGEX',
  'DEV_BUILD_PATH',
  'DEV_BUILD_PATHS',
  'PRODUCT_ALIAS_URLS',
  'STORE_FEATURED_LINES',
  'STORE_PAGE_URL',
  'POLL_CREATE_ANNOUNCEMENT_TEMPLATE',
])

const NUMBER_KEYS = new Set<string>([
  'OPENAI_TIMEOUT_MS',
  'IMAGE_ATTACHMENT_MAX_BYTES',
  'ZIP_ATTACHMENT_MAX_BYTES',
  'ZIP_ATTACHMENT_MAX_FILES',
  'ZIP_ATTACHMENT_MAX_FILE_CHARS',
  'CONVERSATION_HISTORY_LIMIT',
  'PRODUCT_DOCS_MAX_FILES',
  'STORE_FEATURED_COUNT',
  'STORE_LOOKUP_MAX_RESULTS',
  'STORE_PAGE_FETCH_TIMEOUT_MS',
  'STORE_PAGE_MAX_CHARS',
  'STORE_PAGE_REFRESH_MINUTES',
  'STORE_SNAPSHOT_STALE_MINUTES',
  'VECTOR_TOP_K',
  'EMBEDDING_REFRESH_MINUTES',
  'EMBEDDING_MAX_CHUNK_CHARS',
  'EMBEDDING_MAX_CORPUS_CHUNKS',
  'CODEBASE_MAX_FILES',
  'CODEBASE_REFRESH_MINUTES',
  'FAQ_REFRESH_MS',
  'POLL_REMINDER_HOURS_BEFORE',
  'ACTIVE_CONVERSATION_MS',
  'WARN_TIMEOUT_THRESHOLD',
  'WARN_KICK_THRESHOLD',
  'PROFILE_SCAN_MIN_CONFIDENCE',
  'PROFILE_SCAN_COOLDOWN_SEC',
  'PROFILE_SCAN_MAX_PER_MINUTE',
  'AUTOMOD_MAX_MENTIONS',
  'AUTOMOD_MAX_LINKS',
  'AUTOMOD_MAX_DUPES',
  'AUTOMOD_DUPE_WINDOW_SEC',
  'AUTOMOD_FAST_MSG_COUNT',
  'AUTOMOD_FAST_MSG_WINDOW_SEC',
  'URL_RISK_BLOCK_SCORE',
  'HEATED_SLOWMODE_SECONDS',
  'HEATED_SLOWMODE_COOLDOWN_MS',
  'TRANSLATE_COOLDOWN_MS',
  'TRANSLATE_HOURLY_MAX',
  'AI_AUTOMOD_MIN_CONFIDENCE',
  'AI_AUTOMOD_BATCH_SIZE',
  'AI_AUTOMOD_BATCH_INTERVAL_MS',
  'AI_AUTOMOD_MAX_CALLS_PER_MINUTE',
  'AI_AUTOMOD_VISION_MAX_PER_MINUTE',
  'AI_AUTOMOD_STAFF_LOG_DEDUPE_SEC',
  'AI_AUTOMOD_REPORT_MSG_DEDUPE_SEC',
  'AI_AUTOMOD_ESCALATION_WARN_AT',
  'AI_AUTOMOD_ESCALATION_KICK_AT',
  'AI_AUTOMOD_ESCALATION_BAN_AT',
  'AI_AUTOMOD_ESCALATION_DECAY_DAYS',
  'RAID_JOIN_THRESHOLD',
  'RAID_JOIN_WINDOW_SEC',
  'RAID_NEW_ACCOUNT_DAYS',
  'TICKET_MAX_OPEN_PER_USER',
  'TICKET_OFFER_COOLDOWN_MS',
  'TICKET_OPEN_COOLDOWN_MS',
  'TICKET_AUTO_CLOSE_HOURS',
  'TICKET_AUTO_CLOSE_GRACE_HOURS',
  'TICKET_TRANSCRIPT_MAX_MESSAGES',
  'TICKET_FIRST_REPLY_SLA_MS',
  'TICKET_SLA_SECOND_NUDGE_MS',
  'REPORT_MAX_BODY_LENGTH',
  'REPORT_COOLDOWN_MS',
  'LEVELS_XP_MIN',
  'LEVELS_XP_MAX',
  'LEVELS_COOLDOWN_SEC',
  'AUTO_PURGE_INTERVAL_MIN',
  'TEMPVC_DEFAULT_LIMIT',
  'DASHBOARD_PORT',
  'AUTOMOD_HOMOGLYPH_SCRIPT_RATIO',
])

/**
 * Operator-facing one-line descriptions. Keys not in this map render with no help line.
 * Aim for a sentence: what it does, expected unit/format, and any common pitfall.
 */
const HELP: Readonly<Record<string, string>> = {
  // General / secrets
  DISCORD_BOT_TOKEN: 'Bot token from Discord developer portal. Required.',
  GOOGLE_API_KEY: 'API key for Google Generative AI (Gemini). Required.',
  OPENAI_API_KEY: 'Optional OpenAI key, enables fallback when Gemini errors.',
  OPENAI_BASE_URL:
    'Override the OpenAI endpoint (e.g., a proxy). Default: https://api.openai.com/v1.',
  OPENAI_MODEL: 'Primary OpenAI model name. Default: gpt-4o-mini.',
  OPENAI_TIMEOUT_MS: 'OpenAI HTTP timeout in ms. Min 3000.',
  OPENAI_FALLBACK_MODELS: 'Comma-separated OpenAI model IDs tried after the primary.',
  GEMINI_MODEL: 'Primary Gemini model ID (see Google AI Studio for valid names).',
  GEMINI_FALLBACK_MODELS: 'Comma-separated Gemini model IDs tried in order if the primary fails.',
  AI_RESPONSE_CACHE_ENABLED:
    'Cache identical AI classifier prompts (AutoMod, scam-link, appeal triage) for a short time to cut API cost and latency. Chat replies are never cached (1/0).',
  AI_RESPONSE_CACHE_TTL_SEC: 'How long a cached classifier response is reused, in seconds. Default 300.',
  AI_RESPONSE_CACHE_MAX: 'Maximum cached classifier responses kept in memory (oldest evicted). Default 500.',
  DATA_DIR: 'On-disk directory for JSON state (memory, levels, afk, overrides). Default: ./data.',

  // Dashboard
  DASHBOARD_ENABLED: 'Master switch for the local admin server. 1 to start, 0 to disable.',
  DASHBOARD_HOST: 'Bind interface. Keep 127.0.0.1 unless you understand the risk of exposing it.',
  DASHBOARD_PORT: 'TCP port for the admin server. Default 3849.',
  DASHBOARD_TOKEN: 'Bearer token required by every /api/* call. Use 32+ random characters.',
  DASHBOARD_READ_ONLY: 'When on, blocks all writes (PUT/POST). View-only.',
  DASHBOARD_RESTART_ENABLED: 'Allow the Restart button to spawn the restart command.',
  DASHBOARD_RESTART_CMD: 'Optional shell command run by the Restart button (overrides PM2).',
  DASHBOARD_PM2_APP: 'PM2 app name used for the default restart (bunx pm2 restart <name>).',

  // DMs / persistence
  ENABLE_DM_SUPPORT: 'Bot replies to DMs when on. Off keeps DMs ignored.',
  ALLOWED_DM_USER_IDS:
    'Comma-separated user IDs allowed to DM the bot. Empty = anyone (when DMs enabled).',
  PERSISTENT_MEMORY: 'Persist conversation memory to disk (DATA_DIR). Off = RAM only.',
  CONVERSATION_HISTORY_LIMIT: 'Max turns kept per conversation. Capped at 40.',
  CONVERSATION_MEMORY_FILE: 'Filename inside DATA_DIR for memory snapshots.',

  // Channel restriction
  GUILD_CHANNEL_IDS: 'Restrict the AI bot to these channel IDs. Empty = all channels.',
  GUILD_AI_TICKET_CATEGORY_IDS:
    'Channel/category IDs where the AI greets the first ticket message.',

  // System prompts
  SYSTEM_PROMPT: 'Base persona prompt. Used as fallback when guild/DM-specific are blank.',
  SYSTEM_PROMPT_GUILD: 'Persona prompt for guild channels.',
  SYSTEM_PROMPT_DM: 'Persona prompt for direct messages.',

  // ND keywords / context
  ND_KEYWORDS_APPEND:
    'Append the built-in ND vocabulary block to the prompt. Off to fully replace.',
  ND_KEYWORDS_FILE: 'Path to a markdown file appended as project glossary.',
  ND_KEYWORDS_CONTEXT: 'Inline glossary text injected into prompts.',

  // Embeddings / vector
  VECTOR_RETRIEVAL_ENABLED: 'Embed indexed corpora and inject top-K matches per query.',
  VECTOR_TOP_K: 'How many top embedding hits to inject per request.',
  EMBEDDING_MODEL: 'Google embedding model ID. Default: gemini-embedding-001.',
  EMBEDDING_REFRESH_MINUTES: 'How often to rebuild the embedding index.',
  EMBEDDING_MAX_CHUNK_CHARS: 'Max characters per chunk before splitting (min 200).',
  EMBEDDING_MAX_CORPUS_CHUNKS: 'Cap the total chunk count to keep memory bounded.',

  // Codebase indexing
  CODEBASE_REFRESH_MINUTES: 'How often the dev-build index is rebuilt.',
  CODEBASE_MAX_FILES: 'Per-resource file cap when indexing.',
  CODEBASE_EXCLUDE_PATH_SUBSTRINGS: 'Comma-separated path fragments to skip while indexing.',
  CODEBASE_SINGLE_RESOURCE_MODE: 'When on, restrict each query to the resource it asks about.',
  DEV_BUILD_PATH: 'Single dev-build root path to index (legacy).',
  DEV_BUILD_PATHS: 'Comma-separated dev-build root paths to index. Preferred over DEV_BUILD_PATH.',

  // Product docs
  PRODUCT_DOCS_DIR: 'Directory of markdown product docs to index.',
  PRODUCT_DOCS_MAX_FILES: 'Cap on docs loaded per request.',
  PRODUCT_ALIAS_URLS: 'Optional product name -> docs URL JSON map.',
  STORE_FEATURED_LINES: 'One featured bullet per line for /store (overrides auto-parsed listing).',
  STORE_FEATURED_COUNT: 'How many featured bullets when using auto-parsed items (1-10).',
  STORE_LOOKUP_MAX_RESULTS: 'Max product matches returned by /product and nd!product.',
  STORE_SNAPSHOT_STALE_MINUTES:
    'Health UI treats the snapshot as stale after this many minutes without refresh.',
  STORE_PAGE_SNAPSHOT_ENABLED:
    'Fetch the public store page as text and inject it into AI context (and embeddings when enabled).',
  STORE_PAGE_URL: 'Public store listing URL (FaxStore storefront). Default: ND catalog.',
  STORE_PAGE_REFRESH_MINUTES: 'How often to re-fetch the store page (min 15).',
  STORE_PAGE_MAX_CHARS: 'Max characters kept from the HTML→text snapshot.',
  STORE_PAGE_FETCH_TIMEOUT_MS: 'HTTP timeout for the store fetch (min 5000 ms).',

  // FAQ
  FAQ_CHANNEL_ID: 'Channel ID whose pinned messages are scraped as FAQ context.',
  FAQ_REFRESH_MS: 'How often to re-fetch FAQ content (ms). Default 30 min.',

  // Attachments
  IMAGE_ATTACHMENT_MAX_BYTES: 'Max image size for vision (bytes). Capped at 4 MiB.',
  ZIP_ATTACHMENT_MAX_BYTES: 'Max ZIP analyzed for attachments (bytes). Capped at 25 MiB.',
  ZIP_ATTACHMENT_MAX_FILES: 'Max files inspected per ZIP. Capped at 200.',
  ZIP_ATTACHMENT_MAX_FILE_CHARS: 'Max characters captured per text file in a ZIP.',

  // Logging channels
  STAFF_LOG_CHANNEL_ID: 'Channel ID for staff-only mod/system logs.',
  APPEALS_CHANNEL_ID: 'Channel where ban appeals are posted for staff review. Defaults to staff log.',
  APPEALS_ENABLED: 'DM banned users an appeal button so they can request a review (1/0).',
  APPEALS_AI_TRIAGE_ENABLED:
    'AI pre-assesses each submitted appeal and adds a one-line advisory to the staff review embed. Advisory only; staff still decide (1/0).',
  WEEKLY_MOD_REPORT_ENABLED:
    'Post an AI-summarized moderation digest (cases and warnings from the past 7 days) to staff once a week (1/0).',
  WEEKLY_MOD_REPORT_CHANNEL_ID:
    'Channel for the weekly mod report. Defaults to STAFF_LOG_CHANNEL_ID.',
  MODMAIL_ENABLED: 'Let users DM the bot `nd!modmail <msg>` to open a private staff relay (1/0).',
  MODMAIL_CATEGORY_ID: 'Category under which per-user modmail channels are created.',
  MODMAIL_STAFF_ROLE_IDS: 'Extra role IDs (comma-separated) that can see/reply in modmail, beyond MOD_ROLE_ID.',
  VERIFY_ENABLED: 'Require new members to click a Verify button before gaining access (1/0).',
  VERIFY_CHANNEL_ID: 'Channel where the verification panel lives (post it with nd!verifypanel).',
  VERIFY_ROLE_ID: 'Role granted when a member verifies.',
  VERIFY_UNVERIFIED_ROLE_ID: 'Optional holding role assigned on join, removed on verify.',
  VERIFY_KICK_AFTER_MS: 'Kick members who never verify after this many ms (0 = never).',
  RAID_AUTOLOCK_ENABLED: 'Auto-enable lockdown when the raid join threshold is crossed (1/0).',
  RAID_AUTOLOCK_DURATION_MS: 'Auto-unlock after this many ms (0 = stay locked until staff unlock).',
  ALT_DETECTION_ENABLED: 'Score new joins for bot/ban-evasion signals and alert staff (1/0).',
  ALT_ALERT_THRESHOLD: 'Risk score at or above which an alt/bot alert is posted.',
  ALT_ACTION_ENABLED: 'Take tiered auto-action (quarantine/kick/ban) on suspected bot/alt joins (1/0).',
  ALT_DRY_RUN: 'Log/alert what auto-action WOULD happen but take no action (1/0).',
  ALT_QUARANTINE_AT: 'Risk score at or above which to quarantine (add holding role). Default 4.',
  ALT_KICK_AT: 'Risk score at or above which to kick. Default 6.',
  ALT_BAN_AT: 'Risk score at or above which to ban. Default 8.',
  ALT_QUARANTINE_ROLE_ID: 'Role added on quarantine. Falls back to VERIFY_UNVERIFIED_ROLE_ID.',
  ALT_AUTOBAN_MAX_PER_MIN: 'Cap auto-bans per 60s to avoid mass false positives. Default 5.',
  ALT_AVATAR_AI_CHECK: 'Use Gemini vision to flag AI-generated/bot-like avatars on borderline joiners (1/0).',
  ALT_AVATAR_AI_MIN_CONFIDENCE: 'Min confidence (0.5-0.99) for the avatar check to add to the score. Default 0.75.',
  SCAM_LINK_AI_ENABLED: 'AI-classify unknown links (not caught by heuristics) for scam/phishing (1/0).',
  SCAM_LINK_AI_DELETE: 'Delete + timeout on an AI scam-link verdict (1), or log only (0).',
  SCAM_LINK_AI_MIN_CONFIDENCE: 'Min confidence (0.5-0.99) to act on a scam-link verdict. Default 0.8.',
  SCAM_LINK_AI_MAX_PER_MIN: 'Cap AI link classifications per 60s (cost guard). Default 8.',
  QUARANTINE_ROLESWAP_ENABLED: 'When the quarantine role is added, remove the member role; restore it when quarantine is lifted (1/0).',
  QUARANTINE_ROLE_ID: 'The quarantine role to watch.',
  QUARANTINE_TOGGLE_ROLE_ID: 'The member role removed on quarantine and restored when it is lifted.',
  QUARANTINE_NAME_FILTER_ENABLED:
    'Auto-quarantine members whose username, display name, or server nickname is flagged (Discord automod-quarantine flag, profanity/abuse filter, custom flag terms, or an invite link). Applies QUARANTINE_ROLE_ID and alerts staff. Runs even if PROFILE_SCAN_TEXT is off (1/0).',
  QUARANTINE_NAME_EXEMPT_USER_IDS:
    'Comma-separated user IDs never auto-quarantined by the name filter. Use for legitimate members whose name innocently collides with the filter (e.g. surnames like Hancock or Dickson).',
  STARBOARD_ENABLED: 'Repost highly-reacted messages to a highlights channel (1/0).',
  STARBOARD_CHANNEL_ID: 'Highlights channel where starred messages are reposted.',
  STARBOARD_EMOJI: 'Reaction emoji that counts toward the starboard (default star).',
  STARBOARD_THRESHOLD: 'Number of reactions required to hit the starboard (default 3).',
  STREAMING_ALERTS_ENABLED: 'Announce Twitch go-live + YouTube uploads for watched channels (1/0).',
  STREAM_ANNOUNCE_CHANNEL_ID: 'Channel where go-live / new-video alerts are posted.',
  STREAM_POLL_INTERVAL_SEC: 'How often to poll Twitch/YouTube, in seconds (min 60, default 300).',
  TWITCH_CLIENT_ID: 'Twitch app client ID (dev.twitch.tv) for go-live detection.',
  TWITCH_CLIENT_SECRET: 'Twitch app client secret.',
  TWITCH_WATCH_LOGINS: 'Comma-separated Twitch login names to watch.',
  YOUTUBE_WATCH_CHANNELS: 'Comma-separated YouTube channel IDs to watch (uploads via RSS, no API key).',
  DM_LOG_CHANNEL_ID: 'Channel ID for DM transcripts copy.',
  AUDIT_LOG_CHANNEL_ID: 'Channel ID for the audit feed (joins/leaves/edits/deletes).',
  AUDIT_IGNORED_CHANNELS: 'Comma-separated channel IDs the audit feed ignores.',
  AUDIT_IGNORED_CATEGORY_IDS: 'Comma-separated category IDs the audit feed ignores.',
  AUDIT_LOG_PROFILE_UPDATES: 'Include nick/avatar/role profile changes in audit feed.',
  MESSAGE_LOG_CHANNEL_ID: 'Channel ID for message-edit/delete logs.',
  MEMBER_LOG_CHANNEL_ID: 'Channel ID for member join/leave logs.',
  ROLE_LOG_CHANNEL_ID: 'Channel ID for role-change logs.',
  CHANNEL_LOG_CHANNEL_ID: 'Channel ID for channel/thread create/delete logs.',

  // AI feedback reactions
  AI_FEEDBACK_REACTIONS_ENABLED: 'Add thumbs reactions to bot replies for tracking.',
  AI_FEEDBACK_POSITIVE_EMOJI: 'Emoji used for positive feedback. Default ✅.',
  AI_FEEDBACK_NEGATIVE_EMOJI: 'Emoji used for negative feedback. Default ❌.',
  AI_FEEDBACK_LOG_CHANNEL_ID: 'Channel for the feedback log; blank = no log.',

  // AI Automod
  AI_AUTOMOD_ENABLED: 'Master switch for AI moderation queue.',
  AI_AUTOMOD_MIN_CONFIDENCE: 'Confidence floor for an AI verdict to act on (0-1, default 0.75).',
  AI_AUTOMOD_BATCH_SIZE: 'How many messages collected before sending one AI batch.',
  AI_AUTOMOD_BATCH_INTERVAL_MS: 'Max wait (ms) before flushing a non-full batch.',
  AI_AUTOMOD_MAX_CALLS_PER_MINUTE: 'Hard cap on AI moderation requests per minute (rate limit).',
  AI_AUTOMOD_VISION: 'Send image attachments to Gemini vision for moderation review.',
  AI_AUTOMOD_VISION_MAX_PER_MINUTE: 'Per-minute cap on vision moderation calls.',
  AI_AUTOMOD_INCLUDE_REPLY_CONTEXT: 'Include the message being replied to in the AI prompt.',
  AI_AUTOMOD_INCLUDE_CHANNEL_SNIPPET: 'Include a short prior-channel snippet for context.',
  AI_AUTOMOD_SERVER_RULES: 'Server rules text injected into the AI moderator prompt.',
  AI_AUTOMOD_ESCALATION_ENABLED: 'Track repeat offenders and escalate warn → kick → ban.',
  AI_AUTOMOD_ESCALATION_WARN_AT: 'Strike count that triggers a warning.',
  AI_AUTOMOD_ESCALATION_KICK_AT: 'Strike count that triggers a kick.',
  AI_AUTOMOD_ESCALATION_BAN_AT: 'Strike count that triggers a ban.',
  AI_AUTOMOD_ESCALATION_DECAY_DAYS: 'How long an escalation strike persists (days).',
  AI_AUTOMOD_ESCALATION_SKIP_VERDICTS: 'Comma-separated verdict labels excluded from escalation.',
  AI_AUTOMOD_STAFF_LOG_DEDUPE_SEC: 'Suppress duplicate staff alerts within this window (sec).',
  AI_AUTOMOD_REPORT_MSG_DEDUPE_SEC:
    'Suppress duplicate user-facing notices within this window (sec).',
  AI_AUTOMOD_TOXICITY: 'Detect toxicity / harassment.',
  AI_AUTOMOD_SCAM: 'Detect scams (phishing, fake giveaways).',
  AI_AUTOMOD_NSFW: 'Flag NSFW content.',
  AI_AUTOMOD_RAID: 'Flag coordinated raid behavior.',
  AI_AUTOMOD_SENTIMENT: 'Flag heavily negative sentiment for review.',
  AI_AUTOMOD_IMPERSONATION: 'Flag impersonation attempts (staff/popular users).',
  AI_AUTOMOD_HATE: 'Detect hate speech.',
  AI_AUTOMOD_SELFHARM: 'Flag self-harm content for staff review.',
  AI_AUTOMOD_DOXXING: 'Flag doxxing / personal info disclosure.',
  AI_AUTOMOD_SPAM_AD: 'Flag advertising spam.',
  AI_AUTOMOD_CRYPTO_SCAM: 'Flag crypto / token scams.',

  // Rule automod
  AUTOMOD_ENABLED: 'Master switch for rule-based automod (mention/dupe/link caps).',
  AUTOMOD_BLOCK_INVITES: 'Block discord.gg invite links posted by non-staff.',
  AUTOMOD_BLOCK_GIF_URLS: 'Block direct GIF/CDN URL pastes (use the Discord embed instead).',
  AUTOMOD_GIF_BLOCK_HOSTS:
    'Comma-separated hosts treated as GIF spam (tenor.com, giphy.com, etc.).',
  AUTOMOD_MAX_MENTIONS: 'Max user mentions per message. Min 1.',
  AUTOMOD_MAX_LINKS: 'Max distinct links per message. Min 1.',
  AUTOMOD_MAX_DUPES: 'Max identical messages within the dupe window before action. Min 2.',
  AUTOMOD_DUPE_WINDOW_SEC: 'Window for the dupe counter (seconds). Min 3.',
  AUTOMOD_FAST_MSG_COUNT:
    'Burst threshold: this many messages within the window triggers slowmode.',
  AUTOMOD_FAST_MSG_WINDOW_SEC: 'Window for the burst counter (seconds).',
  AUTOMOD_HOMOGLYPH_SCRIPT_RATIO:
    'Ratio (0-1) of suspicious script characters to flag homoglyph spam.',
  AUTOMOD_URL_BLOCKLIST_SUBSTRINGS: 'Newline- or comma-separated URL substrings to always block.',
  AUTOMOD_URL_BLOCKLIST_REGEX: 'Comma-separated regex patterns to block in URLs.',
  AUTOMOD_BLOCKED_ATTACHMENT_EXT:
    'Comma-separated file extensions to delete on upload (e.g., exe,bat,scr).',
  AUTOMOD_PUBLIC_BLURB: 'Short user-facing message included with automod actions.',
  EXTRA_BANNED_WORDS: 'Comma-separated additional banned words.',

  // URL risk
  URL_RISK_ENABLED: 'Score every posted URL for phishing/scam risk.',
  URL_RISK_BLOCK_SCORE: 'Score (0-100) at which a URL is blocked. Min 25.',
  URL_RISK_DELETE_MESSAGE: 'Delete the message when a URL exceeds the block score.',
  URL_RISK_TRUSTED_HOSTS: 'Comma-separated hostnames always allowed.',

  // Raid
  RAID_JOIN_THRESHOLD: 'Joins per window that triggers raid mode.',
  RAID_JOIN_WINDOW_SEC: 'Window (sec) for the join counter.',
  RAID_NEW_ACCOUNT_ALERT_ENABLED: 'Alert staff when new accounts (under N days) join.',
  RAID_NEW_ACCOUNT_DAYS: 'Account age threshold (days) for the new-account alert.',

  // Profile scan
  PROFILE_SCAN_ENABLED: 'Scan member profiles for risky names/avatars/status.',
  PROFILE_SCAN_TEXT: 'Scan textual fields (username, display, status).',
  PROFILE_SCAN_CUSTOM_STATUS: 'Include custom status in scans (requires GuildPresences intent).',
  PROFILE_SCAN_AVATAR_VISION: 'Send avatars to vision model for review.',
  PROFILE_SCAN_DEFAULT_AVATARS: 'Also scan accounts that still have the default Discord avatar.',
  PROFILE_SCAN_INVITE_IN_NAME: 'Flag profiles whose name contains a discord.gg invite.',
  PROFILE_SCAN_MIN_CONFIDENCE: 'Floor (0-1) for acting on AI profile findings.',
  PROFILE_SCAN_COOLDOWN_SEC: 'Per-user re-scan cooldown (seconds).',
  PROFILE_SCAN_MAX_PER_MINUTE: 'Global cap on profile scans per minute.',
  PROFILE_FLAG_TERMS: 'Newline- or comma-separated terms that auto-flag a profile.',

  // Tickets
  TICKET_SYSTEM_ENABLED: 'Master switch for the ticket system.',
  TICKET_PANEL_CHANNEL_ID: 'Channel where the panel embed/buttons are posted.',
  TICKET_OPEN_CATEGORY_ID: 'Category for newly opened ticket channels.',
  TICKET_CLOSED_CATEGORY_ID: 'Category where closed tickets are moved (optional).',
  TICKET_FORUM_CHANNEL_ID: 'Forum channel ID if using forum-based tickets.',
  TICKET_LOG_CHANNEL_ID: 'Channel ID for ticket open/close logs.',
  TICKET_MAX_OPEN_PER_USER: 'Max simultaneously open tickets per user.',
  TICKET_OFFER_ENABLED: 'Auto-offer to open a ticket from likely support questions.',
  TICKET_OFFER_COOLDOWN_MS: 'Cooldown between offers per user (ms).',
  TICKET_OPEN_COOLDOWN_MS: 'Cooldown between ticket opens per user (ms).',
  TICKET_AUTO_CLOSE_HOURS: 'Hours of inactivity before a ticket is auto-closed.',
  TICKET_AUTO_CLOSE_GRACE_HOURS: 'Grace period after the warning before close.',
  TICKET_AUTO_CREATE: 'Auto-create a ticket from messages in TICKET_AUTO_CREATE_CHANNEL_IDS.',
  TICKET_AUTO_CREATE_CHANNEL_IDS: 'Comma-separated channel IDs eligible for auto-create.',
  TICKET_CATEGORY_ROLE_MAP:
    'JSON map of ticket category -> role ID to ping once when that ticket opens, e.g. {"billing/refund":"123","script support":"456"}. Partnership categories default to the partner-manager role.',
  TICKET_DM_ON_CLOSE: 'DM the requester a summary when their ticket closes.',
  TICKET_TRANSCRIPT_ENABLED: 'Build a transcript file when a ticket closes.',
  TICKET_TRANSCRIPT_HTML: 'Render transcripts as HTML (otherwise plain text).',
  TICKET_TRANSCRIPT_MAX_MESSAGES: 'Max messages captured in a single transcript.',
  TICKET_FIRST_REPLY_SLA_MS: 'Time (ms) before the first-reply SLA nudge fires.',
  TICKET_SLA_SECOND_NUDGE_MS: 'Time (ms) before the second SLA nudge fires.',
  TICKET_REASONS: 'Newline- or comma-separated ticket reason labels for the panel buttons.',
  TICKET_WORKFLOW_STATUSES: 'Status labels available in /ticket-status.',
  TICKET_SLA_IGNORE_WORKFLOWS: 'Statuses that pause SLA nudges (e.g., "Waiting on user").',
  TICKET_NAMING: 'Ticket channel name template (e.g., ticket-{user}).',
  TICKET_STAFF_INTAKE_ONLY: 'Only staff may open tickets via the panel.',

  // Levels
  LEVELS_ENABLED: 'Master switch for the leveling/XP system.',
  LEVELS_XP_MIN: 'Min XP awarded per qualifying message.',
  LEVELS_XP_MAX: 'Max XP awarded per qualifying message.',
  LEVELS_COOLDOWN_SEC: 'Per-user cooldown between XP awards (seconds).',
  LEVELS_DM_ENABLED: 'DM the user when they level up.',
  LEVELS_ALERT_CHANNEL_ID: 'Channel ID for level-up announcements.',
  LEVELS_REMOVE_PREVIOUS_ROLES: 'Remove the previous milestone role when granting the next.',
  LEVELS_ROLE_MILESTONES_JSON: 'JSON map of level -> roleId, e.g., {"5":"123","10":"456"}.',
  LEVELS_IGNORED_CHANNELS: 'Comma-separated channel IDs that do not award XP.',
  LEVELS_IGNORED_CATEGORY_IDS: 'Comma-separated category IDs that do not award XP.',

  // AFK
  AFK_ENABLED: 'Enable the /afk system.',
  AFK_AUTO_CLEAR: 'Auto-clear AFK on the next message from the user.',
  AFK_NICKNAME_PREFIX: 'Prefix prepended to AFK users (e.g., [AFK]).',

  // Auto delete / purge
  AUTO_DELETE_ENABLED: 'Master switch for the auto-delete rules.',
  AUTO_DELETE_RULES_JSON: 'JSON array of {channelId, ageMs} rules. See README.',
  AUTO_PURGE_ENABLED: 'Master switch for periodic purge sweeps.',
  AUTO_PURGE_INTERVAL_MIN: 'Minutes between purge passes.',
  AUTO_PURGE_RULES_JSON: 'JSON array of purge rules.',

  // Polls
  POLL_MONITOR_ENABLED: 'Watch native polls and post staff-side analytics.',
  POLL_MONITOR_CHANNEL_IDS: 'Comma-separated channel IDs whose polls are monitored.',
  POLL_REMINDER_CHANNEL_IDS: 'Comma-separated channel IDs that get reminder pings before close.',
  POLL_REMINDER_HOURS_BEFORE: 'Hours before a poll closes that the reminder fires.',
  POLL_REMINDER_PING: '"everyone" to ping @everyone, anything else for a soft mention.',
  POLL_LOG_VOTES: 'Append per-vote data to the staff log.',
  POLL_STAFF_LOG_CHANNEL_ID:
    'Override staff channel for poll logs (defaults to STAFF_LOG_CHANNEL_ID).',
  POLL_CREATE_ANNOUNCEMENT_TEMPLATE:
    'Multiline intro on the poll message (`/polls create`). `{poll_channel}` = link to polls channel; `{question}` = poll question. Leave empty for poll-only (no banner).',
  POLL_CREATE_ANNOUNCEMENT_PING_EVERYONE:
    'Prefix that message with `@everyone` (channel must allow the bot Mention Everyone when template is enabled).',

  // Welcome / mod
  WELCOME_CHANNEL_ID: 'Primary welcome channel ID.',
  WELCOME_ROLE_ID: 'Role auto-assigned to new joiners.',
  WELCOME_RULES_CHANNEL_ID: 'Channel referenced in welcome message as #rules.',
  WELCOME_GENERAL_CHANNEL_ID: 'Channel referenced in welcome message as #general.',
  WELCOME_NEW_PRODUCTS_CHANNEL_ID: 'Channel referenced as #new-products / announcements.',
  WELCOME_UPDATES_CHANNEL_ID: 'Channel referenced as #updates.',
  WELCOME_SUPPORT_CHANNEL_ID: 'Channel referenced as #support.',
  WELCOME_TICKET_CHANNEL_ID: 'Channel referenced as #tickets in welcome message.',
  MOD_ROLE_ID: 'Role ID(s) granted moderation slash commands. Comma-separated allowed.',
  SUGGESTION_CHANNEL_ID: 'Channel ID for /suggest output.',

  // Reports / translate / heated
  REPORT_CHANNEL_ID: 'Channel ID receiving /report submissions.',
  REPORT_COOLDOWN_MS: 'Per-user cooldown between reports (ms).',
  REPORT_MAX_BODY_LENGTH: 'Max characters in a report body.',
  TRANSLATE_COOLDOWN_MS: 'Per-user cooldown between /translate calls (ms).',
  TRANSLATE_HOURLY_MAX: 'Server-wide hourly cap on translations.',
  HEATED_SLOWMODE_SECONDS: 'Slowmode applied when AI flags heated channel (sec). 0 to disable.',
  HEATED_SLOWMODE_COOLDOWN_MS: 'How often (ms) the heated check can re-arm.',
  WARN_TIMEOUT_THRESHOLD: 'Warn count that triggers an automatic timeout.',
  WARN_KICK_THRESHOLD: 'Warn count that triggers an automatic kick.',
  ACTIVE_CONVERSATION_MS: 'How long (ms) the bot considers a channel "actively conversing".',

  // Misc
  AI_MONITORING_NOTICE: 'Footer text appended to AI replies disclosing the monitoring policy.',
  AI_REPLY_DISCLAIMER:
    'Warning disclaimer added as small subtext under AI chat replies (e.g. "I am an AI and can be wrong...").',
  AI_REPLY_DISCLAIMER_ENABLED: 'Append the AI reply disclaimer to chat replies (1/0).',
  CHANNEL_PROMPT_EXTRAS_JSON:
    'JSON map of channelId -> extra prompt snippet appended for that channel.',
  STAFF_DRAFT_SOURCE_CHANNEL_IDS: 'Channel IDs that feed staff-draft features.',
  COMING_SOON_REPLIES_ENABLED: 'Auto-reply with the "coming soon" template when matched.',
  COMING_SOON_RESOURCES:
    'Newline list of resource names that should trigger the coming-soon reply.',
  SAFETY_EXTRA_MARKDOWN: 'Extra safety policy markdown appended to the system prompt.',
  TIKTOK_NOTIFICATIONS_ENABLED: 'Enable the TikTok notification feature (if wired).',
  TWITCH_NOTIFICATIONS_ENABLED: 'Enable the Twitch notification feature (if wired).',
  ND_BOT_TIER: 'Feature tier label (free/pro/etc.) used by feature gates.',
  TEMPVC_LOBBY_ID: 'Voice channel ID acting as the temp-VC lobby.',
  TEMPVC_CATEGORY_ID: 'Category for spawned temp VCs.',
  TEMPVC_DEFAULT_LIMIT: 'Default user limit applied to a new temp VC.',
  SCAM_CHECK_EXTRA_TRUSTED_HOSTS: 'Extra trusted hosts for the scam-check service.',
  SUPPORT_LINKS_JSON: 'JSON map of support button labels -> URLs for the support embed.',
}

function fieldTypeFor(key: string): ConfigFieldType {
  if (BOOL_KEYS.has(key)) return 'bool'
  if (NUMBER_KEYS.has(key)) return 'number'
  if (TEXT_KEYS.has(key)) return 'text'
  if (key === 'DASHBOARD_PORT' || key === 'TEMPVC_DEFAULT_LIMIT') return 'number'
  return 'string'
}

/**
 * Tab routing. Order matters: first match wins. Each entry is a predicate so
 * the precedence is explicit (the previous prefix-tower was fragile).
 */
type TabRule = { match: (k: string) => boolean; tab: string }
const TAB_RULES: readonly TabRule[] = [
  { match: (k) => k.startsWith('DASHBOARD_'), tab: 'Dashboard' },
  { match: (k) => k === 'DISCORD_BOT_TOKEN' || k === 'DATA_DIR', tab: 'General' },
  {
    match: (k) =>
      k === 'GOOGLE_API_KEY' ||
      k.startsWith('GEMINI_') ||
      k.startsWith('OPENAI_') ||
      k.startsWith('AI_RESPONSE_CACHE_'),
    tab: 'API keys and models',
  },
  { match: (k) => k.startsWith('AI_AUTOMOD_') || k.startsWith('SCAM_LINK_'), tab: 'AI AutoMod' },
  { match: (k) => k.startsWith('URL_RISK_'), tab: 'URL risk' },
  { match: (k) => k.startsWith('RAID_'), tab: 'Raid' },
  { match: (k) => k.startsWith('AUTOMOD_'), tab: 'Rule AutoMod' },
  { match: (k) => k.startsWith('TICKET_'), tab: 'Tickets' },
  { match: (k) => k.startsWith('LEVELS_') || k.startsWith('AFK_'), tab: 'Community' },
  {
    match: (k) => k.startsWith('AUTO_DELETE') || k.startsWith('AUTO_PURGE'),
    tab: 'Automation',
  },
  {
    match: (k) =>
      k.startsWith('AUDIT_') ||
      k.includes('MESSAGE_LOG') ||
      k.includes('MEMBER_LOG') ||
      k.includes('ROLE_LOG') ||
      k.includes('CHANNEL_LOG'),
    tab: 'Logs and audit',
  },
  { match: (k) => k.startsWith('POLL_'), tab: 'Polls' },
  {
    match: (k) =>
      k.startsWith('WELCOME_') ||
      k === 'FAQ_CHANNEL_ID' ||
      k === 'MOD_ROLE_ID' ||
      k === 'SUGGESTION_CHANNEL_ID',
    tab: 'Welcome and mod',
  },
  {
    match: (k) => k.startsWith('HEATED_'),
    tab: 'Traffic Control',
  },
  {
    match: (k) =>
      k === 'STAFF_DRAFT_SOURCE_CHANNEL_IDS' ||
      k === 'ACTIVE_CONVERSATION_MS' ||
      k.startsWith('VECTOR_') ||
      k.startsWith('EMBEDDING_'),
    tab: 'AI behavior',
  },
  {
    match: (k) =>
      k === 'STAFF_LOG_CHANNEL_ID' || k === 'DM_LOG_CHANNEL_ID' || k.startsWith('AI_FEEDBACK_'),
    tab: 'Staff and feedback',
  },
  { match: (k) => k.startsWith('PROFILE_'), tab: 'Profile scan' },
  { match: (k) => k.startsWith('REPORT_'), tab: 'User reports' },
  {
    match: (k) => k.startsWith('CODEBASE_') || k === 'DEV_BUILD_PATH' || k === 'DEV_BUILD_PATHS',
    tab: 'Codebase',
  },
  {
    match: (k) =>
      k.startsWith('PRODUCT_') ||
      k === 'SUPPORT_LINKS_JSON' ||
      k === 'SAFETY_EXTRA_MARKDOWN' ||
      k === 'AI_MONITORING_NOTICE' ||
      k === 'AUTOMOD_PUBLIC_BLURB' ||
      k === 'EXTRA_BANNED_WORDS' ||
      k === 'CHANNEL_PROMPT_EXTRAS_JSON' ||
      k.startsWith('COMING_SOON_'),
    tab: 'Content and product',
  },
  {
    match: (k) =>
      k.startsWith('WARN_') || k.startsWith('TRANSLATE_') || k.startsWith('WEEKLY_MOD_REPORT_'),
    tab: 'Moderation',
  },
  {
    match: (k) =>
      k.startsWith('APPEALS_') ||
      k.startsWith('MODMAIL_') ||
      k.startsWith('VERIFY_') ||
      k.startsWith('ALT_') ||
      k.startsWith('QUARANTINE_'),
    tab: 'Security',
  },
  {
    match: (k) =>
      k.startsWith('STARBOARD_') ||
      k.startsWith('STREAM') ||
      k.startsWith('YOUTUBE_') ||
      k === 'TWITCH_CLIENT_ID' ||
      k === 'TWITCH_CLIENT_SECRET' ||
      k === 'TWITCH_WATCH_LOGINS',
    tab: 'Community+',
  },
  { match: (k) => k.startsWith('TEMPVC_'), tab: 'Temp VC' },
  {
    match: (k) => k === 'ND_BOT_TIER' || k.startsWith('TIKTOK_') || k.startsWith('TWITCH_'),
    tab: 'Feature tier',
  },
  { match: (k) => k.startsWith('ND_'), tab: 'Context and keywords' },
  {
    match: (k) =>
      k === 'GUILD_CHANNEL_IDS' ||
      k === 'GUILD_AI_TICKET_CATEGORY_IDS' ||
      k === 'ALLOWED_DM_USER_IDS' ||
      k === 'PERSISTENT_MEMORY' ||
      k.startsWith('CONVERSATION_') ||
      k.startsWith('ENABLE_'),
    tab: 'Data and DMs',
  },
  {
    match: (k) =>
      k === 'SYSTEM_PROMPT' ||
      k === 'SYSTEM_PROMPT_DM' ||
      k === 'SYSTEM_PROMPT_GUILD' ||
      k === 'IMAGE_ATTACHMENT_MAX_BYTES' ||
      k.startsWith('ZIP_ATTACHMENT_'),
    tab: 'AI behavior',
  },
]

function tabForKey(k: string): string {
  for (const rule of TAB_RULES) if (rule.match(k)) return rule.tab
  return 'General'
}

function labelFor(k: string): string {
  return k
    .split('_')
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ')
}

export function isSensitiveKey(key: string): boolean {
  if (SENSITIVE.has(key)) return true
  if (key.includes('SECRET') || /_API_KEY$|_TOKEN$|API_KEY$/.test(key)) return true
  return false
}

export function getConfigManifest(): ConfigField[] {
  return ALL_KEYS.map((key) => {
    const f: ConfigField = {
      key,
      tab: tabForKey(key),
      type: fieldTypeFor(key),
      label: labelFor(key),
      sensitive: SENSITIVE.has(key) || isSensitiveKey(key),
      requiresRestart: !RUNTIME_KEYS.has(key),
    }
    const help = HELP[key]
    if (help) f.help = help
    return f
  })
}

export const manifestKeySet: ReadonlySet<string> = new Set(ALL_KEYS)

export function isManifestKey(key: string): boolean {
  return manifestKeySet.has(key)
}
