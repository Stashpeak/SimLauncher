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

/**
 * Normalized companion path -> the game key whose launch claimed it, for
 * companions that were ALREADY RUNNING when that launch reached them (#853).
 *
 * `runningProcesses` cannot hold these: it is keyed on a live `ChildProcess`
 * handle, and a process we did not spawn has none. But the profile did ask for
 * the app, it is up, and `killLaunchedApps` closes it by path, so the launch
 * establishes ownership just as much as a spawn does. Without that, one already
 * running companion put a Close Apps control on every OTHER row whose profile
 * merely configures the same app.
 *
 * Attribution only, never a kill handle. In memory only, so a restart drops it
 * and every configuring profile claims the app again, which is the state #851
 * replaces with a persisted memory.
 */
export const adoptedCompanionOwners = new Map<string, string>()
export const processNameMismatchWarnings = new Map<string, ProcessNameMismatchWarningEntry>()
export const suppressedProcessNameMismatchWarnings = new Set<string>()

// One AbortController per gameKey with an in-flight launchProfileApps sequence.
// Lives here (not spawn.ts) so kill.ts can abort a sequence without a circular
// import between the two process-lifecycle modules (#670).
const activeLaunchControllers = new Map<string, AbortController>()

/**
 * Games seen running in a succeeded tasklist read, mapped to the monotonic
 * timestamp of the FIRST read in the current streak (#204).
 *
 * A timestamp rather than a bare marker because auto-close only treats a
 * disappearance as the end of a session once the game has been running for
 * long enough to have been one. That is what keeps a launcher stub, which
 * flickers through a scan or two and hands off to a differently-named child,
 * from reading as an exit (Codex on #826).
 *
 * Auto-close's state, kept HERE rather than in autoClose.ts so that
 * `registerActiveLaunch` below can clear it synchronously. Clearing it from a
 * scan instead is not sound: `publishRunningApps('launch')` is fire-and-forget
 * (spawn.ts), observers only run after that publish's tasklist await, and a
 * companion-only or failed sequence can finish and unregister before the read
 * resolves. The scan would then see no active launch, consume the PREVIOUS
 * session's marker and close the companions the launch had just started
 * (Codex on #826).
 */
export const gamesSeenRunning = new Map<string, number>()

/**
 * Monotonic count of launches registered per game (#204).
 *
 * "Is a launch active right now" is a point-in-time sample, and a
 * companion-only or failed sequence can register AND unregister inside a single
 * tasklist read, so an auto-close that samples it before and after its read can
 * miss the launch entirely and then close what that launch just started
 * (CodeRabbit on #826). A counter cannot be missed: a pending close records the
 * value it was armed against and refuses to act if it has moved.
 */
const launchGenerations = new Map<string, number>()

export function getLaunchGeneration(gameKey: string): number {
  return launchGenerations.get(gameKey) ?? 0
}

