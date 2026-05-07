import { createContext, useContext } from 'react'
import type { ThemeMode } from '../../lib/theme'

export interface AppearanceContextValue {
  accentPreset: string
  accentCustom: string
  accentBgTint: boolean
  themeMode: ThemeMode
  focusActiveTitle: boolean
  zoomFactor: number
  isCustomColor: boolean
  onAccentChange: (presetHex: string) => void
  onCustomColorChange: (hex: string) => void
  onAccentBgTintChange: (checked: boolean) => void
  onThemeModeChange: (mode: ThemeMode) => void
  onFocusActiveTitleChange: (checked: boolean) => void
  onZoomFactorChange: (factor: number) => void
}

export const AppearanceContext = createContext<AppearanceContextValue | null>(null)

export function useAppearanceSettings() {
  const context = useContext(AppearanceContext)

  if (!context) {
    throw new Error('useAppearanceSettings must be used within SettingsProvider')
  }

  return context
}
