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
import type { SettingsStateSnapshot } from './useSettingsState'

type StoreConfigChangePayload = Parameters<typeof onStoreConfigChanged>[0] extends (
  payload: infer Payload
) => void
  ? Payload
  : never

interface UseSettingsLoadArgs {
  themeRef: MutableRefObject<{ setThemeMode: (mode: ThemeMode) => void }>
  latestSettingsObjects: MutableRefObject<SettingsObjectRecords>
  resetDirty: (state?: SettingsStateSnapshot) => void
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
  setShowTrayIcon: (showTrayIcon: boolean) => void
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
  setShowTrayIcon,
  setAutoCheckUpdates,
  setZoomFactor,
  setIsCustomColor,
  setAppIcons,
  setGameIcons
}: UseSettingsLoadArgs): { loadSettingsFromStore: () => Promise<SettingsStateSnapshot> } {
  const loadSettingsFromStore = useCallback(async (): Promise<SettingsStateSnapshot> => {
    const [settings, savedProfiles] = await Promise.all([getSettings(), getProfiles()])
    const typedProfiles = normalizeProfiles(savedProfiles)
    const loadedThemeMode = normalizeThemeMode(settings.themeMode)

    // Snapshot of exactly what lands in state below. Key order mirrors the
    // currentSettingsState memo in useSettingsState — the dirty baseline is a
    // JSON string compare, so a re-ordered snapshot would read as permanently
    // dirty (#480).
    const snapshot: SettingsStateSnapshot = {
      appPaths: settings.appPaths,
      appNames: settings.appNames,
      appArgs: settings.appArgs,
      profiles: typedProfiles,
      gamePaths: settings.gamePaths,
      customSlots: resolveCustomSlots(
        settings.customSlots,
        settings.appPaths,
        settings.appNames,
        ...Object.values(typedProfiles).filter(isRecord)
      ),
      accentPreset: settings.accentPreset || DEFAULT_ACCENT_COLOR,
      accentCustom: settings.accentCustom || '',
      accentBgTint: settings.accentBgTint || false,
      themeMode: loadedThemeMode,
      focusActiveTitle: settings.focusActiveTitle !== false,
      launchDelayMs: normalizeLaunchDelayMs(settings.launchDelayMs),
      startWithWindows: settings.startWithWindows || false,
      startMinimized: settings.startMinimized || false,
      minimizeToTray: settings.minimizeToTray || false,
      showTrayIcon: settings.showTrayIcon ?? true,
      autoCheckUpdates: settings.autoCheckUpdates !== false,
      zoomFactor: Number.isFinite(settings.zoomFactor) ? settings.zoomFactor : 1.0
    }

    latestSettingsObjects.current = {
      appPaths: snapshot.appPaths,
      appNames: snapshot.appNames,
      appArgs: snapshot.appArgs,
      gamePaths: snapshot.gamePaths
    }

    setAppPaths(snapshot.appPaths)
    setAppNames(snapshot.appNames)
    setAppArgs(snapshot.appArgs)
    setProfiles(snapshot.profiles)
    setGamePaths(snapshot.gamePaths)
    setCustomSlots(snapshot.customSlots)
    setAccentPreset(snapshot.accentPreset)
    setAccentCustom(snapshot.accentCustom)
    setAccentBgTint(snapshot.accentBgTint)
    setThemeMode(snapshot.themeMode)
    themeRef.current.setThemeMode(snapshot.themeMode)
    setFocusActiveTitle(snapshot.focusActiveTitle)
    setLaunchDelayMs(snapshot.launchDelayMs)
    setStartWithWindows(snapshot.startWithWindows)
    setStartMinimized(snapshot.startMinimized)
    setMinimizeToTray(snapshot.minimizeToTray)
    setShowTrayIcon(snapshot.showTrayIcon)
    setAutoCheckUpdates(snapshot.autoCheckUpdates)
    setZoomFactor(snapshot.zoomFactor)

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
    return snapshot
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
    setShowTrayIcon,
    setProfiles,
    setStartMinimized,
    setStartWithWindows,
    setThemeMode,
    setZoomFactor,
    themeRef
  ])

  useEffect(() => {
    void loadSettingsFromStore()
  }, [loadSettingsFromStore])

  useEffect(() => {
    return onStoreConfigChanged((payload: StoreConfigChangePayload) => {
      // Skip only the bulk writes this provider itself performs on save.
      // 'save-profile' (singular, the per-game editor/GameRow save) must keep
      // reloading: it refreshes our profiles copy (which the settings save
      // writes back to the store) so it can't resurrect deleted profiles.
      if (payload.reason === 'save-settings' || payload.reason === 'save-profiles') return
      // Re-baseline from the EXACT snapshot that was loaded. resetDirty()
      // without arguments would serialize a previous render's currentState and
      // leave a phantom dirty diff on whatever the reload changed — that was
      // the ghost "Utility Apps" dot after every profile save (#480).
      void loadSettingsFromStore().then((snapshot) => resetDirty(snapshot))
    })
  }, [loadSettingsFromStore, resetDirty])

  return { loadSettingsFromStore }
}
