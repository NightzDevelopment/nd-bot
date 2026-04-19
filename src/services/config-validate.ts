/**
 * Basic env validation on boot (fail fast with clear errors).
 */
import { TOKEN, GOOGLE_KEY } from '../config.ts'

export function validateConfigOrExit(): void {
  if (!TOKEN || TOKEN.length < 50) {
    console.error('[config] DISCORD_BOT_TOKEN looks invalid.')
    process.exit(1)
  }
  if (!GOOGLE_KEY || GOOGLE_KEY.length < 20) {
    console.error('[config] GOOGLE_API_KEY looks invalid.')
    process.exit(1)
  }
}
