import fs from 'fs'
import path from 'path'

// isRecord lives in the shared domain layer now (#692); re-exported so the many
// main-process importers keep their `from './utils'` path.
export { isRecord } from '../shared/domain/guards'

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

// A validity check, NOT a type guard: a string that fails validation (wrong
// extension, missing on disk) is still a string. Typing this `p is string`
// made the false branch of `if (!isValidExePath(alreadyStringValue))` narrow to
// `never`, which is wrong (see #752). Callers that need to narrow an
// `unknown`/`string | undefined` down to `string` do so with a local predicate.
export function isValidExePath(p: unknown): boolean {
  if (typeof p !== 'string') {
    return false
  }

  const trimmedPath = p.trim()
  const resolvedPath = path.resolve(trimmedPath)

  return trimmedPath.length > 0 && /\.exe$/i.test(trimmedPath) && fs.existsSync(resolvedPath)
}

/**
 * A bare image name: an `.exe` with no directory, which is what Task Manager
 * shows and what the phantom-exit warning tells the user to enter under
 * "Secondary executables to watch" (#929).
 *
 * Judged by SHAPE, never by existence. A bare name is not a file anywhere
 * (`isValidExePath` resolves it against the CWD and says no), so the two
 * predicates partition a configured entry into path-scoped and name-scoped, the
 * same split the poll and the kill path make with `isPathScopedExe`. `win32`
 * explicitly, like `getExeName`, so a host without backslash separators cannot
 * read a Windows path as a name.
 */
export function isBareExeName(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false
  }

  const trimmed = value.trim()

  return trimmed.length > 0 && /\.exe$/i.test(trimmed) && path.win32.basename(trimmed) === trimmed
}

/**
 * What a "Secondary executables to watch" entry may be: a path that exists, or
 * a bare image name (#929). One predicate rather than two call sites agreeing
 * by accident, because three consumers read that list (the tracking poll,
 * Close Apps, auto-close) and any two drifting apart would leave a name-only
 * entry tracked by one and invisible to the others, which is exactly how the
 * app's own repair instruction spent months not working.
 *
 * Not a type guard, for the same reason `isValidExePath` is not (#752).
 */
export function isTrackableSecondaryExe(value: unknown): boolean {
  return isValidExePath(value) || isBareExeName(value)
}

export function getExeName(filePath: unknown): string {
  if (typeof filePath !== 'string') {
    return ''
  }

  const trimmed = filePath.trim()
  if (trimmed.length === 0) {
    return ''
  }

  // Use win32 basename explicitly: SimLauncher targets Windows exclusively, but
  // CI/tests run on Linux where the platform-native path module treats
  // backslashes as literal characters. Forcing win32 keeps the result
  // consistent across host OSes.
  return path.win32.basename(trimmed).toLowerCase()
}

/**
 * Canonical form for path comparison: trim, resolve to absolute (using win32
 * semantics), lowercase. Returns "" for invalid input (non-string, empty,
 * whitespace-only).
 *
 * SimLauncher targets Windows exclusively, but CI/tests run on Linux where
 * the platform-native `path` module treats backslashes as literal characters
 * and would not canonicalise e.g. `C:\Apps\foo.exe` and `c:/apps/FOO.EXE` to
 * the same string. Forcing `path.win32` ensures host-independent canonical
 * keys safe to use in Maps/Sets and equality checks.
 *
 * Stored exe paths in this app are validated via isValidExePath (which calls
 * fs.existsSync(path.resolve(...))), so they are de-facto absolute by the time
 * they reach comparison sites.
 */
export function normalizePathForComparison(p: unknown): string {
  if (typeof p !== 'string') {
    return ''
  }

  const trimmed = p.trim()
  if (trimmed.length === 0) {
    return ''
  }

  return path.win32.resolve(trimmed).toLowerCase()
}

/**
 * Convenience for "are these two paths the same file" — both inputs are
 * normalized via normalizePathForComparison and compared. Returns false
 * for any invalid input pair (empty results don't match each other).
 */
export function pathsEqual(a: unknown, b: unknown): boolean {
  const normalizedA = normalizePathForComparison(a)
  const normalizedB = normalizePathForComparison(b)

  if (normalizedA.length === 0 || normalizedB.length === 0) {
    return false
  }

  return normalizedA === normalizedB
}

/**
 * Resolves after `ms`, or immediately if `signal` is already aborted or gets
 * aborted before the timer fires. Abort resolves rather than rejects — a
 * cancelled wait is a normal early-exit for the launch loop (#670), not an
 * error condition callers need to catch.
 */
export function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve()
      return
    }

    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true }
    )
  })
}

export function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function getErrorCode(err: unknown): string | undefined {
  return err && typeof err === 'object' && 'code' in err
    ? String((err as { code?: unknown }).code)
    : undefined
}
