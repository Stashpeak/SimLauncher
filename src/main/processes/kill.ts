import type { ChildProcess } from 'child_process'
import path from 'path'

import {
  getActiveStoredProfile,
  getProfileTrackablePaths,
  getStoredProfiles,
  isProcessTrackingEnabled,
  isUtilityEnabled
} from '../profiles'
import { getStoredBoolean, getStoredStringRecord } from '../store'
import { getExeName, isValidExePath, normalizePathForComparison, pathsEqual, wait } from '../utils'

import {
  abortActiveLaunches,
  cancelPendingElevatedHandoffs,
  drainStrandedConsentPrompts,
  processNameMismatchWarnings,
  runningProcesses,
  suppressProcessNameMismatchWarning,
  unclosedProcesses,
  getUnclosedProcessKey
} from './state'
import { publishRunningApps } from './running'
import { invalidateProcessNameCache, readRunningProcessNames } from './tasklist'
import type {
  KillAttemptResult,
  KillFailure,
  KillFailureReason,
  KillProfileAppsOptions,
  KillResult,
  ProfileLaunchEntry
} from './types'
import {
  GRACEFUL_CLOSE_WINDOW_MS,
  type ConfiguredPathState,
  findProcessIdsByExecutablePath,
  hasChildExited,
  isFullExePath,
  isPathScopedExe,
  killProcessByImageName,
  killProcessTree,
  requestGracefulClose,
  resolveConfiguredPathStates,
  resolveRunningConfiguredPaths
} from './win32KillUtils'

// Hardcoded list of companion process names for utilities that spawn background
// agents under a name that differs from (or is not derived from) their
// configured exe path, making normal path-based kill lookup insufficient.
// Utilities whose agent name can be derived from `appPaths` at runtime do not
// need an entry here.
const UTILITY_COMPANION_PROCESS_NAMES: Record<string, string[]> = {
  garage61: ['Garage61 telemetry agent.exe']
}

function clearUnclosedProcess(
  gameKey: string | undefined,
  appPath: string | undefined,
  processName: string
) {
  unclosedProcesses.delete(getUnclosedProcessKey(gameKey, appPath || processName, processName))
}

function getKillFailureReason(attempt: KillAttemptResult): KillFailureReason {
  if (attempt.accessDenied) return 'access_denied'
  if (attempt.stillRunning) return 'still_running'
  return 'unknown'
}

function registerUnclosedProcess(attempt: KillAttemptResult) {
  const appPath = attempt.appPath || attempt.processName
  const gameKey = attempt.gameKey || ''
  const reason = getKillFailureReason(attempt)
  const error =
    attempt.error ||
    (reason === 'access_denied'
      ? 'Windows denied SimLauncher permission to close this app. It may be running as administrator.'
      : 'The app is still running after the close request.')

  unclosedProcesses.set(getUnclosedProcessKey(gameKey, appPath, attempt.processName), {
    path: appPath,
    name: path.basename(appPath),
    gameKey,
    error,
    reason,
    elevated: reason === 'access_denied'
  })
}

export function pruneUnclosedProcesses(processNames: Set<string>): void {
  unclosedProcesses.forEach((entry, key) => {
    if (!processNames.has(getExeName(entry.path))) {
      unclosedProcesses.delete(key)
    }
  })
}

/**
 * Build the set of app paths the user has actually configured in their
 * profiles. This acts as an allowlist for `killProfileApps`: any path that
 * is not in the stored configuration is rejected outright, preventing a
 * compromised renderer from issuing kill requests against arbitrary executables
 * on the system.
 */
function getStoredAppPathTargets() {
  const storedAppPaths = getStoredStringRecord('appPaths')

  return new Set(
    Object.values(storedAppPaths || {})
      .filter(
        (appPath): appPath is string => typeof appPath === 'string' && appPath.trim().length > 0
      )
      .map(normalizePathForComparison)
  )
}

/**
 * Whether the game a pending elevated handoff belongs to is currently managed
 * (#591). Answered from the store on every call, never cached on the handoff:
 * the prompt can outlive any number of tracking toggles in both directions.
 *
 * A handoff with no `gameKey` counts as tracked. It cannot be attributed to a
 * profile that opted out, and the safe default for Close Apps is to close.
 */
function isHandoffProfileTracked(handoffGameKey?: string): boolean {
  if (handoffGameKey === undefined) {
    return true
  }
  return isProcessTrackingEnabled(getActiveStoredProfile(getStoredProfiles()[handoffGameKey]))
}

function hasProcessNameMismatchWarning(gameKey?: string) {
  return Array.from(processNameMismatchWarnings.values()).some(
    (warning) => gameKey === undefined || warning.gameKey === gameKey
  )
}

