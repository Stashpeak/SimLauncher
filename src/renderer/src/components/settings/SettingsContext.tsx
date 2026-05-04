import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction
} from 'react'
import { useDirtyTracking } from '../../hooks/useDirtyTracking'
import { DEFAULT_ACCENT_COLOR, getUtilities, type Profiles, type Utility } from '../../lib/config'
import { browsePath, getFileIcon, setLoginItem, setZoom } from '../../lib/electron'
import type { ThemeMode } from '../../lib/theme'
import { useTheme } from '../../contexts/ThemeContext'
import { useNotify } from '../Notify'
import {
  createSettingsObjectVersions,
  type SettingsObjectField,
  type SettingsObjectRecords
} from './saveRace'
import { useConfigIO } from './useConfigIO'
import { useCustomSlots } from './useCustomSlots'
import { useSettingsLoad } from './useSettingsLoad'
import { useSettingsSave } from './useSettingsSave'

interface SettingsContextValue {
  loading: boolean
  isDirty: boolean
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
  autoCheckUpdates: boolean
  zoomFactor: number
  exportingConfig: boolean
  importingConfig: boolean
  isCustomColor: boolean
  appIcons: Record<string, string>
  gameIcons: Record<string, string>
  iconLoadErrors: Set<string>
  utilities: Utility[]
  onAutoCheckUpdatesChange: (checked: boolean) => void
  onAccentChange: (presetHex: string) => void
  onCustomColorChange: (hex: string) => void
  onAccentBgTintChange: (checked: boolean) => void
  onThemeModeChange: (mode: ThemeMode) => void
  onFocusActiveTitleChange: (checked: boolean) => void
  onZoomFactorChange: (factor: number) => void
  onStartWithWindowsChange: (checked: boolean) => void
  onStartMinimizedChange: (checked: boolean) => void
  onMinimizeToTrayChange: (checked: boolean) => void
  onLaunchDelayMsChange: (delayMs: number) => void
  onExportConfig: () => void
  onImportConfig: () => void
  onBrowse: (key: string, isGame: boolean) => void
  onGamePathChange: (key: string, path: string) => void
  onAppNameChange: (key: string, name: string) => void
  onAppPathChange: (key: string, path: string) => void
  onAppArgsChange: (key: string, args: string) => void
  onIconLoadError: (key: string) => void
  onAddCustomSlot: () => void
  onRemoveCustomSlot: (slotNumber: number) => void
  saveSettings: () => Promise<void>
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

export function useSettings() {
  const context = useContext(SettingsContext)

  if (!context) {
    throw new Error('useSettings must be used within SettingsProvider')
  }

  return context
}

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

  const value: SettingsContextValue = useMemo(
    () => ({
      loading,
      isDirty,
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
      exportingConfig,
      importingConfig,
      isCustomColor,
      appIcons,
      gameIcons,
      iconLoadErrors,
      utilities,
      onAutoCheckUpdatesChange: setAutoCheckUpdates,
      onAccentChange: handleAccentChange,
      onCustomColorChange: handleCustomColorChange,
      onAccentBgTintChange: handleAccentBgTintChange,
      onThemeModeChange: handleThemeModeChange,
      onFocusActiveTitleChange: setFocusActiveTitle,
      onZoomFactorChange: handleZoomFactorChange,
      onStartWithWindowsChange: handleStartWithWindowsChange,
      onStartMinimizedChange: setStartMinimized,
      onMinimizeToTrayChange: setMinimizeToTray,
      onLaunchDelayMsChange: setLaunchDelayMs,
      onExportConfig: handleExportConfig,
      onImportConfig: handleImportConfig,
      onBrowse: handleBrowse,
      onGamePathChange: handleGamePathChange,
      onAppNameChange: handleAppNameChange,
      onAppPathChange: handleAppPathChange,
      onAppArgsChange: handleAppArgsChange,
      onIconLoadError: handleIconLoadError,
      onAddCustomSlot: handleAddCustomSlot,
      onRemoveCustomSlot: handleRemoveCustomSlot,
      saveSettings: handleSave
    }),
    [
      loading,
      isDirty,
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
      exportingConfig,
      importingConfig,
      isCustomColor,
      appIcons,
      gameIcons,
      iconLoadErrors,
      utilities,
      handleAccentChange,
      handleCustomColorChange,
      handleAccentBgTintChange,
      handleThemeModeChange,
      handleZoomFactorChange,
      handleStartWithWindowsChange,
      handleExportConfig,
      handleImportConfig,
      handleBrowse,
      handleGamePathChange,
      handleAppNameChange,
      handleAppPathChange,
      handleAppArgsChange,
      handleIconLoadError,
      handleAddCustomSlot,
      handleRemoveCustomSlot,
      handleSave
    ]
  )

  return (
    <SettingsContext.Provider value={value}>
      {children}
      {customSlotRemoveDialog}
      {configImportDialogs}
    </SettingsContext.Provider>
  )
}
