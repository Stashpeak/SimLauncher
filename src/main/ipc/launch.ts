import { ipcMain } from 'electron'

import { buildActiveProfileLaunchEntries, buildNamedProfileLaunchEntries } from '../profiles'
import {
  type KillResult,
  type ProfileLaunchEntry,
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

/**
 * Identifier used to diff profile-switch targets. Two entries match only when
 * they share BOTH the utility/game key AND the executable path. Comparing on
 * path alone would treat e.g. `customapp1` and `customapp2` pointing at the
 * same exe as equal, which is wrong after the #357 key-based arg refactor:
 * the slots may carry different `appArgs`, so a slot move must still trigger
 * a stop + relaunch with the new args.
 */
export function getProfileLaunchEntryId(entry: ProfileLaunchEntry) {
  return `${entry.key} ${entry.path.toLowerCase()}`
}

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

    const { processNames } = await readRunningProcessNames()
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
      const { processNames } = await readRunningProcessNames()

      const utilityEntries = (profileId: string) =>
        buildNamedProfileLaunchEntries(gameKey, profileId).filter(
          (entry) => !gamePath || entry.path.toLowerCase() !== gamePath
        )

      const fromEntries = utilityEntries(fromProfileId)
      const toEntries = utilityEntries(toProfileId)
      const toEntryIds = new Set(toEntries.map(getProfileLaunchEntryId))
      const fromEntryIds = new Set(fromEntries.map(getProfileLaunchEntryId))
      // Slots that leave the profile and whose image is currently running
      // need to be stopped. Match on `{key, path}` so a slot whose key
      // changes (different args) still counts as a stop even when the
      // exe path is unchanged.
      const stopping = fromEntries.filter(
        (entry) =>
          !toEntryIds.has(getProfileLaunchEntryId(entry)) &&
          processNames.has(getExeName(entry.path))
      )
      const stoppedExeNames = new Set(stopping.map((entry) => getExeName(entry.path)))
      const toStopCount = stopping.length
      // A slot that newly enters the profile needs a start when either its
      // image isn't running, or its image is about to be stopped above
      // (same exe, different key — the incoming slot still needs its own
      // args, so the running process must be replaced).
      const toStartCount = toEntries.filter(
        (entry) =>
          !fromEntryIds.has(getProfileLaunchEntryId(entry)) &&
          (stoppedExeNames.has(getExeName(entry.path)) || !processNames.has(getExeName(entry.path)))
      ).length

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
      // Match on `{key, path}` rather than path alone. After the #357
      // key-based arg refactor, `customapp1` and `customapp2` pointing at
      // the same exe legitimately carry different `appArgs`, so a slot
      // move must still trigger a stop + relaunch even though the path is
      // unchanged.
      const toEntryIds = new Set(toEntries.map(getProfileLaunchEntryId))
      const { processNames: processNamesBeforeSwitch } = await readRunningProcessNames()

      const entriesToStop = fromEntries.filter(
        (entry) =>
          !toEntryIds.has(getProfileLaunchEntryId(entry)) &&
          processNamesBeforeSwitch.has(getExeName(entry.path))
      )
      let killResult: KillResult | undefined

      if (entriesToStop.length > 0) {
        killResult = await killProfileApps(
          gameKey,
          entriesToStop.map((entry) => entry.path)
        )
      }

      const { processNames: processNamesAfterStop } = await readRunningProcessNames()
      // If we just stopped a slot pointing at the same exe (different key
      // and args), the incoming slot still needs to start with its own
      // args — treat that exe as "needs to launch" regardless of post-kill
      // tasklist state. Without this, a same-exe key swap would skip the
      // relaunch and leave the old args active.
      const stoppedExeNames = new Set(entriesToStop.map((entry) => getExeName(entry.path)))
      const entriesToStart = toEntries.filter(
        (entry) =>
          stoppedExeNames.has(getExeName(entry.path)) ||
          !processNamesAfterStop.has(getExeName(entry.path))
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
