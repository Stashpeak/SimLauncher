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
const RUNNING_APPS_SCAN_INTERVAL_MS = 2000
const runningAppsSubscribers = new Set<WebContents>()
let runningAppsMonitor: ReturnType<typeof setInterval> | undefined
let lastRunningAppsSnapshot = ''
let publishRunningAppsPromise: Promise<RunningAppsChangedPayload | null> | undefined

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

  if (runningAppsSubscribers.size === 0 && runningAppsMonitor) {
    clearInterval(runningAppsMonitor)
    runningAppsMonitor = undefined
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
  const snapshot = normalizeRunningAppsSnapshot(apps)

  if (snapshot === lastRunningAppsSnapshot && reason === 'scan') {
    return null
  }

  lastRunningAppsSnapshot = snapshot
  const payload = { apps, reason, updatedAt: Date.now() }
  emitRunningAppsChanged(payload)
  return payload
}

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
  return { apps, reason: 'initial', updatedAt: Date.now() } satisfies RunningAppsChangedPayload
}

export function unsubscribeRunningApps(webContents: WebContents): void {
  removeRunningAppsSubscriber(webContents)
}
