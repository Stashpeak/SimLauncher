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
