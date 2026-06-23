#!/usr/bin/env bash
#
# Restart the bot's screen session to apply code/config changes.
# Tries a graceful stop (Ctrl+C -> the bot's clean shutdown) before relaunching.
#   bash scripts/restart.sh
set -u
cd "$(dirname "$0")/.."

if screen -ls 2>/dev/null | grep -q "\.nd-bot"; then
  echo "==> stopping current nd-bot session (graceful)..."
  # Send Ctrl+C into the session -> bot does its clean shutdown -> run.sh loop ends.
  screen -S nd-bot -X stuff $'\003' 2>/dev/null || true
  sleep 3
  # Make sure the session is really gone before relaunching.
  screen -S nd-bot -X quit 2>/dev/null || true
  sleep 1
fi

echo "==> starting fresh nd-bot session..."
screen -dmS nd-bot bash scripts/run.sh
echo "==> done. Watch it:  screen -r nd-bot   (Ctrl+A then D to detach)"
