#!/usr/bin/env bash
# Pelican startup wrapper for the ND Discord Bot.
#
# Why this script exists:
#   Pelican passes the panel's "Startup Command" to the oven/bun Docker
#   entrypoint as whitespace-split tokens, stripping any quotes. Anything
#   more complex than a single token gets mangled. By having Pelican run
#   `bash start.sh` we sidestep the issue entirely.
#
# Set the Pelican Startup Command to exactly:
#   bash start.sh
#
# Pelican working directory inside the container is /home/container.

set -e

# Ensure we're in the right place even if Pelican changes default cwd.
cd /home/container

# Defensive: if node_modules was wiped (e.g. fresh server, failed install),
# install before launching. This is cheap when modules already exist because
# bun checks the lockfile.
if [ ! -d "node_modules" ]; then
  echo "[start.sh] node_modules missing, running bun install..."
  bun install
fi

# exec replaces the shell with bun so signals (SIGTERM from Pelican stop)
# are delivered directly to the bot instead of getting trapped by bash.
exec bun run src/bot.ts
