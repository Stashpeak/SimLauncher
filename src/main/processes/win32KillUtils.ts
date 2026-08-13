/**
 * Low-level Win32 process helpers: everything that shells out to `taskkill` or
 * queries WMI, with no knowledge of profiles, tracking state, or the store.
 *
 * Extracted verbatim from `kill.ts` (#773) to give #659 a directly testable
 * seam for the force/graceful `taskkill` flag. All three `/F` call sites live
 * here; against the old 1076-line `kill.ts` they were reachable from tests only
 * through `killLaunchedApps` plus a package-level `child_process` mock.
 *
 * The boundary is the point: nothing in this file may read the store or the
 * tracking sets (`runningProcesses`, `unclosedProcesses`,
 * `processNameMismatchWarnings`). Adding such a read collapses the seam and
 * makes these helpers untestable in isolation again.
 */
import { execFile, type ChildProcess } from 'child_process'
import path from 'path'

import { writeAppErrorLog } from '../errorLog'
import { getErrorMessage, getExeName, isValidExePath } from '../utils'

import type { KillAttemptResult } from './types'

// Generous for a healthy system (the query usually returns in tens of ms) but
// bounded so a wedged WMI service cannot hang a kill request forever.
const WMI_LOOKUP_TIMEOUT_MS = 3000

function isAccessDeniedMessage(message: string) {
  return /(access is denied|permission denied|administrator|elevat)/i.test(message)
}

function isNotFoundMessage(message: string) {
  return /not found|no running instance/i.test(message)
}

function isStaleTaskMessage(message: string) {
  return /no running instance/i.test(message)
}

/**
 * How long the whole graceful phase may take, once, for the entire batch (#659).
 *
 * Shared rather than per app on purpose: a per-target wait would make the close
 * action take this long multiplied by the number of apps that ignore it, and the
 * issue requires the total to stay bounded no matter how many do.
 */
export const GRACEFUL_CLOSE_WINDOW_MS = 3000

/**
 * Ask processes to close themselves. `taskkill` WITHOUT `/F` posts `WM_CLOSE`
 * to a process's top-level windows, which is what lets an app run its own
 * shutdown path and flush a layout, dashboard or device handle before it goes.
 *
 * Best effort by design, so this reports nothing. A console app with no message
 * loop, an app that ignores the request, and an elevated app that denies it are
 * all normal here; the force kill that follows is what decides the outcome, and
 * it re-reports everything. That is also why the failures are not logged: at
 * this stage they are expected, not errors.
 *
 * Takes PIDs rather than an image name so the request cannot broaden to a
 * same-named process the user started outside SimLauncher, matching the
 * guarantee the force-kill path already makes.
 */
export async function requestGracefulClose(processIds: number[]): Promise<void> {
  await Promise.all(
    processIds.map((processId) =>
      runTaskkill(['/PID', String(processId), '/T'], `ask process ${processId} to close`, {
        quiet: true
      })
    )
  )
}

function runTaskkill(args: string[], description: string, options?: { quiet?: boolean }) {
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

      if (!notFound && !options?.quiet) {
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
export function isFullExePath(appPath: string | undefined): appPath is string {
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
export function isPathScopedExe(appPath: string | undefined): appPath is string {
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

/**
 * Resolve the PIDs of running processes named `processName` whose WMI
 * `ExecutablePath` resolves to the same file as `appPath`. This is what makes a
 * kill path-scoped instead of name-scoped.
 *
 * ⚠️ **An empty `processIds` does NOT mean "nothing is running there."** On any
 * failure this resolves `{ processIds: [], detail }`, so zero PIDs means either
 * "nothing was there" or "we could not look". Branch on `detail` BEFORE reading
 * `processIds.length`; reading the absence of a signal as a signal is what
 * produced two separate defects on #818.
 *
 * Two further reasons a genuinely running process yields zero PIDs:
 * - an elevated process can expose a null `ExecutablePath`, so the
 *   `Where-Object` clause filters it out while it is very much alive
 *   (#390/#399)
 * - the query is bounded by `WMI_LOOKUP_TIMEOUT_MS` and a timeout arrives as a
 *   failure with `detail` set, deliberately NOT as an `/IM` fallback, which
 *   would kill same-named processes the user started outside SimLauncher (#503)
 *
 * `accessDenied` is set when the failure text says Windows refused the query.
 */
export function findProcessIdsByExecutablePath(processName: string, appPath: string) {
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

/**
 * Kill a process SimLauncher spawned and still holds a `ChildProcess` handle
 * for, by PID. `/T` takes its children with it, which is what catches launchers
 * that re-exec into a second process.
 *
 * Preferred over {@link killProcessByImageName} whenever a handle exists: a PID
 * cannot be ambiguous, so this needs neither a WMI lookup nor path scoping.
 * Off win32 there is no `taskkill`, so it falls back to `child.kill()`.
 *
 * `targetConfirmed` holds unless taskkill reported the process had already
 * exited: a PID we were tracking is positive evidence that this target was
 * real, which callers use to tell "closed nothing" apart from "closed
 * something" (#818).
 */
export async function killProcessTree(
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

/**
 * Kill a process we have no handle for, which is the normal case for a
 * companion that re-execed or that was already running when SimLauncher
 * started.
 *
 * Two very different behaviours hide behind one name, decided by `appPath`:
 *
 * - **path-scoped** when `appPath` is a full exe path: PIDs are resolved with
 *   {@link findProcessIdsByExecutablePath} first and killed individually, so a
 *   same-named process at a different path is never touched
 * - **image-scoped** when `appPath` is a bare name or absent: falls back to
 *   `taskkill /IM`, which kills EVERY process with that image name, including
 *   instances the user started outside SimLauncher. This is the imprecise path
 *   and the reason {@link isFullExePath} gates it
 *
 * Off win32 it reports success without doing anything, so callers on other
 * platforms are not failed for a Windows-only capability.
 */
export async function killProcessByImageName(
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
