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
    showTrayIcon: boolean
    autoCheckUpdates: boolean
    zoomFactor: number
    isCustomColor: boolean
    appIcons: Record<string, string>
    gameIcons: Record<string, string>
    // Bundled curated icons for built-in utilities that ship one (#652),
    // keyed by utility key, preferred over the shell-extracted icon (#727).
    // Display-only cache, like gameIcons — not part of the dirty-tracked
    // settings snapshot.
    utilityIcons: Record<string, string>
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
    setShowTrayIcon: Dispatch<SetStateAction<boolean>>
    setAutoCheckUpdates: Dispatch<SetStateAction<boolean>>
    setZoomFactor: Dispatch<SetStateAction<number>>
    setIsCustomColor: Dispatch<SetStateAction<boolean>>
    setAppIcons: Dispatch<SetStateAction<Record<string, string>>>
    setGameIcons: Dispatch<SetStateAction<Record<string, string>>>
    setUtilityIcons: Dispatch<SetStateAction<Record<string, string>>>
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
    showTrayIcon: boolean
    autoCheckUpdates: boolean
    zoomFactor: number
  }
}

// The dirty-tracking baseline is a JSON string compare against
// currentSettingsState, so anything passed to resetDirty must carry these keys
// in this exact order (see the currentSettingsState memo below).
export type SettingsStateSnapshot = SettingsStateBundle['currentSettingsState']

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
  const [showTrayIcon, setShowTrayIcon] = useState<boolean>(true)
  const [autoCheckUpdates, setAutoCheckUpdates] = useState<boolean>(true)
  const [zoomFactor, setZoomFactor] = useState<number>(1.0)

  const [isCustomColor, setIsCustomColor] = useState(false)
  const [appIcons, setAppIcons] = useState<Record<string, string>>({})
  const [gameIcons, setGameIcons] = useState<Record<string, string>>({})
  const [utilityIcons, setUtilityIcons] = useState<Record<string, string>>({})
  const [iconLoadErrors, setIconLoadErrors] = useState<Set<string>>(new Set())
  const settingsObjectEditVersions = useRef(createSettingsObjectVersions())
  const latestSettingsObjects = useRef<SettingsObjectRecords>({
    appPaths,
    appNames,
    appArgs,
    gamePaths
  })

  // Increment the version counter BEFORE calling setter so the version is
  // already bumped when the save reads settingsObjectEditVersions.current at
  // the start of its async critical section. Bumping inside the updater
  // callback would race because React may batch or defer the state update.
  const updateSettingsObject = useCallback(
    (
      field: SettingsObjectField,
      setter: Dispatch<SetStateAction<Record<string, string>>>,
      updater: (current: Record<string, string>) => Record<string, string>
    ) => {
      settingsObjectEditVersions.current[field] += 1
      setter((current) => {
        const next = updater(current)
        // Mirror the latest value into the ref so that useSettingsSave can read
        // it synchronously without waiting for the React render cycle to complete.
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
      showTrayIcon,
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
      showTrayIcon,
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
      showTrayIcon,
      autoCheckUpdates,
      zoomFactor,
      isCustomColor,
      appIcons,
      gameIcons,
      utilityIcons,
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
      setShowTrayIcon,
      setAutoCheckUpdates,
      setZoomFactor,
      setIsCustomColor,
      setAppIcons,
      setGameIcons,
      setUtilityIcons,
      setIconLoadErrors
    },
    updateSettingsObject,
    settingsObjectEditVersions,
    latestSettingsObjects,
    currentSettingsState
  }
}
