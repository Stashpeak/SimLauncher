import path from 'path'
import { performance } from 'perf_hooks'
import type { WebContents } from 'electron'

import {
  StoredProfileEntry,
  getActiveStoredProfile,
  getProfileTrackablePaths,
  getStoredProfiles,
  isProcessTrackingEnabled
} from '../profiles'
import { getStoredStringRecord } from '../store'
import { getExeName, isValidExePath, normalizePathForComparison } from '../utils'

import { pruneUnclosedProcesses } from './kill'
import {
  isLaunchActiveForGame,
  processNameMismatchWarnings,
  pruneExpiredProcessNameMismatchWarnings,
  pruneStoppedRunningProcesses,
  pruneUntrackedGames,
  runningProcesses,
  unclosedProcesses
} from './state'
import { isTrackedPathRunning, resolveTrackedPathStates } from './pathResolution'
import { readRunningProcessNames, type RunningProcessNamesResult } from './tasklist'

/**
 * A main-process consumer of one raw tasklist read.
 *
 * `succeeded === false` means the read failed and `processNames` is an empty
 * Set carrying no information. An observer MUST treat that as "no observation"
 * rather than "nothing is running", or one failed read reads as everything on
 * the machine having stopped at once.
 */
export type ProcessScanObserver = (result: RunningProcessNamesResult) => void

const processScanObservers = new Set<ProcessScanObserver>()

export interface RunningApp {
  path: string
  name: string
  gameKey: string
  tracked: boolean
  warning?: string
  elevated?: boolean
}
export type RunningAppsChangeReason = 'initial' | 'launch' | 'exit' | 'kill' | 'config' | 'scan'

export interface RunningAppsChangedPayload {
  apps: RunningApp[]
  reason: RunningAppsChangeReason
  updatedAt: number
}

const RUNNING_APPS_CHANGED_CHANNEL = 'running-apps-changed'
// The process scan spawns `tasklist.exe` (plus a `conhost.exe`) every tick, so
// the cadence is adaptive (#672): keep the responsive FAST poll only while it
// earns that cost and back off to SLOW when idle in the tray, where a stale-by-
// a-few-seconds list costs the user nothing.
const FAST_RUNNING_APPS_SCAN_INTERVAL_MS = 2000
const SLOW_RUNNING_APPS_SCAN_INTERVAL_MS = 12000
// After any launch/exit/kill, stay on FAST for this long so a settling launch
// sequence (spawn → child re-exec → external adoption) is still tracked live
// even once the window is hidden.
const POST_ACTIVITY_FAST_WINDOW_MS = 30000
const runningAppsSubscribers = new Set<WebContents>()
let runningAppsScanTimer: ReturnType<typeof setTimeout> | undefined
let runningAppsMonitorActive = false
// Whether the main window is currently both shown AND un-minimized, recomputed
// from live window state on its 'show'/'hide'/'minimize'/'restore'/'focus'
// events (#708) via setRunningAppsWindowVisible. Starts false because the
// window is created hidden (`show: false`) and only reveals once the renderer
// is ready — a start-minimized-to-tray session therefore begins on the SLOW
// cadence.
let runningAppsWindowVisible = false
// Monotonic (performance.now()) timestamp of the last non-scan publish
// (launch/exit/kill). 0 means "no activity yet this session"; it keeps the poll
// FAST for POST_ACTIVITY_FAST_WINDOW_MS. Monotonic rather than Date.now() (#708)
// so a wall-clock jump (NTP sync, VM host suspend/resume) cannot collapse or
// extend the window — it can only elapse at real wall-clock speed.
let lastRunningAppsActivityAt = 0
let lastRunningAppsSnapshot = ''
// Number of apps in the last published snapshot. Includes externally-ADOPTED
// apps (a configured game started outside SimLauncher) which are surfaced via
// the scan but never populate runningProcesses/unclosedProcesses — so the
// cadence must consult this, not only the launcher-owned maps, or an adopted
// external session would wrongly back off to SLOW. #672
let lastPublishedRunningAppsCount = 0
let publishRunningAppsPromise: Promise<RunningAppsChangedPayload | null> | undefined

