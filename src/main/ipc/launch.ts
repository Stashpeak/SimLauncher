import { ipcMain } from 'electron'

import { buildActiveProfileLaunchEntries, buildNamedProfileLaunchEntries } from '../profiles'
import {
  type KillResult,
  type ProfileLaunchEntry,
  getRunningApps,
  hasOtherActiveLaunchControllers,
  isAnyLaunchActive,
  isRunningExePath,
  killLaunchedApps,
  killProfileApps,
  launchProfileApps,
  readRunningProcessNames,
  registerActiveLaunch,
  subscribeRunningApps,
  unregisterActiveLaunch,
  unsubscribeRunningApps
} from '../processes'
import { KNOWN_GAME_KEYS, getStoredStringRecord } from '../store'
import { getExeName, normalizePathForComparison, pathsEqual } from '../utils'

/**
 * Identifier used to diff profile-switch targets. Two entries match only when
 * they share BOTH the utility/game key AND the executable path. Comparing on
 * path alone would treat e.g. `customapp1` and `customapp2` pointing at the
 * same exe as equal, which is wrong after the #357 key-based arg refactor:
 * the slots may carry different `appArgs`, so a slot move must still trigger
 * a stop + relaunch with the new args.
 */
export function getProfileLaunchEntryId(entry: ProfileLaunchEntry): string {
  return `${entry.key} ${normalizePathForComparison(entry.path)}`
}

/**
 * Returns an error payload when `gameKey` is not a recognised game identifier,
 * or `undefined` when the key is valid. The undefined-on-success convention
 * lets callers short-circuit with `if (err) return err` without a dedicated
 * result wrapper type.
 *
 * IPC inputs are always untrusted: a compromised or misbehaving renderer could
 * send any string. The KNOWN_GAME_KEYS allowlist ensures only pre-declared
 * keys can reach process-management code.
 */
export function validateGameKey(gameKey: unknown): { success: false; error: string } | undefined {
  if (typeof gameKey !== 'string') {
    return { success: false, error: 'Invalid argument' }
  }

  if (!KNOWN_GAME_KEYS.has(gameKey)) {
    return { success: false, error: 'Unknown game key' }
  }

  return undefined
}

/**
 * Returns an error payload when any of the supplied profile IDs are not
 * strings, or `undefined` when all are valid. Profile IDs are free-form
 * user-defined names so they cannot be checked against an allowlist; type
 * validation is the only gate here.
 */
export function validateProfileIds(
  ...profileIds: unknown[]
): { success: false; error: string } | undefined {
  if (profileIds.some((profileId) => typeof profileId !== 'string')) {
    return { success: false, error: 'Invalid argument' }
  }

  return undefined
}