export function registerActiveLaunch(gameKey: string): AbortController {
  const controller = new AbortController()
  activeLaunchControllers.set(gameKey, controller)
  launchGenerations.set(gameKey, getLaunchGeneration(gameKey) + 1)
  // A new launch supersedes the previous session, so its exit evidence must go
  // at the moment the launch is registered, not whenever a scan next lands.
  gamesSeenRunning.delete(gameKey)
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
export interface PendingElevatedHandoff {
  gameKey?: string
  /**
   * The profile SLOT this handoff belongs to, and the ONLY stable way to decide
   * whether it is leaving.
   *
   * Two slots can point at one exe with different `appArgs` (#357), so the path
   * alone does not identify it and a caller matching on path cancels both
   * (CodeRabbit on #782). The path is not a usable tie-breaker either: it is a
   * launch-time snapshot, while a caller's entries are rebuilt from the CURRENT
   * `appPaths`, so editing that slot's exe in Settings while a prompt is
   * unanswered makes the two disagree and a `key + path` match miss the handoff
   * entirely (Codex P2 on #842). The key does not move.
   */
  appKey?: string
  appPath: string
  cancel: () => void
}

const pendingElevatedHandoffs = new Map<number, PendingElevatedHandoff>()

export function registerPendingElevatedHandoff(
  handoffId: number,
  entry: PendingElevatedHandoff
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
 *
 * `matches` narrows it further. Without it the scope is the whole game, which is
 * right for "close everything I started here" but wrong for anything that stops
 * a SUBSET: a profile switch that happens to stop one app would otherwise also
 * kill the host of an app both profiles enable and that the switch never
 * intended to touch, costing the user a permission prompt they were about to
 * approve (#782).
 *
 * A predicate rather than a path list, for two reasons that pull the same way.
 *
 * Identity here is the SLOT, never the path. Two slots can share one exe (#357),
 * so a path list cancels the retained slot's prompt along with the leaving one
 * (CodeRabbit on #782), and the path recorded on an entry is a launch-time
 * snapshot that the caller's current `appPaths` may no longer agree with (Codex
 * on #842). Both narrowing callers, `killProfileApps` and the profile switch,
 * therefore match on `appKey`.
 *
 * And a predicate does not have to narrow by identity at all: `killLaunchedApps`
 * uses one to keep the whole-game scope while excluding handoffs whose profile
 * currently has tracking off (#591).
 */
export function cancelPendingElevatedHandoffs(
  gameKey?: string,
  matches?: (entry: PendingElevatedHandoff) => boolean
): void {
  pendingElevatedHandoffs.forEach((entry, handoffId) => {
    if (gameKey !== undefined && entry.gameKey !== gameKey) {
      return
    }
    if (matches && !matches(entry)) {
      return
    }
    pendingElevatedHandoffs.delete(handoffId)
    // `cancel` is a callback owned by spawn.ts and it runs synchronously inside
    // this loop, so a throw would abandon every entry after it AND propagate
    // into whichever caller is running. That matters now that one of them is
    // `save-profile` (#782): the same shape took down four config tests when the
    // untracked reconcile went synchronous on #834. Deleted before the call, so
    // a throwing entry cannot be retried forever either.
    try {
      entry.cancel()
    } catch (err) {
      console.error('Failed to cancel a pending elevated handoff:', err)
    }
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
 * Take the pending count and reset it, so exactly one result reports it.
 *
 * Drained by the kill entry points because every stranded prompt originates
 * from one: the abort signal is only ever raised by `abortActiveLaunches`, and
 * the registry is only ever drained by `cancelPendingElevatedHandoffs`, both of
 * which are called from kill.ts and both synchronously, in the prologue before
 * any await. The count travels to the renderer as a number; the sentence is
 * composed there, next to formatKillFailures.
 */
export function drainStrandedConsentPrompts(): number {
  const count = strandedConsentPrompts
  strandedConsentPrompts = 0
  return count
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
/**
 * Whether a launch sequence for this game is in flight right now (#204).
 *
 * Auto-close needs this because "the game exe is absent" is also true for the
 * whole run-up of a launch: with `gamePosition: 'last'` the game starts after
 * its utilities, and `launchDelayMs` allows up to 30s between entries, so the
 * exe can legitimately be missing for far longer than the grace window while a
 * new session is starting.
 */
export function isLaunchActiveForGame(gameKey: string): boolean {
  return activeLaunchControllers.has(gameKey)
}

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
 * Deliberately NOT matched on the Map key (a normalised path), because some
 * apps replace their process with a child of the same exe name: the original
 * PID is gone but the image is still there, and a key comparison would drop a
 * record that is still live. The question is "is anything running at this
 * path", which is what the predicate answers.
 *
 * Takes a PREDICATE rather than the name set it used to take (#674). Asking by
 * name alone meant a same-named process anywhere on the system kept a dead
 * record alive forever, and the caller is the only party that can answer the
 * path question, so it passes in the answer rather than the raw snapshot. Same
 * reasoning as `pruneUntrackedGames` taking keys: this module stays free of
 * both profile and process-resolution knowledge.
 *
 * The predicate must answer "yes" when it does not know. A record is user
 * visible, so an unobserved tick must not delete it.
 */
export function pruneStoppedRunningProcesses(isPathRunning: (appPath: string) => boolean): void {
  runningProcesses.forEach((appProcess, key) => {
    if (!isPathRunning(appProcess.path)) {
      runningProcesses.delete(key)
    }
  })
}

/**
 * Drop every surfaced record belonging to a game whose active profile has
 * process tracking off (#591), without touching the processes themselves.
 *
 * Takes the keys rather than reading the store so this module stays free of
 * profile knowledge, matching `pruneStoppedRunningProcesses` above.
 */
export function pruneUntrackedGames(untrackedGameKeys: Set<string>): void {
  if (untrackedGameKeys.size === 0) {
    return
  }

  runningProcesses.forEach((entry, key) => {
    if (untrackedGameKeys.has(entry.gameKey)) {
      runningProcesses.delete(key)
    }
  })
  unclosedProcesses.forEach((entry, key) => {
    if (untrackedGameKeys.has(entry.gameKey)) {
      unclosedProcesses.delete(key)
    }
  })
  processNameMismatchWarnings.forEach((entry, key) => {
    if (untrackedGameKeys.has(entry.gameKey)) {
      processNameMismatchWarnings.delete(key)
    }
  })
  // `pendingElevatedHandoffs` is deliberately NOT touched here, and it used to
  // be (Codex on #834). A handoff belonging to a now-untracked game has to be
  // hidden from Close Apps, and this pass was how that happened: the entry was
  // deleted outright.
  //
  // Both attempts to express it as stored state were wrong. Deleting put the
  // handoff out of reach of the profile-switch and config-import consumers #782
  // added, which need it precisely because the user is leaving that profile.
  // Marking `tracked = false` instead fixed that and introduced a one-way door:
  // this pass only ever receives the UNTRACKED set, so turning tracking back on
  // while the prompt is still pending never restored the flag and Close Apps
  // ignored the handoff forever (Codex P2 on #842).
  //
  // So tracking is not stored on the handoff at all. `killLaunchedApps` reads it
  // live from the active profile at cancellation time, which is always current
  // by construction and has no direction to get wrong.
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
