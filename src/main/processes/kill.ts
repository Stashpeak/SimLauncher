import { execFile, type ChildProcess } from 'child_process'
import path from 'path'

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
  processNameMismatchWarnings,
  runningProcesses,
  suppressProcessNameMismatchWarning,
  unclosedProcesses,
  getUnclosedProcessKey
} from './state'
import { publishRunningApps } from './running'
import { invalidateProcessNameCache, readRunningProcessNames } from './tasklist'
import type { KillFailure, KillFailureReason, KillResult } from './types'

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
      staleTask: result.staleTask
    }
  }

  try {
    child.kill()
    return { processName, appPath, gameKey, success: true }
  } catch (err) {
    const error = getErrorMessage(err)
    console.error(`Error killing ${appPath}:`, err)
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
      staleTask: results.every((result) => result.staleTask)
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
    staleTask: result.staleTask
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

      let stillRunning: boolean
      let isElevatedInconclusive = false
      if (isFullExePath(attempt.appPath)) {
        const { processIds } = await findProcessIdsByExecutablePath(
          attempt.processName,
          attempt.appPath
        )
        // When the post-kill tasklist read failed, treat any unverified
        // "process gone" signal as inconclusive rather than success: a
        // notFound result from WMI/taskkill could mean either truly exited
        // or elevated-invisible, and the empty processNamesAfterKill Set
        // can't distinguish them. Same for the access-denied recheck.
        isElevatedInconclusive =
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
    runningProcesses.forEach((appProcess, runningKey) => {
      if (
        (attemptKey && runningKey === attemptKey) ||
        getExeName(appProcess.path) === attempt.processName
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
  const closedCount = finalizedAttempts.length - failedAttempts.length
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

function getProfileCompanionTargets(gameKey?: string) {
  const profiles = getStoredProfiles()
  const gamePaths = getStoredStringRecord('gamePaths')
  const appPaths = getStoredStringRecord('appPaths')
  const companionTargets = new Map<
    string,
    { processName: string; appPath: string; gameKey: string }
  >()

  // A game executable must NEVER be a companion kill target — not even when it is
  // configured as a tracked/utility process in a DIFFERENT profile. The no-arg
  // tray "Close Apps" scans every profile, so excluding only the scanned
  // profile's own game exe is not enough: game A could be reached as a companion
  // of profile B and killed despite the confirmation promising the game is safe
  // (#519). getExeName lowercases, matching the keys used below.
  const gameExeNames = new Set<string>()
  Object.values(gamePaths || {}).forEach((gamePath) => {
    if (isValidExePath(gamePath)) {
      gameExeNames.add(getExeName(gamePath))
    }
  })

  Object.entries(profiles || {}).forEach(([profileGameKey, profileEntry]) => {
    if (gameKey && profileGameKey !== gameKey) {
      return
    }

    const profile = getActiveStoredProfile(profileEntry)

    Object.entries(UTILITY_COMPANION_PROCESS_NAMES).forEach(([utilityKey, processNames]) => {
      if (isUtilityEnabled(profile, utilityKey)) {
        processNames.forEach((processName) => {
          const normalizedProcessName = processName.toLowerCase()
          if (gameExeNames.has(normalizedProcessName)) {
            return
          }
          companionTargets.set(normalizedProcessName, {
            processName: normalizedProcessName,
            appPath: processName,
            gameKey: profileGameKey
          })
        })
      }
    })

    getProfileTrackablePaths(profileGameKey, profile, appPaths, gamePaths).forEach(
      (processPath) => {
        const processName = getExeName(processPath)
        if (gameExeNames.has(processName)) {
          return
        }
        companionTargets.set(processName, {
          processName,
          appPath: processPath,
          gameKey: profileGameKey
        })
      }
    )
  })

  return companionTargets
}

export async function killLaunchedApps(gameKey?: string): Promise<KillResult> {
  const { processNames } = await readRunningProcessNames()
  const companionTargets = getProfileCompanionTargets(gameKey)
  const killTasks: Promise<KillAttemptResult>[] = []

  runningProcesses.forEach((appProcess, runningKey) => {
    const { process: child, path: appPath } = appProcess
    if (gameKey && appProcess.gameKey !== gameKey) {
      return
    }
    if (appProcess.isGame) {
      return
    }

    const processName = getExeName(appPath)
    companionTargets.delete(processName)

    if (processNames.has(processName)) {
      suppressProcessNameMismatchWarning(appPath)
      killTasks.push(killProcessTree(child, appPath, appProcess.gameKey))
    } else {
      runningProcesses.delete(runningKey)
    }
  })

  companionTargets.forEach((target) => {
    if (processNames.has(target.processName)) {
      killTasks.push(killProcessByImageName(target.processName, target.appPath, target.gameKey))
    }
  })

  const result = await finalizeKillAttempts(await Promise.all(killTasks), gameKey)
  await publishRunningApps('kill')
  return result
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

  for (const appProcess of runningProcesses.values()) {
    if (gameKey && appProcess.gameKey !== gameKey) {
      continue
    }
    if (appProcess.isGame) {
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
  appPathsToKill: string[]
): Promise<KillResult> {
  const { processNames } = await readRunningProcessNames()
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
  return result
}
