/**
 * Clamps and rounds a launch-delay value to the valid range [0, 30000] ms.
 * Non-finite inputs (NaN, ±Infinity) fall back to the default 1 s delay rather
 * than crashing or persisting a broken value — covers the custom-delay text
 * input before the user has typed a valid number.
 */
export function normalizeLaunchDelayMs(value: number): number {
  if (!Number.isFinite(value)) {
    return 1000
  }

  return Math.min(Math.max(Math.round(value), 0), 30000)
}