export async function finalizeKillAttempts(
  attempts: KillAttemptResult[],
  gameKey?: string
): Promise<KillResult> {
  if (attempts.length === 0) {
    const hasMismatchWarnings = hasProcessNameMismatchWarning(gameKey)

    return {
      success: true,
      message: hasMismatchWarnings
        ? 'No closable companion apps found. Some apps may be running under a different process name; add the shown process under "Secondary executables to watch" in the profile editor to manage it.'
        : 'No running companion apps to close.',
      closedCount: 0,
      failedCount: 0,
      failures: []
    }
  }

  invalidateProcessNameCache()
  const { processNames: processNamesAfterKill, succeeded: tasklistReadSucceeded } =
    await readRunningProcessNames()

  // Paths this batch positively located a process at, grouped by image name.
  //
  // Scheduling is gated on the tasklist, which knows names and not paths, so
  // once two profiles can configure two same-named executables at different
  // paths (#772) both get scheduled even when only one is running. The absent
  // one then looks exactly like an invisible elevated process (#390): 0 PIDs at
  // its path while the image IS in the tasklist. Inferring a hidden instance
  // there invented a leftover for a profile with nothing running, which is
  // #772's own symptom (Codex P1 on #818).
  //
  // Only a PATH-SCOPED sibling at a DIFFERENT path counts as evidence:
  //
  //   - a bare-name `/IM` confirmation says only that *some* process with this
  //     name exists, which may be the very process this path is tracking, so it
  //     cannot establish that this path was empty (Codex P2 on #818)
  //   - a lookup that errored confirms nothing at all, which is why this reads
  //     `targetConfirmed` rather than the absence of `notFound` (CodeRabbit)
  //   - and the differing path is what stops an attempt vouching for itself,
  //     since `targetConfirmed` and `notFound` can both hold on one attempt when
  //     PIDs are found and taskkill then reports them already gone
  //
  // Deliberately narrow. With no such sibling the ambiguity is real and stays
  // unresolved.
  //
  // #674 has since built the direct answer (`postKillPathStates` below), which
  // needs no sibling at all. This stays as the fallback rather than being
  // replaced, because the enumeration can fail, and a failed enumeration is
  // reported as `unknown` -- indistinguishable here from an enumeration that ran
  // and could not decide. Dropping this would hand those cases back to #818.
  //
  // KNOWN RESIDUAL, unchanged and now confined to this fallback: a sibling that
  // located its target and closed it successfully still counts, even though an
  // image surviving in the tasklist afterwards can only be something else,
  // possibly a genuinely elevated-invisible process at this very path. The trade
  // is deliberate: the false positive suppressed here is far likelier than the
  // false negative left behind.
  // Image names a bare-name `/IM` attempt actually closed. That kill is not
  // path-scoped, so it takes down whatever was running under the name, including
  // whatever a same-named path target was aiming at. Such a path attempt then
  // finds nothing and would otherwise be counted as a second closed app, one
  // process reported as two (Codex P2 on #818).
  //
  // Used ONLY for counting. It cannot decide that the path was empty, since the
  // process it closed may be exactly the one that path tracks.
  const imagesClosedByNameKill = new Set(
    attempts
      .filter((attempt) => !isPathScopedExe(attempt.appPath) && attempt.success)
      .map((attempt) => attempt.processName)
  )

  // What the sibling heuristic above approximates, asked directly (#674).
  //
  // The whole ambiguity is that `processNamesAfterKill` knows names and not
  // paths, so an image surviving the kill cannot say whether it survived at OUR
  // path. A name-scoped enumeration can: it returns each surviving instance with
  // its path and session, and a path with no instance of its own is empty no
  // matter how many strangers share its name. On the field repro that is the
  // difference between "SimHub could not be closed, it may be running as
  // administrator" and the truth, which was 20 unrelated `cmd.exe` processes.
  //
  // Gated on `tasklistReadSucceeded`, and that gate is load-bearing rather than
  // defensive: a failed read yields an EMPTY name set, which this function would
  // otherwise read as "no path can be running" and answer every attempt
  // `not-running` for free — turning a read failure into confident absence, the
  // exact inversion #399 exists to prevent.
  //
  // The cost follows the same rule as the launch filter. A path whose image is
  // absent from the post-kill tasklist is answered without enumerating, so the
  // ordinary close (everything asked for actually died) pays nothing, and a
  // batch that leaves survivors pays one spawn for all of them.
  const fullPathAttemptPaths: string[] = []
  attempts.forEach((attempt) => {
    const appPath = attempt.appPath
    if (isFullExePath(appPath)) {
      fullPathAttemptPaths.push(appPath)
    }
  })
  const postKillPathStates = tasklistReadSucceeded
    ? await resolveConfiguredPathStates(processNamesAfterKill, fullPathAttemptPaths)
    : new Map<string, ConfiguredPathState>()

  const confirmedPathsByImage = new Map<string, Set<string>>()
  attempts.forEach((attempt) => {
    if (!attempt.targetConfirmed || !isPathScopedExe(attempt.appPath)) {
      return
    }
    const confirmedPath = normalizePathForComparison(attempt.appPath)
    if (!confirmedPath) {
      return
    }
    const existing = confirmedPathsByImage.get(attempt.processName)
    if (existing) {
      existing.add(confirmedPath)
    } else {
      confirmedPathsByImage.set(attempt.processName, new Set([confirmedPath]))
    }
  })

  const finalizedAttempts = await Promise.all(
    attempts.map(async (attempt) => {
      // Treat the launched exe's absence from the post-kill tasklist as the
      // authoritative success signal. This covers apps whose actual running
      // process has a different name than the launched exe (e.g. Perplexity
      // and similar Electron wrappers, see #390): the kill effectively
      // succeeded if the image we asked Windows to terminate is gone, even
      // when taskkill reported access-denied/not-found or WMI returns a
      // stale PID on the post-kill recheck.
      //
      // Gate this override on tasklistReadSucceeded so a transient tasklist
      // command failure (which yields an empty Set) doesn't silently turn
      // real taskkill failures into false successes (see #399).
      const imageGoneFromTasklist =
        tasklistReadSucceeded && !processNamesAfterKill.has(attempt.processName)

      // Aliasing appPath to a local const lets the type guard narrow it to
      // string for the WMI lookup below. This is existence-inclusive
      // (isFullExePath -> fs.existsSync) on purpose: WMI ExecutablePath matching
      // needs a real file. Cleanup scoping, by contrast, must NOT depend on
      // existence (see isPathScopedExe at the cleanup loop below).
      const appPath = attempt.appPath
      const isFullPathAttempt = isFullExePath(appPath)

      let stillRunning: boolean
      let isElevatedInconclusive = false
      // This attempt found nothing at its own path, before the kill and after
      // it, while another attempt located the image somewhere else. So this path
      // was never running: not a failure to close, and not a close either.
      //
      // The post-kill half matters for the counting below. Without it, a target
      // absent at lookup time but running by the recheck would be both "failed"
      // and "empty", and closedCount subtracts each once (Codex P2 on #818).
      // Requiring 0 PIDs on the recheck makes the two mutually exclusive by
      // construction rather than by a second filter.
      let isEmptySameNameTarget = false
      let closedNothing = false
      if (isFullPathAttempt) {
        const { processIds, detail: lookupError } = await findProcessIdsByExecutablePath(
          attempt.processName,
          appPath
        )

        // Verifiably nothing at this path: none before the kill, none after, and
        // both lookups actually ran. A lookup that FAILED also returns zero PIDs,
        // so the count alone cannot tell "nothing is there" from "could not
        // look" -- the same mistake as reading confirmation off an absent
        // `notFound`, one lookup later (CodeRabbit on #818).
        const verifiablyEmpty =
          attempt.notFound === true && lookupError === undefined && processIds.length === 0

        // Whether this path was EMPTY is a stronger claim than whether it closed
        // anything, and it needs stronger evidence: a confirmed sibling at a
        // DIFFERENT path. A bare-name `/IM` confirmation cannot serve, because
        // the process it found may be the very one this path tracks (Codex P2).
        //
        // The two are separated because they answer different questions. This
        // one suppresses the elevated-process inference, so being wrong invents
        // or hides a leftover. `closedNothing` only decides whether to count the
        // attempt, and an attempt that found nothing closed nothing no matter
        // what else was running.
        //
        // The enumeration answers the same question outright and without needing
        // a sibling, so it is tried first: `not-running` means no instance of
        // this image is at this path, whoever else is holding the name (#674).
        // The sibling heuristic below stays reachable when it cannot decide,
        // which covers both an undecidable instance (#390's shape: an unreadable
        // path in an interactive session) and an enumeration that failed
        // outright. Its known residual comes along with it, documented above.
        //
        // ONLY `not-running` counts. `unknown` and a missing entry both mean the
        // enumeration could not decide, and neither may weaken a verdict.
        //
        // `!imageGoneFromTasklist` is not redundant with it, and dropping it
        // inverts a whole class of result. An image absent from the post-kill
        // tasklist is `not-running` for free, but that is the SUCCESS case: this
        // attempt closed the last instance. Only a path found empty while its
        // image SURVIVES is the #674 shape, where the survivor is somebody
        // else's process and the attempt was aimed at nothing.
        const pathVerifiedEmpty =
          !imageGoneFromTasklist && postKillPathStates.get(appPath) === 'not-running'
        const ownPath = normalizePathForComparison(appPath)
        const confirmedPaths = confirmedPathsByImage.get(attempt.processName)
        isEmptySameNameTarget =
          verifiablyEmpty &&
          (pathVerifiedEmpty ||
            (!!confirmedPaths &&
              Array.from(confirmedPaths).some((confirmedPath) => confirmedPath !== ownPath)))

        // Either kind of sibling is enough to say this attempt closed nothing.
        // Without one, a lone empty attempt keeps its long-standing treatment
        // rather than having its counting quietly changed here.
        closedNothing =
          isEmptySameNameTarget ||
          (verifiablyEmpty && imagesClosedByNameKill.has(attempt.processName))

        // When the post-kill tasklist read failed, treat any unverified
        // "process gone" signal as inconclusive rather than success: a
        // notFound result from WMI/taskkill could mean either truly exited
        // or elevated-invisible, and the empty processNamesAfterKill Set
        // can't distinguish them. Same for the access-denied recheck.
        isElevatedInconclusive =
          !isEmptySameNameTarget &&
          !imageGoneFromTasklist &&
          attempt.notFound === true &&
          attempt.staleTask !== true &&
          (processNamesAfterKill.has(attempt.processName) || !tasklistReadSucceeded)
        stillRunning =
          !imageGoneFromTasklist &&
          (processIds.length > 0 ||
            isElevatedInconclusive ||
            (attempt.accessDenied === true &&
              !attempt.notFound &&
              // The same name-only reasoning one branch down (#674). Here
              // taskkill was refused on PIDs found AT this path, so the image
              // surviving is normally the refused process itself -- but if the
              // enumeration can see the whole name and none of it is at this
              // path, the refusal outlived the process and the survivor is
              // somebody else. An elevated holdout cannot be dismissed this way:
              // its path is unreadable, which resolves to `unknown`.
              !pathVerifiedEmpty &&
              (processNamesAfterKill.has(attempt.processName) || !tasklistReadSucceeded)))
      } else {
        stillRunning = processNamesAfterKill.has(attempt.processName)
      }
      return {
        ...attempt,
        stillRunning,
        imageGoneFromTasklist,
        isEmptySameNameTarget,
        closedNothing,
        accessDenied: attempt.accessDenied || isElevatedInconclusive
      }
    })
  )

  const hasFailedToClose = (attempt: (typeof finalizedAttempts)[number]) =>
    attempt.stillRunning ||
    (!attempt.success && !attempt.notFound && !attempt.imageGoneFromTasklist)

  finalizedAttempts.forEach((attempt) => {
    if (hasFailedToClose(attempt)) {
      registerUnclosedProcess(attempt)
      return
    }

    clearUnclosedProcess(attempt.gameKey, attempt.appPath, attempt.processName)
    const attemptKey = attempt.appPath ? normalizePathForComparison(attempt.appPath) : ''
    // The name fallback is eligible ONLY for bare-name attempts (no full path to
    // scope by). For a full-path attempt the normalized-path match below already
    // deletes exactly its own entry; matching by name as well would also delete
    // a DIFFERENT game's same-named companion at another path (#677). Judge by
    // path SHAPE, not isFullExePath: a full-path attempt whose exe is missing at
    // finalize time must still stay path-scoped, or the #677 bug reappears.
    const nameFallbackEligible = !isPathScopedExe(attempt.appPath)
    runningProcesses.forEach((appProcess, runningKey) => {
      if (
        (attemptKey && runningKey === attemptKey) ||
        (nameFallbackEligible && getExeName(appProcess.path) === attempt.processName)
      ) {
        runningProcesses.delete(runningKey)
      }
    })
  })

  const failedAttempts = finalizedAttempts.filter(hasFailedToClose)
  // Counted by filtering rather than by subtracting two overlapping tallies. An
  // attempt that verifiably found nothing at its path closed nothing, so it is
  // neither a success nor a failure: counting it reported one process as two
  // whenever a sibling had already covered it, and subtracting it separately
  // could deduct the same attempt twice (Codex P2 on #818).
  const closedCount = finalizedAttempts.filter(
    (attempt) => !hasFailedToClose(attempt) && !attempt.closedNothing
  ).length
  const failures: KillFailure[] = failedAttempts.map((attempt) => {
    const appPath = attempt.appPath || attempt.processName
    return {
      appName: path.basename(appPath),
      appPath,
      reason: getKillFailureReason(attempt)
    }
  })

  return {
    success: failedAttempts.length === 0,
    message:
      closedCount > 0
        ? `Closed ${closedCount} companion app${closedCount === 1 ? '' : 's'}.`
        : undefined,
    closedCount,
    failedCount: failedAttempts.length,
    failures
  }
}

