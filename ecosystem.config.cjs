/** PM2 process file, run: pm2 start ecosystem.config.cjs */
/** After first start: pm2 save && pm2 startup  (so nd-bot restarts on machine reboot) */
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
      script: 'bun',
      args: ['run', 'src/bot.ts'],
      interpreter: 'none',
      cwd: __dirname,
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
