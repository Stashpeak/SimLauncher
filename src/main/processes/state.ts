import path from 'path'

import { getExeName, normalizePathForComparison } from '../utils'

import type {
  ProcessNameMismatchWarningEntry,
  RunningProcessEntry,
  UnclosedProcessEntry
} from './types'

export const runningProcesses = new Map<string, RunningProcessEntry>()
export const unclosedProcesses = new Map<string, UnclosedProcessEntry>()
export const processNameMismatchWarnings = new Map<string, ProcessNameMismatchWarningEntry>()
export const suppressedProcessNameMismatchWarnings = new Set<string>()

/**
 * Signal that the upcoming exit of `appPath` is intentional (user-initiated
 * kill). The suppression is consumed exactly once by
 * `consumeProcessNameMismatchWarningSuppression` so the fast-exit mismatch
 * warning is not shown when SimLauncher itself caused the close.
 */
export function suppressProcessNameMismatchWarning(appPath: string): void {
  suppressedProcessNameMismatchWarnings.add(normalizePathForComparison(appPath))
}

export function consumeProcessNameMismatchWarningSuppression(appPath: string): boolean {
  const key = normalizePathForComparison(appPath)
  const suppressed = suppressedProcessNameMismatchWarnings.has(key)
  // One-shot: delete regardless of whether it was set so a suppression
  // registered for a kill cannot accidentally absorb a subsequent
  // unrelated fast-exit of the same exe.
  suppressedProcessNameMismatchWarnings.delete(key)
  return suppressed
}

/**
 * Reconcile `runningProcesses` against the live tasklist snapshot.
 *
 * Matching is done by exe name, not by the Map key (normalised path), because
 * some apps replace their process with a child of the same exe name — the
 * original PID is gone but the exe is still present, so the path key would
 * still match even without this exe-name check.  Conversely, if the exe name
 * disappears from the tasklist the ChildProcess handle is stale regardless of
 * what key it was filed under, so we drop it.
 */
export function pruneStoppedRunningProcesses(processNames: Set<string>): void {
  runningProcesses.forEach((appProcess, key) => {
    if (!processNames.has(getExeName(appProcess.path))) {
      runningProcesses.delete(key)
    }
  })
}

export function pruneExpiredProcessNameMismatchWarnings(now = Date.now()): void {
  processNameMismatchWarnings.forEach((entry, key) => {
    if (entry.expiresAt !== undefined && entry.expiresAt <= now) {
      processNameMismatchWarnings.delete(key)
    }
  })
}

export function getUnclosedProcessKey(
  gameKey: string | undefined,
  appPath: string,
  processName: string
): string {
  // Callers occasionally pass a bare process name (e.g. "foo.exe") as the
  // appPath fallback. Bare names lack drive/separator info, so resolving them
  // via normalizePathForComparison would pin the key to the launcher's cwd —
  // not what we want. Detect the bare-name case and lowercase it directly;
  // otherwise canonicalise the full path the same way every other Maps/Sets
  // site does.
  const fallback = appPath || processName
  const isBareName = path.win32.basename(fallback) === fallback
  const pathPart = isBareName ? fallback.toLowerCase() : normalizePathForComparison(fallback)
  return `${gameKey || 'unknown'}:${pathPart}`
}

export function dismissAppIcon(appPath: string, gameKey?: string): void {
  const normalizedPath = normalizePathForComparison(appPath)
  processNameMismatchWarnings.delete(normalizedPath)
  unclosedProcesses.delete(getUnclosedProcessKey(gameKey, appPath, getExeName(appPath)))
}
