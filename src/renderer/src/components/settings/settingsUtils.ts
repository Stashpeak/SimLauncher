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
 * Drops any record entry whose value is blank once trimmed. Current
 * save-settings sanitizers drop an empty-string entry rather than persist
 * one, but get-settings does not sanitize on read, so a config saved by an
 * older build, or hand-edited, can still hold a stored `key: ''`. Both the
 * live renderer state and any baseline built from a store read (useSettingsLoad,
 * useSettingsSave's resetDirty call) apply this before being compared, so a
 * never-configured field and a cleared-then-empty one always serialize the
 * same. Without it, typing into a never-configured field and clearing it
 * again leaves a `{"key":""}` entry that an unnormalized `{}` baseline never
 * had, and the dirty-tracking JSON compare (and the per-section dot it
 * derives) never clears (#958).
 */
export function dropEmptyEntries(record: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value.trim().length > 0))
}
