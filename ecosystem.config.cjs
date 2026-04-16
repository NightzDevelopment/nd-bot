/** PM2 process file, run: pm2 start ecosystem.config.cjs */
module.exports = {
  apps: [
    {
      name: 'nd-bot',
      script: 'src/bot.ts',
      interpreter: 'bun',
      cwd: __dirname,
      watch: false,
      max_restarts: 10,
      min_uptime: '5s',
      restart_delay: 3000,
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      merge_logs: true,
      time: true,
    },
  ],
}
