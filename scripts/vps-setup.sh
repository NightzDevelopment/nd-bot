#!/usr/bin/env bash
#
# First-boot / update setup for the bot on a Linux VPS.
# Idempotent: safe to re-run. Run from the project root:  bash scripts/vps-setup.sh
#
# It does NOT create your .env or your Discord token - do that manually (see DEPLOY.md).
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
echo "==> Project: $ROOT"

# 1. Bun (the bot requires it; node will not work).
if ! command -v bun >/dev/null 2>&1; then
  echo "==> Installing Bun..."
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
fi
echo "==> Bun: $(bun --version)"

# 2. .env must exist (never auto-created - holds secrets).
if [ ! -f .env ]; then
  echo "!! No .env found. Copy .env.example to .env and set DISCORD_BOT_TOKEN + GOOGLE_API_KEY first."
  echo "   cp .env.example .env && nano .env"
  exit 1
fi

# 3. Dirs the bot writes to.
mkdir -p logs data

# 3b. Fonts for canvas image cards (best-effort; needs apt + sudo).
if command -v apt-get >/dev/null 2>&1; then
  if ! fc-list 2>/dev/null | grep -qi liberation; then
    echo "==> Installing fonts (image cards)..."
    sudo apt-get install -y fonts-liberation fontconfig || \
      echo "!! Could not install fonts automatically; run: sudo apt-get install -y fonts-liberation fontconfig"
  fi
fi

# 4. Dependencies.
echo "==> Installing dependencies..."
bun install

# 5. screen (session manager) + resilient runner.
if ! command -v screen >/dev/null 2>&1; then
  echo "==> Installing screen..."
  sudo apt-get install -y screen || echo "!! install screen manually: sudo apt-get install -y screen"
fi
chmod +x scripts/run.sh

# 6. (Re)start the bot in a detached screen session named 'nd-bot'.
if screen -ls 2>/dev/null | grep -q "\.nd-bot"; then
  echo "==> Restarting existing 'nd-bot' screen session..."
  screen -S nd-bot -X quit || true
  sleep 1
fi
echo "==> Starting bot in screen session 'nd-bot'..."
screen -dmS nd-bot bash scripts/run.sh

# 7. Reboot survival via crontab (@reboot relaunches the screen session).
RUN_PATH="$ROOT/scripts/run.sh"
CRON_LINE="@reboot screen -dmS nd-bot bash $RUN_PATH"
if ! crontab -l 2>/dev/null | grep -qF "$RUN_PATH"; then
  ( crontab -l 2>/dev/null; echo "$CRON_LINE" ) | crontab - && \
    echo "==> Added @reboot cron so the bot comes back after a server reboot." || \
    echo "!! Could not set crontab; add manually:  $CRON_LINE"
fi

echo ""
echo "==> Done. The bot runs in a detached screen session (auto-restarts on crash)."
echo "==> Watch logs:   screen -r nd-bot     (Ctrl+A then D to detach)"
echo "==>           or:  tail -f logs/bot.log"
echo "==> Stop:         screen -r nd-bot, then Ctrl+C   (or: screen -S nd-bot -X quit)"
