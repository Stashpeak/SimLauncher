import { execFile, type ChildProcess } from 'child_process'
import path from 'path'

import { writeAppErrorLog } from '../errorLog'
import {
  getActiveStoredProfile,
  getProfileTrackablePaths,
  getStoredProfiles,
  isUtilityEnabled
} from '../profiles'
import { getStoredStringRecord } from '../store'
import {
  getErrorMessage,
  getExeName,
  isValidExePath,
  normalizePathForComparison,
  pathsEqual
} from '../utils'

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
import type { KillFailure, KillFailureReason, KillProfileAppsOptions, KillResult } from './types'

// Generous for a healthy system (the query usually returns in tens of ms) but
// bounded so a wedged WMI service cannot hang a kill request forever.
const WMI_LOOKUP_TIMEOUT_MS = 3000

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

// Hardcoded list of companion process names for utilities that spawn background
// agents under a name that differs from (or is not derived from) their
// configured exe path, making normal path-based kill lookup insufficient.
// Utilities whose agent name can be derived from `appPaths` at runtime do not
// need an entry here.
const UTILITY_COMPANION_PROCESS_NAMES: Record<string, string[]> = {
  garage61: ['Garage61 telemetry agent.exe']
}

function isAccessDeniedMessage(message: string) {
  return /(access is denied|permission denied|administrator|elevat)/i.test(message)
}

function isNotFoundMessage(message: string) {
  return /not found|no running instance/i.test(message)
}

function isStaleTaskMessage(message: string) {
  return /no running instance/i.test(message)
}

function runTaskkill(args: string[], description: string) {
  return new Promise<{
    success: boolean
    detail?: string
    accessDenied?: boolean
    notFound?: boolean
    staleTask?: boolean
  }>((resolve) => {
    execFile('taskkill', args, { windowsHide: true }, (error, stdout, stderr) => {
      if (!error) {
        resolve({ success: true })
        return
      }

      const detail = stderr.trim() || stdout.trim() || error.message
      const notFound = isNotFoundMessage(detail)
      const staleTask = isStaleTaskMessage(detail)
      const accessDenied = isAccessDeniedMessage(detail)

      if (!notFound) {
        console.error(`Failed to ${description}: ${detail}`)
        writeAppErrorLog('kill', `Failed to ${description}: ${detail}`)
      }

      resolve({
        success: notFound,
        detail,
        accessDenied,
        notFound,
        staleTask
      })
    })
  })
}

/**
 * Guard that distinguishes a fully-qualified exe path (e.g.
 * `C:\Tools\app.exe`) from a bare process name (e.g. `app.exe`). Only full
 * paths are eligible for path-scoped kills via WMI `ExecutablePath` matching —
 * bare names fall back to the less precise `/IM` image-name kill to avoid
 * refusing to kill a process whose path we cannot verify.
 */
function isFullExePath(appPath: string | undefined): appPath is string {
  return (
    typeof appPath === 'string' && path.basename(appPath) !== appPath && isValidExePath(appPath)
  )
}

/**
 * True when `appPath` is a directory-qualified exe path (has a parent dir),
 * judged by SHAPE ALONE. Unlike {@link isFullExePath} it does NOT stat the
 * filesystem. Use this to decide whether basename fallback cleanup is allowed:
 * scoping must not depend on the exe still being present, or a full-path game
 * whose exe was removed or is momentarily inaccessible mid-close would fall back
 * to matching by image name and delete a DIFFERENT game's same-named companion
 * tracked at another path (#677).
 */
function isPathScopedExe(appPath: string | undefined): appPath is string {
  return typeof appPath === 'string' && path.basename(appPath) !== appPath
}

function parseProcessIds(output: string) {
  const trimmedOutput = output.trim()

  if (!trimmedOutput) {
    return []
  }

  try {
    const parsed = JSON.parse(trimmedOutput) as unknown
    const values = Array.isArray(parsed) ? parsed : [parsed]

    return values
      .map((value) => (typeof value === 'number' ? value : Number(value)))
      .filter((value) => Number.isSafeInteger(value) && value > 0)
  } catch {
    return trimmedOutput
      .split(/\r?\n/)
      .map((line) => Number(line.trim()))
      .filter((value) => Number.isSafeInteger(value) && value > 0)
  }
}