// Normalized full paths of every configured game executable, across all
// profiles. A game must NEVER be a kill target — not via a companion target, and
// not via a runningProcesses entry whose cached isGame flag is unreliable (the
// same exe launched under a non-owning profile is recorded isGame=false). Match
// by full PATH, not basename: two games — or a game and a utility — can share a
// basename, and a basename filter would wrongly drop legitimate companions (#519).
function getConfiguredGameExePaths(): Set<string> {
  const gamePaths = getStoredStringRecord('gamePaths')
  const gameExePaths = new Set<string>()
  Object.values(gamePaths || {}).forEach((gamePath) => {
    if (isValidExePath(gamePath)) {
      gameExePaths.add(normalizePathForComparison(gamePath))
    }
  })
  return gameExePaths
}

interface CompanionTarget {
  processName: string
  appPath: string
  /** Whether this target closes by image name (`/IM`) or scoped to its path. */
  scope: 'name' | 'path'
  /**
   * Every profile that configures this target, in enumeration order. Usually
   * one. More than one is the case #772 is about: a utility shared across
   * profiles (Oculus Tray Tool, SimHub, CrewChief) has no single owner, and the
   * map used to silently keep whichever profile was enumerated last.
   */
  gameKeys: string[]
}

/**
 * Map key for a companion killed by IMAGE NAME (the curated utility list). The
 * name is the whole identity: one `taskkill /IM` covers every profile that
 * enabled it, so the same name from two profiles is one target, not two.
 */
