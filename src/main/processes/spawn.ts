import { execFile, spawn } from 'child_process'
import type { WebContents } from 'electron'
import fs from 'fs'
import path from 'path'

import { writeAppErrorLog } from '../errorLog'
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
  hasOtherActiveLaunchControllers,
  processNameMismatchWarnings,
  registerActiveLaunch,
  runningProcesses,
  unregisterActiveLaunch
} from './state'
import { isConsoleExecutable } from './subsystem'
import { invalidateProcessNameCache, readRunningProcessNames } from './tasklist'
import type {
  AppLaunchResult,
  LaunchProfileAppsOptions,
  LaunchResult,
  ProfileLaunchEntry,
  ProfileLaunchInput,
  SkippedLaunchEntry
} from './types'
import { publishRunningApps } from './running'

const activeLaunches = new Set<string>()
// After a launch completes, block further launches process-wide (across all
// windows — launchBlockedUntil is a single module-level scalar, not per-window)
// for this duration. Apps that self-relaunch under a different process name (the
// mismatch-warning scenario) can trigger a second fast-exit within a few seconds;
// the block prevents a race where the user clicks Launch again before the UI
// reflects the real state.
const POST_LAUNCH_BLOCK_MS = 10000
const PROCESS_NAME_MISMATCH_WARNING_CHANNEL = 'process-name-mismatch-warning'
let launchBlockedUntil = 0

// How long the ordered launch loop will wait on a single elevated (UAC) handoff
// before continuing without it. The elevated fallback is awaited inside the
// sequential loop while the global single-flight guard (activeLaunches) is held,
// so an unanswered consent prompt would otherwise park the game + remaining
// companions — and reject every other window's Launch — for the whole ~120s
// Windows consent timeout (#675). This is the grace window; see launchElevated.
// Exported for unit tests only — not part of the processes barrel surface.
export const ELEVATED_HANDOFF_MAX_WAIT_MS = 10000

/**
 * Whether ANY launch sequence is currently in flight — the same condition as
 * launchProfileApps' own entry gate below. Exposed for the IPC handlers that
 * register their own cancellation controller BEFORE calling launchProfileApps
 * (#716): they must mirror this gate before registering, because
 * registerActiveLaunch overwrites per gameKey — registering while a sequence
 * for the same gameKey is mid-flight would EVICT that sequence's controller
 * from the registry, leaving its still-running loop unreachable by Close Apps
 * (the #670 bug class, via a new path).
 */
export function isAnyLaunchActive(): boolean {
  return activeLaunches.size > 0
}

