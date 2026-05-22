import fs from 'fs'
import path from 'path'

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function isValidExePath(p: unknown): p is string {
  if (typeof p !== 'string') {
    return false
  }

  const trimmedPath = p.trim()
  const resolvedPath = path.resolve(trimmedPath)

  return trimmedPath.length > 0 && /\.exe$/i.test(trimmedPath) && fs.existsSync(resolvedPath)
}

export function getExeName(filePath: unknown): string {
  if (typeof filePath !== 'string') {
    return ''
  }

  const trimmed = filePath.trim()
  if (trimmed.length === 0) {
    return ''
  }

  return path.basename(filePath).toLowerCase()
}

/**
 * Canonical form for path comparison: trim, resolve to absolute, lowercase.
 * Returns "" for invalid input (non-string, empty, whitespace-only).
 *
 * Stored exe paths in this app are validated via isValidExePath (which calls
 * fs.existsSync(path.resolve(...))), so they are de-facto absolute by the time
 * they reach comparison sites. path.resolve() here normalizes drive letter
 * case and slashes consistently; the .toLowerCase() then yields a canonical
 * key safe to use in Maps/Sets and equality checks.
 */
export function normalizePathForComparison(p: unknown): string {
  if (typeof p !== 'string') {
    return ''
  }

  const trimmed = p.trim()
  if (trimmed.length === 0) {
    return ''
  }

  return path.resolve(trimmed).toLowerCase()
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

export function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function getErrorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err)
}

export function getErrorCode(err: unknown) {
  return err && typeof err === 'object' && 'code' in err
    ? String((err as { code?: unknown }).code)
    : undefined
}
