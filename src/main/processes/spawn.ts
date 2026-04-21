import { execFile, spawn } from 'child_process'
import type { WebContents } from 'electron'
import fs from 'fs'
import path from 'path'

import { store } from '../store'
import { getErrorCode, getErrorMessage, getExeName, isValidExePath, wait } from '../utils'

import { runningProcesses } from './state'
import { readRunningProcessNames } from './tasklist'
import type { AppLaunchResult, LaunchResult } from './types'

const activeLaunches = new Set<string>()
const POST_LAUNCH_BLOCK_MS = 10000
let launchBlockedUntil = 0

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
