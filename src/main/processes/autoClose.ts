import { writeAppErrorLog } from '../errorLog'
import { getActiveStoredProfile, getStoredProfiles, type StoredProfile } from '../profiles'
import { getStoredStringRecord } from '../store'
import { getExeName, isValidExePath, normalizePathForComparison } from '../utils'

import { killLaunchedApps } from './kill'
import { registerProcessScanObserver, type ProcessScanObserver } from './running'
import { gamesSeenRunning, isLaunchActiveForGame, processNameMismatchWarnings } from './state'
import { invalidateProcessNameCache, readRunningProcessNames } from './tasklist'
import type { RunningProcessNamesResult } from './tasklist'

/**
 * How long to wait after the game's exe disappears before closing that
 * profile's companions (#204).
 *
 * NOT a debounce, and not protection against a bad tasklist read: reads report
 * `succeeded` explicitly and a failed one is never cached, so that risk is
 * handled deterministically in `observeProcessScan` below. This window exists
 * because companion apps do their most important work AT the end of a session.
 * Garage61 uploads telemetry once the session ends; killing it seconds later
 * risks truncating exactly the data the user ran the session for.
 *
 * Until now the only way these apps got closed was a human deciding to close
 * them, which happens tens of seconds to minutes after the flag drops, so the
 * absence of reported problems says nothing about closing them immediately.
 * 15s is deliberately on the safe side: a window that is too long is cosmetic,
 * a close that is too early destroys data, and it lands while the user still
 * has both hands on the wheel and cannot intervene.
 */
export const AUTO_CLOSE_GRACE_MS = 15000

// A game only becomes a close candidate by leaving `gamesSeenRunning`, so the
// first observation after startup (or after the observer is re-registered) can
// never look like an exit. The set lives in state.ts so that registering a
// launch can clear it synchronously; see the comment there.
const pendingAutoCloses = new Map<string, ReturnType<typeof setTimeout>>()

/**
 * Whether auto-close may act on this game right now. Re-checked immediately
 * before the kill as well, because the whole point of the grace window is that
 * time passes, and the user can change any of this inside it.
 */
function isAutoCloseArmed(gameKey: string): boolean {
  const profile = getActiveProfile(gameKey)

  // The only profile boolean that is opt-in, so `=== true`: absent
  // configuration must never authorise closing a user's apps.
  if (profile?.closeAppsOnGameExit !== true) {
    return false
  }

  // Tracking off means SimLauncher deliberately does not follow this game's
  // process (#591), so there is no exit to detect and arming would be a lie.
  if (profile.trackingEnabled === false) {
    return false
  }

  const gamePath = getStoredStringRecord('gamePaths')[gameKey]
  if (!isValidExePath(gamePath)) {
    return false
  }

  // A mismatch warning means this exe exited right after launch and the real
  // game is running under a different name, which is the launcher-stub case
  // (Steam, EA App). The game exe's absence is then meaningless, so refuse,
  // BUT only while it is the only thing we could watch. Once the user has
  // followed the warning and configured a secondary executable, we have a
  // signal that is not lying and the refusal would be permanent for no reason
  // (Codex on #826). The secondary is what `getArmedGameExeNames` then watches.
  if (
    getDistinctSecondaryExeNames(gameKey, profile).size === 0 &&
    processNameMismatchWarnings.has(normalizePathForComparison(gamePath))
  ) {
    return false
  }

  // Watching is by process name, so if another configured game is a different
  // copy of the same exe, one process satisfies both profiles at once: both
  // record exit evidence, its exit arms two timers, and the companions of a
  // profile the user never played get closed (Codex on #826). This is the #674
  // collision class, and `getExternallyAdoptableGameKeys` already refuses to
  // adopt on the same ambiguity, so refusing here keeps the two consistent.
  if (hasContestedExeName(gameKey)) {
    return false
  }

  return true
}

/**
 * Whether any process name this game would watch is also the configured game
 * exe of a DIFFERENT game key. Covers the secondary names too, since those are
 * matched by name exactly like the primary.
 */
function hasContestedExeName(gameKey: string): boolean {
  const watched = getArmedGameExeNames(gameKey)
  return Object.entries(getStoredStringRecord('gamePaths')).some(
    ([otherGameKey, otherGamePath]) =>
      otherGameKey !== gameKey &&
      isValidExePath(otherGamePath) &&
      watched.has(getExeName(otherGamePath))
  )
}

function getActiveProfile(gameKey: string): StoredProfile | undefined {
  const profileEntry = getStoredProfiles()[gameKey]
  return profileEntry ? getActiveStoredProfile(profileEntry) : undefined
}

function getSecondaryGamePaths(profile: StoredProfile | undefined): string[] {
  return Array.isArray(profile?.trackedProcessPaths)
    ? profile.trackedProcessPaths.filter(isValidExePath)
    : []
}

