#!/usr/bin/env bash
#
# One-command update: pull/refresh code, install any new deps, restart.
# Works whether you deploy by git OR by WinSCP zip upload.
#   bash scripts/update.sh
#
# Your .env and data/ are NOT touched (git ignores them; the zip never contains
# them), so config + database survive every update.
set -u
cd "$(dirname "$0")/.."

export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
export PATH="$BUN_INSTALL/bin:$PATH"

if [ -d .git ]; then
  echo "==> git pull..."
  git pull --ff-only || {
    echo "!! git pull failed (local edits or conflict). Resolve, then re-run."
    exit 1
  }
else
  echo "==> not a git checkout - assuming you already uploaded the new files via WinSCP."
fi

echo "==> bun install (only changes if dependencies moved)..."
bun install

echo "==> restarting..."
bash scripts/restart.sh