/**
 * Identify game keys whose configured game exe is running externally (i.e. the
 * user launched the game outside of SimLauncher) so their companion apps can
 * still be surfaced in the UI.
 *
 * Adoption is intentionally restricted to the case where `owners.size === 1`:
 * if two profiles share the same game exe (e.g. two editions of the same game
 * pointing at the same binary) it is ambiguous which profile owns the running
 * process, so we adopt neither rather than guess and surface the wrong profile's
 * companion utilities.
 */
function getExternallyAdoptableGameKeys(
  isPathRunning: (appPath: string) => boolean,
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

    // `isValidExePath` takes `unknown` and returns a plain boolean, so it does
    // not narrow; the query below needs a string.
    if (typeof gamePath !== 'string') {
      return
    }

    // Path-verified (#674). Adopting on the image name alone surfaced a whole
    // profile's companion list because something shared the game exe's name,
    // which is the widest blast radius the collision had: one stranger, and a
    // game the user never started looks like a live session.
    if (owners?.size === 1 && isPathRunning(gamePath)) {
      adoptableGameKeys.add(gameKey)
    }
  })

  return adoptableGameKeys
}

// A profile's tracked companion utilities are surfaced once that profile has at
// least one app surfaced (its game OR any companion launched by SimLauncher, or
// an unclosed / mismatch entry), or its game exe is detected running externally
// (adoption). NOTE: this is NOT gated on the game itself running — launching only
// a companion still surfaces that profile's companions (same aggregate-vs-game
// distinction as the green dot, #587; the in-session-exe question is #585/#586).
async function getTrackedRunningApps(
  isPathRunning: (appPath: string) => boolean,
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

    if (!isProcessTrackingEnabled(profile)) {
      return
    }

    const pathsToTrack = getProfileTrackablePaths(gameKey, profile, appPaths, gamePaths)

    pathsToTrack.forEach((trackedPath) => {
      const dedupeKey = `${gameKey}:${normalizePathForComparison(trackedPath)}`

      // THE phantom icon (#674). This is the line that drew a strip entry for a
      // configured app that was not running, because something unrelated on the
      // system shared its exe name. The icon could not be dismissed either: it
      // is derived here on every tick rather than stored, so `dismissAppIcon`
      // had nothing to delete and it came straight back.
      if (isPathRunning(trackedPath) && !seen.has(dedupeKey)) {
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

/**
 * Register a main-process observer of the RAW tasklist result (#204).
 *
 * Deliberately raw rather than the published `RunningApp[]`: the #399 guard
 * below protects PRUNING only, so on a failed read the empty `processNames`
 * still flows into `unclosedApps`, `getExternallyAdoptableGameKeys` and
 * `getTrackedRunningApps`, and an externally adopted game plus every tracked
 * companion drop out of the published snapshot for that tick. Anything deciding
 * "the game exited" from that list would read one failed read as an exit. An
 * observer gets `succeeded` and can treat false as "no observation" instead.
 *
 * A registration hook rather than a direct import so this module never has to
 * know about auto-close, which reaches `killLaunchedApps` and would otherwise
 * deepen the existing running/kill import cycle.
 */
export function registerProcessScanObserver(observer: ProcessScanObserver): void {
  processScanObservers.add(observer)
}

/**
 * Drop every surfaced record belonging to a game whose active profile has
 * process tracking off (#591).
 *
 * Turning tracking off has to take effect on apps that are ALREADY recorded,
 * not just on the next launch. `runningProcesses` is written at launch time and
 * nothing removes an entry until its exe exits, so a profile launched while
 * tracked would otherwise keep its strip icons, its dot and its Close Apps
 * entry for the rest of the session, contradicting the setting the user just
 * saved. Forget, never kill: those apps were started deliberately, and
 * fire-and-forget means they outlive our interest in them.
 *
 * Deliberately SYNCHRONOUS, and called from two places for that reason
 * (CodeRabbit on #834). Doing it only inside `getRunningApps` puts it behind
 * that function's `tasklist` await, leaving a window after the profile is saved
 * in which `killLaunchedApps` still finds the stale entries and closes apps the
 * user just opted out of. `publishRunningApps` runs it at call time instead, so
 * a save reconciles before it returns; `getRunningApps` keeps its own call for
 * the paths that reach it without a publish (the `get-running-apps` handler).
 * Idempotent, so running it twice per publish costs one store read.
 *
 * Games with a launch in flight are skipped, and that is load-bearing rather
 * than an optimisation. This reads the store's ACTIVE profile, which during a
 * profile switch still names the OUTGOING one: the renderer launches the
 * incoming profile's apps before saving the new `activeProfileId`. Reconciling
 * in that window would prune the entries the incoming TRACKED profile just
 * correctly recorded, on the authority of the outgoing untracked one. It is the
 * same staleness `LaunchProfileAppsOptions.profileId` exists to defeat, and the
 * same reason auto-close consults this primitive before reading an absence as
 * an exit (#204). A toggle saved mid-launch is simply applied by the next
 * publish, once the sequence has ended and the store agrees with itself.
 */
function reconcileUntrackedGames(): void {
  pruneUntrackedGames(
    new Set(
      Object.entries(getStoredProfiles())
        .filter(
          ([gameKey, profileEntry]) =>
            !isLaunchActiveForGame(gameKey) &&
            !isProcessTrackingEnabled(getActiveStoredProfile(profileEntry))
        )
        .map(([gameKey]) => gameKey)
    )
  )
}

export async function getRunningApps(): Promise<RunningApp[]> {
  const readResult = await readRunningProcessNames()
  // `processNames` is deliberately not read here any more (#674). Every
  // question this function asks is now about a PATH, and the snapshot reaches
  // the resolver whole, so a name-only decision cannot creep back in by
  // reaching for a set that happened to be in scope.
  const { succeeded: tasklistReadSucceeded } = readResult
  // Observers run before any derivation below, on every read rather than only
  // on scan ticks, and never get to break the caller: a throwing observer must
  // not take the running-apps list down with it.
  processScanObservers.forEach((observer) => {
    try {
      observer(readResult)
    } catch (err) {
      console.error('Process scan observer error:', err)
    }
  })
  const profiles = getStoredProfiles()
  const appPaths = getStoredStringRecord('appPaths')
  const gamePaths = getStoredStringRecord('gamePaths')

  // Every path this tick could ask about, gathered before anything is decided
  // so the whole tick costs ONE resolution rather than one per question (#674).
  //
  // Deliberately a superset: it spans all profiles, not just the ones that turn
  // out to be adopted or launched, because adoption is itself one of the
  // questions being answered. That costs nothing, since a path whose image name
  // is absent from the snapshot is resolved for free and never reaches an
  // enumeration.
  //
  // Collected BEFORE the pruning below, which is what makes pruning by path
  // possible at all: a record about to be dropped still needs its own question
  // answered.
  const candidatePaths = new Set<string>()
  Object.entries(profiles || {}).forEach(([gameKey, profileEntry]) => {
    getProfileTrackablePaths(
      gameKey,
      getActiveStoredProfile(profileEntry),
      appPaths,
      gamePaths
    ).forEach((trackablePath) => candidatePaths.add(trackablePath))
  })
  Object.values(gamePaths || {}).forEach((gamePath) => {
    if (isValidExePath(gamePath)) {
      candidatePaths.add(gamePath)
    }
  })
  runningProcesses.forEach((entry) => candidatePaths.add(entry.path))
  unclosedProcesses.forEach((entry) => candidatePaths.add(entry.path))
  processNameMismatchWarnings.forEach((entry) => candidatePaths.add(entry.path))

  const pathStates = await resolveTrackedPathStates(readResult, Array.from(candidatePaths))
  // Folds `unknown` and "not asked" into "running", the same conservative
  // reading the launch and kill paths use: a path that MIGHT be running must
  // not have its record deleted or its icon pulled.
  //
  // The `tasklistReadSucceeded` term keeps a failed read behaving exactly as it
  // did before #674, deliberately rather than by omission. A failed read used to
  // yield an empty `processNames`, so every derivation below answered "not
  // running" and the tick published an empty list; folding it to "running"
  // instead would be a real behaviour change (the strip would freeze rather than
  // blank) and it is not this issue's to make. Pruning is unaffected either way,
  // being already gated on the same flag.
  const isPathRunning = (appPath: string) =>
    tasklistReadSucceeded && isTrackedPathRunning(pathStates.get(appPath))

  // When the tasklist read failed, processNames is an empty Set with no
  // signal value — skip pruning so we don't silently clear running/unclosed
  // state based on bogus "everything is gone" data (see #399).
  if (tasklistReadSucceeded) {
    pruneStoppedRunningProcesses(isPathRunning)
    pruneUnclosedProcesses(isPathRunning)
  }
  pruneExpiredProcessNameMismatchWarnings()
  reconcileUntrackedGames()

  const launchedApps = Array.from(runningProcesses.values()).map((appProcess) => ({
    path: appProcess.path,
    name: appProcess.name,
    gameKey: appProcess.gameKey,
    tracked: false
  }))
  const unclosedApps = Array.from(unclosedProcesses.values())
    .filter((appProcess) => isPathRunning(appProcess.path))
    .map((appProcess) => ({
      path: appProcess.path,
      name: appProcess.name,
      gameKey: appProcess.gameKey,
      tracked: true,
      warning: appProcess.error,
      elevated: appProcess.elevated ?? appProcess.reason === 'access_denied'
    }))
  const surfacedApps = [...launchedApps, ...unclosedApps]
  // Mismatch-warning entries are shown only when the ORIGINAL exe is NOT
  // running (i.e. only the child process survives). If the original were still
  // running it would appear in `surfacedApps` and no warning is needed — the
  // user can see and track it normally.
  //
  // Path-verified like the rest (#674), and here the collision SUPPRESSED a
  // real warning rather than inventing one: a stranger holding the name made
  // the original look alive, so the user was told nothing about a companion
  // that had re-execed under a name SimLauncher cannot track.
  const mismatchWarnings = Array.from(processNameMismatchWarnings.values())
    .filter((entry) => !isPathRunning(entry.path))
    .map((entry) => ({
      path: entry.path,
      name: entry.name,
      gameKey: entry.gameKey,
      tracked: false,
      warning: entry.warning
    }))
  const warningKeys = new Set(
    mismatchWarnings.map(
      (appProcess) => `${appProcess.gameKey}:${normalizePathForComparison(appProcess.path)}`
    )
  )
  const launchedKeys = new Set(
    surfacedApps.map(
      (appProcess) => `${appProcess.gameKey}:${normalizePathForComparison(appProcess.path)}`
    )
  )
  const launchedExeNames = new Set(surfacedApps.map((appProcess) => getExeName(appProcess.path)))
  const launchedGameKeys = new Set(
    [...surfacedApps, ...mismatchWarnings].map((appProcess) => appProcess.gameKey)
  )
  const adoptedGameKeys = getExternallyAdoptableGameKeys(
    isPathRunning,
    profiles,
    gamePaths,
    launchedGameKeys
  )
  const adoptedOrLaunchedGameKeys = new Set([...launchedGameKeys, ...adoptedGameKeys])
  const trackedApps = (
    await getTrackedRunningApps(
      isPathRunning,
      adoptedOrLaunchedGameKeys,
      profiles,
      appPaths,
      gamePaths
    )
  ).filter(
    (appProcess) =>
      !launchedKeys.has(`${appProcess.gameKey}:${normalizePathForComparison(appProcess.path)}`) &&
      !launchedExeNames.has(getExeName(appProcess.path))
  )

  return [
    ...surfacedApps,
    ...mismatchWarnings.filter(
      (appProcess) =>
        !launchedKeys.has(`${appProcess.gameKey}:${normalizePathForComparison(appProcess.path)}`)
    ),
    ...trackedApps.filter(
      (appProcess) =>
        !warningKeys.has(`${appProcess.gameKey}:${normalizePathForComparison(appProcess.path)}`)
    )
  ]
}

function normalizeRunningAppsSnapshot(apps: RunningApp[]) {
  return JSON.stringify(
    apps.map((app) => ({
      elevated: app.elevated ?? false,
      gameKey: app.gameKey,
      name: app.name,
      path: app.path,
      tracked: app.tracked ?? false,
      warning: app.warning ?? ''
    }))
  )
}

function removeRunningAppsSubscriber(webContents: WebContents) {
  runningAppsSubscribers.delete(webContents)

  if (runningAppsSubscribers.size === 0 && runningAppsMonitorActive) {
    stopRunningAppsMonitor()
    // Reset the snapshot so the first emission after the next subscriber
    // re-subscribes is always sent regardless of whether the app list changed
    // while there were no subscribers.
    lastRunningAppsSnapshot = ''
  }
}

function emitRunningAppsChanged(payload: RunningAppsChangedPayload) {
  runningAppsSubscribers.forEach((webContents) => {
    if (webContents.isDestroyed()) {
      removeRunningAppsSubscriber(webContents)
      return
    }

    webContents.send(RUNNING_APPS_CHANGED_CHANNEL, payload)
  })
}

async function publishRunningAppsInternal(
  reason: RunningAppsChangeReason
): Promise<RunningAppsChangedPayload | null> {
  if (runningAppsSubscribers.size === 0) {
    return null
  }

  const apps = await getRunningApps()
  // Refresh on every scan (before the change-gate below) so the cadence always
  // reflects what's actually surfaced, including adopted external apps.
  lastPublishedRunningAppsCount = apps.length
  const snapshot = normalizeRunningAppsSnapshot(apps)

  if (snapshot === lastRunningAppsSnapshot && reason === 'scan') {
    return null
  }

  lastRunningAppsSnapshot = snapshot
  const payload = { apps, reason, updatedAt: Date.now() }
  emitRunningAppsChanged(payload)
  return payload
}

/**
 * Schedule a running-apps broadcast, serializing calls so that concurrent
 * triggers (e.g. a spawn 'spawn' event races the periodic scanner) do not
 * issue parallel tasklist reads that could produce out-of-order snapshots on
 * the renderer. Each call chains its own invocation (with its own reason)
 * onto the previous promise, so every trigger still publishes — just in
 * arrival order.
 */
export function publishRunningApps(
  reason: RunningAppsChangeReason = 'scan'
): Promise<RunningAppsChangedPayload | null> {
  // Any non-scan publish is real activity (launch/exit/kill) — pull the poll
  // back to FAST and hold it there for POST_ACTIVITY_FAST_WINDOW_MS so the
  // settling process set is tracked live even if the window is hidden.
  if (reason !== 'scan') {
    noteRunningAppsActivity()
  }
  // Before the chain, not inside it: a `'config'` publish follows the profile
  // write synchronously, so reconciling here is what makes the tracking toggle
  // take effect by the time the save handler returns rather than one tasklist
  // read later (#591).
  //
  // Guarded, because running it synchronously moved it onto the CALLER's stack:
  // `save-profile` calls this right after writing the store, so an exception in
  // here would now fail the save itself, where the same exception inside the
  // promise chain below was contained by the caller's `.catch`. Reconciling the
  // running-apps view must never be able to take down a settings write.
  try {
    reconcileUntrackedGames()
  } catch (err) {
    console.error('Failed to reconcile untracked games before publishing:', err)
  }

  const next = (publishRunningAppsPromise || Promise.resolve(null))
    .catch(() => null)
    .then(() => publishRunningAppsInternal(reason))
    .finally(() => {
      if (publishRunningAppsPromise === next) {
        publishRunningAppsPromise = undefined
      }
    })

  publishRunningAppsPromise = next
  return publishRunningAppsPromise
}

/**
 * Pick the delay until the next process scan. FAST while the poll is earning its
 * `tasklist.exe` spawn — recent launch activity, a visible window, or any app
 * currently running (launcher-owned OR externally adopted, via the last
 * published count) — and SLOW only when the window is hidden AND nothing is
 * running (the idle-in-tray case #672 targets). The poll never stops, so a
 * first external launch is still adopted within one slow tick, then held FAST.
 */
function computeRunningAppsScanDelayMs(): number {
  // lastRunningAppsActivityAt === 0 means "no activity yet this session"; guard
  // that sentinel. performance.now() is monotonic, so a backward delta can only
  // come from that sentinel (never a real wall-clock jump), but the guard is
  // kept as defense in depth.
  const activityDelta = performance.now() - lastRunningAppsActivityAt
  const withinPostActivityWindow =
    lastRunningAppsActivityAt !== 0 &&
    activityDelta >= 0 &&
    activityDelta < POST_ACTIVITY_FAST_WINDOW_MS
  const hasTrackedProcesses = runningProcesses.size > 0 || unclosedProcesses.size > 0

  if (
    withinPostActivityWindow ||
    runningAppsWindowVisible ||
    hasTrackedProcesses ||
    lastPublishedRunningAppsCount > 0
  ) {
    return FAST_RUNNING_APPS_SCAN_INTERVAL_MS
  }

  return SLOW_RUNNING_APPS_SCAN_INTERVAL_MS
}

// Self-rescheduling scan: each tick re-evaluates the cadence, so the poll can
// move between FAST and SLOW as visibility/activity/tracking change without ever
// stopping. A one-shot setTimeout (not setInterval) is what lets the delay vary.
function scheduleNextRunningAppsScan() {
  if (!runningAppsMonitorActive) {
    return
  }

  if (runningAppsScanTimer) {
    clearTimeout(runningAppsScanTimer)
  }

  runningAppsScanTimer = setTimeout(() => {
    publishRunningApps('scan')
      .catch((err) => {
        console.error('Running apps monitor error:', err)
      })
      .finally(scheduleNextRunningAppsScan)
  }, computeRunningAppsScanDelayMs())
}

function startRunningAppsMonitor() {
  if (runningAppsMonitorActive) {
    return
  }

  runningAppsMonitorActive = true
  scheduleNextRunningAppsScan()
}

function stopRunningAppsMonitor() {
  runningAppsMonitorActive = false
  if (runningAppsScanTimer) {
    clearTimeout(runningAppsScanTimer)
    runningAppsScanTimer = undefined
  }
}

// Recompute the cadence now instead of waiting out a pending SLOW timer. Called
// when something should pull the poll back to FAST (launch activity, the window
// becoming visible); a no-op when the monitor isn't running.
function resetRunningAppsCadence() {
  if (runningAppsMonitorActive) {
    scheduleNextRunningAppsScan()
  }
}

function noteRunningAppsActivity() {
  lastRunningAppsActivityAt = performance.now()
  resetRunningAppsCadence()
}

/**
 * Signal from the main window's visibility state (show/hide AND minimize/restore,
 * see the #708 comment in window.ts). A visible, non-minimized window pulls the
 * poll back to FAST; anything else lets it fall back to SLOW once nothing is
 * tracked. Safe to call before any subscriber exists — it only records state.
 */
export function setRunningAppsWindowVisible(visible: boolean): void {
  runningAppsWindowVisible = visible
  if (visible) {
    resetRunningAppsCadence()
  }
}

export async function subscribeRunningApps(
  webContents: WebContents
): Promise<RunningAppsChangedPayload> {
  runningAppsSubscribers.add(webContents)
  webContents.once('destroyed', () => removeRunningAppsSubscriber(webContents))

  const apps = await getRunningApps()
  // Seed the cadence-gating count from this bootstrap read BEFORE starting the
  // monitor (#708). Previously the monitor started first and scheduled its
  // first scan off the pre-subscription (stale, often 0) count, so a
  // start-minimized launch with an already-running adopted game would
  // bootstrap on the SLOW cadence for one tick (<=12s) before the first scan
  // self-corrected it. One-time and self-healing, but avoidable.
  lastPublishedRunningAppsCount = apps.length
  lastRunningAppsSnapshot = normalizeRunningAppsSnapshot(apps)
  startRunningAppsMonitor()

  return { apps, reason: 'initial', updatedAt: Date.now() } satisfies RunningAppsChangedPayload
}

export function unsubscribeRunningApps(webContents: WebContents): void {
  removeRunningAppsSubscriber(webContents)
}
