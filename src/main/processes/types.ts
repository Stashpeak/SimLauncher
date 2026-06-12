import type { ChildProcess } from 'child_process'

/**
 * `access_denied` — taskkill/WMI confirmed the process is still alive but Windows
 * refused the kill (elevated target, see #390).  `still_running` — kill call
 * succeeded according to the API but a post-kill tasklist recheck shows the exe
 * is still present.  `unknown` — any other condition where we cannot confirm the
 * process exited.
 */
export type KillFailureReason = 'access_denied' | 'still_running' | 'unknown'

export interface KillFailure {
  appName: string
  appPath: string
  reason: KillFailureReason
}

export interface LaunchResult {
  success: boolean
  message?: string
  warning?: string
  error?: string
  launchedCount?: number
  skippedCount?: number
  elevatedCount?: number
  failedCount?: number
  killFailures?: KillFailure[]
}

export interface KillResult {
  success: boolean
  message?: string
  error?: string
  closedCount: number
  failedCount: number
  failures: KillFailure[]
}

export type AppLaunchResult =
  | { status: 'launched'; appPath: string }
  | { status: 'elevated'; appPath: string; warning: string }
  | { status: 'failed'; appPath: string; error: string }

export interface ProfileLaunchEntry {
  /**
   * Utility key (e.g. `simhub`, `customapp1`, `customapp20`) or the game key when
   * the entry represents the game executable itself. Used to look up per-slot
   * launch arguments so two custom-app slots that share the same exe still get
   * their own args (#357).
   */
  key: string
  path: string
}

export type ProfileLaunchInput = string | ProfileLaunchEntry

export interface RunningProcessEntry {
  process: ChildProcess
  path: string
  name: string
  gameKey: string
  isGame: boolean
}

export interface ProcessNameMismatchWarningEntry {
  path: string
  name: string
  gameKey: string
  warning: string
  /**
   * Optional wall-clock expiry (ms since epoch). When set, the entry is
   * eligible for pruning by `pruneExpiredProcessNameMismatchWarnings` once
   * the current time passes this value. Entries without an expiry persist
   * until the user explicitly dismisses the icon.
   */
  expiresAt?: number
}

export interface UnclosedProcessEntry {
  path: string
  name: string
  gameKey: string
  error: string
  reason: KillFailureReason
  /**
   * Explicit flag set when the kill was `access_denied`. Kept separately from
   * `reason` so the renderer can show a lock icon without re-interpreting the
   * free-form `error` string.
   */
  elevated?: boolean
}
