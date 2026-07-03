export type SkippedLaunchReason = 'invalid' | 'missing'

export interface SkippedLaunchEntrySummary {
  key: string
  path: string
  reason: SkippedLaunchReason
}

export interface SkippedLaunchNameLookup {
  gameKey: string
  gameName: string
  // Only populated where the caller already has the settings-driven name
  // lookup in scope (the profile editor's own state). GameRow's row-level
  // launch buttons don't pull in the settings context just for this, so they
  // fall back to the executable's basename for non-game entries instead.
  appNames?: Record<string, string>
  utilities?: { key: string; name: string }[]
}

function getExeBasenameWithoutExtension(filePath: string): string {
  const parts = filePath.split(/[/\\]/)
  const basename = parts[parts.length - 1] || filePath
  return basename.replace(/\.exe$/i, '') || basename
}

// Resolution order mirrors getDroppedEntryLabel's settings-save warning
// (#669): custom name > utility default > a readable fallback derived from
// the path — never the raw path itself, never an internal key like
// "customapp3".
function resolveSkippedEntryName(
  entry: SkippedLaunchEntrySummary,
  lookup: SkippedLaunchNameLookup
): string {
  if (entry.key === lookup.gameKey) {
    return lookup.gameName
  }

  const configuredName = lookup.appNames?.[entry.key]
  const utilityName = lookup.utilities?.find((utility) => utility.key === entry.key)?.name

  return configuredName || utilityName || getExeBasenameWithoutExtension(entry.path)
}

/**
 * Builds the warning toast copy for a launch that succeeded for some profile
 * apps but skipped others because their configured executable path is no
 * longer valid — moved after a game update, or uninstalled since it was
 * configured (#639). Whether the path was malformed or simply missing isn't
 * surfaced to the user; both point at the same fix (re-browse the path in the
 * profile editor).
 */
export function formatSkippedLaunchEntries(
  skipped: SkippedLaunchEntrySummary[],
  lookup: SkippedLaunchNameLookup
): string {
  const names = skipped.map((entry) => resolveSkippedEntryName(entry, lookup))

  return names.length === 1
    ? `${names[0]} was skipped — its path no longer exists.`
    : `${names.length} apps were skipped because their paths no longer exist (${names.join(', ')}).`
}
