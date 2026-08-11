import path from 'path'

import { getExeName, normalizePathForComparison } from '../utils'

import type {
  KillProfileAppsOptions,
  ProcessNameMismatchWarningEntry,
  RunningProcessEntry,
  UnclosedProcessEntry
} from './types'

export const runningProcesses = new Map<string, RunningProcessEntry>()
export const unclosedProcesses = new Map<string, UnclosedProcessEntry>()
export const processNameMismatchWarnings = new Map<string, ProcessNameMismatchWarningEntry>()
export const suppressedProcessNameMismatchWarnings = new Set<string>()

// One AbortController per gameKey with an in-flight launchProfileApps sequence.
// Lives here (not spawn.ts) so kill.ts can abort a sequence without a circular
// import between the two process-lifecycle modules (#670).
const activeLaunchControllers = new Map<string, AbortController>()

export function registerActiveLaunch(gameKey: string): AbortController {
  const controller = new AbortController()
  activeLaunchControllers.set(gameKey, controller)
  return controller
}

/**
 * Elevated (UAC) handoffs whose grace window expired while the consent prompt
 * was still on screen (#675). The launch sequence has moved on and its
 * AbortController is unregistered, but the PowerShell host is deliberately
 * still alive so a late approval works — which means nothing else can reach it.
 *
 * Without this registry a Close Apps click after the sequence ended finds no
 * controller and no running target, so approving the still-visible prompt would
 * start the app AFTER the user asked to close everything (Codex P1 on #779).
 * Lives here, next to activeLaunchControllers, for the same reason: kill.ts must
 * reach it without importing spawn.ts.
 */
const pendingElevatedHandoffs = new Map<number, { gameKey?: string; cancel: () => void }>()

export function registerPendingElevatedHandoff(
  handoffId: number,
  entry: { gameKey?: string; cancel: () => void }
): void {
  pendingElevatedHandoffs.set(handoffId, entry)
}

export function unregisterPendingElevatedHandoff(handoffId: number): void {
  pendingElevatedHandoffs.delete(handoffId)
}

/**
 * Cancel every still-pending elevated handoff for `gameKey`, or all of them when
 * `gameKey` is undefined (the global "close everything" kill). Each entry
 * removes itself as its callback settles, so this is safe to call on every kill.
 */
export function cancelPendingElevatedHandoffs(gameKey?: string): void {
  pendingElevatedHandoffs.forEach((entry, handoffId) => {
    if (gameKey !== undefined && entry.gameKey !== gameKey) {
      return
    }
    pendingElevatedHandoffs.delete(handoffId)
    entry.cancel()
  })
}

/**
 * Consent prompts left on screen by a host SimLauncher killed (#809).
 *
 * Counted here, at the one fact that matters, rather than at either caller.
 * There are two ways a pending host gets killed and they do not overlap
 * cleanly: the abort signal reaches it at any point in the sequence, while the
 * registry above only holds it AFTER its grace window expired. Counting at the
 * callers therefore both missed cancellations (before the grace window, the
 * registry is empty and the abort path was silent) and double-counted them
 * (after it, both mechanisms fire for the same handoff, so the user was told
 * twice, once by the kill result and once by the launch summary).
 */
let strandedConsentPrompts = 0

/** Called wherever a host is killed while its consent prompt is still pending. */
export function noteStrandedConsentPrompt(): void {
  strandedConsentPrompts += 1
}

/**
 * Take the pending count and reset it, so exactly one message reports it.
 *
 * Drained by the kill entry points because every stranded prompt originates
 * from one: the abort signal is only ever raised by `abortActiveLaunches`, and
 * the registry is only ever drained by `cancelPendingElevatedHandoffs`, both of
 * which are called from kill.ts and both synchronously, before the kill result
 * is built. The launch summary deliberately stays out of it: mid-sequence, both
 * it and the kill result are delivered, and the user should hear this once.
 */
export function drainStrandedConsentPrompts(): number {
  const count = strandedConsentPrompts
  strandedConsentPrompts = 0
  return count
}

