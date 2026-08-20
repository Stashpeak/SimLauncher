import type { WebContents } from 'electron'
import fs from 'fs'
import path from 'path'

import { writeAppErrorLog } from '../errorLog'
import {
  getActiveProfileForGame,
  getStoredProfiles,
  isProcessTrackingEnabled,
  resolveNamedProfile
} from '../profiles'
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

import { execFileUnlessAborted, spawnUnlessAborted } from './guardedStart'
import {
  consumeProcessNameMismatchWarningSuppression,
  noteStrandedConsentPrompt,
  hasOtherActiveLaunchControllers,
  processNameMismatchWarnings,
  registerActiveLaunch,
  registerPendingElevatedHandoff,
  runningProcesses,
  unregisterActiveLaunch,
  unregisterPendingElevatedHandoff
} from './state'
import { isConsoleExecutable } from './subsystem'
import { invalidateProcessNameCache, readRunningProcessNames } from './tasklist'
import type {
  AppLaunchResult,
  LateElevatedOutcome,
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

// True outcomes of elevated handoffs that settled AFTER their grace timer had
// already resolved the promise as `elevated` (#675). The awaited value cannot be
// corrected once it is out, so without this the sequence summary would keep
// telling the user an app "started with administrator permission and cannot be
// closed" even when the abort killed the host and nothing survived, or when the
// user denied the prompt (Codex P2 on #779).
//
// Keyed by a per-handoff id, NOT by appPath, for two independent reasons
// (both CodeRabbit Majors on #779):
//   1. ACROSS runs — a host left alive by an earlier timed-out handoff keeps
//      waiting on its prompt for the full consent timeout, so its callback can
//      fire DURING a later sequence, i.e. after this map was cleared.
//   2. WITHIN a run — two profile slots may point at the SAME exe (supported:
//      per-slot args, #357), so one sequence can have two live handoffs for one
//      path. With one slot per path the later callback would overwrite the
//      other, and its outcome would then be applied to BOTH results.
// A unique id per handoff plus the owning run id closes both.
let launchRunId = 0
let elevatedHandoffSeq = 0
const lateElevatedOutcomes = new Map<number, LateElevatedOutcome>()

function nextElevatedHandoffId(): number {
  elevatedHandoffSeq += 1
  return elevatedHandoffSeq
}

function recordLateElevatedOutcome(
  runId: number,
  handoffId: number,
  outcome: LateElevatedOutcome
): void {
  if (runId !== launchRunId) {
    return
  }
  lateElevatedOutcomes.set(handoffId, outcome)
}

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

/**
 * Wording for a sequence that finished with no failures and no kill.
 *
 * `skippedCount` and `missingCount` are two different senses of "skipped" (see
 * LaunchResult): the first is "already running", the second is entries filtered
 * out before spawn for an invalid or missing path. The renderer concatenates the
 * skip warning naming those missing entries onto this string, so claiming "All"
 * while `missingCount > 0` produces a toast that contradicts itself in
 * consecutive sentences (#739).
 *
 * Extracted from the return site, and written as ordered early returns rather
 * than nested ternaries, because the ordering IS the logic and both review bots
 * found a wrong branch in the ternary version. Exported for unit tests only, not
 * part of the processes barrel surface.
 */
export function buildLaunchSummaryMessage(
  launchedCount: number,
  skippedCount: number,
  missingCount: number
): string {
  // Nothing actually started. Reachable without failing or being cancelled:
  // launchedCount subtracts elevated handoffs cancelled by a kill that did not
  // abort this sequence's controller (the `except: launchController` path used
  // by switch-profile-apps). Both "Started 0 apps" and "All ... launched" are
  // false here, and the latter is the very contradiction this function fixes.
  if (launchedCount === 0) {
    return skippedCount > 0
      ? `No apps were started; ${skippedCount} ${skippedCount === 1 ? 'was' : 'were'} already running.`
      : 'No apps were started.'
  }

  const started = `Started ${launchedCount} app${launchedCount === 1 ? '' : 's'}`

  // Must be tested before `missingCount`, or a launch that both skipped a
  // running app and filtered out a missing one loses the already-running count.
  if (skippedCount > 0) {
    return `${started}; skipped ${skippedCount} already running.`
  }

  if (missingCount > 0) {
    return `${started}.`
  }

  return 'All profile applications launched.'
}

// Mirrors the per-app wording built in `launchElevated`. Kept in step with it
// deliberately: the plural branch REPLACES those warnings rather than joining
// them, so an unconditional plural string puts the promise back the moment a
// second app needs elevation (Codex on #834).
function buildPluralElevatedWarning(count: number, tracked: boolean): string {
  return tracked
    ? `${count} apps requested administrator permission. SimLauncher will detect when they're running but cannot close them from here.`
    : `${count} apps requested administrator permission. Process tracking is off for this profile, so SimLauncher will not detect or close them.`
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
  // Never let a previous sequence's late handoff colour this one (#779). The
  // clear drops what already landed; the run id drops what lands from here on.
  lateElevatedOutcomes.clear()
  launchRunId += 1

  // Everything from here runs under the finally — a throw anywhere below
  // (store read, tasklist scan, path checks) must still release the launch
  // guard and the abort registration, or every future launch stays blocked
  // behind the stale `activeLaunches` entry.
  try {
    const launchDelayMs = getLaunchDelayMs()
    const gamePaths = getStoredStringRecord('gamePaths')
    const gamePath = gamePaths?.[gameKey]
    // Resolved from the profile these entries came FROM, which during a profile
    // switch is not the one the store calls active: the renderer launches the
    // incoming profile's apps and saves the new activeProfileId afterwards
    // (GameRow). Reading the store here would apply the OUTGOING profile's
    // tracking setting, so switching to a fire-and-forget profile would still
    // record its apps, and switching away from one would leave the incoming
    // tracked profile with no running strip at all.
    const trackingEnabled = isProcessTrackingEnabled(
      options?.profileId
        ? resolveNamedProfile(getStoredProfiles()[gameKey], options.profileId)
        : getActiveProfileForGame(gameKey)
    )
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

    // REPORTING, not prevention (#715). Nothing has been started yet and the
    // guarded start would refuse to start anything now anyway — but the early
    // returns below would otherwise answer a Close Apps with a plain
    // success/error that contradicts it, so the cancellation is named here.
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
        // Two different meanings of "skipped" meet here (see LaunchResult):
        // `skippedCount` is "already running", `skipped` is "missing or invalid
        // path". Saying "All" while `skipped` is non-empty contradicts the skip
        // warning the renderer concatenates onto this very string (#739) — one
        // sentence names an app that could not be found, the next claims they
        // are all running.
        message:
          skipped.length > 0
            ? 'The remaining profile applications are already running.'
            : 'All profile applications are already running.',
        launchedCount: 0,
        skippedCount,
        skipped
      }
    }

    const launchResults: AppLaunchResult[] = []

    for (let index = 0; index < appsToLaunch.length; index += 1) {
      // PROMPTNESS, not prevention (#715). Whichever suspension point a kill
      // lands in — the wait below, the probe inside spawnDetachedApp, or one a
      // later feature adds (#625, #626) — spawnUnlessAborted starts nothing and
      // spawnDetachedApp answers 'cancelled'. Deleting this check cannot make a
      // cancelled launch spawn something; it can only make it slower to admit
      // it, by entering spawnDetachedApp for an app it will never start and
      // paying that app's PE-subsystem probe first (Codex P2 on #828). That
      // probe has no timeout, and the process-wide launch guard is held until
      // this whole sequence returns, so every window's Launch waits on it.
      //
      // Which is why it is a check about latency, not correctness, and why the
      // features queued behind this refactor must not copy it as protection.
      // The difference is visible in the tests: remove this and one test slows
      // down and asserts an extra probe; remove the guarded start and eleven
      // fail.
      if (launchController.signal.aborted) {
        break
      }

      const launchResult = await spawnDetachedApp(
        sender,
        gameKey,
        appsToLaunch[index],
        gamePath,
        launchController.signal,
        trackingEnabled
      )
      // Nothing was started, so don't count it (and don't arm the post-launch
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
    const spawnFailedResults = launchResults.filter(
      (result): result is Extract<AppLaunchResult, { status: 'failed' }> =>
        result.status === 'failed'
    )

    // An elevated result is only trustworthy if the handoff was OBSERVED. When
    // the grace window expired first (#675) the promise said `elevated` on spec,
    // and the truth may have arrived afterwards through lateElevatedOutcomes
    // (#779). Resolve each one before it reaches the user:
    //   survived  — the app is running elevated and we cannot close it
    //   failed    — Windows refused it, or the user denied the prompt
    //   cancelled — we killed the host ourselves, so nothing started
    //   unknown   — the prompt is still unanswered; say "may have"
    const elevatedFate = (result: Extract<AppLaunchResult, { status: 'elevated' }>) => {
      if (result.confirmed) {
        return 'survived' as const
      }
      const late = lateElevatedOutcomes.get(result.handoffId)
      if (!late) {
        return 'unknown' as const
      }
      if (late.outcome === 'elevated') {
        return 'survived' as const
      }
      return late.outcome
    }

    // A denial that arrives while the loop is still running is a real failure
    // and must be reported as one, not merely subtracted from the counts
    // (Codex P2 on #779). `spawnFailedResults` only holds the synchronous spawn
    // failures, so late ones are folded in here.
    const lateFailedResults = elevatedResults.flatMap((result) => {
      const late = lateElevatedOutcomes.get(result.handoffId)
      return !result.confirmed && late?.outcome === 'failed'
        ? [{ status: 'failed' as const, appPath: result.appPath, error: late.error }]
        : []
    })
    const failedResults = [...spawnFailedResults, ...lateFailedResults]
    const cancelledElevatedCount = elevatedResults.filter(
      (result) => elevatedFate(result) === 'cancelled'
    ).length
    // Neither a failed nor a cancelled handoff started anything.
    const launchedCount = launchResults.length - failedResults.length - cancelledElevatedCount

    // REPORTING, not prevention (#715): the loop has already ended and the
    // guarded start decided what did and did not start. A kill (Close Apps)
    // mid-sequence aborts launchController before doing its own work (#670) —
    // report that as neither success nor failure, and stop before the
    // failure/success branches below account for apps deliberately never
    // started.
    if (launchController.signal.aborted) {
      // Elevated apps that completed their UAC handoff before (or despite)
      // the abort survive the kill — SimLauncher cannot close them (#670
      // Codex P2). Name them instead of implying everything was closed.
      //
      // But only the ones that actually survived. A handoff that timed out
      // (#675) and was then cancelled by this very abort started nothing, so
      // claiming it survived tells the user we failed to close something we did
      // close (Codex P2 on #779). Ones still waiting on the prompt get a hedged
      // sentence rather than a confident wrong one.
      const survivedCount = elevatedResults.filter(
        (result) => elevatedFate(result) === 'survived'
      ).length
      const unknownCount = elevatedResults.filter(
        (result) => elevatedFate(result) === 'unknown'
      ).length
      const survivedNote =
        survivedCount === 1
          ? ' One app started with administrator permission and cannot be closed from here.'
          : survivedCount > 1
            ? ` ${survivedCount} apps started with administrator permission and cannot be closed from here.`
            : ''
      const unknownNote =
        unknownCount === 1
          ? ' One app may have started with administrator permission and could not be closed from here.'
          : unknownCount > 1
            ? ` ${unknownCount} apps may have started with administrator permission and could not be closed from here.`
            : ''
      return {
        success: false,
        cancelled: true,
        message: `Launch cancelled — closed apps instead.${survivedNote}${unknownNote}`,
        launchedCount,
        skippedCount,
        elevatedCount: survivedCount + unknownCount,
        failedCount: failedResults.length,
        skipped
      }
    }

    // Same rule as the cancelled branch: a handoff we know started nothing is
    // not something to warn the user about (#779).
    const standingElevated = elevatedResults.filter((result) => {
      const fate = elevatedFate(result)
      return fate === 'survived' || fate === 'unknown'
    })

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
        elevatedCount: standingElevated.length,
        failedCount: failedResults.length,
        skipped
      }
    }

    const elevatedWarning =
      standingElevated.length === 1
        ? standingElevated[0].warning
        : standingElevated.length > 1
          ? buildPluralElevatedWarning(standingElevated.length, trackingEnabled)
          : undefined

    return {
      success: true,
      message: buildLaunchSummaryMessage(launchedCount, skippedCount, skipped.length),
      warning: elevatedWarning,
      launchedCount,
      skippedCount,
      elevatedCount: standingElevated.length,
      skipped
    }
  } finally {
    if (launchedAny) {
      launchBlockedUntil = Date.now() + POST_LAUNCH_BLOCK_MS
    }
    activeLaunches.delete(gameKey)
    unregisterActiveLaunch(gameKey, launchController)
    // A tracking toggle saved DURING this sequence was skipped by the reconcile,
    // which refuses to judge a game mid-launch because the store's active
    // profile is unreliable then (#591). Nothing else publishes when a sequence
    // ENDS: every per-app publish above runs before this unregister, and the
    // poll stops outright once the last subscriber goes, so the stale records
    // and any pending elevated handoff could otherwise outlive the toggle
    // indefinitely and still be closed by a tray Close Apps (Codex on #834).
    //
    // Only when no `profileId` was passed, which is the exact condition: the
    // caller supplies it precisely when the profile being launched is NOT the
    // persisted active one, i.e. a switch whose new `activeProfileId` the
    // renderer has not saved yet. Reconciling there would prune the incoming
    // profile's records on the authority of the outgoing one, and the switch's
    // own `save-profile` publish covers it with a store that agrees with itself
    // by then. Gating on `options.controller` instead is NOT equivalent and the
    // switch regression test says so: it passes a profileId without one.
    if (!options?.profileId) {
      publishRunningApps('config').catch((err) => {
        console.error('Failed to publish running apps after a launch sequence:', err)
      })
    }
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
  signal?: AbortSignal,
  tracked = true,
  appKey?: string
) {
  return new Promise<AppLaunchResult>((resolve) => {
    // Two sentences because the second one is a promise, and it is only true
    // when we are tracking (CodeRabbit on #834). Telling a fire-and-forget
    // profile that SimLauncher "will detect when it's running" is exactly the
    // lie #591 exists to stop: it will not, deliberately, because the user
    // asked it not to.
    const elevatedWarning = tracked
      ? `${path.basename(appPath)} requested administrator permission. SimLauncher will detect when it's running but cannot close it from here.`
      : `${path.basename(appPath)} requested administrator permission. Process tracking is off for this profile, so SimLauncher will not detect or close it.`

    // A kill (Close Apps) can land while the UAC handoff is still pending —
    // the consent prompt sits on screen until the user answers it, so this
    // window is wide (#670 Codex P2). Killing the PowerShell host is a best
    // effort to stop the pending Start-Process from proceeding, and it
    // unblocks the launch sequence immediately instead of leaving it parked
    // until the user answers a prompt they no longer want.
    let handoffPending = true
    /**
     * Killing the host does not remove the consent prompt, so whoever reports
     * the cancellation has to explain the dialog left behind (#809). Noted here
     * rather than at the caller because this is the moment we know a prompt was
     * pending, which also covers the window before the grace timer, where the
     * pending-handoff registry is still empty.
     *
     * Once per handoff, deliberately. A Close Apps arriving after the grace
     * window reaches the SAME handoff through both mechanisms, the abort signal
     * and the registry, and without this guard one prompt gets counted twice
     * and described in the plural.
     */
    let strandedPromptNoted = false
    const noteStrandedPromptOnce = () => {
      if (!strandedPromptNoted) {
        strandedPromptNoted = true
        noteStrandedConsentPrompt()
      }
    }
    // `child` is null only when the abort beat the host's start, and that path
    // returns below without arming the timer or attaching this listener — so
    // the optional call here and in the timer's cancel is never the reason
    // nothing gets killed. It is declared above the start because the callback
    // execFile is given references it, and that callback can fire synchronously.
    const onAbort = () => {
      if (handoffPending) {
        noteHandoffCancelled()
        noteStrandedPromptOnce()
        child?.kill()
      }
    }

    // Never let an unanswered UAC prompt hold the launch loop (and the global
    // single-flight guard) for the full ~120s consent timeout (#675). After a
    // bounded grace window, report the handoff optimistically as `elevated` and
    // let the sequence continue. The PowerShell host is deliberately left alive
    // so a late approval still starts the app, and tasklist reconciliation
    // reflects the true running state either way. resolve() is idempotent, so
    // the eventual callback below cannot un-settle the promise; abort still
    // kills the host because handoffPending stays true until it settles.
    //
    // The callback's real outcome is NOT discarded, though: once this timer has
    // fired, it is recorded in lateElevatedOutcomes so the sequence summary can
    // correct what it tells the user (#779). `timedOut` is the switch.
    // Captured at handoff creation, not read at callback time: by the time a
    // stalled host finally answers, launchRunId may already belong to a later
    // sequence, and that is precisely the write we must drop.
    const handoffRunId = launchRunId
    const handoffId = nextElevatedHandoffId()
    let timedOut = false
    // Set by cancelPendingElevatedHandoffs, i.e. a Close Apps that arrives after
    // the sequence already ended. The abort signal cannot cover that window: its
    // controller is unregistered once launchProfileApps returns.
    let cancelledByKill = false
    /**
     * Record the cancellation at KILL-REQUEST time, not from the execFile
     * callback. `child.kill()` only signals the PowerShell host; its callback
     * fires on process exit, which in production is asynchronous. The launch
     * loop resumes on that same abort and can build its summary before the
     * callback ever runs — and a summary built without this record sees
     * `unknown`, so it hedges that an app SimLauncher itself just killed "may
     * have started with administrator permission" (#779 Codex P2). The test
     * mock fired its callback synchronously from kill(), which hid the race.
     *
     * A no-op before the grace timer fires: until then the promise is unsettled,
     * so the callback still reports `cancelled` through the normal channel.
     */
    const noteHandoffCancelled = (): void => {
      if (timedOut) {
        recordLateElevatedOutcome(handoffRunId, handoffId, { appPath, outcome: 'cancelled' })
      }
    }
    const handoffTimer = setTimeout(() => {
      timedOut = true
      // The sequence is about to move on without this handoff, and its
      // controller will be unregistered when the sequence ends. Register the
      // still-live host so a later Close Apps can still reach it (#779 Codex
      // P1), otherwise approving the prompt afterwards would start the app the
      // user just asked to close.
      //
      // Not for a fire-and-forget profile though (#591). This registry has
      // exactly one consumer, `cancelPendingElevatedHandoffs`, called from both
      // kill entry points BEFORE they filter profile targets, so registering
      // here would let a global Close Apps kill the host of an app the user
      // opted out of us managing: the late approval would then start nothing
      // and they would be told a consent prompt was stranded. Not registering
      // is what leaves the prompt answerable.
      //
      // Only the post-grace-window registry is skipped. The abort signal above
      // still cancels this handoff while the sequence is in flight, because
      // cancelling a launch in progress is a different thing from managing the
      // apps it already started.
      if (tracked) {
        registerPendingElevatedHandoff(handoffId, {
          gameKey,
          // Recorded so cancellation can target the app rather than the whole
          // game (#782). A pending handoff has never started, so it has no
          // image name in any tasklist snapshot: these two are the only handle
          // anything downstream gets on which app it belongs to. The slot key
          // is needed as well as the path because two slots can point at one
          // exe with different args (#357), and cancelling the wrong one costs
          // the user a prompt they were about to approve.
          appKey,
          appPath,
          cancel: () => {
            cancelledByKill = true
            noteHandoffCancelled()
            // Same reason as onAbort (#809), and the same guard: mid-sequence
            // both this and the abort fire for this one handoff.
            noteStrandedPromptOnce()
            child?.kill()
          }
        })
      }
      resolve({
        status: 'elevated',
        appPath,
        warning: elevatedWarning,
        confirmed: false,
        handoffId
      })
    }, ELEVATED_HANDOFF_MAX_WAIT_MS)

    const child = execFileUnlessAborted(
      signal,
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
        unregisterPendingElevatedHandoff(handoffId)
        signal?.removeEventListener('abort', onAbort)
        if (error) {
          // An error after the abort is the expected shape of a cancelled
          // handoff (our own host kill, or the user denying a prompt they no
          // longer want) — report cancelled, and don't log it as a failure.
          // `cancelledByKill` covers the same thing for a Close Apps that landed
          // after the sequence ended, when the abort signal is no longer wired.
          if (signal?.aborted || cancelledByKill) {
            if (timedOut) {
              recordLateElevatedOutcome(handoffRunId, handoffId, { appPath, outcome: 'cancelled' })
            }
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
          if (timedOut) {
            recordLateElevatedOutcome(handoffRunId, handoffId, {
              appPath,
              outcome: 'failed',
              error: message
            })
          }
          resolve({ status: 'failed', appPath, error: message })
          return
        }

        // Success is reported truthfully even when an abort landed mid-handoff
        // (the user accepted the prompt before the host kill took effect): the
        // elevated app IS running and the kill cannot close it — the sequence's
        // cancellation message names it rather than implying it was closed.
        if (timedOut) {
          recordLateElevatedOutcome(handoffRunId, handoffId, { appPath, outcome: 'elevated' })
        }
        resolve({
          status: 'elevated',
          appPath,
          warning: elevatedWarning,
          confirmed: true,
          handoffId
        })
      }
    )

    if (!child) {
      // The launch was cancelled before the elevation host started. No consent
      // prompt was ever raised, so there is no host to kill and nothing
      // stranded on screen for the caller to explain (#809) — unlike every
      // later cancellation point in this function.
      handoffPending = false
      clearTimeout(handoffTimer)
      resolve({ status: 'cancelled', appPath })
      return
    }

    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Starts one profile entry and reports how it settled.
 *
 * @param trackingEnabled Whether SimLauncher manages what it starts. `false`
 * means fire-and-forget (#591): the process is never recorded, so it cannot
 * afterwards be surfaced in the running strip, counted, closed by Close Apps,
 * or auto-closed with the game. Omit it to resolve the setting from the active
 * profile in the store; pass it explicitly whenever the caller knows which
 * profile these entries came from, because mid profile-switch the store still
 * names the OUTGOING one (see `LaunchProfileAppsOptions.profileId`).
 */
export async function spawnDetachedApp(
  sender: WebContents,
  gameKey: string,
  entry: ProfileLaunchEntry,
  gamePath?: string,
  signal?: AbortSignal,
  trackingEnabled?: boolean
): Promise<AppLaunchResult> {
  const { path: appPath, key: appKey } = entry
  // Console-subsystem exes must NOT get DETACHED_PROCESS: without a console
  // they can exit before doing anything (powershell.exe exits 0 without
  // executing, #486). Spawned non-detached they allocate their own console,
  // and children outlive the parent on Windows either way. GUI apps keep the
  // long-standing detached behavior.
  //
  // A kill (Close Apps) can land while this PE-subsystem probe is in flight —
  // and while anything else the launch sequence awaits before reaching here is
  // in flight. None of those windows needs its own check: spawnUnlessAborted
  // re-reads the signal in the same synchronous block as spawn() (#715).
  const consoleApp = await isConsoleExecutable(appPath)
  // Resolved once per app rather than at each use below, so one launch cannot
  // end up half-tracked if the user flips the toggle while its handlers are
  // still pending.
  //
  // The caller passes it whenever the profile being launched is not the
  // persisted active one; the fallback covers direct use of this function.
  const isTracked = trackingEnabled ?? isProcessTrackingEnabled(getActiveProfileForGame(gameKey))

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
      const child = spawnUnlessAborted(signal, appPath, args, {
        cwd: path.dirname(appPath),
        detached: !consoleApp,
        stdio: 'ignore'
      })
      if (!child) {
        // The launch was cancelled before this app started. Nothing to
        // register, nothing to unwind, nothing running for the kill to miss.
        resolveOnce({ status: 'cancelled', appPath })
        return
      }
      const runningKey = normalizePathForComparison(appPath)
      // Fire-and-forget when this game's profile has tracking off (#591): the
      // app is never recorded, so it cannot be surfaced, counted, killed or
      // auto-closed later. Not recorded rather than filtered on the way out,
      // deliberately. A display filter was tried and reverted for two reasons
      // a filter cannot avoid: `launchedExeNames` is a global basename dedup
      // set built from the UNFILTERED list, so an untracked profile launching
      // a shared exe (SimHub is the normal case for multi-sim users) would
      // suppress a tracked profile's own copy of it and surface the companion
      // nowhere; and profile switch derives `isRunning` from the same list,
      // so hiding the apps silently skipped its stop/start pipeline while
      // reporting success.
      //
      // Not managing them afterwards is the feature, not a gap: the user asked
      // SimLauncher to be a launcher and nothing else.
      if (isTracked) {
        runningProcesses.set(runningKey, {
          process: child,
          path: appPath,
          name: path.basename(appPath),
          gameKey,
          isGame: !!gamePath && pathsEqual(appPath, gamePath)
        })
      }

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
          // A kill (Close Apps) can land between spawn() and this error event,
          // in which case launchElevated starts nothing and reports the attempt
          // as cancelled — its own start is guarded (#715). Nothing is running
          // here either way: this spawn failed.
          resolveOnce(
            await launchElevated(appPath, getAppArgs(appKey), gameKey, signal, isTracked, appKey)
          )
          return
        }

        writeAppErrorLog('launch', `[${gameKey}] Error launching ${appPath}: ${message}`)
        resolveOnce({ status: 'failed', appPath, error: message })
      })

      child.once('exit', () => {
        const processEntry = runningProcesses.get(runningKey)
        // Derived the same way as at record time rather than read back off the
        // entry, because the entry is not guaranteed to still be there: the
        // untracked reconcile prunes it (#591), and `?? false` then claimed the
        // game exe was a companion and toasted about it (Codex on #834).
        // Whether this path IS the game does not depend on whether we recorded
        // it, so it should not be stored in something prunable.
        const wasGame = !!gamePath && pathsEqual(appPath, gamePath)
        // Only drop the entry if it is still ours. Two slots can share a
        // canonical key (#357), and a late exit event for an already-killed
        // child must not wipe an entry that a subsequent spawn has just
        // installed (profile-switch path is the realistic trigger).
        if (processEntry?.process === child) {
          runningProcesses.delete(runningKey)
        }
        const exitedDuringPostLaunchWindow = Date.now() - launchStartedAt <= POST_LAUNCH_BLOCK_MS
        const wasClosedBySimLauncher = consumeProcessNameMismatchWarningSuppression(appPath)

        // The whole warning is about tracking having been lost, so it has
        // nothing to say to a profile that asked not to be tracked (#591). It
        // would also be the one thing still lighting that game's card, which is
        // exactly what fire-and-forget promises not to do.
        //
        // Both the launch-time decision AND the current one, because they can
        // disagree: this fires up to POST_LAUNCH_BLOCK_MS after the launch, so
        // a toggle inside that window leaves `isTracked` stale (Codex on #834).
        // The stored warning would be pruned by the reconcile on the next
        // publish, but the toast is already on the user's screen and there is
        // no retracting it. Re-read rather than replace: the message is only
        // ever true if the app was tracked when it started as well.
        //
        // Residual, accepted: mid profile-switch the store still names the
        // OUTGOING profile, so switching from an untracked profile to a tracked
        // one can swallow a legitimate warning for a few milliseconds. A missed
        // warning costs the user nothing permanent; a wrong one is a toast they
        // cannot dismiss the cause of.
        const stillTracked = isTracked && isProcessTrackingEnabled(getActiveProfileForGame(gameKey))

        if (stillTracked && exitedDuringPostLaunchWindow && !wasClosedBySimLauncher) {
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
        launchElevated(appPath, getAppArgs(appKey), gameKey, signal, isTracked, appKey).then(
          resolveOnce
        )
        return
      }

      writeAppErrorLog('launch', `[${gameKey}] Error launching ${appPath}: ${message}`)
      resolveOnce({ status: 'failed', appPath, error: message })
    }
  })
}