/**
 * Secondary executables that contribute a process name the primary does not.
 *
 * Only these may lift the mismatch refusal (CodeRabbit on #826). Watching is by
 * process NAME, so a secondary that is the game path again, or a same-named exe
 * from another install, collapses into the primary's name and adds no signal.
 * Counting it would grant the bypass and then arm on the very name the warning
 * says is unreliable, which is the destructive false close the refusal exists
 * to prevent. `getExeName` lowercases, so this comparison is case-safe.
 */
function getDistinctSecondaryExeNames(
  gameKey: string,
  profile: StoredProfile | undefined
): Set<string> {
  const primaryExeName = getExeName(getStoredStringRecord('gamePaths')[gameKey])
  return new Set(
    getSecondaryGamePaths(profile)
      .map(getExeName)
      .filter((exeName) => exeName.length > 0 && exeName !== primaryExeName)
  )
}

/**
 * Every process whose presence means this game's session is still going: the
 * configured game exe plus any "Secondary executables to watch".
 *
 * Deliberately NOT `getProfileTrackablePaths`, which also folds in the enabled
 * utilities. Those are the very processes auto-close exists to close, so
 * waiting for them to stop would mean waiting for the thing this is supposed
 * to cause.
 *
 * The trade-off in reusing that user-facing list: it is worded as secondary
 * executables generally, so a user who files a COMPANION under it turns
 * auto-close for that profile into a no-op, because that companion is still
 * running at the moment we ask. That fails safe (nothing is closed) and it is
 * the price of making the launcher-stub repair path actually work.
 */
function getArmedGameExeNames(gameKey: string): Set<string> {
  const gamePath = getStoredStringRecord('gamePaths')[gameKey]
  const paths = [gamePath, ...getSecondaryGamePaths(getActiveProfile(gameKey))].filter(
    isValidExePath
  )
  return new Set(paths.map(getExeName))
}

/**
 * What was true when the window was armed, so the eventual kill can prove it is
 * still acting on that same intent rather than on whatever is configured 15
 * seconds later.
 */
interface ArmedSnapshot {
  profileId: string | undefined
  exeNames: Set<string>
}

function captureArming(gameKey: string): ArmedSnapshot {
  return { profileId: getActiveProfileId(gameKey), exeNames: getArmedGameExeNames(gameKey) }
}

/**
 * The active profile's id, or undefined for a legacy flat profile entry, which
 * has only one profile and therefore nothing to switch between.
 *
 * Watched exe names alone cannot stand in for this (Codex on #826): two
 * profiles for the same game necessarily share the game exe, so switching
 * between them is invisible to a name comparison. The profile switch starts the
 * incoming profile's companions, and `killLaunchedApps` resolves its targets
 * from whichever profile is active when it runs, so a stale timer would close
 * apps that belong to a session the user just started.
 */
function getActiveProfileId(gameKey: string): string | undefined {
  const id = getActiveProfile(gameKey)?.id
  return typeof id === 'string' ? id : undefined
}

function isSameArming(gameKey: string, armed: ArmedSnapshot): boolean {
  return (
    getActiveProfileId(gameKey) === armed.profileId &&
    sameExeNames(getArmedGameExeNames(gameKey), armed.exeNames)
  )
}

// Order-independent, because the identity that matters is WHICH processes are
// watched, not how the profile happens to list them.
function sameExeNames(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && [...a].every((name) => b.has(name))
}

// The session is over only when EVERY watched process is gone. Any survivor
// means the game is still up under one of its names, which is exactly the
// launcher-stub case this set exists for.
function isAnyRunning(exeNames: Set<string>, processNames: Set<string>): boolean {
  return [...exeNames].some((exeName) => processNames.has(exeName))
}

function cancelPendingAutoClose(gameKey: string): void {
  const timer = pendingAutoCloses.get(gameKey)
  if (timer) {
    clearTimeout(timer)
    pendingAutoCloses.delete(gameKey)
  }
}

/**
 * The final check, deliberately adjacent to the destructive action rather than
 * inherited from the scan that armed it. Fifteen seconds is long enough for the
 * world to have changed, and the cached read is up to 500ms stale on top, so
 * the cache is dropped and one fresh read is taken here.
 */