function companionTargetNameKey(processName: string): string {
  return `name:${processName.toLowerCase()}`
}

/**
 * Map key for a companion killed by PATH (a tracked companion path). The path
 * is the identity, not the basename: two profiles pointing at two different
 * `Overlay.exe` files are two separate processes and both need closing. Keying
 * by basename collapsed them and closed only one (#772).
 */
function companionTargetPathKey(processPath: string): string {
  return `path:${normalizePathForComparison(processPath)}`
}

/**
 * The game a failed close should be filed under, or `undefined` when the target
 * is configured in more than one profile.
 *
 * Undefined is the honest answer, not a fallback. For a companion SimLauncher
 * launched itself the owner is known and comes from `runningProcesses`, which
 * never reaches this function. What reaches it is a configured companion that is
 * merely *running*, and when several profiles configure it there is nothing that
 * makes one of them its owner. Naming one anyway is exactly the defect: it made
 * a game the user never started surface as having leftover apps, which is why
 * the tray Close Apps item was pulled before 1.0.0 (#772, blocks #519).
 *
 * The failure is still reported either way. `finalizeKillAttempts` builds
 * `failures` from the attempts alone, so the toast names the app regardless of
 * whether anything can be attributed.
 */
function resolveCompanionTargetGameKey(target: CompanionTarget): string | undefined {
  return target.gameKeys.length === 1 ? target.gameKeys[0] : undefined
}

