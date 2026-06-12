/**
 * Builds the accessible label for a context-menu dismiss action.
 *
 * `tracked` distinguishes between two dismiss concepts: warning dismissal
 * (the app is being watched) vs. icon dismissal (the app badge is orphaned).
 * The label uses the configured display name when available, falling back to
 * the basename of the executable path with the `.exe` extension stripped.
 */
export function buildDismissLabel(
  appPath: string,
  options: { tracked?: boolean; name?: string } = {}
): string {
  const rawName = options.name?.trim() || getBasename(appPath)
  const displayName = rawName.replace(/\.exe$/i, '') || rawName

  const action = options.tracked ? 'Dismiss Warning' : 'Dismiss Icon'
  return displayName ? `${action} for ${displayName}` : action
}

function getBasename(path: string): string {
  const parts = path.split(/[/\\]/)
  return parts[parts.length - 1] || ''
}
