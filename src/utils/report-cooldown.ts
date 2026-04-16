const lastReport = new Map<string, number>()

export function takeReportSlot(userId: string, cooldownMs: number): boolean {
  const now = Date.now()
  if (now - (lastReport.get(userId) ?? 0) < cooldownMs) return false
  lastReport.set(userId, now)
  return true
}