function getProfileCompanionTargets(gameKey?: string) {
  const profiles = getStoredProfiles()
  const gamePaths = getStoredStringRecord('gamePaths')
  const appPaths = getStoredStringRecord('appPaths')
  const companionTargets = new Map<string, CompanionTarget>()

  const gameExePaths = getConfiguredGameExePaths()

  // Record `profileGameKey` as an owner of `key`, creating the target on first
  // sight. Never overwrites: a repeated key means another profile configures the
  // same target, which is information, not a collision to resolve by last write.
  const addOwner = (key: string, target: Omit<CompanionTarget, 'gameKeys'>, owner: string) => {
    const existing = companionTargets.get(key)
    if (!existing) {
      companionTargets.set(key, { ...target, gameKeys: [owner] })
      return
    }
    if (!existing.gameKeys.includes(owner)) {
      existing.gameKeys.push(owner)
    }
  }

  Object.entries(profiles || {}).forEach(([profileGameKey, profileEntry]) => {
    if (gameKey && profileGameKey !== gameKey) {
      return
    }

    const profile = getActiveStoredProfile(profileEntry)

    // Tracking off means SimLauncher does not manage this profile's apps at all
    // (#591, desired behavior 2). Skipping the recording in spawn.ts is not
    // enough on its own: this function rebuilds targets from the stored profile
    // rather than from what was launched, so without this guard the tray's
    // always-enabled Close Apps would still find and kill apps the user
    // explicitly opted out of us touching. `hasClosableLaunchedApps` reads the
    // same map, so this also stops the action being offered for that profile.
    if (!isProcessTrackingEnabled(profile)) {
      return
    }

    // The hardcoded list is curated utility process names — never a game — so it
    // needs no game filtering. Only the path-based tracked companions can name a
    // game exe, and those are excluded by full path below.
    Object.entries(UTILITY_COMPANION_PROCESS_NAMES).forEach(([utilityKey, processNames]) => {
      if (isUtilityEnabled(profile, utilityKey)) {
        processNames.forEach((processName) => {
          const normalizedProcessName = processName.toLowerCase()
          addOwner(
            companionTargetNameKey(normalizedProcessName),
            { processName: normalizedProcessName, appPath: processName, scope: 'name' },
            profileGameKey
          )
        })
      }
    })

    getProfileTrackablePaths(profileGameKey, profile, appPaths, gamePaths).forEach(
      (processPath) => {
        if (gameExePaths.has(normalizePathForComparison(processPath))) {
          return
        }
        addOwner(
          companionTargetPathKey(processPath),
          { processName: getExeName(processPath), appPath: processPath, scope: 'path' },
          profileGameKey
        )
      }
    )
  })

  // A curated utility whose executable path is ALSO configured yields both a
  // name-keyed and a path-keyed target for the same process. Issuing both would
  // close one app twice and count it twice, so the image-name entry is dropped
  // in favour of the path-scoped one, which is strictly more precise and hits
  // the same process.
  //
  // The old basename keying collapsed these too, but by accident: both landed on
  // the same Map key and the path branch happened to be enumerated second.
  // Keying by identity separated them, so the collapse has to be deliberate --
  // and, unlike the accident, it has to be narrow.
  //
  // Matching on the process name alone is NOT enough. `getProfileTrackablePaths`
  // pulls `appPaths[key]` exactly when that utility is enabled, so a genuine
  // duplicate always carries the SAME owners on both scopes. A basename shared
  // by coincidence does not: another profile's freeform `trackedProcessPaths`
  // entry can happen to be called the same thing. Collapsing that would delete a
  // target this profile really configured, leaving the survivor looking uniquely
  // owned by a profile that never enabled the utility -- #772 reintroduced --
  // and dropping the `/IM` coverage along with it.
  //
  // So a name target is only a duplicate if every profile that owns it also
  // owns a path target for the same process. Merging the owners instead would
  // fix the attribution but still lose that coverage.
  const pathTargetsByName = new Map<string, CompanionTarget[]>()
  companionTargets.forEach((target) => {
    if (target.scope !== 'path') {
      return
    }
    const existing = pathTargetsByName.get(target.processName)
    if (existing) {
      existing.push(target)
    } else {
      pathTargetsByName.set(target.processName, [target])
    }
  })
  companionTargets.forEach((target, key) => {
    if (target.scope !== 'name') {
      return
    }
    const pathTargets = pathTargetsByName.get(target.processName)
    if (!pathTargets) {
      return
    }
    const everyOwnerReachableByPath = target.gameKeys.every((owner) =>
      pathTargets.some((pathTarget) => pathTarget.gameKeys.includes(owner))
    )
    if (everyOwnerReachableByPath) {
      companionTargets.delete(key)
    }
  })

  return companionTargets
}

/**
 * Attach the stranded-consent-prompt count to a kill result (#809).
 *
 * A COUNT, not a sentence. Pre-baking the copy into `message` looked simpler
 * and was wrong: the profile-switch flow discards `message` entirely and the
 * renderer ignores it on a failed kill, so the explanation was produced
 * correctly and never shown. The renderer composes the wording, next to
 * `formatKillFailures` and `formatSkippedLaunchEntries`.
 *
 * Drained in each entry point's PROLOGUE, not here: `abortActiveLaunches` and
 * `cancelPendingElevatedHandoffs` both run synchronously before any await, so
 * taking the count there attributes it to the kill that caused it even when a
 * second kill overlaps this one's async work.
 */
function withStrandedConsentPrompts(result: KillResult, strandedPromptCount: number): KillResult {
  return strandedPromptCount > 0
    ? { ...result, strandedConsentPrompts: strandedPromptCount }
    : result
}

