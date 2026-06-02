import { useCallback, type MutableRefObject } from 'react'
import { saveProfiles, saveSettings as persistSettings } from '../../lib/store'
import type { Profiles } from '../../lib/config'
import type { ThemeMode } from '../../lib/theme'
import {
  getSettingsObjectChangesDuringSave,
  resolveSettingsObjectsAfterSave,
  type SettingsObjectRecords,
  type SettingsObjectVersions
} from './saveRace'
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

function trimPathRecord(paths: Record<string, string>) {
  return Object.fromEntries(Object.entries(paths).map(([key, value]) => [key, value.trim()]))
}

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
  latestSettingsObjects: MutableRefObject<SettingsObjectRecords>
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
  latestSettingsObjects,
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
      const resetSettingsObjects = resolveSettingsObjectsAfterSave({
        savedObjects: savedSettingsObjects,
        latestObjects: latestSettingsObjects.current,
        changedDuringSave
      })

      if (!changedDuringSave.appPaths) setAppPaths(savedSettingsObjects.appPaths)
      if (!changedDuringSave.gamePaths) setGamePaths(savedSettingsObjects.gamePaths)
      if (!changedDuringSave.appArgs) setAppArgs(savedSettingsObjects.appArgs)

      setLaunchDelayMs(normalizedLaunchDelayMs)
      notify('Settings saved!', 'success', 2500)
      resetDirty({
        ...currentSettingsState,
        ...resetSettingsObjects,
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
    latestSettingsObjects,
    setAppPaths,
    setGamePaths,
    setAppArgs,
    setLaunchDelayMs
  ])

  return { handleSave }
}