function findProcessIdsByExecutablePath(processName: string, appPath: string) {
  return new Promise<{
    processIds: number[]
    detail?: string
    accessDenied?: boolean
  }>((resolve) => {
    const script = [
      // Both the target path and the process name are injected via environment
      // variables rather than interpolated into the script string. This prevents
      // a value containing single-quotes or PowerShell metacharacters from
      // breaking out of a string literal or injecting arbitrary commands.
      '$target = $env:SIMLAUNCHER_TARGET_PROCESS_PATH',
      '$name = $env:SIMLAUNCHER_TARGET_PROCESS_NAME',
      '$targetPath = [System.IO.Path]::GetFullPath($target)',
      // Match the process name in PowerShell with -ieq rather than in a WQL
      // `Name = '...'` filter. WQL string-literal quote escaping is ambiguous and
      // version-dependent (SQL-style doubling vs backslash), and getting it wrong
      // silently breaks the lookup for exe names containing a single quote — the
      // exact case this guards (#531). Comparing $_.Name to the env-injected $name
      // in the host language sidesteps WQL escaping entirely and handles any
      // character. The (rare, user-initiated) full-process enumeration is bounded
      // by WMI_LOOKUP_TIMEOUT_MS; precision still comes from the ExecutablePath match.
      'Get-CimInstance Win32_Process |',
      '  Where-Object { $_.Name -ieq $name -and $_.ExecutablePath -and ([System.IO.Path]::GetFullPath($_.ExecutablePath) -ieq $targetPath) } |',
      '  Select-Object -ExpandProperty ProcessId |',
      '  ConvertTo-Json -Compress'
    ].join('\n')

    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      {
        windowsHide: true,
        // A hung or slow WMI query (slow disk, process-heavy system) must not
        // stall the kill pipeline indefinitely. On timeout this surfaces as a
        // clean kill failure — deliberately NOT a `taskkill /IM` fallback,
        // which would break the path-scoping safety guarantee and kill
        // same-named processes the user started outside SimLauncher (#503).
        timeout: WMI_LOOKUP_TIMEOUT_MS,
        env: {
          ...process.env,
          SIMLAUNCHER_TARGET_PROCESS_PATH: path.resolve(appPath),
          SIMLAUNCHER_TARGET_PROCESS_NAME: processName
        }
      },
      (error, stdout, stderr) => {
        if (error) {
          // execFile sets `killed` when it terminated the child itself —
          // with a plain timeout option that means the deadline elapsed.
          const detail = error.killed
            ? `Process lookup timed out after ${WMI_LOOKUP_TIMEOUT_MS / 1000} seconds.`
            : stderr.trim() || stdout.trim() || error.message
          console.error(`Failed to find process IDs for ${appPath}: ${detail}`)
          writeAppErrorLog('kill', `Failed to find process IDs for ${appPath}: ${detail}`)
          resolve({ processIds: [], detail, accessDenied: isAccessDeniedMessage(detail) })
          return
        }

        resolve({ processIds: parseProcessIds(stdout) })
      }
    )
  })
}

async function killProcessTree(
  child: ChildProcess,
  appPath: string,
  gameKey?: string
): Promise<KillAttemptResult> {
  const processName = getExeName(appPath)

  if (process.platform === 'win32' && child.pid) {
    const result = await runTaskkill(
      ['/PID', String(child.pid), '/T', '/F'],
      `kill process tree for ${appPath}`
    )
    return {
      processName,
      appPath,
      gameKey,
      success: result.success,
      error: result.detail,
      accessDenied: result.accessDenied,
      notFound: result.notFound,
      staleTask: result.staleTask,
      // A tracked child we hold a PID for was a real target unless taskkill
      // reports it had already exited.
      targetConfirmed: !result.notFound
    }
  }

  try {
    child.kill()
    return { processName, appPath, gameKey, success: true, targetConfirmed: true }
  } catch (err) {
    const error = getErrorMessage(err)
    console.error(`Error killing ${appPath}:`, err)
    writeAppErrorLog('kill', `Error killing ${appPath}: ${error}`)
    return {
      processName,
      appPath,
      gameKey,
      success: false,
      error,
      accessDenied: isAccessDeniedMessage(error)
    }
  }
}

