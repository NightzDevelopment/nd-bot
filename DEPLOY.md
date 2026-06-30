# Deploying the bot to an always-online Linux VPS

This runs the bot 24/7 on a Linux server (so it stays online when your PC is off),
kept alive in a `screen` session with crash-restart + reboot-survival. The bot uses
the **Bun** runtime and a local
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

> Folder vs name: the project folder is **`nd-discord-gemini-bot`** (the repo name) - that
> is what you'll see on the server. The name **`nd-bot`** used elsewhere in this guide is only
> the *runtime* name (the `screen` session / PM2 process), not the folder. Paths below assume
> `/home/nd-discord-gemini-bot`; adjust if you put it somewhere else. `scripts/vps-setup.sh`
> auto-detects its own folder, so the `@reboot` cron line it writes is always correct.

**Option A - git (recommended):** push this repo to GitHub (private), then on the server:
```bash
cd /home
git clone <your-repo-url>        # creates the nd-discord-gemini-bot/ folder
cd nd-discord-gemini-bot
```

**Option B - WinSCP upload:** zip the project folder **excluding** `node_modules/`,
`.env`, `data/`, and `logs/`, upload it to e.g. `/home/nd-discord-gemini-bot`, and unzip there.
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

Also install fonts so image cards (profile/level/stock/casino cards) render instead of
showing blank boxes - the renderers use Arial/Courier New which a bare Linux server lacks:
```bash
sudo apt-get install -y fonts-liberation fontconfig
```
The bot registers these under the Arial/Courier New aliases at startup automatically.

---

## 4. Create the `.env` on the server

```bash
cd /home/nd-discord-gemini-bot
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

## 5. Install dependencies + screen

```bash
bun install
sudo apt-get install -y screen        # the session manager (if not already present)
```

`scripts/run.sh` is a resilient wrapper that **auto-restarts the bot if it crashes**
(the part `screen` does not do on its own) and stops cleanly when you press Ctrl+C.

---

## 6. Start it in a screen session

```bash
chmod +x scripts/run.sh
screen -dmS nd-bot bash scripts/run.sh   # start, detached (survives logout)
```

Or interactively (matches the Weblutions guide style):
```bash
screen -S nd-bot          # create + enter the session
bash scripts/run.sh      # start the bot
# detach and leave it running: press Ctrl+A then D
```

screen cheatsheet:
```bash
screen -r nd-bot          # reattach to watch live logs
# Ctrl+A then D          # detach again (bot keeps running)
# Ctrl+C (while attached)# stop the bot gracefully (the run loop then exits)
screen -ls               # list sessions
screen -S nd-bot -X quit  # force-kill the session
```

### Survive a server reboot
A screen session does **not** come back on its own after a reboot. Add a cron entry:
```bash
crontab -e
```
add this line (adjust the path), then save:
```
@reboot screen -dmS nd-bot bash /home/nd-discord-gemini-bot/scripts/run.sh
```
Now: crash → `run.sh` restarts it; reboot → cron relaunches the screen session. That is
the full "always online" guarantee, the screen way.

---

## 7. Verify

```bash
screen -r nd-bot          # attach; you should see "Logged in as <your new bot>#1234"
```
(`Ctrl+A` then `D` to detach.) Logs are also appended to `logs/bot.log`:
```bash
tail -f logs/bot.log
```

---

## 8. Updating later

A Discord bot has no hot-reload: an update = new code on the VPS + a restart (a few
seconds). Your **`.env` and `data/` are preserved** every time (git ignores them; the
zip never contains them), so config + database are never lost.

**One command** (after the new code is on the VPS, by either method below):
```bash
cd /home/nd-bot
bash scripts/update.sh     # git pull (if a git checkout) + bun install + graceful restart
```
Just restart without pulling: `bash scripts/restart.sh`.

How to get the new code there:

- **Git (recommended)** - the folder must be a `git clone` (has a `.git`). Then on your PC
  `git push`, and on the VPS just `bash scripts/update.sh`.
- **WinSCP zip** - on your PC rebuild the bundle and drag it over, then unzip on top:
  ```bash
  cd /home && unzip -o nd-bot-deploy.zip   # -o overwrites source files; leaves .env/data alone
  cd nd-bot && bash scripts/update.sh
  ```

---

## 9. Optional: HTTPS on a domain via NGINX

By default the dashboard is localhost-only (reach it with the SSH tunnel in Notes).
To serve it on a real domain with HTTPS, put NGINX in front as a reverse proxy. A
ready-made config (with the WebSocket plumbing the live feed needs) is in
`deploy/nginx/nd-bot.conf`.

```bash
sudo apt-get install -y nginx
sudo cp deploy/nginx/nd-bot.conf /etc/nginx/sites-available/nd-bot.conf
sudo ln -s /etc/nginx/sites-available/nd-bot.conf /etc/nginx/sites-enabled/nd-bot.conf
# edit server_name to your domain, and confirm proxy_pass port == DASHBOARD_PORT
sudo nano /etc/nginx/sites-available/nd-bot.conf
sudo nginx -t && sudo systemctl reload nginx
```

Then add free auto-renewing HTTPS (certbot rewrites the config to add the 443 block
and an HTTP->HTTPS redirect):
```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d bot.example.com
```

Point your domain's DNS A record at the VPS first. Keep `DASHBOARD_HOST=127.0.0.1`
(the default) so the bot is reachable **only** through NGINX, never directly. The
config also supports an IP allowlist or NGINX basic-auth as extra hardening
(commented at the bottom of the file).

---

## Notes

- **Database:** a local SQLite file under `data/`. Back it up periodically
  (`cp data/*.sqlite ~/backups/`). Do not point the bot at MySQL/FaxStore.
- **Dashboard:** binds to `127.0.0.1:3849` by default. Reach it from your PC with an SSH
  tunnel (`ssh -L 3849:localhost:3849 user@vps`), or expose it on a domain with HTTPS via
  NGINX (section 9). Do **not** bind it to `0.0.0.0` / expose the raw port publicly.
- **Secrets:** `.env` is gitignored. Never commit it; never paste tokens/passwords into chat.
- **screen vs PM2:** this guide uses `screen` + `scripts/run.sh` (crash-restart) + a
  `@reboot` cron (reboot-survival). PM2 (`pm2 start ecosystem.config.cjs && pm2 save &&
  pm2 startup`) is an equivalent alternative and is still what the local Windows PC uses;
  pick one supervisor on the VPS, not both (they would fight over the port + single-instance lock).
