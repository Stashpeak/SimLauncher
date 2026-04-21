import { execFile, spawn, type ChildProcess } from 'child_process'
import type { WebContents } from 'electron'
import fs from 'fs'
import path from 'path'

import {
  StoredProfileEntry,
  getActiveStoredProfile,
  getProfileTrackablePaths,
  isUtilityEnabled
} from './profiles'
import { store } from './store'
import { getErrorCode, getErrorMessage, getExeName, isValidExePath, wait } from './utils'

export interface LaunchResult {
  success: boolean
  message?: string
  warning?: string
  error?: string
  launchedCount?: number
  skippedCount?: number
  elevatedCount?: number
  failedCount?: number
}

interface KillAttemptResult {
  processName: string
  success: boolean
  appPath?: string
  gameKey?: string
  error?: string
  accessDenied?: boolean
  notFound?: boolean
  stillRunning?: boolean
}

export interface KillResult {
  success: boolean
  message?: string
  warning?: string
  error?: string
  closedCount: number
  failedCount: number
}

type AppLaunchResult =
  | { status: 'launched'; appPath: string }
  | { status: 'elevated'; appPath: string; warning: string }
  | { status: 'failed'; appPath: string; error: string }

const runningProcesses = new Map<
  string,
  { process: ChildProcess; name: string; gameKey: string; isGame: boolean }
>()
const unclosedProcesses = new Map<
  string,
  { path: string; name: string; gameKey: string; error: string }
>()
const activeLaunches = new Set<string>()
const POST_LAUNCH_BLOCK_MS = 10000
let launchBlockedUntil = 0
const UTILITY_COMPANION_PROCESS_NAMES: Record<string, string[]> = {
  garage61: ['Garage61 telemetry agent.exe']
}

function isAccessDeniedMessage(message: string) {
  return /access is denied/i.test(message)
}

function isNotFoundMessage(message: string) {
  return /not found/i.test(message)
}

