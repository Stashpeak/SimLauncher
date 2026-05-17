import { useCallback, useEffect, type MutableRefObject } from 'react'
import {
  DEFAULT_ACCENT_COLOR,
  GAMES,
  isRecord,
  normalizeProfiles,
  resolveCustomSlots,
  type Profiles
} from '../../lib/config'
import { getAssetData, getFileIcon } from '../../lib/electron'
import { getProfiles, getSettings, onStoreConfigChanged } from '../../lib/store'
import { normalizeThemeMode, type ThemeMode } from '../../lib/theme'
import { normalizeLaunchDelayMs } from './settingsUtils'
import type { SettingsObjectRecords } from './saveRace'

type StoreConfigChangePayload = Parameters<typeof onStoreConfigChanged>[0] extends (
  payload: infer Payload
) => void
  ? Payload
  : never

interface UseSettingsLoadArgs {
  themeRef: MutableRefObject<{ setThemeMode: (mode: ThemeMode) => void }>
  latestSettingsObjects: MutableRefObject<SettingsObjectRecords>
  resetDirty: () => void
  setLoading: (loading: boolean) => void
  setAppPaths: (appPaths: Record<string, string>) => void
  setAppNames: (appNames: Record<string, string>) => void
  setAppArgs: (appArgs: Record<string, string>) => void
  setProfiles: (profiles: Profiles) => void
  setGamePaths: (gamePaths: Record<string, string>) => void
  setCustomSlots: (customSlots: number) => void
  setAccentPreset: (accentPreset: string) => void
  setAccentCustom: (accentCustom: string) => void
  setAccentBgTint: (accentBgTint: boolean) => void
  setThemeMode: (themeMode: ThemeMode) => void
  setFocusActiveTitle: (focusActiveTitle: boolean) => void
  setLaunchDelayMs: (launchDelayMs: number) => void
  setStartWithWindows: (startWithWindows: boolean) => void
  setStartMinimized: (startMinimized: boolean) => void
  setMinimizeToTray: (minimizeToTray: boolean) => void
  setAutoCheckUpdates: (autoCheckUpdates: boolean) => void
  setZoomFactor: (zoomFactor: number) => void
  setIsCustomColor: (isCustomColor: boolean) => void
  setAppIcons: (appIcons: Record<string, string>) => void
  setGameIcons: (gameIcons: Record<string, string>) => void
}

export function useSettingsLoad({
  themeRef,
  latestSettingsObjects,
  resetDirty,
  setLoading,
  setAppPaths,
  setAppNames,
  setAppArgs,
  setProfiles,
  setGamePaths,
  setCustomSlots,
  setAccentPreset,
  setAccentCustom,
  setAccentBgTint,
  setThemeMode,
  setFocusActiveTitle,
  setLaunchDelayMs,
  setStartWithWindows,
  setStartMinimized,
  setMinimizeToTray,
  setAutoCheckUpdates,
  setZoomFactor,
  setIsCustomColor,
  setAppIcons,
  setGameIcons
}: UseSettingsLoadArgs) {
  const loadSettingsFromStore = useCallback(async () => {
    const [settings, savedProfiles] = await Promise.all([getSettings(), getProfiles()])
    const typedProfiles = normalizeProfiles(savedProfiles)

    latestSettingsObjects.current = {
      appPaths: settings.appPaths,
      appNames: settings.appNames,
      appArgs: settings.appArgs,
      gamePaths: settings.gamePaths
    }

    setAppPaths(settings.appPaths)
    setAppNames(settings.appNames)
    setAppArgs(settings.appArgs)
    setProfiles(typedProfiles)
    setGamePaths(settings.gamePaths)
    setCustomSlots(
      resolveCustomSlots(
        settings.customSlots,
        settings.appPaths,
        settings.appNames,
        ...Object.values(typedProfiles).filter(isRecord)
      )
    )
    const loadedThemeMode = normalizeThemeMode(settings.themeMode)

    setAccentPreset(settings.accentPreset || DEFAULT_ACCENT_COLOR)
    setAccentCustom(settings.accentCustom || '')
    setAccentBgTint(settings.accentBgTint || false)
    setThemeMode(loadedThemeMode)
    themeRef.current.setThemeMode(loadedThemeMode)
    setFocusActiveTitle(settings.focusActiveTitle !== false)
    setLaunchDelayMs(normalizeLaunchDelayMs(settings.launchDelayMs))
    setStartWithWindows(settings.startWithWindows || false)
    setStartMinimized(settings.startMinimized || false)
    setMinimizeToTray(settings.minimizeToTray || false)
    setAutoCheckUpdates(settings.autoCheckUpdates !== false)
    setZoomFactor(Number.isFinite(settings.zoomFactor) ? settings.zoomFactor : 1.0)

    setIsCustomColor(settings.accentPreset === 'custom')

    const iconEntries = await Promise.all(
      Object.entries(settings.appPaths)
        .filter((entry): entry is [string, string] => Boolean(entry[1]))
        .map(async ([key, path]) => [key, await getFileIcon(path)] as const)
    )
    const icons: Record<string, string> = {}
    for (const [key, icon] of iconEntries) {
      if (icon) icons[key] = icon
    }
    setAppIcons(icons)

    const gameIconEntries = await Promise.all(
      GAMES.map(async (game) => {
        const filename = game.icon.split('/').pop() || ''
        return [game.key, await getAssetData(filename)] as const
      })
    )
    const gIcons: Record<string, string> = {}
    for (const [key, data] of gameIconEntries) {
      if (data) gIcons[key] = data
    }
    setGameIcons(gIcons)

    setLoading(false)
  }, [
    latestSettingsObjects,
    setAccentBgTint,
    setAccentCustom,
    setAccentPreset,
    setAppArgs,
    setAppIcons,
    setAppNames,
    setAppPaths,
    setAutoCheckUpdates,
    setCustomSlots,
    setFocusActiveTitle,
    setGameIcons,
    setGamePaths,
    setIsCustomColor,
    setLaunchDelayMs,
    setLoading,
    setMinimizeToTray,
    setProfiles,
    setStartMinimized,
    setStartWithWindows,
    setThemeMode,
    setZoomFactor,
    themeRef
  ])

  useEffect(() => {
    loadSettingsFromStore()
  }, [loadSettingsFromStore])

  useEffect(() => {
    return onStoreConfigChanged((payload: StoreConfigChangePayload) => {
      if (payload.reason === 'save-settings' || payload.reason === 'save-profiles') return
      void loadSettingsFromStore().then(() => resetDirty())
    })
  }, [loadSettingsFromStore, resetDirty])

  return { loadSettingsFromStore }
}
