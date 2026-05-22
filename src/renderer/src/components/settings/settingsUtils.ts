export function normalizeLaunchDelayMs(value: number): number {
  if (!Number.isFinite(value)) {
    return 1000
  }

  return Math.min(Math.max(Math.round(value), 0), 30000)
}
