/** Single help body for `nd!help` and `/help` so they never drift apart. */
export const BOT_HELP_DESCRIPTION =
  '**AI chat (guild)**, @mention the bot or reply to it (2 min follow-up window without pinging). If `GUILD_AI_TICKET_CATEGORY_IDS` is set, a user’s **first** message in a channel under that category also gets AI. **DMs** always get AI.\n\n' +
  '**Prefix** (`nd!`)\n' +
  '`nd!help`, this list\n' +
  '`nd!faq` · `nd!ask` · `nd!clear` · `nd!translate` / `nd!en`\n' +
  '`nd!summarize` (mod, reply to message) · `nd!digest` (mod, weekly-style summary)\n' +
  '`nd!warn` · `nd!warnings` · `nd!clearwarns` · `nd!timeout` · `nd!kick` · `nd!ban` · `nd!purge`\n' +
  '`nd!lockdown` · `nd!unlock`\n' +
  '`nd!serverinfo` · `nd!userinfo` · `nd!avatar` · `nd!poll` · `nd!announce` · `nd!say` · `nd!reminder`\n' +
  '`nd!rolereact` · `nd!giveaway` · `nd!giveaway-end` · `nd!giveaway-list`\n' +
  '`nd!suggest` · `nd!approve` · `nd!deny` · `nd!suggestions`\n' +
  '`nd!schedule` · `nd!schedule-list` · `nd!schedule-cancel`\n' +
  '`nd!vc-limit` · `nd!vc-name` · `nd!vc-lock` · `nd!vc-unlock` (temp voice owner)\n' +
  '`nd!ping` · `nd!links` · `nd!ticket` (panel + staff: `nd!ticket list` = `/tickets`)\n' +
  '`nd!tickets` / `nd!ticket-list` (mod, same as `/tickets`) · `nd!ticketstats` / `nd!ticket stats` (mod)\n' +
  '`nd!adduser` / `nd!removeuser` (mod, in ticket)\n' +
  '`nd!search` · `nd!product` · `nd!roll` · `nd!choose`\n' +
  '`nd!safety` · `nd!scamtips` · `nd!privacy` · `nd!report` · `nd!automodpublic` · `nd!modautomod` (mod)\n' +
  '`nd!scamcheck` · `nd!tldr`\n\n' +
  '**Slash**\n' +
  '`/help` · `/faq` · `/ask` · `/clear` · `/serverinfo` · `/userinfo` · `/warn` · `/purge`\n' +
  '`/translate` · `/ping` · `/links` · `/ticket` · `/tickets` (mod) · `/ticketstats` (mod) · `/search` · `/product` · `/roll` · `/choose`\n' +
  '`/safety` · `/scamtips` · `/privacy` · `/report` · `/automod_public` · `/scam_check` · `/tldr` · `/mod_automod`\n\n' +
  '**Training ND’s AI:** Edit `data/nd-knowledge.md` (via `ND_KEYWORDS_FILE`), add `data/products/*.md`, pin FAQ entries (`FAQ_CHANNEL_ID`), set `DEV_BUILD_PATHS`, optional `VECTOR_RETRIEVAL_ENABLED=1`. Staff can react to bot replies for feedback (see `.env` `AI_FEEDBACK_*`).'
