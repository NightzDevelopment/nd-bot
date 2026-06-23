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

# 5. PM2 (supervisor). Installed via npm if missing.
if ! command -v pm2 >/dev/null 2>&1; then
  echo "==> Installing PM2..."
  npm install -g pm2
fi

# 6. Start or reload under PM2.
if pm2 describe nd-bot >/dev/null 2>&1; then
  echo "==> Reloading nd-bot..."
  pm2 restart nd-bot --update-env
else
  echo "==> Starting nd-bot..."
  pm2 start ecosystem.config.cjs
fi

# 7. Persist process list so it survives reboots.
pm2 save

echo ""
echo "==> Done. If this is the first ever boot, run ONCE to survive server reboots:"
echo "      pm2 startup    # then copy/paste/run the command it prints"
echo ""
echo "==> Check it:  pm2 logs nd-bot --lines 40   (look for 'Logged in as ...')"
