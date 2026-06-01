process.env.DISCORD_BOT_TOKEN = 'x'.repeat(60)
process.env.GOOGLE_API_KEY = 'x'.repeat(30)
process.env.DATA_DIR = './data'
process.env.DASHBOARD_ENABLED = '1'
process.env.DASHBOARD_TOKEN = 'testtok'
process.env.DASHBOARD_PORT = '13850'
process.env.DASHBOARD_HOST = '127.0.0.1'

const { startDashboard } = await import('../src/dashboard/server.ts')
startDashboard()