export function registerLaunchHandlers(): void {
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

  // relaunch-missing-profile: re-launches only the subset of profile apps that
  // are not currently running. Useful after a crash or manual close of a single
  // companion app without wanting to restart the entire profile.
  ipcMain.handle('relaunch-missing-profile', async (event, gameKey: string) => {
    const validationError = validateGameKey(gameKey)
    if (validationError) {
      return validationError
    }

    const allEntries = buildActiveProfileLaunchEntries(gameKey)

    if (allEntries.length === 0) {
      return { success: false, error: 'No executable paths configured for this profile.' }
    }

    // Mirrors launchProfileApps' own entry gate, and must run BEFORE the
    // registerActiveLaunch below: registerActiveLaunch overwrites per gameKey,
    // so registering while a launch sequence is already mid-flight would EVICT
    // that sequence's controller from the registry — this handler would then
    // bounce off launchProfileApps' gate and its finally would delete its own
    // controller, leaving the registry EMPTY while the first loop still runs,
    // unreachable by Close Apps (the #670 bug class via a new path). There is
    // no await between this check and the registration, so the event loop
    // makes the check-then-register pair atomic.
    //
    // Both halves are required: isAnyLaunchActive() covers a sequence already
    // inside launchProfileApps, while hasOtherActiveLaunchControllers() covers
    // another handler still in its PRE-launch window — registered, but not yet
    // in launchProfileApps, so activeLaunches is still empty (#716 review
    // finding, inverse window).
    if (isAnyLaunchActive() || hasOtherActiveLaunchControllers()) {
      return { success: false, error: 'Another profile is already launching.' }
    }

    // Registered BEFORE the tasklist scan below (not inside launchProfileApps,
    // which only runs after it) so a Close Apps click landing during that scan
    // has something to abort — otherwise the scan's await was a window where
    // the click was a no-op and the sequence still launched with a fresh,
    // un-aborted controller right after (#716, #670 residual).
    const launchController = registerActiveLaunch(gameKey)
    try {
      const { processNames } = await readRunningProcessNames()
      const missingEntries = allEntries.filter(
        (entry) => !isRunningExePath(processNames, entry.path)
      )

      if (missingEntries.length === 0) {
        return {
          success: true,
          message: 'All profile apps are already running.',
          launchedCount: 0,
          skippedCount: 0
        }
      }

      // `await` (not a bare `return`) matters here: it keeps the controller
      // registered until the sequence actually finishes, so the `finally`
      // below doesn't unregister it out from under a still-running launch
      // loop — which would make a Close Apps click during the loop itself a
      // no-op again.
      return await launchProfileApps(event.sender, gameKey, missingEntries, {
        controller: launchController
      })
    } finally {
      unregisterActiveLaunch(gameKey, launchController)
    }
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
      const gamePath = gamePaths[gameKey]
      const { processNames } = await readRunningProcessNames()

      // The game executable itself is excluded from the diff: it is always
      // left running across a profile switch because the switch only concerns
      // companion utilities (SimHub, CrewChief, etc.), not the game itself.
      const utilityEntries = (profileId: string) =>
        buildNamedProfileLaunchEntries(gameKey, profileId).filter(
          (entry) => !gamePath || !pathsEqual(entry.path, gamePath)
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
      const gamePath = gamePaths[gameKey]

      const fromEntries = buildNamedProfileLaunchEntries(gameKey, fromProfileId).filter(
        (entry) => !gamePath || !pathsEqual(entry.path, gamePath)
      )
      const toEntries = buildNamedProfileLaunchEntries(gameKey, toProfileId).filter(
        (entry) => !gamePath || !pathsEqual(entry.path, gamePath)
      )
      // Match on `{key, path}` rather than path alone. After the #357
      // key-based arg refactor, `customapp1` and `customapp2` pointing at
      // the same exe legitimately carry different `appArgs`, so a slot
      // move must still trigger a stop + relaunch even though the path is
      // unchanged.
      const toEntryIds = new Set(toEntries.map(getProfileLaunchEntryId))

      // Mirrors launchProfileApps' own entry gate, and must run BEFORE the
      // registerActiveLaunch below — same eviction reasoning as the
      // relaunch-missing-profile handler above (#716 review finding), and the
      // same two-half gate: hasOtherActiveLaunchControllers() catches another
      // handler still in its pre-launch window, which isAnyLaunchActive()
      // cannot see (activeLaunches fills only once launchProfileApps starts).
      // Bailing out here also means the switch never kills the outgoing
      // profile's apps for a launch that could not proceed anyway. No await
      // sits between this check and the registration, so the pair is atomic.
      if (isAnyLaunchActive() || hasOtherActiveLaunchControllers()) {
        return { success: false, error: 'Another profile is already launching.' }
      }

      // Registered BEFORE the pre-switch scan below — covers that scan, the
      // whole kill phase (killProfileApps can take seconds with WMI lookups),
      // and the post-stop scan, all of which run before the launch call. A
      // Close Apps click landing anywhere in that window used to find nothing
      // registered to abort (#716, #670 residual).
      const launchController = registerActiveLaunch(gameKey)
      try {
        const { processNames: processNamesBeforeSwitch } = await readRunningProcessNames()

        const entriesToStop = fromEntries.filter(
          (entry) =>
            !toEntryIds.has(getProfileLaunchEntryId(entry)) &&
            processNamesBeforeSwitch.has(getExeName(entry.path))
        )
        let killResult: KillResult | undefined

        if (entriesToStop.length > 0) {
          // `except: launchController` is the self-abort-trap fix: without
          // it, this kill's own abortActiveLaunches(gameKey) call would
          // cancel the switch's OWN registration above — the switch would
          // then always report itself as cancelled, even with no Close Apps
          // click involved.
          killResult = await killProfileApps(
            gameKey,
            entriesToStop.map((entry) => entry.path),
            { except: launchController }
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

        // Sharing launchController here is what makes a Close Apps click
        // landing during the pre-switch scan or the kill phase above actually
        // stop profile B from launching — launchProfileApps checks the same
        // signal before it spawns anything.
        const launchResult = await launchProfileApps(event.sender, gameKey, entriesToStart, {
          controller: launchController
        })

        return {
          ...launchResult,
          failedCount: (launchResult.failedCount || 0) + (killResult?.failedCount || 0),
          killFailures: killResult?.failures
        }
      } finally {
        unregisterActiveLaunch(gameKey, launchController)
      }
    }
  )

  ipcMain.handle('get-running-apps', async () => {
    return getRunningApps()
  })

  // subscribe-running-apps / unsubscribe-running-apps use event.sender as the
  // subscriber identity so the processes module can push updates to the correct
  // WebContents without holding a direct reference to the window object.
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
