import { execFile, spawn } from 'child_process'
import type { WebContents } from 'electron'
import fs from 'fs'
import path from 'path'

import { getStoredStringRecord, store } from '../store'
import {
  getErrorCode,
  getErrorMessage,
  getExeName,
  isValidExePath,
  normalizePathForComparison,
  pathsEqual,
  wait
} from '../utils'

import {
  consumeProcessNameMismatchWarningSuppression,
  processNameMismatchWarnings,
  runningProcesses
} from './state'
import { isConsoleExecutable } from './subsystem'
import { invalidateProcessNameCache, readRunningProcessNames } from './tasklist'
import type { AppLaunchResult, LaunchResult, ProfileLaunchEntry, ProfileLaunchInput } from './types'
import { publishRunningApps } from './running'

const activeLaunches = new Set<string>()
// After a launch completes, block further launches for this window. Apps that
// self-relaunch under a different process name (the mismatch-warning scenario)
// can trigger a second fast-exit within a few seconds; the block prevents a
// race where the user clicks Launch again before the UI reflects the real state.
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
  const gamePath = gamePaths?.[gameKey]
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
          ? `${elevatedResults.length} apps requested administrator permission. SimLauncher will detect when they're running but cannot close them from here.`
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

// Exported for unit tests only — not part of the processes barrel surface.
export function getLaunchDelayMs(): number {
  const value = store.get('launchDelayMs')

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 1000
  }

  return Math.min(Math.max(Math.round(value), 0), 30000)
}

export function isRunningExePath(processNames: Set<string>, appPath: string): boolean {
  return processNames.has(getExeName(appPath))
}

/**
 * Parse a Windows-style command-line argument string into an argv array.
 *
 * We do not delegate to the shell (`shell: true`) because that would spawn an
 * intermediate cmd.exe and break `detached` process-tree ownership — the child
 * would become a grandchild of cmd.exe rather than a direct child, preventing
 * reliable PID-based kill.  This parser handles the subset of quoting rules
 * that users realistically enter in the Settings UI (double-quoted groups,
 * backslash-escaped quotes).
 */
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
  const appEntry = Object.entries(appPaths).find(([, value]) => pathsEqual(value, appPath))
  return appEntry?.[0]
}

// Exported for unit tests only — not part of the processes barrel surface.
export function normalizeLaunchInput(
  input: ProfileLaunchInput,
  gameKey: string
): ProfileLaunchEntry {
  if (typeof input !== 'string') {
    return { key: input.key, path: input.path }
  }

  const gamePaths = getStoredStringRecord('gamePaths')
  const matchingGamePath = gamePaths?.[gameKey]
  if (typeof matchingGamePath === 'string' && pathsEqual(matchingGamePath, input)) {
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
  // -WorkingDirectory mirrors the non-elevated cwd fix (#483). Best effort:
  // Windows may not propagate it across the elevation boundary, but stating
  // the intent is harmless and covers configurations where it does.
  const payload = JSON.stringify({
    filePath: appPath,
    args,
    workingDirectory: path.dirname(appPath)
  })
  const startProcessCommand =
    args.length > 0
      ? 'Start-Process -FilePath $payload.filePath -ArgumentList $payload.args -WorkingDirectory $payload.workingDirectory -Verb RunAs'
      : 'Start-Process -FilePath $payload.filePath -WorkingDirectory $payload.workingDirectory -Verb RunAs'

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
          warning: `${path.basename(appPath)} requested administrator permission. SimLauncher will detect when it's running but cannot close it from here.`
        })
      }
    )
  })
}

export async function spawnDetachedApp(
  sender: WebContents,
  gameKey: string,
  entry: ProfileLaunchEntry,
  gamePath?: string
): Promise<AppLaunchResult> {
  const { path: appPath, key: appKey } = entry
  // Console-subsystem exes must NOT get DETACHED_PROCESS: without a console
  // they can exit before doing anything (powershell.exe exits 0 without
  // executing, #486). Spawned non-detached they allocate their own console,
  // and children outlive the parent on Windows either way. GUI apps keep the
  // long-standing detached behavior.
  const consoleApp = await isConsoleExecutable(appPath)
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
      // Always start an app in its own folder, the way Explorer/Steam do.
      // Apps that resolve assets relative to their CWD (e.g. iOverlay's WIC
      // sprite loads) break — and can leak memory until OOM — when they
      // inherit SimLauncher's CWD instead (#483).
      const child = spawn(appPath, args, {
        cwd: path.dirname(appPath),
        detached: !consoleApp,
        stdio: 'ignore'
      })
      const runningKey = normalizePathForComparison(appPath)
      runningProcesses.set(runningKey, {
        process: child,
        path: appPath,
        name: path.basename(appPath),
        gameKey,
        isGame: !!gamePath && pathsEqual(appPath, gamePath)
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
        const processEntry = runningProcesses.get(runningKey)
        if (processEntry?.process === child) {
          runningProcesses.delete(runningKey)
        }
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
        const processEntry = runningProcesses.get(runningKey)
        const wasGame = processEntry?.isGame ?? false
        // Only drop the entry if it is still ours. Two slots can share a
        // canonical key (#357), and a late exit event for an already-killed
        // child must not wipe an entry that a subsequent spawn has just
        // installed (profile-switch path is the realistic trigger).
        if (processEntry?.process === child) {
          runningProcesses.delete(runningKey)
        }
        const exitedDuringPostLaunchWindow = Date.now() - launchStartedAt <= POST_LAUNCH_BLOCK_MS
        const wasClosedBySimLauncher = consumeProcessNameMismatchWarningSuppression(appPath)

        if (exitedDuringPostLaunchWindow && !wasClosedBySimLauncher) {
          const warning = `${path.basename(appPath)} exited shortly after launch. It likely spawned a child process under a different name — SimLauncher can no longer detect when you close it. To restore tracking, find the child process name in Task Manager and add it under "Secondary executables to watch" in the profile editor. Right-click the icon to dismiss this warning.`

          processNameMismatchWarnings.set(normalizePathForComparison(appPath), {
            path: appPath,
            name: path.basename(appPath),
            gameKey,
            warning
          })
          // Suppress the toast notification for the game exe itself: fast-exit
          // is the normal pattern for launcher stubs (Steam, EA App, etc.) and
          // the warning icon in the game card is sufficient feedback. The toast
          // is only useful for companion utilities where the user may not
          // immediately notice the card state change.
          if (!wasGame) {
            sendProcessNameMismatchWarning(sender, appPath, warning)
          }
        }
        invalidateProcessNameCache()
        publishRunningApps('exit').catch((err) => {
          console.error('Failed to publish running apps after exit:', err)
        })
      })

      // The 'spawn' event fires synchronously on success for most GUI apps, but
      // some launchers (e.g. Ubisoft Connect wrapper) can delay it. The 500 ms
      // fallback ensures the caller is unblocked even if the event never fires
      // (e.g. the child is already gone by the time Node processes the queue).
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
