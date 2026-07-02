import path from 'path'
import type { WebContents } from 'electron'

import {
  StoredProfileEntry,
  getActiveStoredProfile,
  getProfileTrackablePaths,
  getStoredProfiles
} from '../profiles'
import { getStoredStringRecord } from '../store'
import { getExeName, isValidExePath, normalizePathForComparison } from '../utils'

import { pruneUnclosedProcesses } from './kill'
import {
  processNameMismatchWarnings,
  pruneExpiredProcessNameMismatchWarnings,
  pruneStoppedRunningProcesses,
  runningProcesses,
  unclosedProcesses
} from './state'
import { readRunningProcessNames } from './tasklist'

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
// Whether the main window is currently visible, fed by its 'show'/'hide' events
// via setRunningAppsWindowVisible. Starts false because the window is created
// hidden (`show: false`) and only reveals once the renderer is ready — a
// start-minimized-to-tray session therefore begins on the SLOW cadence.
let runningAppsWindowVisible = false
// Timestamp of the last non-scan publish (launch/exit/kill). 0 means "no
// activity yet this session"; it keeps the poll FAST for POST_ACTIVITY_FAST_WINDOW_MS.
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

// A profile's tracked companion utilities are surfaced once that profile has at
// least one app surfaced (its game OR any companion launched by SimLauncher, or
// an unclosed / mismatch entry), or its game exe is detected running externally
// (adoption). NOTE: this is NOT gated on the game itself running — launching only
// a companion still surfaces that profile's companions (same aggregate-vs-game
// distinction as the green dot, #587; the in-session-exe question is #585/#586).
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
      const dedupeKey = `${gameKey}:${normalizePathForComparison(trackedPath)}`

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

export async function getRunningApps(): Promise<RunningApp[]> {
  const { processNames, succeeded: tasklistReadSucceeded } = await readRunningProcessNames()
  // When the tasklist read failed, processNames is an empty Set with no
  // signal value — skip pruning so we don't silently clear running/unclosed
  // state based on bogus "everything is gone" data (see #399).
  if (tasklistReadSucceeded) {
    pruneStoppedRunningProcesses(processNames)
    pruneUnclosedProcesses(processNames)
  }
  pruneExpiredProcessNameMismatchWarnings()

  const launchedApps = Array.from(runningProcesses.values()).map((appProcess) => ({
    path: appProcess.path,
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
      warning: appProcess.error,
      elevated: appProcess.elevated ?? appProcess.reason === 'access_denied'
    }))
  const surfacedApps = [...launchedApps, ...unclosedApps]
  // Mismatch-warning entries are shown only when the ORIGINAL exe is NOT in
  // the tasklist (i.e. only the child process survives). If the original exe
  // were still running it would appear in `surfacedApps` and no warning is
  // needed — the user can see and track it normally.
  const mismatchWarnings = Array.from(processNameMismatchWarnings.values())
    .filter((entry) => !processNames.has(getExeName(entry.path)))
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
  const profiles = getStoredProfiles()
  const appPaths = getStoredStringRecord('appPaths')
  const gamePaths = getStoredStringRecord('gamePaths')
  const launchedGameKeys = new Set(
    [...surfacedApps, ...mismatchWarnings].map((appProcess) => appProcess.gameKey)
  )
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
  // that sentinel and a backward clock jump (negative delta) so neither wedges
  // the poll on FAST.
  const activityDelta = Date.now() - lastRunningAppsActivityAt
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
  lastRunningAppsActivityAt = Date.now()
  resetRunningAppsCadence()
}

/**
 * Signal from the main window's 'show'/'hide' events. A visible window pulls the
 * poll back to FAST; hiding lets it fall back to SLOW once nothing is tracked.
 * Safe to call before any subscriber exists — it only records state.
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
  startRunningAppsMonitor()

  const apps = await getRunningApps()
  lastRunningAppsSnapshot = normalizeRunningAppsSnapshot(apps)
  return { apps, reason: 'initial', updatedAt: Date.now() } satisfies RunningAppsChangedPayload
}

export function unsubscribeRunningApps(webContents: WebContents): void {
  removeRunningAppsSubscriber(webContents)
}