/**
 * The opt-in graceful phase (#659): ask everything we are about to close to
 * close itself, then wait once, then let the caller force-kill whatever is left.
 *
 * There is deliberately NO re-check of who survived. The force kill IS the
 * re-check: `taskkill` on a process that already exited reports `notFound`,
 * which the existing accounting already treats as closed rather than failed. A
 * separate survivor scan would add a TOCTOU window (exit between scan and kill)
 * and, if it used the name-scoped `readRunningProcessNames`, would answer wrong
 * for two same-named exes at different paths, which is the class #772 and #674
 * are about.
 *
 * NOT used by `killProfileApps`. A profile switch already contains close-then-
 * relaunch pairs today: identity is `{key, path}` (`ipc/launch.ts:31`) while
 * `appArgs` is global per slot key, so moving one exe between slots stops and
 * restarts it (`ipc/launch.ts:283-290`). Waiting politely for an app that is
 * about to be started again is latency spent on nothing, and it would put a new
 * timing phase into the handler #715 and #782 are about to restructure.
 */
async function requestGracefulCloseForTargets(
  trackedChildren: ChildProcess[],
  pathTargets: { processName: string; appPath: string }[]
): Promise<void> {
  // Each path target is asked the moment ITS OWN lookup resolves, never after
  // the slowest one. Every WMI query is bounded by WMI_LOOKUP_TIMEOUT_MS, so
  // collecting all the results first left an already-discovered PID unsignalled
  // for up to that long, and a number that stale may no longer mean the same
  // process: if that companion exited on its own in the gap, Windows can hand
  // its number to something we never launched, and `/T` would take that
  // stranger's whole tree (Codex on #823). A raw PID carries no way to notice,
  // so the only defence is to not hold it.
  const askedByPath = await Promise.all(
    pathTargets.map(async ({ processName, appPath }) => {
      const { processIds } = await findProcessIdsByExecutablePath(processName, appPath)
      if (processIds.length === 0) {
        return false
      }
      await requestGracefulClose(processIds)
      return true
    })
  )

  // A tracked child is the one thing that may be held across the lookups, for
  // the same reason: we keep the ChildProcess, not the number, so the wait buys
  // fresher evidence instead of decaying it. The liveness check therefore sits
  // HERE, after the lookups, and a child that died while they were in flight is
  // dropped rather than signalled by a number it no longer owns.
  const trackedPids = trackedChildren
    .filter((child) => !hasChildExited(child))
    .map((child) => child.pid)
    .filter((pid): pid is number => typeof pid === 'number')

  if (trackedPids.length > 0) {
    await requestGracefulClose(trackedPids)
  }

  // Nothing answered, so there is nothing to wait for. Skipping the window here
  // keeps "close with nothing running" instant even with the toggle on.
  if (trackedPids.length === 0 && !askedByPath.some(Boolean)) {
    return
  }

  await wait(GRACEFUL_CLOSE_WINDOW_MS)
}

export async function killLaunchedApps(gameKey?: string): Promise<KillResult> {
  // Cancel any in-flight launchProfileApps sequence for this gameKey (or all
  // of them, for the gameKey-less tray/global kill) before touching the
  // process list — otherwise the launch loop can spawn its next queued app
  // during or after this kill (#670).
  abortActiveLaunches(gameKey)
  // A UAC handoff whose grace window expired outlives its sequence's controller
  // (#675), so aborting is not enough: kill the still-live PowerShell host too,
  // or approving the prompt afterwards starts an app the user just closed
  // (Codex P1 on #779).
  //
  // Tracked handoffs only. This is the "close everything I manage" action, and a
  // fire-and-forget profile (#591) has opted its apps out of being managed, so
  // killing the host would strand a prompt the user was still entitled to
  // answer. The exclusion is HERE rather than at registration because the other
  // consumers, the profile switch and the config import, want the opposite:
  // those are profile-departure events, and fire-and-forget protects a running
  // app from being closed, not a departed profile from being finished with
  // (Codex P2 on #842).
  //
  // Read LIVE from the active profile, not from anything stored on the handoff.
  // A prompt can sit unanswered across any number of toggles in both directions,
  // and a recorded flag only gets refreshed by whatever pass thinks to refresh
  // it -- the version that stored it was updated by the untracked reconcile,
  // which only ever sees the untracked set, so turning tracking back ON never
  // restored it and Close Apps ignored the handoff forever. The current profile
  // is the answer to "does the user manage this?" by definition.
  cancelPendingElevatedHandoffs(gameKey, (handoff) => isHandoffProfileTracked(handoff.gameKey))
  const strandedPromptCount = drainStrandedConsentPrompts()

  const { processNames } = await readRunningProcessNames()
  const gameExePaths = getConfiguredGameExePaths()
  const companionTargets = getProfileCompanionTargets(gameKey)
  // Thunks, not promises. A `killProcessTree(...)` expression starts the kill
  // the moment it is evaluated, so building the list eagerly would force-kill
  // everything before the graceful phase below ever ran (#659). Nothing starts
  // until these are called.
  const killTasks: (() => Promise<KillAttemptResult>)[] = []
  const gracefulChildren: ChildProcess[] = []
  const gracefulPathTargets: { processName: string; appPath: string }[] = []

  runningProcesses.forEach((appProcess, runningKey) => {
    const { process: child, path: appPath } = appProcess
    if (gameKey && appProcess.gameKey !== gameKey) {
      return
    }
    // Never terminate a configured game. The isGame flag alone is not enough:
    // the same exe launched under a non-owning profile is recorded isGame=false,
    // so the all-profiles close would otherwise kill it (#519).
    if (appProcess.isGame || gameExePaths.has(normalizePathForComparison(appPath))) {
      return
    }

    const processName = getExeName(appPath)
    // This process is about to be tree-killed, so drop the companion targets that
    // would hit it again: its own path, and the curated image-name entry, whose
    // `taskkill /IM` would cover it by name. A same-named companion at a
    // DIFFERENT path is deliberately left alone now that paths are keyed by path
    // rather than by basename — it is a separate process and still needs closing.
    companionTargets.delete(companionTargetPathKey(appPath))
    companionTargets.delete(companionTargetNameKey(processName))

    if (processNames.has(processName)) {
      suppressProcessNameMismatchWarning(appPath)
      gracefulChildren.push(child)
      killTasks.push(() => killProcessTree(child, appPath, appProcess.gameKey))
    } else {
      runningProcesses.delete(runningKey)
    }
  })

  companionTargets.forEach((target) => {
    if (processNames.has(target.processName)) {
      // Only a full path can be asked to close politely. A bare-name target
      // would have to go through `/IM`, which is not path-scoped, and asking
      // every same-named process to close would break the same guarantee the
      // force kill upholds.
      if (isFullExePath(target.appPath)) {
        gracefulPathTargets.push({ processName: target.processName, appPath: target.appPath })
      }
      killTasks.push(() =>
        killProcessByImageName(
          target.processName,
          target.appPath,
          resolveCompanionTargetGameKey(target)
        )
      )
    }
  })

  // Ask first, then force. Only ever from here: `killProfileApps` (the profile
  // switch) deliberately does not opt in, see requestGracefulCloseForTargets.
  if (getStoredBoolean('gracefulCloseEnabled')) {
    await requestGracefulCloseForTargets(gracefulChildren, gracefulPathTargets)
  }

  const result = await finalizeKillAttempts(
    await Promise.all(killTasks.map((startKill) => startKill())),
    gameKey
  )
  await publishRunningApps('kill')
  return withStrandedConsentPrompts(result, strandedPromptCount)
}

