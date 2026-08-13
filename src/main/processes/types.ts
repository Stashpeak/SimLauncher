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

/**
 * The outcome of one kill attempt against one process name.
 *
 * Lives here rather than in `kill.ts` because it is the contract BETWEEN the two
 * halves of the kill path: `win32KillUtils.ts` produces these, `kill.ts`
 * interprets them. Declaring it in either half would make the other import from
 * its own consumer (#773).
 */
export interface KillAttemptResult {
  processName: string
  success: boolean
  appPath?: string
  gameKey?: string
  error?: string
  accessDenied?: boolean
  notFound?: boolean
  staleTask?: boolean
  stillRunning?: boolean
  /**
   * Set only when this attempt positively observed a process under
   * `processName`: PIDs discovered at its path, a tracked child that was really
   * there, or an `/IM` taskkill that found something to act on.
   *
   * Deliberately NOT the inverse of `notFound`. A WMI lookup that errors out
   * returns neither, and treating that absence as evidence would let a failed
   * lookup vouch for a sibling it never looked at (CodeRabbit on #818).
   */
  targetConfirmed?: boolean
}

/**
 * `invalid` — the configured path failed the .exe path-shape check
 * (isValidExePath). `missing` — the path is a well-formed .exe path but the
 * file no longer exists on disk (moved after a game update, or uninstalled).
 */
export type SkippedLaunchReason = 'invalid' | 'missing'

/**
 * A profile entry that was filtered out of a launch before any process was
 * spawned. `key` is the game/utility key (see ProfileLaunchEntry) so the
 * renderer can resolve it to the display name the user actually configured,
 * rather than showing the raw path (#639).
 */
export interface SkippedLaunchEntry {
  key: string
  path: string
  reason: SkippedLaunchReason
}

export interface LaunchResult {
  success: boolean
  message?: string
  warning?: string
  error?: string
  launchedCount?: number
  /** Apps not (re)launched because they were ALREADY RUNNING. Unrelated to `skipped`. */
  skippedCount?: number
  elevatedCount?: number
  failedCount?: number
  killFailures?: KillFailure[]
  /**
   * Consent prompts left on screen because this operation killed a pending
   * elevated handoff (#809). A count, not a sentence: the renderer composes the
   * copy, like it does for killFailures and skipped.
   */
  strandedConsentPrompts?: number
  /** Entries excluded before spawn for an invalid/missing exe path (#639). NOT counted by `skippedCount`. */
  skipped?: SkippedLaunchEntry[]
  /**
   * True when a kill (Close Apps) aborted this sequence mid-flight (#670).
   * `success` is false in this case, but it is not a failure either — the
   * renderer should show a neutral "cancelled" toast, not an error toast.
   */
  cancelled?: boolean
}

export interface KillResult {
  success: boolean
  message?: string
  error?: string
  closedCount: number
  failedCount: number
  failures: KillFailure[]
  /**
   * Consent prompts left on screen because this operation killed a pending
   * elevated handoff (#809). A count, not a sentence: the renderer composes the
   * copy, like it does for killFailures and skipped.
   */
  strandedConsentPrompts?: number
}

/**
 * Options threaded into `launchProfileApps` by a caller that has already
 * registered its own cancellation token before the sequence starts. The two
 * IPC flows with async work ahead of the launch call (`relaunch-missing-profile`,
 * `switch-profile-apps` — see `ipc/launch.ts`) register early so a Close Apps
 * click during that pre-launch window has something to abort (#716). When
 * omitted, `launchProfileApps` registers its own controller, unchanged from
 * #670.
 */
export interface LaunchProfileAppsOptions {
  controller?: AbortController
}

/**
 * Options threaded into `killProfileApps` so a caller that has already
 * registered its OWN in-flight launch controller for the same `gameKey` (the
 * `switch-profile-apps` handler, mid-switch) can kill the outgoing profile's
 * apps without self-aborting that registration (#716) — see
 * `abortActiveLaunches`'s `except` parameter.
 */
export interface KillProfileAppsOptions {
  except?: AbortController
}

/**
 * The true outcome of an elevated (UAC) handoff that settled AFTER the bounded
 * grace window already resolved its promise as `elevated` (#675). The caller has
 * been told `elevated` and cannot be told again, so this is the only channel by
 * which the real result reaches it (#779).
 */
export type LateElevatedOutcome = {
  appPath: string
} & ({ outcome: 'elevated' } | { outcome: 'cancelled' } | { outcome: 'failed'; error: string })

export type AppLaunchResult =
  | { status: 'launched'; appPath: string }
  /**
   * `confirmed: false` means the grace window expired with the UAC prompt still
   * unanswered, so this is an optimistic report, not an observed launch. Never
   * tell the user an unconfirmed app "started" (#779).
   *
   * `handoffId` identifies THIS handoff, not this exe: two profile slots may
   * point at the same path (per-slot args, #357), so appPath is not unique
   * within a sequence. It is the key a late outcome is filed and read under.
   */
  | {
      status: 'elevated'
      appPath: string
      warning: string
      confirmed: boolean
      handoffId: number
    }
  | { status: 'failed'; appPath: string; error: string }
  // The launch was aborted (Close Apps) during the async pre-spawn work, so
  // the process was deliberately never spawned (#670).
  | { status: 'cancelled'; appPath: string }

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