/**
 * The sentence appended when a cancellation killed a pending elevated handoff.
 *
 * Killing the PowerShell host stops the app from starting, but it does NOT
 * remove the Windows consent prompt: that UI belongs to the AppInfo service on
 * the secure desktop and is not ours to close. Verified on a real machine
 * (#809): after the kill the prompt stayed up, and answering Yes started
 * nothing. Without this line the user's only readings are "elevation is broken"
 * or "SimLauncher failed to start it", and neither is true.
 *
 * Two things it deliberately does not say: that the app started (it did not),
 * and that SimLauncher closed the prompt (it cannot). It also stays silent at
 * zero, so the ordinary cancellation reads exactly as it does today.
 *
 * Lives here rather than in spawn.ts because both cancellation paths need the
 * same words and kill.ts does not import spawn.ts: the mid-sequence abort
 * (spawn.ts's own summary) and the post-sequence kill (kill.ts, via the
 * registry above) must not describe the same event differently.
 */
export function describeStrandedConsentPrompts(cancelledCount: number): string {
  if (cancelledCount === 1) {
    return ' A Windows permission prompt may still be on screen. Answering it will not start the app.'
  }
  if (cancelledCount > 1) {
    return ' Windows permission prompts may still be on screen. Answering them will not start those apps.'
  }
  return ''
}

/**
 * Clear the registry entry once launchProfileApps' sequence ends. Only clears
 * it if `controller` is still the registered one — a new launch for the same
 * gameKey may have already installed its own fresh controller (started right
 * after this one was cancelled), and that must not be torn down early.
 */
export function unregisterActiveLaunch(gameKey: string, controller: AbortController): void {
  if (activeLaunchControllers.get(gameKey) === controller) {
    activeLaunchControllers.delete(gameKey)
  }
}

/**
 * Whether the registry holds any controller other than `except`. This is the
 * second half of the launch gate (#716 review finding): spawn.ts's
 * `activeLaunches` Set only fills once launchProfileApps starts, but the
 * relaunch/switch IPC handlers register their controller BEFORE their
 * pre-launch async work (tasklist scans, the switch's kill phase). During
 * that window `activeLaunches` is still empty, so any gate reading only it
 * would let a competing launch through — whose registration would then evict
 * the first handler's controller from this registry, leaving its sequence
 * unreachable by Close Apps. `except` lets launchProfileApps' own gate skip
 * the caller's own threaded-through controller, so a handler's launch is not
 * blocked by its own registration.
 */
export function hasOtherActiveLaunchControllers(except?: AbortController): boolean {
  for (const controller of activeLaunchControllers.values()) {
    if (controller !== except) {
      return true
    }
  }
  return false
}

/**
 * Abort the in-flight launch sequence for `gameKey`, or every in-flight
 * sequence when `gameKey` is undefined (the tray/global "close everything"
 * kill has no single gameKey to target). Called from kill.ts before it does
 * any kill work, so a launch loop already mid-sequence cannot spawn the next
 * queued app during or after the kill (#670).
 *
 * `options.except` skips one specific controller regardless of which gameKey
 * it is registered under. This is for a caller that registered its OWN
 * controller before doing kill work as part of a launch sequence it is
 * itself orchestrating (`switch-profile-apps`, #716) — without it, that
 * kill's own `abortActiveLaunches(gameKey)` call would self-abort the very
 * sequence it belongs to. A real Close Apps click never passes `except`, so
 * it still aborts everything as before.
 *
 * `AbortController.abort()` is itself idempotent (a second call is a no-op),
 * so this is safe to call on every kill request even when nothing is
 * currently launching for the target gameKey.
 */
export function abortActiveLaunches(gameKey?: string, options?: KillProfileAppsOptions): void {
  activeLaunchControllers.forEach((controller, key) => {
    if (controller === options?.except) {
      return
    }
    if (gameKey === undefined || key === gameKey) {
      controller.abort()
    }
  })
}

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
