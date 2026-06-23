#!/usr/bin/env bash
#
# Resilient runner for the bot inside a `screen` session (the PM2 alternative).
# - Restarts the bot automatically if it CRASHES (non-zero exit).
# - Stops the loop on a CLEAN shutdown (exit 0, e.g. you pressed Ctrl+C), so an
#   intentional stop actually stops.
#
# Usage (see DEPLOY.md):
#   screen -dmS ndbot bash scripts/run.sh      # start, detached
#   screen -r ndbot                            # reattach to watch logs
#   (Ctrl+A then D to detach again; Ctrl+C to stop gracefully)
set -u

cd "$(dirname "$0")/.."

# Make sure bun is on PATH even in a non-login shell (screen/cron).
export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
export PATH="$BUN_INSTALL/bin:$PATH"
export NODE_ENV="${NODE_ENV:-production}"

if ! command -v bun >/dev/null 2>&1; then
  echo "[run] FATAL: bun not found on PATH. Install it: curl -fsSL https://bun.sh/install | bash"
  exit 1
fi

mkdir -p logs

backoff=2
while true; do
  echo "[run] starting bot at $(date '+%Y-%m-%d %H:%M:%S')"
  start=$(date +%s)
  bun run src/bot.ts 2>&1 | tee -a logs/bot.log
  code=${PIPESTATUS[0]}
  end=$(date +%s)

  if [ "$code" -eq 0 ]; then
    echo "[run] clean exit (code 0). Stopping."
    break
  fi

  # Reset backoff if it ran for a while (real crash loops exit fast).
  if [ $((end - start)) -ge 60 ]; then
    backoff=2
  fi
  echo "[run] bot exited with code $code; restarting in ${backoff}s..."
  sleep "$backoff"
  backoff=$((backoff * 2))
  [ "$backoff" -gt 60 ] && backoff=60
done
