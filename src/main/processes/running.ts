import path from 'path'

import { StoredProfileEntry, getActiveStoredProfile, getProfileTrackablePaths } from '../profiles'
import { store } from '../store'
import { getExeName, isValidExePath } from '../utils'

import { pruneUnclosedProcesses } from './kill'
import { pruneStoppedRunningProcesses, runningProcesses, unclosedProcesses } from './state'
import { readRunningProcessNames } from './tasklist'

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
      const dedupeKey = `${gameKey}:${trackedPath.toLowerCase()}`

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

export async function getRunningApps() {
  const processNames = await readRunningProcessNames()
  pruneStoppedRunningProcesses(processNames)
  pruneUnclosedProcesses(processNames)

  const launchedApps = Array.from(runningProcesses.entries()).map(([appPath, appProcess]) => ({
    path: appPath,
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
      warning: appProcess.error
    }))
  const surfacedApps = [...launchedApps, ...unclosedApps]
  const launchedKeys = new Set(
    surfacedApps.map((appProcess) => `${appProcess.gameKey}:${appProcess.path.toLowerCase()}`)
  )
  const launchedExeNames = new Set(
    surfacedApps.map((appProcess) => path.basename(appProcess.path).toLowerCase())
  )
  const profiles = store.get('profiles') as Record<string, StoredProfileEntry> | undefined
  const appPaths = store.get('appPaths') as Record<string, string> | undefined
  const gamePaths = store.get('gamePaths') as Record<string, string> | undefined
  const launchedGameKeys = new Set(surfacedApps.map((appProcess) => appProcess.gameKey))
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
      !launchedKeys.has(`${appProcess.gameKey}:${appProcess.path.toLowerCase()}`) &&
      !launchedExeNames.has(path.basename(appProcess.path).toLowerCase())
  )

  return [...surfacedApps, ...trackedApps]
}
