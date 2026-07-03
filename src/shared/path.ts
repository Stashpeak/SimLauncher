/**
 * Shared, platform-independent path utilities safe to import from both the
 * main process and the renderer (no Node `path` dependency).
 *
 * Main-process code that needs path comparison/canonicalisation should keep
 * importing from `src/main/utils.ts` (normalizePathForComparison, pathsEqual,
 * getExeName), which uses Node's `path.win32` API. This module exists for
 * display-only logic the renderer also needs.
 */

/**
 * Returns the last path segment of `filePath`, splitting on both forward and
 * back slashes. Intended for human-facing display only — does NOT lowercase
 * or canonicalise. Falls back to the input string when no separator is found.
 *
 * Use this when you need an "app name" to render in the UI. For comparison
 * keys use `normalizePathForComparison` / `pathsEqual` from
 * `src/main/utils.ts` instead.
 */
export function getPathDisplayName(filePath: string): string {
  if (typeof filePath !== 'string') {
    return ''
  }

  const trimmed = filePath.trim()
  if (trimmed.length === 0) {
    return ''
  }

  const segments = trimmed.split(/[\\/]/)
  const last = segments[segments.length - 1]
  return last && last.length > 0 ? last : trimmed
}

/**
 * Renderer-safe approximation of main's `normalizePathForComparison`
 * (src/main/utils.ts): trim, unify separators to backslash, collapse duplicate
 * separators (preserving a leading UNC `\\`), lowercase.
 *
 * WHY an approximation: the main-process canonicaliser uses Node's
 * `path.win32.resolve`, which is not available in the renderer. Full resolve
 * additionally absolutises relative paths and strips `.`/`..` segments — but
 * the paths compared here are absolute exe paths from the settings store and
 * from main-process process snapshots, so slash style, stray whitespace and
 * case are the differences that actually occur (#652: a configured
 * `C:/Tools\App.exe ` must match the running entry's `c:\tools\app.exe`, which
 * a bare `toLowerCase()` key misses).
 *
 * Use for comparison keys only, never for display (see getPathDisplayName).
 */
export function getPathComparisonKey(filePath: string): string {
  if (typeof filePath !== 'string') {
    return ''
  }

  const trimmed = filePath.trim()
  if (trimmed.length === 0) {
    return ''
  }

  const unified = trimmed.replace(/\//g, '\\')
  const isUncPath = unified.startsWith('\\\\')
  const collapsed = unified.replace(/\\+/g, '\\')

  return `${isUncPath ? '\\' : ''}${collapsed}`.toLowerCase()
}
