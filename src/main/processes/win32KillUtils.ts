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
import { getErrorMessage, getExeName, isValidExePath, normalizePathForComparison } from '../utils'

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
 * Whether a child we spawned has already exited, judged on POSITIVE evidence
 * only. A live `ChildProcess` reports `null` for both; `undefined` means we are
 * not looking at a real handle and must not be read as "gone".
 *
 * This is the guard on signalling a PID at all. Once a process exits Node
 * releases its handle and Windows may hand that number to something else, so a
 * `taskkill /PID` issued afterwards can hit a stranger, and `/T` takes that
 * stranger's children too. While the handle reports neither an exit code nor a
 * signal it is open, and the PID cannot have been recycled.
 *
 * Exported so the force kill and the graceful phase share one definition. They
 * are separated by seconds of awaited work, so a second copy of this rule would
 * drift (Codex on #823).
 */
export function hasChildExited(child: ChildProcess): boolean {
  return typeof child.exitCode === 'number' || typeof child.signalCode === 'string'
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

  // The child already exited, so there is nothing to signal. Bailing out here is
  // not an optimisation, it is a safety check: once a process exits, Node
  // releases its handle and Windows is free to hand that PID to something else,
  // and `/T` would then take an unrelated process tree with it.
  //
  // Cheap before #659, load-bearing after it: the graceful phase deliberately
  // opens a window in which a well-behaved app is expected to exit, so the gap
  // between "decide to kill" and "kill" went from microseconds to seconds
  // (CodeRabbit on #823).
  //
  // Reports exactly what `taskkill` would have reported had it been called and
  // found nothing (`success: notFound`), so no downstream accounting has to
  // learn a new shape.
  if (hasChildExited(child)) {
    return { processName, appPath, gameKey, success: true, notFound: true }
  }

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

/**
 * One running instance of an image name, as seen by a name-scoped WMI
 * enumeration.
 *
 * `executablePath` is null when WMI would not disclose it. That is not an
 * error: a non-elevated SimLauncher cannot read the path of a process running
 * at higher integrity, and on a real machine that is roughly 38% of all
 * processes. Callers must treat null as "unknown", never as "different".
 */
export interface NamedProcessInstance {
  /** Lowercased image name, matching how `tasklist` results are keyed. */
  name: string
  processId: number
  executablePath: string | null
  /**
   * Windows session. 0 is the non-interactive services session, which cannot
   * host a companion the user launched, so it is the one case where an
   * unreadable path is still decidable (#674).
   */
  sessionId: number
}

/**
 * Enumerate every running process whose image name is one of `processNames`.
 *
 * The discriminator `tasklist` cannot provide. `tasklist` returns image names
 * with no path, so every "is my configured app already running?" answer built
 * on it is name-only, and a same-named process from an unrelated path passes
 * for the configured one (#674).
 *
 * ONE spawn regardless of how many names are asked about. Every caller batches
 * its whole question into a single call, because the cost here is dominated by
 * starting PowerShell, not by the enumeration.
 *
 * Names are injected as JSON through the environment rather than interpolated
 * into the script, for the same reason `findProcessIdsByExecutablePath`
 * documents: WQL string-literal escaping is ambiguous and version-dependent,
 * and an exe name containing a quote would otherwise break the lookup or worse
 * (#531). Comparison happens in the host language, which handles any character.
 */
export function findProcessesByName(processNames: string[]): Promise<{
  instances: NamedProcessInstance[]
  succeeded: boolean
}> {
  return new Promise((resolve) => {
    const wanted = Array.from(new Set(processNames.map((name) => name.toLowerCase()))).filter(
      (name) => name.length > 0
    )

    if (wanted.length === 0) {
      // Not a failure: nothing was asked. `succeeded: true` matters, because
      // callers treat a failed read as "no observation" and fall back to the
      // conservative branch.
      resolve({ instances: [], succeeded: true })
      return
    }

    const script = [
      '$names = $env:SIMLAUNCHER_TARGET_PROCESS_NAMES | ConvertFrom-Json',
      // Force an array: a single-element JSON array deserializes to a scalar,
      // and `-contains` against a scalar silently matches nothing.
      '$wanted = @($names) | ForEach-Object { $_.ToLowerInvariant() }',
      'Get-CimInstance Win32_Process |',
      '  Where-Object { $wanted -contains $_.Name.ToLowerInvariant() } |',
      '  Select-Object @{N="name";E={$_.Name.ToLowerInvariant()}},',
      '    @{N="processId";E={[int]$_.ProcessId}},',
      '    @{N="executablePath";E={$_.ExecutablePath}},',
      '    @{N="sessionId";E={[int]$_.SessionId}} |',
      // -AsArray so a single match is still a JSON array, matching the parse
      // below. Without it PowerShell emits a bare object and the parse drops it.
      '  ConvertTo-Json -Compress -AsArray'
    ].join('\n')

    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      {
        windowsHide: true,
        timeout: WMI_LOOKUP_TIMEOUT_MS,
        env: {
          ...process.env,
          SIMLAUNCHER_TARGET_PROCESS_NAMES: JSON.stringify(wanted)
        }
      },
      (error, stdout) => {
        if (error) {
          console.error('Failed to enumerate processes by name:', getErrorMessage(error))
          resolve({ instances: [], succeeded: false })
          return
        }

        try {
          const parsed: unknown = JSON.parse(stdout.trim() || '[]')
          if (!Array.isArray(parsed)) {
            resolve({ instances: [], succeeded: false })
            return
          }
          const instances = parsed.flatMap((entry): NamedProcessInstance[] => {
            if (typeof entry !== 'object' || entry === null) return []
            const record = entry as Record<string, unknown>
            if (typeof record.name !== 'string' || typeof record.processId !== 'number') return []
            return [
              {
                name: record.name.toLowerCase(),
                processId: record.processId,
                executablePath:
                  typeof record.executablePath === 'string' && record.executablePath.length > 0
                    ? record.executablePath
                    : null,
                sessionId: typeof record.sessionId === 'number' ? record.sessionId : 0
              }
            ]
          })
          resolve({ instances, succeeded: true })
        } catch (err) {
          console.error('Failed to parse the process enumeration:', getErrorMessage(err))
          resolve({ instances: [], succeeded: false })
        }
      }
    )
  })
}

/**
 * What a name-scoped enumeration can say about ONE configured path.
 *
 * `unknown` is not a failure and must not be collapsed into either answer. It
 * means the evidence is genuinely ambiguous, and every caller answers it the
 * way it answered before #674, which is what keeps #390 (a genuinely elevated
 * process invisible to a non-elevated SimLauncher) reporting as elevated.
 */
export type ConfiguredPathState = 'running' | 'not-running' | 'unknown'

/**
 * Decide whether the exe at `configuredPath` is among `instances`.
 *
 * The single decision rule behind every "is this app already running?" answer
 * in the app (#674). It lives here, next to the enumeration that feeds it,
 * because five call sites depend on agreeing, and agreeing by having copied the
 * same expression is how they stop agreeing.
 *
 * Order matters and each step earns its place:
 *
 *   1. A path match wins outright, INCLUDING in session 0. Session is only ever
 *      used to dismiss an instance, never to deny one that positively matches:
 *      a service-hosted copy of the configured exe is still the configured exe.
 *   2. An instance is dismissible when it has a readable path that differs, or
 *      when it is in session 0. Session 0 is the non-interactive services
 *      session, so it cannot be the companion the user launched, and that is
 *      what makes an UNREADABLE path decidable there. On a real machine that
 *      resolves 170 of the 187 processes whose path WMI will not disclose.
 *   3. Anything left is an instance with an unreadable path in an interactive
 *      session. That is exactly the shape of #390, so the answer is `unknown`
 *      and the caller keeps its pre-#674 behaviour.
 */
export function resolveConfiguredPathState(
  instances: NamedProcessInstance[],
  configuredPath: string
): ConfiguredPathState {
  const targetName = getExeName(configuredPath)
  const relevant = instances.filter((instance) => instance.name === targetName)

  if (relevant.length === 0) {
    return 'not-running'
  }

  const target = normalizePathForComparison(configuredPath)
  if (
    relevant.some(
      (instance) =>
        instance.executablePath && normalizePathForComparison(instance.executablePath) === target
    )
  ) {
    return 'running'
  }

  const undecidable = relevant.filter(
    (instance) => !instance.executablePath && instance.sessionId !== 0
  )

  return undecidable.length === 0 ? 'not-running' : 'unknown'
}
