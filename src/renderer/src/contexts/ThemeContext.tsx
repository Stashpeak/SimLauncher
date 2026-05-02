import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react'
import { DEFAULT_ACCENT_COLOR } from '../lib/config'
import { setZoom } from '../lib/electron'
import { getSettings } from '../lib/store'
import { applyAccentTheme, applyThemeMode, normalizeThemeMode, type ThemeMode } from '../lib/theme'

interface ThemeContextValue {
  accentPreset: string
  accentCustom: string
  accentBgTint: boolean
  themeMode: ThemeMode
  resolvedAccent: string
  setAccentPreset: (preset: string) => void
  setAccentCustom: (hex: string) => void
  setAccentBgTint: (checked: boolean) => void
  setThemeMode: (mode: ThemeMode) => void
  syncThemeFromStore: () => Promise<void>
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function useTheme() {
  const context = useContext(ThemeContext)

  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider')
  }

  return context
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [accentPreset, setAccentPresetState] = useState(DEFAULT_ACCENT_COLOR)
  const [accentCustom, setAccentCustomState] = useState('')
  const [accentBgTint, setAccentBgTintState] = useState(false)
  const [themeMode, setThemeModeState] = useState<ThemeMode>('dark')

  const applyAccent = useCallback((preset: string, custom: string) => {
    const hex = preset === 'custom' ? custom : preset

    if (hex) {
      applyAccentTheme(hex)
    }
  }, [])

  const setAccentPreset = useCallback(
    (preset: string) => {
      setAccentPresetState(preset)
      applyAccent(preset, accentCustom)
    },
    [accentCustom, applyAccent]
  )

  const setAccentCustom = useCallback(
    (hex: string) => {
      setAccentCustomState(hex)
      applyAccent(accentPreset, hex)
    },
    [accentPreset, applyAccent]
  )

  const setThemeMode = useCallback((mode: ThemeMode) => {
    setThemeModeState(mode)
    applyThemeMode(mode)
  }, [])

  const syncThemeFromStore = useCallback(async () => {
    const settings = await getSettings()
    const preset = settings.accentPreset || DEFAULT_ACCENT_COLOR
    const custom = settings.accentCustom || ''
    const loadedThemeMode = normalizeThemeMode(settings.themeMode)

    setAccentPresetState(preset)
    setAccentCustomState(custom)
    setAccentBgTintState(settings.accentBgTint || false)
    setThemeModeState(loadedThemeMode)
    applyThemeMode(loadedThemeMode)
    applyAccent(preset, custom)

    if (Number.isFinite(settings.zoomFactor)) {
      setZoom(settings.zoomFactor)
    }
  }, [applyAccent])

  useEffect(() => {
    syncThemeFromStore().catch((err) => {
      console.error('Failed to sync theme', err)
    })
  }, [syncThemeFromStore])

  const value = useMemo(
    () => ({
      accentPreset,
      accentCustom,
      accentBgTint,
      themeMode,
      resolvedAccent: accentPreset === 'custom' ? accentCustom : accentPreset,
      setAccentPreset,
      setAccentCustom,
      setAccentBgTint: setAccentBgTintState,
      setThemeMode,
      syncThemeFromStore
    }),
    [
      accentPreset,
      accentCustom,
      accentBgTint,
      themeMode,
      setAccentPreset,
      setAccentCustom,
      setThemeMode,
      syncThemeFromStore
    ]
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
