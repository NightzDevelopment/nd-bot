#!/usr/bin/env bash
#
# Restart the bot's screen session to apply code/config changes.
# Tries a graceful stop (Ctrl+C -> the bot's clean shutdown) before relaunching.
#   bash scripts/restart.sh
#
# `screen -S nd-bot -X quit` is AMBIGUOUS once more than one nd-bot session
# exists ("Use -S to specify a session"), so it silently leaves duplicates
# running and starts yet another. Duplicates then fight over the single-instance
# lock and an old instance keeps serving stale code. So kill EVERY matching
# session by its exact id, plus any stray process + stale lock, before starting.
set -u
cd "$(dirname "$0")/.."
export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
export PATH="$BUN_INSTALL/bin:$PATH"

sessions() { screen -ls 2>/dev/null | grep '\.nd-bot' | awk '{print $1}'; }

kill_all() {
  for s in $(sessions); do
    screen -S "$s" -X quit 2>/dev/null || true
  done
}

if [ -n "$(sessions)" ]; then
  echo "==> stopping nd-bot session(s) gracefully..."
  for s in $(sessions); do
    screen -S "$s" -X stuff $'\003' 2>/dev/null || true
  done
  sleep 3
  kill_all
  sleep 1
  kill_all # second pass for any that respawned during shutdown
fi

# Belt and suspenders: kill any stray bot process and clear a stale lock so the
# fresh instance is not blocked by a dead one.
pkill -f "bun run src/bot.ts" 2>/dev/null || true
sleep 1
rm -f data/nd-bot-instance.lock 2>/dev/null || true

echo "==> starting fresh nd-bot session..."
screen -dmS nd-bot bash scripts/run.sh
sleep 2
echo "==> running sessions:"
screen -ls 2>/dev/null | grep '\.nd-bot' || echo "  (none found - check: bun run src/bot.ts)"
echo "==> done. Watch it:  screen -r nd-bot   (Ctrl+A then D to detach)"
