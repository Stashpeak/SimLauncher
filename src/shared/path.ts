/**
 * Shared, platform-independent path utilities safe to import from both the
 * main process and the renderer (no Node `path` dependency).
 *
 * Main-process code that needs path comparison/canonicalisation should keep
 * importing from `src/main/utils.ts` (normalizePathForComparison, pathsEqual,
 * getExeName), which uses Node's `path.win32` API. This module exists for
 * display-only logic the renderer also needs, and for the one acceptance rule
 * both sides have to agree on: what a configured exe path may look like
 * (`getExePathRejectReason`), which the store's sanitizers enforce and the
 * profile editor checks before it asks the store to write (#890).
 */

/**
 * Longest configured exe path the store will keep. Shared rather than a store
 * constant because the renderer refuses a save on the same limit, and two
 * numbers would be two limits.
 */
export const MAX_CONFIGURED_EXE_PATH_LENGTH = 300

/**
 * Why an exe path is rejected. The renderer picks its warning text from this,
 * so it has to name the check that actually failed: a legitimately named .exe
 * can be rejected purely for length.
 */
export type ExePathRejectReason = 'not-an-exe' | 'too-long'

/**
 * The form of a pasted path we are willing to store: trimmed, and with ONE
 * matched pair of surrounding double quotes removed (#859).
 *
 * Windows 11's own "Copy as path" wraps the clipboard value in quotes, which
 * makes the most natural way to get a path out of Explorer the one way that
 * used to fail: the closing quote defeated the `.exe` test, so the entry was
 * dropped and reported as `not-an-exe` while the user was looking at a path
 * that plainly ended in `.exe`.
 *
 * Only a MATCHED pair is removed, and only the outermost one. A quote is not a
 * legal character in a Windows path, so a matched pair can only be a quoting
 * artifact, while anything left over means the value is not a path at all and
 * the caller rejects it below rather than silently storing half-stripped
 * nonsense.
 */
export function normalizeConfiguredExePath(value: string): string {
  const trimmed = value.trim()

  return trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')
    ? trimmed.slice(1, -1).trim()
    : trimmed
}

/**
 * Single source of truth for WHY an exe path is rejected, so the sanitizer's
 * accept/reject decision, the dropped-entry reason reported to the renderer
 * (#669) and the profile editor's own refusal (#890) can never disagree.
 * Returns null when the path is acceptable.
 *
 * Every check runs against the NORMALIZED form, because that is what would be
 * stored. Validating the raw string and persisting the stripped one (or the
 * reverse) is how a length cap gets bypassed by two characters.
 *
 * This is the STORAGE rule only. It does not ask whether the file exists,
 * which is deliberate: a secondary executable is often configured before the
 * program is installed, and existence is checked where the path is used.
 */
export function getExePathRejectReason(value: unknown): ExePathRejectReason | null {
  if (typeof value !== 'string') {
    return 'not-an-exe'
  }

  const normalizedPath = normalizeConfiguredExePath(value)

  // A surviving quote means it was unmatched, or nested, or embedded. None of
  // those is a path Windows can open, so this is a rejection rather than
  // something to strip harder.
  if (normalizedPath.includes('"')) {
    return 'not-an-exe'
  }

  if (normalizedPath.length === 0 || !/\.exe$/i.test(normalizedPath)) {
    return 'not-an-exe'
  }

  if (normalizedPath.length > MAX_CONFIGURED_EXE_PATH_LENGTH) {
    return 'too-long'
  }

  return null
}

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