async function runAutoClose(gameKey: string, armed: ArmedSnapshot): Promise<void> {
  pendingAutoCloses.delete(gameKey)

  // An early-out, NOT a correctness guard: the identical check runs after the
  // read, which is the one that decides. This exists so a timer that is already
  // moot does not drop everyone else's process-name cache on its way to
  // deciding nothing, since `invalidateProcessNameCache` is shared state.
  if (!isAutoCloseArmed(gameKey) || !isSameArming(gameKey, armed)) {
    return
  }

  const { exeNames } = armed

  invalidateProcessNameCache()
  const { processNames, succeeded } = await readRunningProcessNames()

  // "We could not look" is not "it is gone". Skip this close rather than act on
  // a read that told us nothing.
  //
  // Putting the evidence back is what makes that a skip rather than a permanent
  // opt-out (CodeRabbit on #826): arming consumed the `gamesSeenRunning` entry,
  // so without this the next scan, which still finds the game absent, gets
  // `false` from the delete and never arms again. One transient tasklist
  // failure at the wrong moment would disable auto-close for the rest of the
  // session.
  if (!succeeded) {
    gamesSeenRunning.add(gameKey)
    return
  }

  // Any one of them still up means the session is not over: a relaunch, or a
  // restart we never saw stop in a scan. Not an exit.
  if (isAnyRunning(exeNames, processNames)) {
    gamesSeenRunning.add(gameKey)
    return
  }

  // Eligibility is re-read here too, not just before the await. The presence
  // check above is deliberately adjacent to the kill; leaving the permission
  // check on the far side of an I/O boundary would be the same mistake in the
  // other half, and a profile edited mid-read would kill against a process set
  // we no longer target (CodeRabbit on #826).
  if (!isAutoCloseArmed(gameKey) || !isSameArming(gameKey, armed)) {
    return
  }

  // An absent game exe is ALSO what a launch in progress looks like, and
  // `killLaunchedApps` opens by aborting active launches, so firing here would
  // cancel the session the user just asked for and close the companions it had
  // already started (Codex on #826). Checked last, so a launch begun during the
  // read is still caught.
  if (isLaunchActiveForGame(gameKey)) {
    return
  }

  // Failures propagate to the scheduler's catch, which is the single place
  // auto-close reports a problem. Handling it twice would log it twice.
  await killLaunchedApps(gameKey)
}

/**
 * Observe one raw tasklist result and arm, cancel, or leave alone.
 *
 * A failed read returns immediately: `processNames` is empty on failure, so
 * treating it as observation would read one failed read as every game exiting
 * at once.
 */
export const observeProcessScan: ProcessScanObserver = ({
  processNames,
  succeeded
}: RunningProcessNamesResult): void => {
  if (!succeeded) {
    return
  }

  const profiles = getStoredProfiles()

  Object.keys(profiles).forEach((gameKey) => {
    if (!isAutoCloseArmed(gameKey)) {
      // Disarming mid-window cancels the close rather than letting a timer the
      // user just turned off go off anyway.
      cancelPendingAutoClose(gameKey)
      gamesSeenRunning.delete(gameKey)
      return
    }

    // A launch for this game supersedes any pending close: the user has asked
    // for a new session, and the run-up to it looks exactly like an exit,
    // because with `gamePosition: 'last'` the game starts after its utilities
    // and `launchDelayMs` allows up to 30s between entries (Codex on #826).
    //
    // Only the timer is dropped here. The seen-marker is cleared by
    // `registerActiveLaunch` instead, because this branch cannot be relied on
    // to run at all: `publishRunningApps('launch')` is fire-and-forget and a
    // companion-only or failed sequence can finish before that publish's
    // tasklist read resolves, so no scan need ever observe an active launch
    // (Codex on #826). Clearing it a second time here would be dead: every
    // launch path registers, and this early return means nothing re-adds the
    // marker for the duration of a launch either.
    if (isLaunchActiveForGame(gameKey)) {
      cancelPendingAutoClose(gameKey)
      return
    }

    const exeNames = getArmedGameExeNames(gameKey)
    if (exeNames.size === 0) {
      return
    }

    if (isAnyRunning(exeNames, processNames)) {
      gamesSeenRunning.add(gameKey)
      cancelPendingAutoClose(gameKey)
      return
    }

    // Absent, and we saw it running. `delete` returning true IS the "arm once"
    // guarantee: it consumes the evidence, so the next scan, which still finds
    // the game gone, gets false and does not push the window out again. A
    // separate `!pendingAutoCloses.has(...)` check would look like the guard
    // doing that work and never once decide anything.
    if (gamesSeenRunning.delete(gameKey)) {
      const armed = captureArming(gameKey)
      pendingAutoCloses.set(
        gameKey,
        setTimeout(() => {
          // Caught here rather than left to `void`: a rejection from the read
          // or the kill would otherwise surface as an unhandled rejection with
          // no indication which game it came from.
          runAutoClose(gameKey, armed).catch((err: unknown) => {
            const detail = err instanceof Error ? err.message : String(err)
            console.error(`Auto-close failed for ${gameKey}:`, err)
            writeAppErrorLog('autoClose', `[${gameKey}] Auto-close failed: ${detail}`)
          })
        }, AUTO_CLOSE_GRACE_MS)
      )
    }
  })
}

/**
 * Subscribe auto-close to the process scan. Inert until some profile opts in,
 * so registering it costs a Set lookup per scan and nothing else.
 *
 * Call AFTER the profile migration has run: every decision here reads the
 * stored profile shape, and observing a half-migrated one would answer against
 * data that is about to change.
 */
export function initAutoClose(): void {
  registerProcessScanObserver(observeProcessScan)
}
