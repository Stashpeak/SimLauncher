import { execFile, spawn } from 'child_process'
import type { WebContents } from 'electron'
import fs from 'fs'
import path from 'path'

import { getStoredStringRecord, store } from '../store'
import { getErrorCode, getErrorMessage, getExeName, isValidExePath, wait } from '../utils'

import {
  consumeProcessNameMismatchWarningSuppression,
  processNameMismatchWarnings,
  runningProcesses
} from './state'
import { invalidateProcessNameCache, readRunningProcessNames } from './tasklist'
import type { AppLaunchResult, LaunchResult, ProfileLaunchEntry, ProfileLaunchInput } from './types'
import { publishRunningApps } from './running'

const activeLaunches = new Set<string>()
const POST_LAUNCH_BLOCK_MS = 10000
const PROCESS_NAME_MISMATCH_WARNING_CHANNEL = 'process-name-mismatch-warning'
let launchBlockedUntil = 0

export async function launchProfileApps(
  sender: WebContents,
  gameKey: string,
  profileApps: ProfileLaunchInput[]
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
  const gamePaths = getStoredStringRecord('gamePaths')
  const gamePath = gamePaths?.[gameKey]?.toLowerCase()
  const { processNames } = await readRunningProcessNames()
  const normalizedEntries = profileApps.map((input) => normalizeLaunchInput(input, gameKey))
  const validApps = normalizedEntries.filter((entry) => {
    if (!isValidExePath(entry.path)) {
      console.error(`Skipping invalid path: ${entry.path}`)
      return false
    }
    if (!fs.existsSync(entry.path.trim())) {
      console.error(`Skipping missing executable: ${entry.path}`)
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
    const appsToLaunch = validApps.filter((entry) => !isRunningExePath(processNames, entry.path))
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

function parseCommandLineArgs(input: string) {
  const args: string[] = []
  let current = ''
  let inQuotes = false

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]
    const nextChar = input[index + 1]

    if (char === '\\' && nextChar === '"') {
      current += nextChar
      index += 1
      continue
    }

    if (char === '"') {
      inQuotes = !inQuotes
      continue
    }

    if (/\s/.test(char) && !inQuotes) {
      if (current.length > 0) {
        args.push(current)
        current = ''
      }
      continue
    }

    current += char
  }

  if (current.length > 0) {
    args.push(current)
  }

  return args
}

function getAppArgs(appKey: string) {
  const appArgs = getStoredStringRecord('appArgs')
  const args = appArgs[appKey]
  return typeof args === 'string' && args.trim().length > 0 ? parseCommandLineArgs(args) : []
}

function resolveAppKeyFromPath(appPath: string): string | undefined {
  const appPaths = getStoredStringRecord('appPaths')
  const normalizedAppPath = appPath.trim().toLowerCase()
  const appEntry = Object.entries(appPaths).find(
    ([, value]) => value.trim().toLowerCase() === normalizedAppPath
  )
  return appEntry?.[0]
}

function normalizeLaunchInput(input: ProfileLaunchInput, gameKey: string): ProfileLaunchEntry {
  if (typeof input !== 'string') {
    return { key: input.key, path: input.path }
  }

  const gamePaths = getStoredStringRecord('gamePaths')
  const matchingGamePath = gamePaths?.[gameKey]
  if (
    typeof matchingGamePath === 'string' &&
    matchingGamePath.trim().toLowerCase() === input.trim().toLowerCase()
  ) {
    return { key: gameKey, path: input }
  }

  // Legacy callers that supply plain paths fall back to a reverse lookup against
  // `appPaths`. New callers should pass {key, path} so the lookup is unambiguous
  // when two slots share an exe (#357).
  const resolvedKey = resolveAppKeyFromPath(input)
  return { key: resolvedKey ?? input, path: input }
}

function sendLaunchError(sender: WebContents, appPath: string, error: string) {
  if (!sender.isDestroyed()) {
    sender.send('app-launch-error', { app: appPath, error })
  }
}

function sendProcessNameMismatchWarning(sender: WebContents, appPath: string, warning: string) {
  if (!sender.isDestroyed()) {
    sender.send(PROCESS_NAME_MISMATCH_WARNING_CHANNEL, { app: appPath, warning })
  }
}

function isElevatedLaunchError(err: unknown) {
  return process.platform === 'win32' && getErrorCode(err) === 'EACCES'
}

function encodePowerShellCommand(command: string) {
  return Buffer.from(command, 'utf16le').toString('base64')
}

function createElevatedLaunchCommand(appPath: string, args: string[]) {
  const payload = JSON.stringify({ filePath: appPath, args })
  const startProcessCommand =
    args.length > 0
      ? 'Start-Process -FilePath $payload.filePath -ArgumentList $payload.args -Verb RunAs'
      : 'Start-Process -FilePath $payload.filePath -Verb RunAs'

  return encodePowerShellCommand(
    [
      "$ErrorActionPreference = 'Stop'",
      "$payload = ConvertFrom-Json @'",
      payload,
      "'@",
      startProcessCommand
    ].join('\n')
  )
}

function launchElevated(appPath: string, args: string[] = []) {
  return new Promise<AppLaunchResult>((resolve) => {
    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        createElevatedLaunchCommand(appPath, args)
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
  entry: ProfileLaunchEntry,
  gamePath?: string
) {
  const { path: appPath, key: appKey } = entry
  return new Promise<AppLaunchResult>((resolve) => {
    let settled = false
    let fallbackTimer: ReturnType<typeof setTimeout> | undefined
    const launchStartedAt = Date.now()

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
      const args = getAppArgs(appKey)
      const child = spawn(appPath, args, { detached: true, stdio: 'ignore' })
      runningProcesses.set(appPath, {
        process: child,
        name: path.basename(appPath),
        gameKey,
        isGame: !!gamePath && appPath.toLowerCase() === gamePath
      })

      child.once('spawn', () => {
        child.unref()
        invalidateProcessNameCache()
        publishRunningApps('launch').catch((err) => {
          console.error('Failed to publish running apps after launch:', err)
        })
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
          resolveOnce(await launchElevated(appPath, getAppArgs(appKey)))
          return
        }

        resolveOnce({ status: 'failed', appPath, error: message })
      })

      child.once('exit', () => {
        const processEntry = runningProcesses.get(appPath)
        const wasGame = processEntry?.isGame ?? false
        runningProcesses.delete(appPath)
        const exitedDuringPostLaunchWindow = Date.now() - launchStartedAt <= POST_LAUNCH_BLOCK_MS
        const wasClosedBySimLauncher = consumeProcessNameMismatchWarningSuppression(appPath)

        if (exitedDuringPostLaunchWindow && !wasClosedBySimLauncher) {
          const warning = `${path.basename(appPath)} exited shortly after launch. It likely spawned a child process under a different name — SimLauncher can no longer detect when you close it. To restore tracking, find the child process name in Task Manager and add that executable to this slot under tracked processes. Right-click the icon to dismiss this warning.`

          processNameMismatchWarnings.set(appPath.toLowerCase(), {
            path: appPath,
            name: path.basename(appPath),
            gameKey,
            warning
          })
          if (!wasGame) {
            sendProcessNameMismatchWarning(sender, appPath, warning)
          }
        }
        invalidateProcessNameCache()
        publishRunningApps('exit').catch((err) => {
          console.error('Failed to publish running apps after exit:', err)
        })
      })

      fallbackTimer = setTimeout(() => resolveOnce({ status: 'launched', appPath }), 500)
    } catch (err) {
      const message = getErrorMessage(err)
      console.error(`Error launching ${appPath}: ${message}`)

      if (isElevatedLaunchError(err)) {
        launchElevated(appPath, getAppArgs(appKey)).then(resolveOnce)
        return
      }

      resolveOnce({ status: 'failed', appPath, error: message })
    }
  })
}
