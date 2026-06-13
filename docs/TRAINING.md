# Training “ND’s AI” (quick reference)

1. **`data/nd-knowledge.md`**: Broad ND facts, policies, links. Set `ND_KEYWORDS_FILE=data/nd-knowledge.md` in `.env`.
2. **`data/products/*.md`**: One markdown file per product (install, config, issues). Scored by keyword overlap; also used when vector retrieval is enabled.
3. **FAQ channel**: Pin Q&A in `FAQ_CHANNEL_ID`. See [FAQ_PINS_GUIDE.md](./FAQ_PINS_GUIDE.md).
4. **`DEV_BUILD_PATHS`**: Point at local product folders so the indexer can attach config/code snippets (keyword + optional embeddings).
5. **`.env`**: `CODEBASE_MAX_FILES`, `CONVERSATION_HISTORY_LIMIT`, `PERSISTENT_MEMORY`, `VECTOR_RETRIEVAL_ENABLED`, `AI_FEEDBACK_*`.

Staff can react to the bot’s AI messages (defaults: checkmark / cross) to log feedback; negative flags go to `AI_FEEDBACK_LOG_CHANNEL_ID` or `STAFF_LOG_CHANNEL_ID`.
