import path from 'path'
import type { WebContents } from 'electron'

import {
  StoredProfileEntry,
  getActiveStoredProfile,
  getProfileTrackablePaths,
  getStoredProfiles
} from '../profiles'
import { getStoredStringRecord } from '../store'
import { getExeName, isValidExePath, normalizePathForComparison, pathsEqual } from '../utils'

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
const RUNNING_APPS_SCAN_INTERVAL_MS = 2000
const runningAppsSubscribers = new Set<WebContents>()

type RunningAppsChangeListener = (payload: RunningAppsChangedPayload) => void
// Main-process (non-renderer) listeners, e.g. the tray menu rebuilding its
// "Close Apps" enabled state. Kept separate from the WebContents subscribers
// because they receive the payload directly rather than over IPC.
const runningAppsChangeListeners = new Set<RunningAppsChangeListener>()

// Cached result of "is there a closable companion running" so the tray menu can
// decide its enabled state synchronously (Menu.buildFromTemplate is sync). It is
// refreshed on every getRunningApps() computation — see hasClosableApps.
let closableAppsCached = false
let runningAppsMonitor: ReturnType<typeof setInterval> | undefined
let lastRunningAppsSnapshot = ''
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

// INVARIANT: manual companion utilities are only surfaced when the owning game is
// already launched by SimLauncher or its configured game exe is externally running.
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

  const filteredMismatchWarnings = mismatchWarnings.filter(
    (appProcess) =>
      !launchedKeys.has(`${appProcess.gameKey}:${normalizePathForComparison(appProcess.path)}`)
  )
  const filteredTrackedApps = trackedApps.filter(
    (appProcess) =>
      !warningKeys.has(`${appProcess.gameKey}:${normalizePathForComparison(appProcess.path)}`)
  )

  // Refresh the tray's "Close Apps" enabled state. Closable = anything
  // killLaunchedApps can target: launched companions, still-running unclosed
  // companions, and externally-tracked companions. The game is excluded, and so
  // are mismatch warnings — their original exe is already gone from the tasklist
  // (only the renamed child survives), so the kill cannot act on them.
  closableAppsCached = [...surfacedApps, ...filteredTrackedApps].some(
    (app) => !isGameApp(app, gamePaths)
  )

  return [...surfacedApps, ...filteredMismatchWarnings, ...filteredTrackedApps]
}

// A surfaced running app is the game itself (not a closable companion) when its
// path matches the profile's configured game exe. killLaunchedApps never
// terminates the game, so it must not drive the "Close Apps" enabled state.
function isGameApp(app: RunningApp, gamePaths: Record<string, string> | undefined): boolean {
  const gamePath = gamePaths?.[app.gameKey]
  return !!gamePath && pathsEqual(app.path, gamePath)
}

/**
 * Whether the tray "Close Apps" action has anything to act on (#519): at least
 * one running companion (non-game) app that killLaunchedApps could close.
 *
 * Synchronous (Menu.buildFromTemplate is) by returning the value cached on the
 * last getRunningApps() computation. That cache is refreshed on every launch,
 * exit, kill and the periodic scan, so it stays current within the scan
 * interval. Sourcing it from getRunningApps — rather than runningProcesses
 * alone — means elevated and externally-running companions, which never enter
 * runningProcesses but are still reachable by killLaunchedApps, are counted too,
 * while the game and mismatch warnings (which the kill cannot act on) are not.
 */
export function hasClosableApps(): boolean {
  return closableAppsCached
}

/**
 * Register a main-process listener for running-apps changes (the tray uses this
 * to refresh its "Close Apps" enabled state). Returns an unsubscribe function.
 *
 * Listeners fire from the same emission path as renderer subscribers, which is
 * gated on there being at least one renderer subscriber. In practice the
 * renderer's WebContents stays subscribed for the whole app lifetime (it is only
 * destroyed on quit, not when minimized to the tray), so the tray — which only
 * exists alongside that window — receives every change.
 */
export function addRunningAppsChangeListener(listener: RunningAppsChangeListener): () => void {
  runningAppsChangeListeners.add(listener)
  return () => {
    runningAppsChangeListeners.delete(listener)
  }
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

  if (runningAppsSubscribers.size === 0 && runningAppsMonitor) {
    clearInterval(runningAppsMonitor)
    runningAppsMonitor = undefined
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

  notifyRunningAppsChangeListeners(payload)
}

function notifyRunningAppsChangeListeners(payload: RunningAppsChangedPayload) {
  runningAppsChangeListeners.forEach((listener) => {
    // Isolate listener failures: a misbehaving main-process listener (e.g. the
    // tray menu rebuild) must not reject the publish promise that kill/spawn
    // callers await, nor stop other listeners from running.
    try {
      listener(payload)
    } catch (err) {
      console.error('Running apps change listener error:', err)
    }
  })
}

async function publishRunningAppsInternal(
  reason: RunningAppsChangeReason
): Promise<RunningAppsChangedPayload | null> {
  if (runningAppsSubscribers.size === 0) {
    return null
  }

  const apps = await getRunningApps()
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

function startRunningAppsMonitor() {
  if (runningAppsMonitor) {
    return
  }

  runningAppsMonitor = setInterval(() => {
    publishRunningApps('scan').catch((err) => {
      console.error('Running apps monitor error:', err)
    })
  }, RUNNING_APPS_SCAN_INTERVAL_MS)
}

export async function subscribeRunningApps(
  webContents: WebContents
): Promise<RunningAppsChangedPayload> {
  runningAppsSubscribers.add(webContents)
  webContents.once('destroyed', () => removeRunningAppsSubscriber(webContents))
  startRunningAppsMonitor()

  const apps = await getRunningApps()
  lastRunningAppsSnapshot = normalizeRunningAppsSnapshot(apps)
  const payload = {
    apps,
    reason: 'initial',
    updatedAt: Date.now()
  } satisfies RunningAppsChangedPayload
  // Notify main-process listeners (the tray) with the initial snapshot so the
  // menu reflects companions that were already running before the renderer
  // subscribed. emitRunningAppsChanged is not used here because the subscribing
  // WebContents receives this payload as the return value instead.
  notifyRunningAppsChangeListeners(payload)
  return payload
}

export function unsubscribeRunningApps(webContents: WebContents): void {
  removeRunningAppsSubscriber(webContents)
}
