import { ipcMain } from 'electron'

import { buildActiveProfileLaunchPaths, buildNamedProfileLaunchPaths } from '../profiles'
import {
  type KillResult,
  getRunningApps,
  isRunningExePath,
  killLaunchedApps,
  killProfileApps,
  launchProfileApps,
  readRunningProcessNames
} from '../processes'
import { store } from '../store'
import { getExeName } from '../utils'

export function registerLaunchHandlers() {
  ipcMain.handle('launch-profile', async (event, gameKey: string) => {
    const profileApps = buildActiveProfileLaunchPaths(gameKey)

    if (profileApps.length === 0) {
      return { success: false, error: 'No executable paths configured for this profile.' }
    }

    return launchProfileApps(event.sender, gameKey, profileApps)
  })

  ipcMain.handle('relaunch-missing-profile', async (event, gameKey: string) => {
    const allPaths = buildActiveProfileLaunchPaths(gameKey)

    if (allPaths.length === 0) {
      return { success: false, error: 'No executable paths configured for this profile.' }
    }

    const processNames = await readRunningProcessNames()
    const missingPaths = allPaths.filter((p) => !isRunningExePath(processNames, p))

    if (missingPaths.length === 0) {
      return { success: true, message: 'All profile apps are already running.', launchedCount: 0, skippedCount: 0 }
    }

    return launchProfileApps(event.sender, gameKey, missingPaths)
  })

  ipcMain.handle('get-profile-switch-diff', async (_event, gameKey: string, fromProfileId: string, toProfileId: string) => {
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
    const toStopCount = [...fromPaths].filter((p) => !toPaths.has(p) && processNames.has(getExeName(p))).length
    const toStartCount = [...toPaths].filter((p) => !processNames.has(getExeName(p))).length

    return { toStopCount, toStartCount }
  })

  ipcMain.handle(
    'switch-profile-apps',
    async (event, gameKey: string, fromProfileId: string, toProfileId: string) => {
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
          warning: killResult?.warning,
          launchedCount: 0,
          skippedCount: 0,
          failedCount: killResult?.failedCount
        }
      }

      const launchResult = await launchProfileApps(event.sender, gameKey, pathsToStart)
      const warnings = [killResult?.warning, launchResult.warning].filter(Boolean)

      return {
        ...launchResult,
        warning: warnings.length > 0 ? warnings.join(' ') : undefined,
        failedCount: (launchResult.failedCount || 0) + (killResult?.failedCount || 0)
      }
    }
  )

  ipcMain.handle('get-running-apps', async () => {
    return getRunningApps()
  })

  ipcMain.handle('kill-launched-apps', (_event, gameKey?: string) => {
    return killLaunchedApps(gameKey)
  })

  ipcMain.handle('kill-profile-apps', (_event, gameKey: string, appPathsToKill: string[]) => {
    return killProfileApps(gameKey, Array.isArray(appPathsToKill) ? appPathsToKill : [])
  })
}