function runTaskkill(args: string[], description: string) {
  return new Promise<{
    success: boolean
    detail?: string
    accessDenied?: boolean
    notFound?: boolean
  }>((resolve) => {
    execFile('taskkill', args, { windowsHide: true }, (error, stdout, stderr) => {
      if (!error) {
        resolve({ success: true })
        return
      }

      const detail = stderr.trim() || stdout.trim() || error.message
      const notFound = isNotFoundMessage(detail)
      const accessDenied = isAccessDeniedMessage(detail)

      if (!notFound) {
        console.error(`Failed to ${description}: ${detail}`)
      }

      resolve({
        success: notFound,
        detail,
        accessDenied,
        notFound
      })
    })
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
      notFound: result.notFound
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
    notFound: result.notFound
  }
}

function getUnclosedProcessKey(gameKey: string | undefined, appPath: string, processName: string) {
  return `${gameKey || 'unknown'}:${(appPath || processName).toLowerCase()}`
}

function clearUnclosedProcess(
  gameKey: string | undefined,
  appPath: string | undefined,
  processName: string
) {
  unclosedProcesses.delete(getUnclosedProcessKey(gameKey, appPath || processName, processName))
}

function registerUnclosedProcess(attempt: KillAttemptResult) {
  const appPath = attempt.appPath || attempt.processName
  const gameKey = attempt.gameKey || ''
  const error =
    attempt.error ||
    (attempt.accessDenied
      ? 'Windows denied permission to close this app.'
      : 'The app is still running after the close request.')

  unclosedProcesses.set(getUnclosedProcessKey(gameKey, appPath, attempt.processName), {
    path: appPath,
    name: path.basename(appPath),
    gameKey,
    error
  })
}

function pruneUnclosedProcesses(processNames: Set<string>) {
  unclosedProcesses.forEach((entry, key) => {
    if (!processNames.has(getExeName(entry.path))) {
      unclosedProcesses.delete(key)
    }
  })
}

function normalizePathForComparison(appPath: string) {
  return path.resolve(appPath.trim()).toLowerCase()
}

function getStoredAppPathTargets() {
  const storedAppPaths = store.get('appPaths') as Record<string, string> | undefined

  return new Set(
    Object.values(storedAppPaths || {})
      .filter(
        (appPath): appPath is string => typeof appPath === 'string' && appPath.trim().length > 0
      )
      .map(normalizePathForComparison)
  )
}

function formatKillWarning(failedAttempts: KillAttemptResult[]) {
  if (failedAttempts.length === 0) {
    return undefined
  }

  const first = failedAttempts[0]
  const appName = path.basename(first.appPath || first.processName)

  if (failedAttempts.length === 1) {
    return first.accessDenied
      ? `${appName} is still running because Windows denied permission to close it.`
      : `${appName} could not be closed and is still running.`
  }

  return `${failedAttempts.length} apps could not be closed and are still running.`
}

async function finalizeKillAttempts(attempts: KillAttemptResult[]): Promise<KillResult> {
  if (attempts.length === 0) {
    return {
      success: true,
      message: 'No running companion apps to close.',
      closedCount: 0,
      failedCount: 0
    }
  }

  const processNamesAfterKill = await readRunningProcessNames()
  const finalizedAttempts = attempts.map((attempt) => ({
    ...attempt,
    stillRunning: processNamesAfterKill.has(attempt.processName)
  }))

  finalizedAttempts.forEach((attempt) => {
    if (attempt.stillRunning) {
      registerUnclosedProcess(attempt)
      return
    }

    clearUnclosedProcess(attempt.gameKey, attempt.appPath, attempt.processName)
    runningProcesses.forEach((_appProcess, runningPath) => {
      if (
        (attempt.appPath && runningPath.toLowerCase() === attempt.appPath.toLowerCase()) ||
        getExeName(runningPath) === attempt.processName
      ) {
        runningProcesses.delete(runningPath)
      }
    })
  })

  const failedAttempts = finalizedAttempts.filter((attempt) => attempt.stillRunning)
  const closedCount = finalizedAttempts.length - failedAttempts.length
  const warning = formatKillWarning(failedAttempts)

  return {
    success: failedAttempts.length === 0,
    message:
      closedCount > 0
        ? `Closed ${closedCount} companion app${closedCount === 1 ? '' : 's'}.`
        : undefined,
    warning,
    error: warning,
    closedCount,
    failedCount: failedAttempts.length
  }
}

function getProfileCompanionTargets(gameKey?: string) {
  const profiles = store.get('profiles') as Record<string, StoredProfileEntry> | undefined
  const gamePaths = store.get('gamePaths') as Record<string, string> | undefined
  const appPaths = store.get('appPaths') as Record<string, string> | undefined
  const companionTargets = new Map<
    string,
    { processName: string; appPath: string; gameKey: string }
  >()

  Object.entries(profiles || {}).forEach(([profileGameKey, profileEntry]) => {
    if (gameKey && profileGameKey !== gameKey) {
      return
    }

    const profile = getActiveStoredProfile(profileEntry)
    const gameExeName = isValidExePath(gamePaths?.[profileGameKey])
      ? getExeName(gamePaths![profileGameKey])
      : null

    Object.entries(UTILITY_COMPANION_PROCESS_NAMES).forEach(([utilityKey, processNames]) => {
      if (isUtilityEnabled(profile, utilityKey)) {
        processNames.forEach((processName) => {
          const normalizedProcessName = processName.toLowerCase()
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
        if (processName !== gameExeName) {
          companionTargets.set(processName, {
            processName,
            appPath: processPath,
            gameKey: profileGameKey
          })
        }
      }
    )
  })

  return companionTargets
}

export async function killLaunchedApps(gameKey?: string) {
  const processNames = await readRunningProcessNames()
  const companionTargets = getProfileCompanionTargets(gameKey)
  const killTasks: Promise<KillAttemptResult>[] = []

  runningProcesses.forEach(({ process: child }, appPath) => {
    const appProcess = runningProcesses.get(appPath)
    if (gameKey && appProcess?.gameKey !== gameKey) {
      return
    }
    if (appProcess?.isGame) {
      return
    }

    const processName = getExeName(appPath)
    companionTargets.delete(processName)

    if (processNames.has(processName)) {
      killTasks.push(killProcessTree(child, appPath, appProcess?.gameKey))
    } else {
      runningProcesses.delete(appPath)
    }
  })

  companionTargets.forEach((target) => {
    if (processNames.has(target.processName)) {
      killTasks.push(killProcessByImageName(target.processName, target.appPath, target.gameKey))
    }
  })

  return finalizeKillAttempts(await Promise.all(killTasks))
}

export async function killProfileApps(gameKey: string, appPathsToKill: string[]) {
  const processNames = await readRunningProcessNames()
  const gamePaths = store.get('gamePaths') as Record<string, string> | undefined
  const gamePath = gamePaths?.[gameKey]?.toLowerCase()
  const storedAppPathTargets = getStoredAppPathTargets()
  const validAppPathsToKill: string[] = []
  const killTasks: Promise<KillAttemptResult>[] = []
  const killedExeNames = new Set<string>()

  for (const appPath of appPathsToKill) {
    if (
      !isValidExePath(appPath) ||
      !storedAppPathTargets.has(normalizePathForComparison(appPath))
    ) {
      return {
        success: false,
        error: 'Kill request includes an app path that is not configured.',
        closedCount: 0,
        failedCount: 0
      }
    }

    validAppPathsToKill.push(appPath)
  }

  validAppPathsToKill.forEach((appPath) => {
    if (gamePath && appPath.toLowerCase() === gamePath) {
      return
    }
    if (!processNames.has(getExeName(appPath))) {
      return
    }

    const runningAppEntry = Array.from(runningProcesses.entries()).find(
      ([runningPath, runningApp]) =>
        runningPath.toLowerCase() === appPath.toLowerCase() &&
        runningApp.gameKey === gameKey &&
        !runningApp.isGame
    )

    if (runningAppEntry) {
      const [_runningPath, runningApp] = runningAppEntry
      killTasks.push(killProcessTree(runningApp.process, appPath, runningApp.gameKey))
      killedExeNames.add(getExeName(appPath))
      return
    }
  })

  validAppPathsToKill.forEach((appPath) => {
    if (gamePath && appPath.toLowerCase() === gamePath) {
      return
    }

    const processName = getExeName(appPath)

    if (!killedExeNames.has(processName) && processNames.has(processName)) {
      killTasks.push(killProcessByImageName(processName, appPath, gameKey))
      killedExeNames.add(processName)
    }
  })

  return finalizeKillAttempts(await Promise.all(killTasks))
}

export async function launchProfileApps(
  sender: WebContents,
  gameKey: string,
  profileApps: string[]
): Promise<LaunchResult> {
  if (activeLaunches.size > 0) {
    return { success: false, error: 'Another profile is already launching.' }
  }

  const cooldownRemainingMs = launchBlockedUntil - Date.now()
  if (cooldownRemainingMs > 0) {
    return {
      success: false,
      error: `Launch is settling. Try again in ${Math.ceil(cooldownRemainingMs / 1000)}s.`
    }
  }

  activeLaunches.add(gameKey)
  const launchDelayMs = getLaunchDelayMs()
  const gamePaths = store.get('gamePaths') as Record<string, string> | undefined
  const gamePath = gamePaths?.[gameKey]?.toLowerCase()
  const processNames = await readRunningProcessNames()
  const validApps = profileApps.filter((appPath) => {
    if (!isValidExePath(appPath)) {
      console.error(`Skipping invalid path: ${appPath}`)
      return false
    }
    if (!fs.existsSync(appPath.trim())) {
      console.error(`Skipping missing executable: ${appPath}`)
      return false
    }
    return true
  })

  if (validApps.length === 0) {
    activeLaunches.delete(gameKey)
    return { success: false, error: 'No valid executable paths configured.' }
  }

  let launchedAny = false

  try {
    const appsToLaunch = validApps.filter((appPath) => !isRunningExePath(processNames, appPath))
    const skippedCount = validApps.length - appsToLaunch.length

    if (appsToLaunch.length === 0) {
      return {
        success: true,
        message: 'All profile applications are already running.',
        launchedCount: 0,
        skippedCount
      }
    }

    const launchResults: AppLaunchResult[] = []

    for (let index = 0; index < appsToLaunch.length; index += 1) {
      launchedAny = true
      launchResults.push(await spawnDetachedApp(sender, gameKey, appsToLaunch[index], gamePath))

      if (index < appsToLaunch.length - 1 && launchDelayMs > 0) {
        await wait(launchDelayMs)
      }
    }

    const elevatedResults = launchResults.filter(
      (result): result is Extract<AppLaunchResult, { status: 'elevated' }> =>
        result.status === 'elevated'
    )
    const failedResults = launchResults.filter(
      (result): result is Extract<AppLaunchResult, { status: 'failed' }> =>
        result.status === 'failed'
    )
    const launchedCount = launchResults.length - failedResults.length

    if (failedResults.length > 0) {
      const firstFailure = failedResults[0]
      const failedAppName = path.basename(firstFailure.appPath)

      return {
        success: false,
        error:
          failedResults.length === 1
            ? `Failed to launch ${failedAppName}: ${firstFailure.error}`
            : `Failed to launch ${failedResults.length} apps. First error: ${failedAppName}: ${firstFailure.error}`,
        launchedCount,
        skippedCount,
        elevatedCount: elevatedResults.length,
        failedCount: failedResults.length
      }
    }

    const elevatedWarning =
      elevatedResults.length === 1
        ? elevatedResults[0].warning
        : elevatedResults.length > 1
          ? `${elevatedResults.length} apps requested administrator permission. SimLauncher cannot track or close elevated apps after launch.`
          : undefined

    return {
      success: true,
      message:
        skippedCount > 0
          ? `Started ${launchedCount} app${launchedCount === 1 ? '' : 's'}; skipped ${skippedCount} already running.`
          : 'All profile applications launched.',
      warning: elevatedWarning,
      launchedCount,
      skippedCount,
      elevatedCount: elevatedResults.length
    }
  } finally {
    if (launchedAny) {
      launchBlockedUntil = Date.now() + POST_LAUNCH_BLOCK_MS
    }
    activeLaunches.delete(gameKey)
  }
}

function getLaunchDelayMs() {
  const value = store.get('launchDelayMs')

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 1000
  }

  return Math.min(Math.max(Math.round(value), 0), 5000)
}

export function isRunningExePath(processNames: Set<string>, appPath: string) {
  return processNames.has(getExeName(appPath))
}

function pruneStoppedRunningProcesses(processNames: Set<string>) {
  runningProcesses.forEach((_appProcess, appPath) => {
    if (!processNames.has(getExeName(appPath))) {
      runningProcesses.delete(appPath)
    }
  })
}

function sendLaunchError(sender: WebContents, appPath: string, error: string) {
  if (!sender.isDestroyed()) {
    sender.send('app-launch-error', { app: appPath, error })
  }
}

function isElevatedLaunchError(err: unknown) {
  return process.platform === 'win32' && getErrorCode(err) === 'EACCES'
}

function launchElevated(appPath: string) {
  return new Promise<AppLaunchResult>((resolve) => {
    const escapedAppPath = appPath.replace(/'/g, "''")

    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Start-Process -FilePath '${escapedAppPath}' -Verb RunAs`
      ],
      { windowsHide: true },
      (error) => {
        if (error) {
          const message = `Administrator permission was requested for ${path.basename(appPath)}, but Windows did not start it. ${getErrorMessage(error)}`
          console.error(`Error launching ${appPath} as administrator: ${getErrorMessage(error)}`)
          resolve({ status: 'failed', appPath, error: message })
          return
        }

        resolve({
          status: 'elevated',
          appPath,
          warning: `${path.basename(appPath)} requested administrator permission. SimLauncher cannot track or close elevated apps after launch.`
        })
      }
    )
  })
}

function spawnDetachedApp(
  sender: WebContents,
  gameKey: string,
  appPath: string,
  gamePath?: string
) {
  return new Promise<AppLaunchResult>((resolve) => {
    let settled = false
    let fallbackTimer: ReturnType<typeof setTimeout> | undefined

    const resolveOnce = (result: AppLaunchResult) => {
      if (!settled) {
        settled = true
        if (fallbackTimer) {
          clearTimeout(fallbackTimer)
        }
        resolve(result)
      }
    }

    try {
      const child = spawn(appPath, [], { detached: true, stdio: 'ignore' })
      runningProcesses.set(appPath, {
        process: child,
        name: path.basename(appPath),
        gameKey,
        isGame: !!gamePath && appPath.toLowerCase() === gamePath
      })

      child.once('spawn', () => {
        child.unref()
        resolveOnce({ status: 'launched', appPath })
      })

      child.once('error', async (err) => {
        runningProcesses.delete(appPath)
        if (fallbackTimer) {
          clearTimeout(fallbackTimer)
        }
        const message = getErrorMessage(err)
        console.error(`Error launching ${appPath}: ${message}`)

        if (settled) {
          sendLaunchError(sender, appPath, message)
          return
        }

        if (isElevatedLaunchError(err)) {
          resolveOnce(await launchElevated(appPath))
          return
        }

        resolveOnce({ status: 'failed', appPath, error: message })
      })

      child.once('exit', () => {
        runningProcesses.delete(appPath)
      })

      fallbackTimer = setTimeout(() => resolveOnce({ status: 'launched', appPath }), 500)
    } catch (err) {
      const message = getErrorMessage(err)
      console.error(`Error launching ${appPath}: ${message}`)

      if (isElevatedLaunchError(err)) {
        launchElevated(appPath).then(resolveOnce)
        return
      }

      resolveOnce({ status: 'failed', appPath, error: message })
    }
  })
}

export function readRunningProcessNames() {
  return new Promise<Set<string>>((resolve) => {
    execFile('tasklist', ['/fo', 'csv', '/nh'], { windowsHide: true }, (error, stdout) => {
      if (error) {
        console.error('Failed to read running processes:', error)
        resolve(new Set())
        return
      }

      const names = new Set<string>()
      stdout.split(/\r?\n/).forEach((line) => {
        const match = line.match(/^"([^"]+)"/)
        if (match) {
          names.add(match[1].toLowerCase())
        }
      })
      resolve(names)
    })
  })
}

function getExternallyAdoptableGameKeys(
  processNames: Set<string>,
  profiles: Record<string, StoredProfileEntry> | undefined,
  gamePaths: Record<string, string> | undefined,
  launchedGameKeys: Set<string>
) {
  const gameExeOwners = new Map<string, Set<string>>()

  Object.entries(profiles || {}).forEach(([gameKey]) => {
    const gamePath = gamePaths?.[gameKey]

    if (!isValidExePath(gamePath)) {
      return
    }

    const exeName = getExeName(gamePath)
    const owners = gameExeOwners.get(exeName) || new Set<string>()
    owners.add(gameKey)
    gameExeOwners.set(exeName, owners)
  })

  const adoptableGameKeys = new Set<string>()

  Object.entries(profiles || {}).forEach(([gameKey]) => {
    if (launchedGameKeys.has(gameKey)) {
      return
    }

    const gamePath = gamePaths?.[gameKey]

    if (!isValidExePath(gamePath)) {
      return
    }

    const exeName = getExeName(gamePath)
    const owners = gameExeOwners.get(exeName)

    if (owners?.size === 1 && processNames.has(exeName)) {
      adoptableGameKeys.add(gameKey)
    }
  })

  return adoptableGameKeys
}

// INVARIANT: manual companion utilities are only surfaced when the owning game is
// already launched by SimLauncher or its configured game exe is externally running.
async function getTrackedRunningApps(
  processNames: Set<string>,
  adoptedOrLaunchedGameKeys: Set<string>,
  profiles: Record<string, StoredProfileEntry> | undefined,
  appPaths: Record<string, string> | undefined,
  gamePaths: Record<string, string> | undefined
) {
  const trackedApps: { path: string; name: string; gameKey: string; tracked: boolean }[] = []
  const seen = new Set<string>()

  Object.entries(profiles || {}).forEach(([gameKey, profileEntry]) => {
    if (!adoptedOrLaunchedGameKeys.has(gameKey)) {
      return
    }

    const profile = getActiveStoredProfile(profileEntry)

    if (profile?.trackingEnabled === false) {
      return
    }

    const pathsToTrack = getProfileTrackablePaths(gameKey, profile, appPaths, gamePaths)

    pathsToTrack.forEach((trackedPath) => {
      const processName = getExeName(trackedPath)
      const dedupeKey = `${gameKey}:${trackedPath.toLowerCase()}`

      if (processNames.has(processName) && !seen.has(dedupeKey)) {
        trackedApps.push({
          path: trackedPath,
          name: path.basename(trackedPath),
          gameKey,
          tracked: true
        })
        seen.add(dedupeKey)
      }
    })
  })

  return trackedApps
}

export async function getRunningApps() {
  const processNames = await readRunningProcessNames()
  pruneStoppedRunningProcesses(processNames)
  pruneUnclosedProcesses(processNames)

  const launchedApps = Array.from(runningProcesses.entries()).map(([appPath, appProcess]) => ({
    path: appPath,
    name: appProcess.name,
    gameKey: appProcess.gameKey,
    tracked: false
  }))
  const unclosedApps = Array.from(unclosedProcesses.values())
    .filter((appProcess) => processNames.has(getExeName(appProcess.path)))
    .map((appProcess) => ({
      path: appProcess.path,
      name: appProcess.name,
      gameKey: appProcess.gameKey,
      tracked: true,
      warning: appProcess.error
    }))
  const surfacedApps = [...launchedApps, ...unclosedApps]
  const launchedKeys = new Set(
    surfacedApps.map((appProcess) => `${appProcess.gameKey}:${appProcess.path.toLowerCase()}`)
  )
  const launchedExeNames = new Set(
    surfacedApps.map((appProcess) => path.basename(appProcess.path).toLowerCase())
  )
  const profiles = store.get('profiles') as Record<string, StoredProfileEntry> | undefined
  const appPaths = store.get('appPaths') as Record<string, string> | undefined
  const gamePaths = store.get('gamePaths') as Record<string, string> | undefined
  const launchedGameKeys = new Set(surfacedApps.map((appProcess) => appProcess.gameKey))
  const adoptedGameKeys = getExternallyAdoptableGameKeys(
    processNames,
    profiles,
    gamePaths,
    launchedGameKeys
  )
  const adoptedOrLaunchedGameKeys = new Set([...launchedGameKeys, ...adoptedGameKeys])
  const trackedApps = (
    await getTrackedRunningApps(
      processNames,
      adoptedOrLaunchedGameKeys,
      profiles,
      appPaths,
      gamePaths
    )
  ).filter(
    (appProcess) =>
      !launchedKeys.has(`${appProcess.gameKey}:${appProcess.path.toLowerCase()}`) &&
      !launchedExeNames.has(path.basename(appProcess.path).toLowerCase())
  )

  return [...surfacedApps, ...trackedApps]
}
