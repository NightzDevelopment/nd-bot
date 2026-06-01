/** Parse duration strings: 30s, 5m, 2h, 1d, 24h */
export function parseDuration(input: string): number | null {
  const m = input
    .trim()
    .toLowerCase()
    .match(/^(\d+(?:\.\d+)?)\s*([smhd])$/)
  if (!m) return null
  const n = parseFloat(m[1]!)
  const u = m[2]!
  const mult = u === 's' ? 1000 : u === 'm' ? 60_000 : u === 'h' ? 3_600_000 : 86_400_000
  return Math.floor(n * mult)
}

/** Parse human time for schedule: "2h", "30m", "1d" */
export function parseScheduleDelay(input: string): number | null {
  return parseDuration(input)
}

export function formatMs(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`
  if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(1)}h`
  return `${(ms / 86_400_000).toFixed(1)}d`
}
