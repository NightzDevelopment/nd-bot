# Deploying the bot to an always-online Linux VPS

This runs the bot 24/7 on a Linux server (so it stays online when your PC is off),
under PM2 with reboot-survival. The bot uses the **Bun** runtime and a local
**SQLite** database file. It does **not** use MySQL, so you do not need any MySQL
credentials (the `faxstore` DB is unrelated and should be left alone).

> v2 = this same codebase, deployed to the VPS with a **new bot token**. You can keep
> the old bot running on your PC until v2 is stable, then retire it.

---

## 0. What you need

- A Linux VPS (Ubuntu/Debian assumed below) with SSH access. (Weblutions VPS works.)
- WinSCP (to upload files) and/or `git` on the server.
- A **new** Discord bot application + token (see step 1). Do **not** reuse the old token.

---

## 1. Create the new Discord bot (one time)

1. https://discord.com/developers/applications -> **New Application**.
2. **Bot** tab -> **Reset Token** -> copy the token (this is your `DISCORD_BOT_TOKEN`).
3. Under **Privileged Gateway Intents**, enable **Server Members Intent** and
   **Message Content Intent** (and **Presence Intent** only if you want custom-status scanning).
4. **OAuth2 -> URL Generator**: scopes `bot` + `applications.commands`, pick permissions
   (Administrator is simplest for a moderation bot), open the URL, invite it to your server.

Keep the token secret. It goes only in `.env` on the server (never in git, never in chat).

---

## 2. Get the code onto the VPS

**Option A - git (recommended):** push this repo to GitHub (private), then on the server:
```bash
cd /home
git clone <your-repo-url> nd-bot && cd nd-bot
```

**Option B - WinSCP upload:** zip the project folder **excluding** `node_modules/`,
`.env`, `data/`, and `logs/`, upload it to e.g. `/home/nd-bot`, and unzip there.
(Those folders are machine-specific or secret; never upload `.env`.)

---

## 3. Install Bun on the VPS (one time)

```bash
curl -fsSL https://bun.sh/install | bash
# reload PATH (or log out/in):
source ~/.bashrc
bun --version    # confirm it works
```

`node .` will NOT work for this bot - it requires Bun (uses bun:sqlite + Bun.serve).

---

## 4. Create the `.env` on the server

```bash
cd /home/nd-bot
cp .env.example .env
nano .env
```

Fill in at minimum:
```
DISCORD_BOT_TOKEN=<the NEW bot token from step 1>
GOOGLE_API_KEY=<your Gemini key>
```
Optional providers/features (Claude, OpenAI, channel IDs, etc.) can be added later -
the bot starts fine without them and the dashboard can set most of them at runtime.

Leave `DEV_BUILD_PATHS` **empty** on the VPS (those `D:\...` Windows paths do not exist
on Linux). Set it only if you upload code folders to index.

The SQLite database and `data/` directory are created automatically on first boot.

---

## 5. Install dependencies + PM2

```bash
bun install
npm install -g pm2     # PM2 runs under Node; that's fine, it only supervises the bun process
```

---

## 6. Start it under PM2 + survive reboots

```bash
pm2 start ecosystem.config.cjs
pm2 save               # remember the current process list
pm2 startup            # prints a command - copy/paste/run it once (sets up boot service)
```

`pm2 startup` + `pm2 save` is what makes it **truly always-online**: the VPS restarts the
bot automatically on crash AND on server reboot.

---

## 7. Verify

```bash
pm2 logs nd-bot --lines 40
```
You want to see `Logged in as <your new bot>#1234` and `registered N slash commands`.

Handy commands:
```bash
pm2 status            # is it online?
pm2 restart nd-bot    # apply changes
pm2 stop nd-bot
pm2 logs nd-bot       # live logs
```

---

## 8. Updating later

```bash
cd /home/nd-bot
git pull              # (or re-upload changed files via WinSCP)
bun install           # only if dependencies changed
pm2 restart nd-bot --update-env
```

---

## Notes

- **Database:** a local SQLite file under `data/`. Back it up periodically
  (`cp data/*.sqlite ~/backups/`). Do not point the bot at MySQL/FaxStore.
- **Dashboard:** binds to `127.0.0.1:3853` by default. Reach it from your PC with an SSH
  tunnel (`ssh -L 3853:localhost:3853 user@vps`) - do **not** bind it to `0.0.0.0` /
  expose it publicly without auth.
- **Secrets:** `.env` is gitignored. Never commit it; never paste tokens/passwords into chat.
- **Memory:** PM2 restarts the bot if it exceeds `max_memory_restart` (set in
  ecosystem.config.cjs) - protects a small VPS from OOM.