/**
 * Whether killLaunchedApps(gameKey) currently has at least one target it would
 * try to close: a tracked non-game process whose exe is running, or a configured
 * / hardcoded companion whose process is running.
 *
 * NOT currently called from production. It was written for a tray "Close Apps"
 * item whose enabled state was cached and kept fresh by listeners; that design
 * was replaced by an always-enabled item, and the re-land in #519 does not use a
 * pre-check at all, because deciding "nothing to close" before reaching
 * killLaunchedApps skips the abort/cancel prologue and lets an in-flight launch
 * carry on (Codex P1 on #819). Kept because #673 plans to expose it over IPC for
 * the missing Close Apps affordance after a restart. If that changes, delete it
 * rather than leaving it to look load-bearing again.
 *
 * KEEP IN SYNC with killLaunchedApps above — the two membership conditions here
 * mirror its two kill-task branches. Deliberately NOT derived from
 * getRunningApps(): that list gates companions on the owning game being launched
 * or adopted, while killLaunchedApps closes configured companions regardless, so
 * the surfaced list would under-report closable targets.
 *
 * One deliberate asymmetry with killLaunchedApps, and it is not drift: this
 * verifies a candidate against its PATH (#674) where the scheduling there stays
 * name-gated. The two answer different questions. Scheduling a kill for a path
 * nothing is running at costs a lookup and nothing else, because the kill is
 * path-scoped and finalizeKillAttempts now judges the empty result correctly.
 * Telling the user there is something to close when there is not is the defect
 * this function would otherwise ship to #673, so it pays for the enumeration and
 * the scheduling does not.
 *
 * On-demand only. This is one PowerShell spawn in the collision case, which is
 * fine for a click and is not fine on the running-apps poll — do not call it
 * from a timer.
 */
export async function hasClosableLaunchedApps(gameKey?: string): Promise<boolean> {
  const { processNames } = await readRunningProcessNames()
  const gameExePaths = getConfiguredGameExePaths()

  const candidatePaths: string[] = []
  for (const appProcess of runningProcesses.values()) {
    if (gameKey && appProcess.gameKey !== gameKey) {
      continue
    }
    if (appProcess.isGame || gameExePaths.has(normalizePathForComparison(appProcess.path))) {
      continue
    }
    candidatePaths.push(appProcess.path)
  }

  const companionTargets = getProfileCompanionTargets(gameKey)
  for (const target of companionTargets.values()) {
    // A curated name-scoped target has no path to verify against, so it keeps
    // the name-only answer. That is not a gap being tolerated: `/IM` is how such
    // a target would be closed too, so name membership is exactly the condition
    // under which closing it would do something.
    if (target.scope === 'name') {
      if (processNames.has(target.processName)) {
        return true
      }
      continue
    }
    candidatePaths.push(target.appPath)
  }

  if (candidatePaths.length === 0) {
    return false
  }

  // One enumeration for both branches, and none at all unless some candidate's
  // image is actually in the tasklist.
  const runningPaths = await resolveRunningConfiguredPaths(processNames, candidatePaths)
  return candidatePaths.some((candidatePath) => runningPaths.has(candidatePath))
}

/**
 * Stops the apps a profile switch is leaving behind.
 *
 * Takes ENTRIES rather than paths, and that is load-bearing rather than
 * cosmetic. The kill itself only ever needs paths: two slots pointing at one exe
 * (#357) are a single target to a process killer, and stopping the exe stops it
 * for both. But this call also cancels pending elevated handoffs, and a pending
 * handoff has never started, so it is not a process at all -- it is a registry
 * entry that knows exactly which slot it belongs to. Narrowing that by path
 * cancels the retained slot's consent prompt alongside the leaving one, which is
 * the same over-cancel #782 exists to remove (Codex P2 on #842).
 *
 * The caller is the only party that knows which SLOTS are stopping, so the
 * signature takes what it has instead of letting it flatten the identity away
 * and leaving this function to guess.
 */
