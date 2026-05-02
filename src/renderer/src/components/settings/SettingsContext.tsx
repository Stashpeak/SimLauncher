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
import {
  DEFAULT_ACCENT_COLOR,
  GAMES,
  getCustomUtilityKey,
  getUtilities,
  resolveCustomSlots,
  type Profiles,
  type Utility
} from '../../lib/config'
import { browsePath, getAssetData, getFileIcon, setLoginItem, setZoom } from '../../lib/electron'
import {
  exportConfig,
  getProfiles,
  getSettings,
  importConfig,
  saveProfiles,
  saveSettings as persistSettings
} from '../../lib/store'
import {
  applyAccentTheme,
  applyThemeMode,
  normalizeThemeMode,
  type ThemeMode
} from '../../lib/theme'
import { useNotify } from '../Notify'
import { shiftCustomSlotRecord, shiftCustomSlotSet, shiftProfileCustomSlots } from './customSlots'
import {
  createSettingsObjectVersions,
  getSettingsObjectChangesDuringSave,
  resolveSettingsObjectsAfterSave,
  type SettingsObjectField,
  type SettingsObjectRecords
} from './saveRace'
import { normalizeLaunchDelayMs } from './settingsUtils'

function trimPathRecord(paths: Record<string, string>) {
  return Object.fromEntries(Object.entries(paths).map(([key, value]) => [key, value.trim()]))
}

