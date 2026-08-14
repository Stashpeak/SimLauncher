import { writeAppErrorLog } from '../errorLog'
import { getActiveStoredProfile, getStoredProfiles } from '../profiles'
import { getStoredStringRecord } from '../store'
import { getExeName, isValidExePath, normalizePathForComparison } from '../utils'

import { killLaunchedApps } from './kill'
import { registerProcessScanObserver, type ProcessScanObserver } from './running'
import { processNameMismatchWarnings } from './state'
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

// Games whose exe has been SEEN running in a SUCCEEDED read. A game only
// becomes a close candidate by leaving this set, so the first observation after
// startup (or after the observer is re-registered) can never look like an exit.
const gamesSeenRunning = new Set<string>()

const pendingAutoCloses = new Map<string, ReturnType<typeof setTimeout>>()

/**
 * Whether auto-close may act on this game right now. Re-checked immediately
 * before the kill as well, because the whole point of the grace window is that
 * time passes, and the user can change any of this inside it.
 */
function isAutoCloseArmed(gameKey: string): boolean {
  const profileEntry = getStoredProfiles()[gameKey]
  const profile = profileEntry ? getActiveStoredProfile(profileEntry) : undefined

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
  // (Steam, EA App). For those games EVERY exit signal we have is wrong: the
  // exe is gone from the tasklist while the session is very much alive. Refuse
  // to arm rather than act on a signal we already know is lying. The user's
  // route back is "Secondary executables to watch" in the profile editor.
  if (processNameMismatchWarnings.has(normalizePathForComparison(gamePath))) {
    return false
  }

  return true
}

function getArmedGameExeName(gameKey: string): string | undefined {
  const gamePath = getStoredStringRecord('gamePaths')[gameKey]
  return isValidExePath(gamePath) ? getExeName(gamePath) : undefined
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
async function runAutoClose(gameKey: string): Promise<void> {
  pendingAutoCloses.delete(gameKey)

  if (!isAutoCloseArmed(gameKey)) {
    return
  }

  const exeName = getArmedGameExeName(gameKey)
  if (!exeName) {
    return
  }

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

  // It came back inside the window (a relaunch, or a restart we never saw stop
  // in a scan). Not an exit.
  if (processNames.has(exeName)) {
    gamesSeenRunning.add(gameKey)
    return
  }

  // Eligibility is re-read here too, not just before the await. The presence
  // check above is deliberately adjacent to the kill; leaving the permission
  // check on the far side of an I/O boundary would be the same mistake in the
  // other half, and a game path edited mid-read would kill against an exe name
  // we no longer target (CodeRabbit on #826).
  if (!isAutoCloseArmed(gameKey) || getArmedGameExeName(gameKey) !== exeName) {
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

    const exeName = getArmedGameExeName(gameKey)
    if (!exeName) {
      return
    }

    if (processNames.has(exeName)) {
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
      pendingAutoCloses.set(
        gameKey,
        setTimeout(() => {
          // Caught here rather than left to `void`: a rejection from the read
          // or the kill would otherwise surface as an unhandled rejection with
          // no indication which game it came from.
          runAutoClose(gameKey).catch((err: unknown) => {
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
