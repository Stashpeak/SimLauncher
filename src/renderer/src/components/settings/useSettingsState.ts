import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction
} from 'react'
import { DEFAULT_ACCENT_COLOR, type Profiles } from '../../lib/config'
import type { ThemeMode } from '../../lib/theme'
import {
  createSettingsObjectVersions,
  type SettingsObjectField,
  type SettingsObjectRecords,
  type SettingsObjectVersions
} from './saveRace'

export interface SettingsStateBundle {
  state: {
    loading: boolean
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
    isCustomColor: boolean
    appIcons: Record<string, string>
    gameIcons: Record<string, string>
    iconLoadErrors: Set<string>
  }
  setters: {
    setLoading: Dispatch<SetStateAction<boolean>>
    setAppPaths: Dispatch<SetStateAction<Record<string, string>>>
    setAppNames: Dispatch<SetStateAction<Record<string, string>>>
    setAppArgs: Dispatch<SetStateAction<Record<string, string>>>
    setProfiles: Dispatch<SetStateAction<Profiles>>
    setGamePaths: Dispatch<SetStateAction<Record<string, string>>>
    setCustomSlots: Dispatch<SetStateAction<number>>
    setAccentPreset: Dispatch<SetStateAction<string>>
    setAccentCustom: Dispatch<SetStateAction<string>>
    setAccentBgTint: Dispatch<SetStateAction<boolean>>
    setThemeMode: Dispatch<SetStateAction<ThemeMode>>
    setFocusActiveTitle: Dispatch<SetStateAction<boolean>>
    setLaunchDelayMs: Dispatch<SetStateAction<number>>
    setStartWithWindows: Dispatch<SetStateAction<boolean>>
    setStartMinimized: Dispatch<SetStateAction<boolean>>
    setMinimizeToTray: Dispatch<SetStateAction<boolean>>
    setAutoCheckUpdates: Dispatch<SetStateAction<boolean>>
    setZoomFactor: Dispatch<SetStateAction<number>>
    setIsCustomColor: Dispatch<SetStateAction<boolean>>
    setAppIcons: Dispatch<SetStateAction<Record<string, string>>>
    setGameIcons: Dispatch<SetStateAction<Record<string, string>>>
    setIconLoadErrors: Dispatch<SetStateAction<Set<string>>>
  }
  updateSettingsObject: (
    field: SettingsObjectField,
    setter: Dispatch<SetStateAction<Record<string, string>>>,
    updater: (current: Record<string, string>) => Record<string, string>
  ) => void
  settingsObjectEditVersions: MutableRefObject<SettingsObjectVersions>
  latestSettingsObjects: MutableRefObject<SettingsObjectRecords>
  currentSettingsState: {
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
  }
}

export function useSettingsState(): SettingsStateBundle {
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

  return {
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
  }
}
