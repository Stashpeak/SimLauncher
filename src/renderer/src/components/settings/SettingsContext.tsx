import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useDirtyTracking } from '../../hooks/useDirtyTracking'
import { getUtilities } from '../../lib/config'
import {
  browsePath,
  getFileIcon,
  setLoginItem,
  setPendingMinimizeToTray,
  setZoom
} from '../../lib/electron'
import type { ThemeMode } from '../../lib/theme'
import { useTheme } from '../../contexts/ThemeContext'
import { useNotify } from '../Notify'
import { AppearanceContext, type AppearanceContextValue } from './AppearanceContext'
import { AppsContext, type AppsContextValue } from './AppsContext'
import { BehaviorContext, type BehaviorContextValue } from './BehaviorContext'
import { GamesContext, type GamesContextValue } from './GamesContext'
import { SettingsMetaContext, type SettingsMetaContextValue } from './SettingsMetaContext'
import { useConfigIO } from './useConfigIO'
import { useCustomSlots } from './useCustomSlots'
import { useSettingsLoad } from './useSettingsLoad'
import { useSettingsSave } from './useSettingsSave'
import { useSettingsState } from './useSettingsState'

export function SettingsProvider({
  children,
  onDirtyChange,
  onConfigImported
}: {
  children: ReactNode
  onDirtyChange?: (isDirty: boolean) => void
  onConfigImported?: () => void
}): ReactNode {
  const { notify } = useNotify()
  const theme = useTheme()
  const themeRef = useRef(theme)
  themeRef.current = theme

  const {
    state: {
      loading,
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
      startWithWindows,
      startMinimized,
      minimizeToTray,
      autoCheckUpdates,
      zoomFactor,
      isCustomColor,
      appIcons,
      gameIcons,
      iconLoadErrors
    },
    setters: {
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
      setGameIcons,
      setIconLoadErrors
    },
    updateSettingsObject,
    settingsObjectEditVersions,
    latestSettingsObjects,
    currentSettingsState
  } = useSettingsState()

  const { isDirty, resetDirty, getDirtySubset } = useDirtyTracking(currentSettingsState, loading)

  const dirtySections = useMemo(
    () => ({
      appearance: getDirtySubset([
        'accentPreset',
        'accentCustom',
        'accentBgTint',
        'themeMode',
        'focusActiveTitle',
        'zoomFactor'
      ]),
      behavior: getDirtySubset([
        'startWithWindows',
        'startMinimized',
        'minimizeToTray',
        'launchDelayMs'
      ]),
      games: getDirtySubset(['gamePaths']),
      apps: getDirtySubset(['appPaths', 'appNames', 'appArgs', 'customSlots', 'profiles']),
      // The auto-check-updates toggle lives in the About section (not Config,
      // which only has export/import actions and never goes dirty).
      about: getDirtySubset(['autoCheckUpdates'])
    }),
    // getDirtySubset is recreated whenever currentState OR the baseline changes
    // (the baseline resets on save), so the per-section dots clear correctly
    // after a save without keeping stale flags (#279 Codex P2).
    [getDirtySubset]
  )

  useSettingsLoad({
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
  })

  useEffect(() => {
    onDirtyChange?.(isDirty)
  }, [isDirty, onDirtyChange])

  // Mirror the renderer's pending minimize-to-tray preference to the main
  // process so the window close handler honours unsaved toggle changes
  // (Closes #387). When dirty we forward the in-flight value; otherwise we
  // clear the pending preference so main falls back to the persisted setting.
  useEffect(() => {
    if (loading) return
    void setPendingMinimizeToTray(isDirty ? minimizeToTray : null)
  }, [isDirty, loading, minimizeToTray])

  const handleAccentChange = useCallback(
    (presetHex: string) => {
      setAccentPreset(presetHex)
      if (presetHex !== 'custom') {
        setIsCustomColor(false)
        theme.setAccentPreset(presetHex)
      } else {
        setIsCustomColor(true)
        theme.setAccentPreset(presetHex)
      }
    },
    [theme, setAccentPreset, setIsCustomColor]
  )

  const handleCustomColorChange = useCallback(
    (hex: string) => {
      setAccentCustom(hex)
      theme.setAccentCustom(hex)
    },
    [theme, setAccentCustom]
  )

  const handleAccentBgTintChange = useCallback(
    (checked: boolean) => {
      setAccentBgTint(checked)
      theme.setAccentBgTint(checked)
    },
    [theme, setAccentBgTint]
  )

  const handleThemeModeChange = useCallback(
    (mode: ThemeMode) => {
      setThemeMode(mode)
      theme.setThemeMode(mode)
    },
    [theme, setThemeMode]
  )

  const handleZoomFactorChange = useCallback(
    (factor: number) => {
      setZoomFactor(factor)
      setZoom(factor)
    },
    [setZoomFactor]
  )

  const handleStartWithWindowsChange = useCallback(
    (checked: boolean) => {
      setStartWithWindows(checked)
      setLoginItem(checked)
    },
    [setStartWithWindows]
  )

  const handleBrowse = useCallback(
    async (key: string, isGame: boolean) => {
      const result = (await browsePath(key)) as {
        filePath: string
        inputId: string
      }
      if (result && result.filePath) {
        if (isGame) {
          updateSettingsObject('gamePaths', setGamePaths, (prev) => ({
            ...prev,
            [key]: result.filePath
          }))
        } else {
          updateSettingsObject('appPaths', setAppPaths, (prev) => ({
            ...prev,
            [key]: result.filePath
          }))
          const icon = await getFileIcon(result.filePath)
          if (icon) {
            setAppIcons((prev) => ({ ...prev, [key]: icon }))
            setIconLoadErrors((prev) => {
              const next = new Set(prev)
              next.delete(key)
              return next
            })
          } else {
            // The new exe has no extractable icon — drop any stale icon from a
            // previous Browse pick on this slot so the initial-letter fallback
            // renders instead of the old app's icon bleeding through (#428).
            setAppIcons((prev) => {
              if (!(key in prev)) return prev
              const next = { ...prev }
              delete next[key]
              return next
            })
            setIconLoadErrors((prev) => {
              if (!prev.has(key)) return prev
              const next = new Set(prev)
              next.delete(key)
              return next
            })
          }
        }
      }
    },
    [updateSettingsObject, setGamePaths, setAppPaths, setAppIcons, setIconLoadErrors]
  )

  const handleGamePathChange = useCallback(
    (key: string, path: string) => {
      updateSettingsObject('gamePaths', setGamePaths, (prev) => ({ ...prev, [key]: path }))
    },
    [updateSettingsObject, setGamePaths]
  )

  const handleAppPathChange = useCallback(
    (key: string, path: string) => {
      updateSettingsObject('appPaths', setAppPaths, (prev) => ({ ...prev, [key]: path }))
      if (!path) {
        setAppIcons((prev) => {
          const next = { ...prev }
          delete next[key]
          return next
        })
      }
    },
    [updateSettingsObject, setAppPaths, setAppIcons]
  )

  const handleAppNameChange = useCallback(
    (key: string, name: string) => {
      updateSettingsObject('appNames', setAppNames, (prev) => ({ ...prev, [key]: name }))
    },
    [updateSettingsObject, setAppNames]
  )

  const handleAppArgsChange = useCallback(
    (key: string, args: string) => {
      updateSettingsObject('appArgs', setAppArgs, (prev) => ({ ...prev, [key]: args }))
    },
    [updateSettingsObject, setAppArgs]
  )

  const handleIconLoadError = useCallback(
    (key: string) => {
      setIconLoadErrors((prev) => new Set([...prev, key]))
    },
    [setIconLoadErrors]
  )

  const { handleAddCustomSlot, handleRemoveCustomSlot, customSlotRemoveDialog } = useCustomSlots({
    appNames,
    appPaths,
    customSlots,
    notify,
    updateSettingsObject,
    setAppPaths,
    setAppNames,
    setAppArgs,
    setAppIcons,
    setIconLoadErrors,
    setProfiles,
    setCustomSlots
  })

  const {
    exportingConfig,
    importingConfig,
    handleExportConfig,
    handleImportConfig,
    configImportDialogs
  } = useConfigIO({ notify, onConfigImported })

  const { handleSave } = useSettingsSave({
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
  })

  const utilities = useMemo(() => getUtilities(customSlots), [customSlots])

  const appearanceValue: AppearanceContextValue = useMemo(
    () => ({
      accentPreset,
      accentCustom,
      accentBgTint,
      themeMode,
      focusActiveTitle,
      zoomFactor,
      isCustomColor,
      onAccentChange: handleAccentChange,
      onCustomColorChange: handleCustomColorChange,
      onAccentBgTintChange: handleAccentBgTintChange,
      onThemeModeChange: handleThemeModeChange,
      onFocusActiveTitleChange: setFocusActiveTitle,
      onZoomFactorChange: handleZoomFactorChange
    }),
    [
      accentPreset,
      accentCustom,
      accentBgTint,
      themeMode,
      focusActiveTitle,
      zoomFactor,
      isCustomColor,
      handleAccentChange,
      handleCustomColorChange,
      handleAccentBgTintChange,
      handleThemeModeChange,
      handleZoomFactorChange,
      setFocusActiveTitle
    ]
  )

  const appsValue: AppsContextValue = useMemo(
    () => ({
      appPaths,
      appNames,
      appArgs,
      appIcons,
      iconLoadErrors,
      customSlots,
      utilities,
      profiles,
      onBrowse: handleBrowse,
      onAppNameChange: handleAppNameChange,
      onAppPathChange: handleAppPathChange,
      onAppArgsChange: handleAppArgsChange,
      onIconLoadError: handleIconLoadError,
      onAddCustomSlot: handleAddCustomSlot,
      onRemoveCustomSlot: handleRemoveCustomSlot
    }),
    [
      appPaths,
      appNames,
      appArgs,
      appIcons,
      iconLoadErrors,
      customSlots,
      utilities,
      profiles,
      handleBrowse,
      handleAppNameChange,
      handleAppPathChange,
      handleAppArgsChange,
      handleIconLoadError,
      handleAddCustomSlot,
      handleRemoveCustomSlot
    ]
  )

  const gamesValue: GamesContextValue = useMemo(
    () => ({
      gamePaths,
      gameIcons,
      onBrowse: handleBrowse,
      onGamePathChange: handleGamePathChange
    }),
    [gamePaths, gameIcons, handleBrowse, handleGamePathChange]
  )

  const behaviorValue: BehaviorContextValue = useMemo(
    () => ({
      startWithWindows,
      startMinimized,
      minimizeToTray,
      launchDelayMs,
      onStartWithWindowsChange: handleStartWithWindowsChange,
      onStartMinimizedChange: setStartMinimized,
      onMinimizeToTrayChange: setMinimizeToTray,
      onLaunchDelayMsChange: setLaunchDelayMs
    }),
    [
      startWithWindows,
      startMinimized,
      minimizeToTray,
      launchDelayMs,
      handleStartWithWindowsChange,
      setStartMinimized,
      setMinimizeToTray,
      setLaunchDelayMs
    ]
  )

  const settingsMetaValue: SettingsMetaContextValue = useMemo(
    () => ({
      loading,
      isDirty,
      dirtySections,
      saveSettings: handleSave,
      exportingConfig,
      importingConfig,
      autoCheckUpdates,
      onExportConfig: handleExportConfig,
      onImportConfig: handleImportConfig,
      onAutoCheckUpdatesChange: setAutoCheckUpdates
    }),
    [
      loading,
      isDirty,
      dirtySections,
      autoCheckUpdates,
      exportingConfig,
      importingConfig,
      handleExportConfig,
      handleImportConfig,
      handleSave,
      setAutoCheckUpdates
    ]
  )

  return (
    <SettingsMetaContext.Provider value={settingsMetaValue}>
      <AppearanceContext.Provider value={appearanceValue}>
        <BehaviorContext.Provider value={behaviorValue}>
          <GamesContext.Provider value={gamesValue}>
            <AppsContext.Provider value={appsValue}>
              {children}
              {customSlotRemoveDialog}
              {configImportDialogs}
            </AppsContext.Provider>
          </GamesContext.Provider>
        </BehaviorContext.Provider>
      </AppearanceContext.Provider>
    </SettingsMetaContext.Provider>
  )
}