async function killProcessByImageName(
  processName: string,
  appPath?: string,
  gameKey?: string
): Promise<KillAttemptResult> {
  if (process.platform !== 'win32') {
    return { processName, appPath, gameKey, success: true }
  }

  if (isFullExePath(appPath)) {
    const targetAppPath = appPath
    const { processIds, detail, accessDenied } = await findProcessIdsByExecutablePath(
      processName,
      targetAppPath
    )

    if (detail) {
      return {
        processName,
        appPath: targetAppPath,
        gameKey,
        success: false,
        error: detail,
        accessDenied
      }
    }

    if (processIds.length === 0) {
      // Elevated processes can expose null ExecutablePath in WMI, so they are silently
      // filtered out by the Where-Object clause; treat this as notFound rather than error.
      return { processName, appPath: targetAppPath, gameKey, success: true, notFound: true }
    }

    const results = await Promise.all(
      processIds.map((processId) =>
        runTaskkill(
          ['/PID', String(processId), '/T', '/F'],
          `kill companion process ${targetAppPath}`
        )
      )
    )
    const failedResult = results.find((result) => !result.success && !result.notFound)

    return {
      processName,
      appPath: targetAppPath,
      gameKey,
      success: !failedResult,
      error: failedResult?.detail,
      accessDenied: failedResult?.accessDenied,
      notFound: results.every((result) => result.notFound),
      staleTask: results.every((result) => result.staleTask),
      // PIDs were discovered at this exact path, so a process under this image
      // name demonstrably existed.
      targetConfirmed: true
    }
  }

  const result = await runTaskkill(
    ['/IM', processName, '/T', '/F'],
    `kill companion process ${processName}`
  )
  return {
    processName,
    appPath,
    gameKey,
    success: result.success,
    error: result.detail,
    accessDenied: result.accessDenied,
    notFound: result.notFound,
    staleTask: result.staleTask,
    // taskkill either killed something or was denied by something. Any other
    // failure is ambiguous, so it does not count as evidence.
    targetConfirmed: result.success || result.accessDenied === true
  }
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

  // Image names this batch found something real to kill under. Scheduling is
  // gated on the tasklist, which knows names and not paths, so once two profiles
  // can configure two same-named executables at different paths (#772) both get
  // scheduled even when only one of them is running.
  //
  // That matters because "0 PIDs at this path while the image is in the
  // tasklist" is otherwise read as an invisible elevated process (#390). Here
  // the image's presence is already accounted for by the sibling attempt that
  // did find PIDs, so inferring a hidden instance at a DIFFERENT path is
  // unjustified: it invented a leftover under a profile that had nothing
  // running, and counted an empty attempt as a closed app (Codex P1 on #818).
  //
  // Deliberately narrow. With no sibling to explain the image, the ambiguity is
  // real and stays unresolved; discriminating name from path in the general case
  // is #674.
  //
  // KNOWN RESIDUAL, recorded on #674: a sibling that found its target and closed
  // it successfully still counts as confirmation here, even though the image
  // surviving in the tasklist afterwards can only be something else -- possibly a
  // genuinely elevated-invisible process at this very path. Distinguishing the
  // two needs the post-kill state of each sibling, which is what #674 builds.
  // The trade is deliberate: the false positive this suppresses (a leftover
  // invented for a profile with nothing running) is #772's own symptom and far
  // likelier than the false negative it leaves.
  // Counted, not a Set, because the test is "did ANOTHER attempt confirm this
  // image". `targetConfirmed` and `notFound` can both hold on one attempt (PIDs
  // were discovered, then taskkill found them already gone), so membership alone
  // would let such an attempt vouch for itself.
  const confirmedTargetsByImage = new Map<string, number>()
  attempts.forEach((attempt) => {
    if (attempt.targetConfirmed) {
      confirmedTargetsByImage.set(
        attempt.processName,
        (confirmedTargetsByImage.get(attempt.processName) ?? 0) + 1
      )
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

      // This attempt found nothing at its own path, and another attempt in the
      // same batch did find the image elsewhere. So this path was never running:
      // not a failure to close, and not a close either.
      const siblingsWithConfirmedTarget =
        (confirmedTargetsByImage.get(attempt.processName) ?? 0) - (attempt.targetConfirmed ? 1 : 0)
      const isEmptySameNameTarget =
        isFullPathAttempt && attempt.notFound === true && siblingsWithConfirmedTarget > 0

      let stillRunning: boolean
      let isElevatedInconclusive = false
      if (isFullPathAttempt) {
        const { processIds } = await findProcessIdsByExecutablePath(attempt.processName, appPath)
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
              (processNamesAfterKill.has(attempt.processName) || !tasklistReadSucceeded)))
      } else {
        stillRunning = processNamesAfterKill.has(attempt.processName)
      }
      return {
        ...attempt,
        stillRunning,
        imageGoneFromTasklist,
        isEmptySameNameTarget,
        accessDenied: attempt.accessDenied || isElevatedInconclusive
      }
    })
  )

  finalizedAttempts.forEach((attempt) => {
    const failedToClose =
      attempt.stillRunning ||
      (!attempt.success && !attempt.notFound && !attempt.imageGoneFromTasklist)

    if (failedToClose) {
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

  const failedAttempts = finalizedAttempts.filter(
    (attempt) =>
      attempt.stillRunning ||
      (!attempt.success && !attempt.notFound && !attempt.imageGoneFromTasklist)
  )
  // An attempt that found nothing at its own path while a sibling accounted for
  // the image closed nothing, so it is neither a success nor a failure. Counting
  // it as closed reported one app as two.
  const emptySameNameTargets = finalizedAttempts.filter(
    (attempt) => attempt.isEmptySameNameTarget
  ).length
  const closedCount = finalizedAttempts.length - failedAttempts.length - emptySameNameTargets
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
  cancelPendingElevatedHandoffs(gameKey)
  const strandedPromptCount = drainStrandedConsentPrompts()

  const { processNames } = await readRunningProcessNames()
  const gameExePaths = getConfiguredGameExePaths()
  const companionTargets = getProfileCompanionTargets(gameKey)
  const killTasks: Promise<KillAttemptResult>[] = []

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
      killTasks.push(killProcessTree(child, appPath, appProcess.gameKey))
    } else {
      runningProcesses.delete(runningKey)
    }
  })

  companionTargets.forEach((target) => {
    if (processNames.has(target.processName)) {
      killTasks.push(
        killProcessByImageName(
          target.processName,
          target.appPath,
          resolveCompanionTargetGameKey(target)
        )
      )
    }
  })

  const result = await finalizeKillAttempts(await Promise.all(killTasks), gameKey)
  await publishRunningApps('kill')
  return withStrandedConsentPrompts(result, strandedPromptCount)
}

