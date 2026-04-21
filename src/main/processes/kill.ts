import { execFile, type ChildProcess } from 'child_process'
import path from 'path'

import {
  StoredProfileEntry,
  getActiveStoredProfile,
  getProfileTrackablePaths,
  isUtilityEnabled
} from '../profiles'
import { store } from '../store'
import { getErrorMessage, getExeName, isValidExePath } from '../utils'

import { runningProcesses, unclosedProcesses } from './state'
import { readRunningProcessNames } from './tasklist'
import type { KillResult } from './types'

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

export function pruneUnclosedProcesses(processNames: Set<string>) {
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
