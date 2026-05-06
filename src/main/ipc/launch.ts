import { ipcMain } from 'electron'

import { buildActiveProfileLaunchPaths, buildNamedProfileLaunchPaths } from '../profiles'
import {
  type KillResult,
  getRunningApps,
  isRunningExePath,
  killLaunchedApps,
  killProfileApps,
  launchProfileApps,
  readRunningProcessNames,
  subscribeRunningApps,
  unsubscribeRunningApps
} from '../processes'
import { store } from '../store'
import { getExeName } from '../utils'

export function validateGameKey(gameKey: unknown) {
  if (typeof gameKey !== 'string') {
    return { success: false, error: 'Invalid argument' }
  }

  if (!Object.keys(store.get('gamePaths', {}) as Record<string, string>).includes(gameKey)) {
    return { success: false, error: 'Unknown game key' }
  }

  return undefined
}

export function registerLaunchHandlers() {
  ipcMain.handle('launch-profile', async (event, gameKey: string) => {
    const validationError = validateGameKey(gameKey)
    if (validationError) {
      return validationError
    }

    const profileApps = buildActiveProfileLaunchPaths(gameKey)

    if (profileApps.length === 0) {
      return { success: false, error: 'No executable paths configured for this profile.' }
    }

    return launchProfileApps(event.sender, gameKey, profileApps)
  })

  ipcMain.handle('relaunch-missing-profile', async (event, gameKey: string) => {
    const validationError = validateGameKey(gameKey)
    if (validationError) {
      return validationError
    }

    const allPaths = buildActiveProfileLaunchPaths(gameKey)

    if (allPaths.length === 0) {
      return { success: false, error: 'No executable paths configured for this profile.' }
    }

    const processNames = await readRunningProcessNames()
    const missingPaths = allPaths.filter((p) => !isRunningExePath(processNames, p))

    if (missingPaths.length === 0) {
      return {
        success: true,
        message: 'All profile apps are already running.',
        launchedCount: 0,
        skippedCount: 0
      }
    }

    return launchProfileApps(event.sender, gameKey, missingPaths)
  })

  ipcMain.handle(
    'get-profile-switch-diff',
    async (_event, gameKey: string, fromProfileId: string, toProfileId: string) => {
      const validationError = validateGameKey(gameKey)
      if (validationError) {
        return validationError
      }

      const gamePaths = (store.get('gamePaths') as Record<string, string> | undefined) || {}
      const gamePath = gamePaths[gameKey]?.toLowerCase()
      const processNames = await readRunningProcessNames()

      const utilityPaths = (profileId: string) =>
        new Set(
          buildNamedProfileLaunchPaths(gameKey, profileId)
            .filter((p) => !gamePath || p.toLowerCase() !== gamePath)
            .map((p) => p.toLowerCase())
        )

      const fromPaths = utilityPaths(fromProfileId)
      const toPaths = utilityPaths(toProfileId)
      const toStopCount = [...fromPaths].filter(
        (p) => !toPaths.has(p) && processNames.has(getExeName(p))
      ).length
      const toStartCount = [...toPaths].filter((p) => !processNames.has(getExeName(p))).length

      return { toStopCount, toStartCount }
    }
  )

  ipcMain.handle(
    'switch-profile-apps',
    async (event, gameKey: string, fromProfileId: string, toProfileId: string) => {
      const validationError = validateGameKey(gameKey)
      if (validationError) {
        return validationError
      }

      const gamePaths = (store.get('gamePaths') as Record<string, string> | undefined) || {}
      const gamePath = gamePaths[gameKey]?.toLowerCase()

      const fromPaths = buildNamedProfileLaunchPaths(gameKey, fromProfileId).filter(
        (p) => !gamePath || p.toLowerCase() !== gamePath
      )
      const toPaths = buildNamedProfileLaunchPaths(gameKey, toProfileId).filter(
        (p) => !gamePath || p.toLowerCase() !== gamePath
      )
      const toPathSet = new Set(toPaths.map((p) => p.toLowerCase()))
      const processNamesBeforeSwitch = await readRunningProcessNames()

      const pathsToStop = fromPaths.filter(
        (p) => !toPathSet.has(p.toLowerCase()) && processNamesBeforeSwitch.has(getExeName(p))
      )
      let killResult: KillResult | undefined

      if (pathsToStop.length > 0) {
        killResult = await killProfileApps(gameKey, pathsToStop)
      }

      const processNamesAfterStop = await readRunningProcessNames()
      const pathsToStart = toPaths.filter((p) => !processNamesAfterStop.has(getExeName(p)))

      if (pathsToStart.length === 0) {
        return {
          success: true,
          message: killResult?.message,
          launchedCount: 0,
          skippedCount: 0,
          failedCount: killResult?.failedCount,
          killFailures: killResult?.failures
        }
      }

      const launchResult = await launchProfileApps(event.sender, gameKey, pathsToStart)

      return {
        ...launchResult,
        failedCount: (launchResult.failedCount || 0) + (killResult?.failedCount || 0),
        killFailures: killResult?.failures
      }
    }
  )

  ipcMain.handle('get-running-apps', async () => {
    return getRunningApps()
  })

  ipcMain.handle('subscribe-running-apps', async (event) => {
    return subscribeRunningApps(event.sender)
  })

  ipcMain.handle('unsubscribe-running-apps', (event) => {
    unsubscribeRunningApps(event.sender)
  })

  ipcMain.handle('kill-launched-apps', async (_event, gameKey?: string) => {
    if (gameKey !== undefined) {
      const validationError = validateGameKey(gameKey)
      if (validationError) {
        return validationError
      }
    }

    return killLaunchedApps(gameKey)
  })
}