export async function killProfileApps(
  gameKey: string,
  entriesToKill: ProfileLaunchEntry[],
  options?: KillProfileAppsOptions
): Promise<KillResult> {
  const appPathsToKill = entriesToKill.map((entry) => entry.path)
  const gamePaths = getStoredStringRecord('gamePaths')
  const gamePath = gamePaths?.[gameKey]
  const storedAppPathTargets = getStoredAppPathTargets()
  const validAppPathsToKill: string[] = []
  const killTasks: Promise<KillAttemptResult>[] = []
  const killedExeNames = new Set<string>()

  // Validate the entire list before acting on any of it. An all-or-nothing
  // check avoids a partial kill where some apps close and others are rejected,
  // which would leave the profile in an inconsistent half-closed state.
  for (const appPath of appPathsToKill) {
    if (
      !isValidExePath(appPath) ||
      !storedAppPathTargets.has(normalizePathForComparison(appPath))
    ) {
      return {
        success: false,
        error: 'Kill request includes an app path that is not configured.',
        closedCount: 0,
        failedCount: 0,
        failures: []
      }
    }

    validAppPathsToKill.push(appPath)
  }

  // Cancel any in-flight launchProfileApps sequence for this gameKey before
  // doing kill work, same reasoning as killLaunchedApps above (#670). Placed
  // after the synchronous validation so a rejected (not-configured-path)
  // request doesn't cancel a legitimate in-flight launch as a side effect —
  // but BEFORE the tasklist scan below: that await can be slow, and a launch
  // loop sitting in a short inter-app wait could otherwise spawn its next app
  // before the abort lands, leaving it running past this kill's snapshot.
  //
  // `options.except` is set by switch-profile-apps (#716): that handler
  // registers its own controller before calling this to kill the outgoing
  // profile's apps, and must not have that same call self-abort the switch
  // it is in the middle of performing. A real Close Apps click never passes
  // `except`, so it still cancels a switch's launch as before.
  abortActiveLaunches(gameKey, options)
  // Same reason as killLaunchedApps: a timed-out handoff is not reachable
  // through the abort signal once its sequence ended (#779 Codex P1). And the
  // same consequence: each one killed leaves its consent prompt behind (#809).
  //
  // Scoped to what this call is actually stopping, unlike killLaunchedApps which
  // really does mean the whole game. This one is a SUBSET operation: a profile
  // switch stopping one app was cancelling every pending handoff for the game,
  // including one for an app both profiles enable and that the switch was never
  // going to touch (#782).
  //
  // Matched by SLOT KEY, and only entries that survived validation are eligible:
  // a path this call refused to kill has no business cancelling anything.
  //
  // The key alone, not key plus path. Two slots can share an exe with different
  // args (#357), so a path match kills the retained slot's prompt alongside the
  // leaving one, and the key is what tells them apart. Adding the path on top
  // then breaks it the other way: the registry's path is a launch-time snapshot
  // while these entries carry the CURRENT `appPaths`, so editing that slot's exe
  // in Settings while a prompt is unanswered makes the two disagree and the
  // handoff survives the switch away from it (Codex P2 on #842). The key does
  // not move.
  const validPaths = new Set(validAppPathsToKill.map(normalizePathForComparison))
  const keysBeingKilled = new Set(
    entriesToKill
      .filter((entry) => validPaths.has(normalizePathForComparison(entry.path)))
      .map((entry) => entry.key)
  )
  cancelPendingElevatedHandoffs(
    gameKey,
    (handoff) => handoff.appKey !== undefined && keysBeingKilled.has(handoff.appKey)
  )
  const strandedPromptCount = drainStrandedConsentPrompts()

  const { processNames } = await readRunningProcessNames()

  // First pass: prefer killing via the ChildProcess handle (PID-based /T /F
  // tree kill) for apps that SimLauncher itself spawned and still owns. This
  // is more precise than image-name matching and correctly terminates child
  // processes the app may have spawned.
  validAppPathsToKill.forEach((appPath) => {
    if (gamePath && pathsEqual(appPath, gamePath)) {
      return
    }
    if (!processNames.has(getExeName(appPath))) {
      return
    }

    const runningApp = runningProcesses.get(normalizePathForComparison(appPath))

    if (runningApp && runningApp.gameKey === gameKey && !runningApp.isGame) {
      suppressProcessNameMismatchWarning(appPath)
      killTasks.push(killProcessTree(runningApp.process, appPath, runningApp.gameKey))
      killedExeNames.add(getExeName(appPath))
      return
    }
  })

  // Second pass: fall back to WMI path-scoped image-name kill for apps that
  // are running but were not launched by this SimLauncher session (externally
  // started or session-restored). `killedExeNames` prevents double-killing an
  // exe that was already handled in the first pass.
  validAppPathsToKill.forEach((appPath) => {
    if (gamePath && pathsEqual(appPath, gamePath)) {
      return
    }

    const processName = getExeName(appPath)

    if (!killedExeNames.has(processName) && processNames.has(processName)) {
      killTasks.push(killProcessByImageName(processName, appPath, gameKey))
      killedExeNames.add(processName)
    }
  })

  const result = await finalizeKillAttempts(await Promise.all(killTasks), gameKey)
  await publishRunningApps('kill')
  return withStrandedConsentPrompts(result, strandedPromptCount)
}