/**
 * Whether killLaunchedApps(gameKey) currently has at least one target it would
 * try to close: a tracked non-game process whose exe is running, or a configured
 * / hardcoded companion whose process is running. Drives the tray "Close Apps"
 * enabled state (#519).
 *
 * KEEP IN SYNC with killLaunchedApps above — the two membership conditions here
 * mirror its two kill-task branches. Deliberately NOT derived from
 * getRunningApps(): that list gates companions on the owning game being launched
 * or adopted, while killLaunchedApps closes configured companions regardless, so
 * the surfaced list would under-report closable targets.
 */
export async function hasClosableLaunchedApps(gameKey?: string): Promise<boolean> {
  const { processNames } = await readRunningProcessNames()
  const gameExePaths = getConfiguredGameExePaths()

  for (const appProcess of runningProcesses.values()) {
    if (gameKey && appProcess.gameKey !== gameKey) {
      continue
    }
    if (appProcess.isGame || gameExePaths.has(normalizePathForComparison(appProcess.path))) {
      continue
    }
    if (processNames.has(getExeName(appProcess.path))) {
      return true
    }
  }

  const companionTargets = getProfileCompanionTargets(gameKey)
  for (const target of companionTargets.values()) {
    if (processNames.has(target.processName)) {
      return true
    }
  }

  return false
}

export async function killProfileApps(
  gameKey: string,
  appPathsToKill: string[],
  options?: KillProfileAppsOptions
): Promise<KillResult> {
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
  cancelPendingElevatedHandoffs(gameKey)
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
