import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction
} from 'react'
import { useDirtyTracking } from '../../hooks/useDirtyTracking'
import { DEFAULT_ACCENT_COLOR, getUtilities, type Profiles } from '../../lib/config'
import { browsePath, getFileIcon, setLoginItem, setZoom } from '../../lib/electron'
import type { ThemeMode } from '../../lib/theme'
import { useTheme } from '../../contexts/ThemeContext'
import { useNotify } from '../Notify'
import { AppearanceContext, type AppearanceContextValue } from './AppearanceContext'
import { AppsContext, type AppsContextValue } from './AppsContext'
import { BehaviorContext, type BehaviorContextValue } from './BehaviorContext'
import { GamesContext, type GamesContextValue } from './GamesContext'
import { SettingsMetaContext, type SettingsMetaContextValue } from './SettingsMetaContext'
import {
  createSettingsObjectVersions,
  type SettingsObjectField,
  type SettingsObjectRecords
} from './saveRace'
import { useConfigIO } from './useConfigIO'
import { useCustomSlots } from './useCustomSlots'
import { useSettingsLoad } from './useSettingsLoad'
import { useSettingsSave } from './useSettingsSave'

export function SettingsProvider({
  children,
  onDirtyChange,
  shouldSaveTrigger,
  onSaved,
  onConfigImported
}: {
  children: ReactNode
  onDirtyChange?: (isDirty: boolean) => void
  shouldSaveTrigger?: boolean
  onSaved?: () => void
  onConfigImported?: () => void
}) {
  const { notify } = useNotify()
  const theme = useTheme()
  const themeRef = useRef(theme)
  themeRef.current = theme
  const [loading, setLoading] = useState(true)

  const [appPaths, setAppPaths] = useState<Record<string, string>>({})
  const [appNames, setAppNames] = useState<Record<string, string>>({})
  const [appArgs, setAppArgs] = useState<Record<string, string>>({})
  const [profiles, setProfiles] = useState<Profiles>({})
  const [gamePaths, setGamePaths] = useState<Record<string, string>>({})
  const [customSlots, setCustomSlots] = useState(1)
  const [accentPreset, setAccentPreset] = useState<string>(DEFAULT_ACCENT_COLOR)
  const [accentCustom, setAccentCustom] = useState<string>('')
  const [accentBgTint, setAccentBgTint] = useState<boolean>(false)
  const [themeMode, setThemeMode] = useState<ThemeMode>('dark')
  const [focusActiveTitle, setFocusActiveTitle] = useState<boolean>(true)
  const [launchDelayMs, setLaunchDelayMs] = useState<number>(1000)
  const [startWithWindows, setStartWithWindows] = useState<boolean>(false)
  const [startMinimized, setStartMinimized] = useState<boolean>(false)
  const [minimizeToTray, setMinimizeToTray] = useState<boolean>(false)
  const [autoCheckUpdates, setAutoCheckUpdates] = useState<boolean>(true)
  const [zoomFactor, setZoomFactor] = useState<number>(1.0)

  const [isCustomColor, setIsCustomColor] = useState(false)
  const [appIcons, setAppIcons] = useState<Record<string, string>>({})
  const [gameIcons, setGameIcons] = useState<Record<string, string>>({})
  const [iconLoadErrors, setIconLoadErrors] = useState<Set<string>>(new Set())
  const settingsObjectEditVersions = useRef(createSettingsObjectVersions())
  const latestSettingsObjects = useRef<SettingsObjectRecords>({
    appPaths,
    appNames,
    appArgs,
    gamePaths
  })

  const updateSettingsObject = useCallback(
    (
      field: SettingsObjectField,
      setter: Dispatch<SetStateAction<Record<string, string>>>,
      updater: (current: Record<string, string>) => Record<string, string>
    ) => {
      settingsObjectEditVersions.current[field] += 1
      setter((current) => {
        const next = updater(current)
        latestSettingsObjects.current = {
          ...latestSettingsObjects.current,
          [field]: next
        }
        return next
      })
    },
    []
  )

  const currentSettingsState = useMemo(
    () => ({
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
      zoomFactor
    }),
    [
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
      zoomFactor
    ]
  )

  const { isDirty, resetDirty } = useDirtyTracking(currentSettingsState, loading)

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
    [theme]
  )

  const handleCustomColorChange = useCallback(
    (hex: string) => {
      setAccentCustom(hex)
      theme.setAccentCustom(hex)
    },
    [theme]
  )

  const handleAccentBgTintChange = useCallback(
    (checked: boolean) => {
      setAccentBgTint(checked)
      theme.setAccentBgTint(checked)
    },
    [theme]
  )

  const handleThemeModeChange = useCallback(
    (mode: ThemeMode) => {
      setThemeMode(mode)
      theme.setThemeMode(mode)
    },
    [theme]
  )

  const handleZoomFactorChange = useCallback((factor: number) => {
    setZoomFactor(factor)
    setZoom(factor)
  }, [])

  const handleStartWithWindowsChange = useCallback((checked: boolean) => {
    setStartWithWindows(checked)
    setLoginItem(checked)
  }, [])

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
          }
        }
      }
    },
    [updateSettingsObject]
  )

  const handleGamePathChange = useCallback(
    (key: string, path: string) => {
      updateSettingsObject('gamePaths', setGamePaths, (prev) => ({ ...prev, [key]: path }))
    },
    [updateSettingsObject]
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
    [updateSettingsObject]
  )

  const handleAppNameChange = useCallback(
    (key: string, name: string) => {
      updateSettingsObject('appNames', setAppNames, (prev) => ({ ...prev, [key]: name }))
    },
    [updateSettingsObject]
  )

  const handleAppArgsChange = useCallback(
    (key: string, args: string) => {
      updateSettingsObject('appArgs', setAppArgs, (prev) => ({ ...prev, [key]: args }))
    },
    [updateSettingsObject]
  )

  const handleIconLoadError = useCallback((key: string) => {
    setIconLoadErrors((prev) => new Set([...prev, key]))
  }, [])

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
    setLaunchDelayMs,
    shouldSaveTrigger,
    onSaved
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
      handleZoomFactorChange
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
    [startWithWindows, startMinimized, minimizeToTray, launchDelayMs, handleStartWithWindowsChange]
  )

  const settingsMetaValue: SettingsMetaContextValue = useMemo(
    () => ({
      loading,
      isDirty,
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
      autoCheckUpdates,
      exportingConfig,
      importingConfig,
      handleExportConfig,
      handleImportConfig,
      handleSave
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
