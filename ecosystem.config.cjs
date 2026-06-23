/** PM2 process file, run: pm2 start ecosystem.config.cjs */
/** After first start: pm2 save && pm2 startup  (so nd-bot restarts on machine reboot) */
const fs = require('node:fs')
const path = require('node:path')

/**
 * Resolve an ABSOLUTE path to the bun binary. After `pm2 startup`, PM2 relaunches
 * from a systemd unit whose PATH does NOT include ~/.bun/bin, so a bare `bun` would
 * fail with "command not found" and the bot would be silently offline after reboot.
 * Resolving here (at config load, in the user's shell) bakes the real path into the
 * saved PM2 process. Cross-platform so the same file still works on the Windows PC.
 */
function resolveBun() {
  if (process.env.BUN_PATH && fs.existsSync(process.env.BUN_PATH)) return process.env.BUN_PATH
  const home = process.env.HOME || process.env.USERPROFILE || ''
  const candidates = [
    path.join(home, '.bun', 'bin', 'bun'), // linux / macOS
    path.join(home, '.bun', 'bin', 'bun.exe'), // windows
  ]
  for (const c of candidates) {
    if (fs.existsSync(c)) return c
  }
  return 'bun' // fall back to PATH
}

module.exports = {
  apps: [
    {
      name: 'nd-bot',
      /**
       * Spawn `bun run src/bot.ts` as a plain binary.
       * `interpreter: 'none'` bypasses PM2's ProcessContainerForkBun.js, which
       * uses require() on the entry and fails on async ESM modules
       * (TypeError: require() async module ... is unsupported).
       */
      script: resolveBun(),
      args: ['run', 'src/bot.ts'],
      interpreter: 'none',
      cwd: __dirname,
      /** Production logging (NDJSON, no pino-pretty worker) + signals downstream. */
      env: { NODE_ENV: 'production' },
      watch: false,
      autorestart: true,
      /** Exit loops faster than 10s count as crashes; need stability before counting restarts. */
      min_uptime: '10s',
      /** Back off a bit on repeated crash loops. */
      exp_backoff_restart_delay: 100,
      max_restarts: 30,
      restart_delay: 3000,
      /** Restart if memory exceeds this (protects a small VPS from OOM). */
      max_memory_restart: '768M',
      /** Optional: restart daily at low traffic (comment out if you do not want this). */
      // cron_restart: '0 5 * * *',
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      merge_logs: true,
      time: true,
    },
  ],
}
