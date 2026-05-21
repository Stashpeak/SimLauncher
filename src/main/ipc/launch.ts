import { ipcMain } from 'electron'

import {
  buildActiveProfileLaunchEntries,
  buildNamedProfileLaunchEntries,
  buildNamedProfileLaunchPaths
} from '../profiles'
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
import { KNOWN_GAME_KEYS, getStoredStringRecord } from '../store'
import { getExeName } from '../utils'

export function validateGameKey(gameKey: unknown) {
  if (typeof gameKey !== 'string') {
    return { success: false, error: 'Invalid argument' }
  }

  if (!KNOWN_GAME_KEYS.has(gameKey)) {
    return { success: false, error: 'Unknown game key' }
  }

  return undefined
}

export function validateProfileIds(...profileIds: unknown[]) {
  if (profileIds.some((profileId) => typeof profileId !== 'string')) {
    return { success: false, error: 'Invalid argument' }
  }

  return undefined
}

export function registerLaunchHandlers() {
  ipcMain.handle('launch-profile', async (event, gameKey: string) => {
    const validationError = validateGameKey(gameKey)
    if (validationError) {
      return validationError
    }

    const profileApps = buildActiveProfileLaunchEntries(gameKey)

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

    const allEntries = buildActiveProfileLaunchEntries(gameKey)

    if (allEntries.length === 0) {
      return { success: false, error: 'No executable paths configured for this profile.' }
    }

    const processNames = await readRunningProcessNames()
    const missingEntries = allEntries.filter((entry) => !isRunningExePath(processNames, entry.path))

    if (missingEntries.length === 0) {
      return {
        success: true,
        message: 'All profile apps are already running.',
        launchedCount: 0,
        skippedCount: 0
      }
    }

    return launchProfileApps(event.sender, gameKey, missingEntries)
  })

  ipcMain.handle(
    'get-profile-switch-diff',
    async (_event, gameKey: string, fromProfileId: string, toProfileId: string) => {
      const validationError = validateGameKey(gameKey)
      if (validationError) {
        return validationError
      }

      const profileIdValidationError = validateProfileIds(fromProfileId, toProfileId)
      if (profileIdValidationError) {
        return profileIdValidationError
      }

      const gamePaths = getStoredStringRecord('gamePaths')
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

      const profileIdValidationError = validateProfileIds(fromProfileId, toProfileId)
      if (profileIdValidationError) {
        return profileIdValidationError
      }

      const gamePaths = getStoredStringRecord('gamePaths')
      const gamePath = gamePaths[gameKey]?.toLowerCase()

      const fromEntries = buildNamedProfileLaunchEntries(gameKey, fromProfileId).filter(
        (entry) => !gamePath || entry.path.toLowerCase() !== gamePath
      )
      const toEntries = buildNamedProfileLaunchEntries(gameKey, toProfileId).filter(
        (entry) => !gamePath || entry.path.toLowerCase() !== gamePath
      )
      const toPathSet = new Set(toEntries.map((entry) => entry.path.toLowerCase()))
      const processNamesBeforeSwitch = await readRunningProcessNames()

      const entriesToStop = fromEntries.filter(
        (entry) =>
          !toPathSet.has(entry.path.toLowerCase()) &&
          processNamesBeforeSwitch.has(getExeName(entry.path))
      )
      let killResult: KillResult | undefined

      if (entriesToStop.length > 0) {
        killResult = await killProfileApps(
          gameKey,
          entriesToStop.map((entry) => entry.path)
        )
      }

      const processNamesAfterStop = await readRunningProcessNames()
      const entriesToStart = toEntries.filter(
        (entry) => !processNamesAfterStop.has(getExeName(entry.path))
      )

      if (entriesToStart.length === 0) {
        return {
          success: true,
          message: killResult?.message,
          launchedCount: 0,
          skippedCount: 0,
          failedCount: killResult?.failedCount,
          killFailures: killResult?.failures
        }
      }

      const launchResult = await launchProfileApps(event.sender, gameKey, entriesToStart)

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