export async function launchProfileApps(
  sender: WebContents,
  gameKey: string,
  profileApps: ProfileLaunchInput[],
  options?: LaunchProfileAppsOptions
): Promise<LaunchResult> {
  // Two-part gate (#716 review finding). `activeLaunches` alone misses two
  // windows where a relaunch/switch handler has REGISTERED its controller but
  // not yet reached this function (its pre-launch scans / kill phase run
  // first, and only this function fills `activeLaunches`):
  //   (a) a plain launch-profile call landing in that window would pass an
  //       activeLaunches-only gate and self-register below — evicting the
  //       handler's controller from the registry, and
  //   (b) the two handlers' own mirror of this gate has the same blind spot,
  //       covered by the same registry check on their side.
  // `options?.controller` as the `except` keeps a handler's own pre-registered
  // controller from blocking the very launch it was registered for.
  if (activeLaunches.size > 0 || hasOtherActiveLaunchControllers(options?.controller)) {
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
  // Use the caller's pre-registered controller when one is supplied — the
  // two IPC flows with async work BEFORE this call (relaunch-missing-profile,
  // switch-profile-apps) register early so a Close Apps click during that
  // pre-launch window has something to abort (#716). Every other caller falls
  // back to self-registration here, unchanged from #670.
  const launchController = options?.controller ?? registerActiveLaunch(gameKey)
  let launchedAny = false

  // Everything from here runs under the finally — a throw anywhere below
  // (store read, tasklist scan, path checks) must still release the launch
  // guard and the abort registration, or every future launch stays blocked
  // behind the stale `activeLaunches` entry.
  try {
    const launchDelayMs = getLaunchDelayMs()
    const gamePaths = getStoredStringRecord('gamePaths')
    const gamePath = gamePaths?.[gameKey]
    const { processNames } = await readRunningProcessNames()
    const normalizedEntries = profileApps.map((input) => normalizeLaunchInput(input, gameKey))
    // Entries filtered out below never reach spawn — tracked here (not just
    // console.error'd) so the caller can tell "some apps launched, one was
    // silently skipped" apart from a plain success (#639).
    const skipped: SkippedLaunchEntry[] = []
    const validApps = normalizedEntries.filter((entry) => {
      if (!isValidExePath(entry.path)) {
        // isValidExePath also checks the resolved path's existence, so a
        // well-formed .exe path that simply no longer exists fails here too —
        // attribute those as 'missing' (not 'invalid') so the reason AND the
        // log text reflect the actual problem (moved/uninstalled exe, #639)
        // rather than a malformed path.
        const trimmedPath = entry.path.trim()
        const looksLikeExePath = trimmedPath.length > 0 && /\.exe$/i.test(trimmedPath)
        const skipLogText = looksLikeExePath
          ? `Skipping missing executable: ${entry.path}`
          : `Skipping invalid path: ${entry.path}`
        console.error(skipLogText)
        writeAppErrorLog('launch', `[${gameKey}] ${skipLogText}`)
        skipped.push({
          key: entry.key,
          path: entry.path,
          reason: looksLikeExePath ? 'missing' : 'invalid'
        })
        return false
      }
      if (!fs.existsSync(entry.path.trim())) {
        console.error(`Skipping missing executable: ${entry.path}`)
        writeAppErrorLog('launch', `[${gameKey}] Skipping missing executable: ${entry.path}`)
        skipped.push({ key: entry.key, path: entry.path, reason: 'missing' })
        return false
      }
      return true
    })

    // A kill can land during the pre-loop awaits (the tasklist scan above) —
    // the early returns below must report the cancellation like the loop
    // paths do, not a plain success/error the user's Close Apps contradicts.
    if (launchController.signal.aborted) {
      return {
        success: false,
        cancelled: true,
        message: 'Launch cancelled — closed apps instead.',
        launchedCount: 0,
        skipped
      }
    }

    if (validApps.length === 0) {
      return { success: false, error: 'No valid executable paths configured.', skipped }
    }

    const appsToLaunch = validApps.filter((entry) => !isRunningExePath(processNames, entry.path))
    const skippedCount = validApps.length - appsToLaunch.length

    if (appsToLaunch.length === 0) {
      return {
        success: true,
        message: 'All profile applications are already running.',
        launchedCount: 0,
        skippedCount,
        skipped
      }
    }

    const launchResults: AppLaunchResult[] = []

    for (let index = 0; index < appsToLaunch.length; index += 1) {
      // Checked at the TOP of every iteration, not just after the wait below:
      // a kill can land in the gap between spawnDetachedApp resolving and the
      // wait call starting, and an already-aborted signal resolves wait()
      // immediately — without this check the loop would still spawn one more
      // app on that immediate resolution (#670).
      if (launchController.signal.aborted) {
        break
      }

      const launchResult = await spawnDetachedApp(
        sender,
        gameKey,
        appsToLaunch[index],
        gamePath,
        launchController.signal
      )
      // The abort landed during spawnDetachedApp's pre-spawn probe — nothing
      // was spawned, so don't count it (and don't arm the post-launch
      // cooldown for an attempt that never happened).
      if (launchResult.status === 'cancelled') {
        break
      }
      launchedAny = true
      launchResults.push(launchResult)

      if (index < appsToLaunch.length - 1 && launchDelayMs > 0) {
        await wait(launchDelayMs, launchController.signal)
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

    // A kill (Close Apps) mid-sequence aborts launchController before doing its
    // own work (#670) — report this as neither success nor failure, and stop
    // before the failure/success branches below account for apps that were
    // deliberately never spawned.
    if (launchController.signal.aborted) {
      // Elevated apps that completed their UAC handoff before (or despite)
      // the abort survive the kill — SimLauncher cannot close them (#670
      // Codex P2). Name them instead of implying everything was closed.
      const elevatedNote =
        elevatedResults.length === 1
          ? ' One app started with administrator permission and cannot be closed from here.'
          : elevatedResults.length > 1
            ? ` ${elevatedResults.length} apps started with administrator permission and cannot be closed from here.`
            : ''
      return {
        success: false,
        cancelled: true,
        message: `Launch cancelled — closed apps instead.${elevatedNote}`,
        launchedCount,
        skippedCount,
        elevatedCount: elevatedResults.length,
        failedCount: failedResults.length,
        skipped
      }
    }

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
        failedCount: failedResults.length,
        skipped
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
      elevatedCount: elevatedResults.length,
      skipped
    }
  } finally {
    if (launchedAny) {
      launchBlockedUntil = Date.now() + POST_LAUNCH_BLOCK_MS
    }
    activeLaunches.delete(gameKey)
    unregisterActiveLaunch(gameKey, launchController)
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
 * reliable PID-based kill.
 *
 * Backslashes follow the Windows argv convention (CommandLineToArgvW): they
 * are literal unless they precede a double quote, in which case each pair
 * collapses to one backslash and an odd remainder escapes the quote. One
 * deliberate deviation: inside a quoted group whose accumulated content looks
 * like a Windows path, an odd trailing backslash whose quote is followed by
 * whitespace/end closes the group instead of producing a literal quote — so
 * `"C:\My Path\" --flag` parses the way users mean it (a path plus a flag)
 * rather than swallowing the rest of the line (#504). The path test is what
 * keeps escaped quotes in non-path arguments (e.g. `"Lap \" time"`) on the
 * strict Windows behaviour — a literal `"` cannot occur in a Windows path, so
 * the two intents never genuinely collide.
 *
 * Exported for unit tests only — not part of the processes barrel surface.
 */
export function parseCommandLineArgs(input: string): string[] {
  const args: string[] = []
  let current = ''
  let inQuotes = false

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]

    if (char === '\\') {
      let backslashCount = 0
      while (input[index + backslashCount] === '\\') {
        backslashCount += 1
      }

      if (input[index + backslashCount] !== '"') {
        current += '\\'.repeat(backslashCount)
        index += backslashCount - 1
        continue
      }

      current += '\\'.repeat(Math.floor(backslashCount / 2))

      if (backslashCount % 2 === 0) {
        // Even run: backslashes consumed, the quote toggles on the next pass.
        index += backslashCount - 1
        continue
      }

      const charAfterQuote = input[index + backslashCount + 1]
      const quoteEndsToken = charAfterQuote === undefined || /\s/.test(charAfterQuote)
      // The token itself must BE a path (optionally as a --key=value payload):
      // drive-letter or UNC prefix at the token start. Anchoring matters — a
      // sentence merely containing a path (e.g. "Saved under C:\Logs\" today")
      // must keep the strict literal-quote behaviour. Quotes are invalid
      // characters in Windows paths, so an actual path token cannot
      // legitimately want a literal quote here.
      const looksLikeWindowsPath = /^(?:[^\s"]*=)?(?:[A-Za-z]:[\\/]|\\\\)/.test(current)

      if (inQuotes && quoteEndsToken && looksLikeWindowsPath) {
        // The path-friendly deviation described above: `...\" ` closes the
        // quoted group and keeps the backslash.
        current += '\\'
        inQuotes = false
      } else {
        current += '"'
      }
      index += backslashCount // also consumes the quote
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

function launchElevated(
  appPath: string,
  args: string[] = [],
  gameKey?: string,
  signal?: AbortSignal
) {
  return new Promise<AppLaunchResult>((resolve) => {
    const elevatedWarning = `${path.basename(appPath)} requested administrator permission. SimLauncher will detect when it's running but cannot close it from here.`

    // A kill (Close Apps) can land while the UAC handoff is still pending —
    // the consent prompt sits on screen until the user answers it, so this
    // window is wide (#670 Codex P2). Killing the PowerShell host is a best
    // effort to stop the pending Start-Process from proceeding, and it
    // unblocks the launch sequence immediately instead of leaving it parked
    // until the user answers a prompt they no longer want.
    let handoffPending = true
    const onAbort = () => {
      if (handoffPending) {
        child.kill()
      }
    }

    // Never let an unanswered UAC prompt hold the launch loop (and the global
    // single-flight guard) for the full ~120s consent timeout (#675). After a
    // bounded grace window, report the handoff optimistically as `elevated` and
    // let the sequence continue. The PowerShell host is deliberately left alive
    // so a late approval still starts the app, and tasklist reconciliation
    // reflects the true running state either way. resolve() is idempotent, so
    // the eventual callback below is a harmless no-op once this has fired; abort
    // still kills the host because handoffPending stays true until it settles.
    const handoffTimer = setTimeout(() => {
      resolve({ status: 'elevated', appPath, warning: elevatedWarning })
    }, ELEVATED_HANDOFF_MAX_WAIT_MS)

    const child = execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        createElevatedLaunchCommand(appPath, args)
      ],
      { windowsHide: true },
      (error) => {
        handoffPending = false
        clearTimeout(handoffTimer)
        signal?.removeEventListener('abort', onAbort)
        if (error) {
          // An error after the abort is the expected shape of a cancelled
          // handoff (our own host kill, or the user denying a prompt they no
          // longer want) — report cancelled, and don't log it as a failure.
          if (signal?.aborted) {
            resolve({ status: 'cancelled', appPath })
            return
          }
          const message = `Administrator permission was requested for ${path.basename(appPath)}, but Windows did not start it. ${getErrorMessage(error)}`
          console.error(`Error launching ${appPath} as administrator: ${getErrorMessage(error)}`)
          // execFile's error.message embeds the full command line — including
          // the encoded launch args, which may carry tokens — so the on-disk
          // entry gets only the exe path + error code, never the message.
          const code = getErrorCode(error)
          writeAppErrorLog(
            'launch',
            `${gameKey ? `[${gameKey}] ` : ''}Error launching ${appPath} as administrator${code ? ` (${code})` : ''}`
          )
          resolve({ status: 'failed', appPath, error: message })
          return
        }

        // Success is reported truthfully even when an abort landed mid-handoff
        // (the user accepted the prompt before the host kill took effect): the
        // elevated app IS running and the kill cannot close it — the sequence's
        // cancellation message names it rather than implying it was closed.
        resolve({ status: 'elevated', appPath, warning: elevatedWarning })
      }
    )
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export async function spawnDetachedApp(
  sender: WebContents,
  gameKey: string,
  entry: ProfileLaunchEntry,
  gamePath?: string,
  signal?: AbortSignal
): Promise<AppLaunchResult> {
  const { path: appPath, key: appKey } = entry
  // Console-subsystem exes must NOT get DETACHED_PROCESS: without a console
  // they can exit before doing anything (powershell.exe exits 0 without
  // executing, #486). Spawned non-detached they allocate their own console,
  // and children outlive the parent on Windows either way. GUI apps keep the
  // long-standing detached behavior.
  const consoleApp = await isConsoleExecutable(appPath)

  // A kill (Close Apps) can land while the PE-subsystem probe above is in
  // flight. The kill's snapshot cannot include a process that hasn't spawned
  // yet, so spawning now would leave an app running that the user just asked
  // to close (#670). There is no further await between this check and spawn()
  // below, so the window is fully closed.
  if (signal?.aborted) {
    return { status: 'cancelled', appPath }
  }
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
          writeAppErrorLog('launch', `[${gameKey}] Error launching ${appPath}: ${message}`)
          sendLaunchError(sender, appPath, message)
          return
        }

        // A UAC elevation request is a handoff, not a failure — don't write a
        // failure entry for it; launchElevated logs its own genuine failures.
        if (isElevatedLaunchError(err)) {
          // A kill (Close Apps) can land between spawn() and this error event.
          // Handing off now would pop a UAC prompt right after the user's
          // Close Apps click — and start an elevated app the kill's snapshot
          // can never include (#670). Nothing is running (the spawn failed),
          // so report the attempt as cancelled instead.
          if (signal?.aborted) {
            resolveOnce({ status: 'cancelled', appPath })
            return
          }
          resolveOnce(await launchElevated(appPath, getAppArgs(appKey), gameKey, signal))
          return
        }

        writeAppErrorLog('launch', `[${gameKey}] Error launching ${appPath}: ${message}`)
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

      // The 'spawn' event normally fires promptly (next tick) on success, but
      // some launchers (e.g. Ubisoft Connect wrapper) can delay it. The 500 ms
      // fallback ensures the caller is unblocked even if the event never fires
      // (e.g. the child is already gone by the time Node processes the queue).
      fallbackTimer = setTimeout(() => resolveOnce({ status: 'launched', appPath }), 500)
    } catch (err) {
      const message = getErrorMessage(err)
      console.error(`Error launching ${appPath}: ${message}`)

      // Same handoff-vs-failure distinction as the 'error' handler above.
      if (isElevatedLaunchError(err)) {
        launchElevated(appPath, getAppArgs(appKey), gameKey, signal).then(resolveOnce)
        return
      }

      writeAppErrorLog('launch', `[${gameKey}] Error launching ${appPath}: ${message}`)
      resolveOnce({ status: 'failed', appPath, error: message })
    }
  })
}
