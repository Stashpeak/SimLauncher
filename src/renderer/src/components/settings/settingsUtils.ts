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

/**
 * Drops any record entry whose value is blank once trimmed. The main-process
 * sanitizers never persist an empty-string entry (store.ts's
 * sanitizeArgsRecord / sanitizeNameRecord / sanitizePathRecord all drop one),
 * so the live renderer state must agree before it is compared against a
 * baseline read back from the store. Without this, typing into a never-
 * configured field and clearing it again leaves a `{"key":""}` entry that the
 * baseline's `{}` never had, and the dirty-tracking JSON compare (and the
 * per-section dot it derives) never clears (#958).
 */
export function dropEmptyEntries(record: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value.trim().length > 0))
}
