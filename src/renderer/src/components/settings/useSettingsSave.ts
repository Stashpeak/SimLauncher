import { useCallback, type MutableRefObject } from 'react'
import { saveProfiles, saveSettings as persistSettings } from '../../lib/store'
import type { Profiles } from '../../lib/config'
import type { ThemeMode } from '../../lib/theme'
import { getSettingsObjectChangesDuringSave, type SettingsObjectVersions } from './saveRace'
import { normalizeLaunchDelayMs } from './settingsUtils'

interface SettingsStateSnapshot {
  appPaths: Record<string, string>
  appNames: Record<string, string>
  appArgs: Record<string, string>
  profiles: Profiles
  gamePaths: Record<string, string>
  customSlots: number
  accentPreset: string
  accentCustom: string
  accentBgTint: boolean
  themeMode: ThemeMode
  focusActiveTitle: boolean
  launchDelayMs: number
  startWithWindows: boolean
  startMinimized: boolean
  minimizeToTray: boolean
  showTrayIcon: boolean
  autoCheckUpdates: boolean
  zoomFactor: number
}

// Paths only need whitespace trimmed; an empty string is a valid sentinel
// meaning "not configured" and must be preserved so the store can clear it.
function trimPathRecord(paths: Record<string, string>) {
  return Object.fromEntries(Object.entries(paths).map(([key, value]) => [key, value.trim()]))
}

// Args entries with a blank value after trimming are dropped entirely rather
// than stored as empty strings — avoids passing a bare "" to the launcher and
// keeps the persisted JSON clean.
function trimStringRecord(values: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(values)
      .map(([key, value]) => [key, value.trim()])
      .filter(([, value]) => value.length > 0)
  )
}

interface UseSettingsSaveArgs {
  appPaths: Record<string, string>
  appNames: Record<string, string>
  appArgs: Record<string, string>
  profiles: Profiles
  gamePaths: Record<string, string>
  customSlots: number
  accentPreset: string
  accentCustom: string
  accentBgTint: boolean
  themeMode: ThemeMode
  focusActiveTitle: boolean
  launchDelayMs: number
  startMinimized: boolean
  minimizeToTray: boolean
  showTrayIcon: boolean
  autoCheckUpdates: boolean
  startWithWindows: boolean
  zoomFactor: number
  currentSettingsState: SettingsStateSnapshot
  settingsObjectEditVersions: MutableRefObject<SettingsObjectVersions>
  notify: (message: string, type: 'success' | 'error' | 'warn', duration?: number) => void
  resetDirty: (state?: SettingsStateSnapshot) => void
  setAppPaths: (appPaths: Record<string, string>) => void
  setGamePaths: (gamePaths: Record<string, string>) => void
  setAppArgs: (appArgs: Record<string, string>) => void
  setLaunchDelayMs: (launchDelayMs: number) => void
}

export function useSettingsSave({
  appPaths,
  appNames,
  appArgs,
  profiles,
  gamePaths,
  customSlots,
  accentPreset,
  accentCustom,
  accentBgTint,
  themeMode,
  focusActiveTitle,
  launchDelayMs,
  startMinimized,
  minimizeToTray,
  showTrayIcon,
  autoCheckUpdates,
  startWithWindows,
  zoomFactor,
  currentSettingsState,
  settingsObjectEditVersions,
  notify,
  resetDirty,
  setAppPaths,
  setGamePaths,
  setAppArgs,
  setLaunchDelayMs
}: UseSettingsSaveArgs): { handleSave: () => Promise<boolean> } {
  const handleSave = useCallback(async (): Promise<boolean> => {
    try {
      const normalizedLaunchDelayMs = normalizeLaunchDelayMs(launchDelayMs)
      const trimmedAppPaths = trimPathRecord(appPaths)
      const trimmedGamePaths = trimPathRecord(gamePaths)
      const trimmedAppArgs = trimStringRecord(appArgs)
      // Snapshot versions before the await so we can detect edits that arrive
      // while the IPC write is in flight (the race window).
      const settingsObjectEditVersionsAtSave = { ...settingsObjectEditVersions.current }
      const savedSettingsObjects = {
        appPaths: trimmedAppPaths,
        appNames,
        appArgs: trimmedAppArgs,
        gamePaths: trimmedGamePaths
      }

      await Promise.all([
        persistSettings({
          appPaths: savedSettingsObjects.appPaths,
          appNames: savedSettingsObjects.appNames,
          appArgs: savedSettingsObjects.appArgs,
          gamePaths: savedSettingsObjects.gamePaths,
          customSlots,
          accentPreset,
          accentCustom,
          accentBgTint,
          themeMode,
          focusActiveTitle,
          launchDelayMs: normalizedLaunchDelayMs,
          startMinimized,
          minimizeToTray,
          showTrayIcon,
          autoCheckUpdates,
          startWithWindows,
          zoomFactor
        }),
        saveProfiles(profiles)
      ])
      const changedDuringSave = getSettingsObjectChangesDuringSave(
        settingsObjectEditVersionsAtSave,
        settingsObjectEditVersions.current
      )

      // Only push the trimmed value back into state when the user hasn't edited
      // the field since the save started — avoids overwriting a concurrent edit
      // with the (now-stale) pre-save trimmed copy.
      if (!changedDuringSave.appPaths) setAppPaths(savedSettingsObjects.appPaths)
      if (!changedDuringSave.gamePaths) setGamePaths(savedSettingsObjects.gamePaths)
      if (!changedDuringSave.appArgs) setAppArgs(savedSettingsObjects.appArgs)

      setLaunchDelayMs(normalizedLaunchDelayMs)
      notify('Settings saved!', 'success', 2500)
      // The new dirty baseline uses the SAVED object records, not the live
      // renderer state: the baseline must reflect what is on disk, so edits
      // made while the save was awaiting stay visibly dirty (re-saveable)
      // instead of silently looking already-saved.
      resetDirty({
        ...currentSettingsState,
        ...savedSettingsObjects,
        launchDelayMs: normalizedLaunchDelayMs
      })
      return true
    } catch (err) {
      notify('Failed to save settings', 'error')
      console.error(err)
      return false
    }
  }, [
    appArgs,
    appNames,
    appPaths,
    accentBgTint,
    accentCustom,
    accentPreset,
    autoCheckUpdates,
    currentSettingsState,
    customSlots,
    focusActiveTitle,
    gamePaths,
    launchDelayMs,
    minimizeToTray,
    showTrayIcon,
    notify,
    profiles,
    resetDirty,
    startMinimized,
    startWithWindows,
    themeMode,
    zoomFactor,
    settingsObjectEditVersions,
    setAppPaths,
    setGamePaths,
    setAppArgs,
    setLaunchDelayMs
  ])

  return { handleSave }
}
