# FAQ channel pins (training the bot)

The bot reads **all pinned messages** in the channel set by `FAQ_CHANNEL_ID` and injects them into every AI reply (refreshed on a timer).

## How to set up

1. Create or pick a channel (often `#faq` or `#bot-faq`).
2. Set `FAQ_CHANNEL_ID` in `.env` to that channel’s ID.
3. Restart the bot. You should see a log line like `[faq] loaded N pinned FAQ entries`.

## What to pin (aim for 20–50 pins)

Each pin should be **self-contained**. Use a clear Q/A pattern:

```text
**Q: How do I install ND_Scenes?**
A: Download from your Tebex library, extract into resources, add `ensure ND_Scenes` after dependencies in server.cfg. Requires ox_lib (version X+).
```

### Good topics

- Install order and `ensure` lines for each major product
- Framework compatibility (ESX / QBCore / standalone)
- Common errors (SCRIPT ERROR paths, SQL, permissions)
- Licensing and key activation (high level; send to Tebex/ticket for account issues)
- Where to open tickets and what info to include (F8 error, framework, artifact version)

### Tips

- **One topic per pin** so staff can update a single answer without editing a huge message.
- **Update pins** when you ship breaking changes; the bot will pick them up on the next FAQ refresh (`FAQ_REFRESH_MS` in `.env`).
- Avoid secrets (API keys, internal URLs). The model sees this text in user-visible context.

## Verify

Use `nd!faq` or `/faq` with a search term to confirm pins match what you expect in Discord.