function trimStringRecord(values: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(values)
      .map(([key, value]) => [key, value.trim()])
      .filter(([_key, value]) => value.length > 0)
  )
}

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

  const [exportingConfig, setExportingConfig] = useState(false)
  const [importingConfig, setImportingConfig] = useState(false)
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

  const loadSettingsFromStore = useCallback(async () => {
    const [settings, savedProfiles] = await Promise.all([getSettings(), getProfiles()])
    const typedProfiles = savedProfiles as Profiles

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
        ...(Object.values(typedProfiles) as Record<string, unknown>[])
      )
    )
    const loadedThemeMode = normalizeThemeMode(settings.themeMode)

    setAccentPreset(settings.accentPreset || DEFAULT_ACCENT_COLOR)
    setAccentCustom(settings.accentCustom || '')
    setAccentBgTint(settings.accentBgTint || false)
    setThemeMode(loadedThemeMode)
    applyThemeMode(loadedThemeMode)
    setFocusActiveTitle(settings.focusActiveTitle !== false)
    setLaunchDelayMs(normalizeLaunchDelayMs(settings.launchDelayMs))
    setStartWithWindows(settings.startWithWindows || false)
    setStartMinimized(settings.startMinimized || false)
    setMinimizeToTray(settings.minimizeToTray || false)
    setAutoCheckUpdates(settings.autoCheckUpdates !== false)
    setZoomFactor(Number.isFinite(settings.zoomFactor) ? settings.zoomFactor : 1.0)

    setIsCustomColor(settings.accentPreset === 'custom')

    const icons: Record<string, string> = {}
    for (const [key, path] of Object.entries(settings.appPaths)) {
      if (path) {
        const icon = await getFileIcon(path)
        if (icon) icons[key] = icon
      }
    }
    setAppIcons(icons)

    const gIcons: Record<string, string> = {}
    for (const game of GAMES) {
      const filename = game.icon.split('/').pop() || ''
      const data = await getAssetData(filename)
      if (data) gIcons[game.key] = data
    }
    setGameIcons(gIcons)

    setLoading(false)
  }, [])

  useEffect(() => {
    loadSettingsFromStore()
  }, [])

  useEffect(() => {
    latestSettingsObjects.current = {
      appPaths,
      appNames,
      appArgs,
      gamePaths
    }
  }, [appPaths, appNames, appArgs, gamePaths])

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

  useEffect(() => {
    onDirtyChange?.(isDirty)
  }, [isDirty, onDirtyChange])

  const updateAccentCSS = useCallback((hex: string) => {
    if (hex) applyAccentTheme(hex)
  }, [])

  const handleAccentChange = useCallback(
    (presetHex: string) => {
      setAccentPreset(presetHex)
      if (presetHex !== 'custom') {
        setIsCustomColor(false)
        updateAccentCSS(presetHex)
      } else {
        setIsCustomColor(true)
        if (accentCustom) updateAccentCSS(accentCustom)
      }
    },
    [accentCustom, updateAccentCSS]
  )

  const handleCustomColorChange = useCallback(
    (hex: string) => {
      setAccentCustom(hex)
      updateAccentCSS(hex)
    },
    [updateAccentCSS]
  )

  const handleAccentBgTintChange = useCallback((checked: boolean) => {
    setAccentBgTint(checked)
    window.dispatchEvent(new CustomEvent('bg-tint-change', { detail: checked }))
  }, [])

  const handleThemeModeChange = useCallback((mode: ThemeMode) => {
    setThemeMode(mode)
    applyThemeMode(mode)
  }, [])

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

  const handleAddCustomSlot = useCallback(() => {
    setCustomSlots((current) => current + 1)
  }, [])

  const handleRemoveCustomSlot = useCallback(
    (slotNumber: number) => {
      if (customSlots <= 1) {
        notify('At least one custom app slot is required', 'warn')
        return
      }

      const slotKey = getCustomUtilityKey(slotNumber)
      const slotName = appNames[slotKey] || `Custom App ${slotNumber}`

      if (appPaths[slotKey]) {
        const confirmed = window.confirm(`Remove ${slotName} and its executable path?`)

        if (!confirmed) {
          return
        }
      }

      updateSettingsObject('appPaths', setAppPaths, (current) =>
        shiftCustomSlotRecord(current, slotNumber, customSlots)
      )
      updateSettingsObject('appNames', setAppNames, (current) =>
        shiftCustomSlotRecord(current, slotNumber, customSlots)
      )
      updateSettingsObject('appArgs', setAppArgs, (current) =>
        shiftCustomSlotRecord(current, slotNumber, customSlots)
      )
      setAppIcons((current) => shiftCustomSlotRecord(current, slotNumber, customSlots))
      setIconLoadErrors((current) => shiftCustomSlotSet(current, slotNumber, customSlots))
      setProfiles((current) => {
        const nextProfiles: Profiles = {}

        Object.entries(current).forEach(([gameKey, profile]) => {
          nextProfiles[gameKey] = shiftProfileCustomSlots(profile, slotNumber, customSlots)
        })

        return nextProfiles
      })
      setCustomSlots((current) => Math.max(1, current - 1))
    },
    [appNames, appPaths, customSlots, notify, updateSettingsObject]
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

  const handleExportConfig = useCallback(async () => {
    setExportingConfig(true)

    try {
      const result = await exportConfig()

      if (result.success) {
        notify('Config exported', 'success', 2500)
      } else if (!result.canceled) {
        notify(result.error || 'Failed to export config', 'error')
      }
    } catch (err) {
      notify('Failed to export config', 'error')
      console.error(err)
    } finally {
      setExportingConfig(false)
    }
  }, [notify])

  const handleImportConfig = useCallback(async () => {
    const confirmed = window.confirm(
      'Importing a config file will replace your current SimLauncher settings. Continue?'
    )

    if (!confirmed) {
      return
    }

    setImportingConfig(true)

    try {
      const result = await importConfig()

      if (result.success) {
        await loadSettingsFromStore()
        resetDirty()
        onConfigImported?.()
        notify('Config imported', 'success', 2500)
      } else if (!result.canceled) {
        notify(result.error || 'Failed to import config', 'error')
      }
    } catch (err) {
      notify('Failed to import config', 'error')
      console.error(err)
    } finally {
      setImportingConfig(false)
    }
  }, [loadSettingsFromStore, notify, onConfigImported, resetDirty])

  const handleSave = useCallback(async () => {
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

      if (!changedDuringSave.appPaths) {
        setAppPaths(savedSettingsObjects.appPaths)
      }

      if (!changedDuringSave.gamePaths) {
        setGamePaths(savedSettingsObjects.gamePaths)
      }

      if (!changedDuringSave.appArgs) {
        setAppArgs(savedSettingsObjects.appArgs)
      }

      setLaunchDelayMs(normalizedLaunchDelayMs)

      notify('Settings saved!', 'success', 2500)

      resetDirty({
        ...currentSettingsState,
        ...resetSettingsObjects,
        launchDelayMs: normalizedLaunchDelayMs
      })
    } catch (err) {
      notify('Failed to save settings', 'error')
      console.error(err)
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
    notify,
    profiles,
    resetDirty,
    startMinimized,
    startWithWindows,
    themeMode,
    zoomFactor
  ])

  useEffect(() => {
    if (shouldSaveTrigger) {
      handleSave().then(() => {
        onSaved?.()
      })
    }
  }, [shouldSaveTrigger])

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

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}
