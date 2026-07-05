import type { ReactNode } from 'react'
import type { ThemeMode } from '../lib/theme'

export const THEME_MODE_OPTIONS: Array<{ label: string; value: ThemeMode }> = [
  { label: 'Dark', value: 'dark' },
  { label: 'Light', value: 'light' },
  { label: 'System', value: 'system' }
]

interface ThemeModeControlProps {
  themeMode: ThemeMode
  onThemeModeChange: (mode: ThemeMode) => void
  /**
   * Container class for the pill group. Defaults to the Settings-row control
   * layout; the onboarding modal passes its own so the row fits that surface.
   */
  className?: string
}

/**
 * The segmented Light/Dark/System control. Shared by AppearanceSection
 * (Settings) and the first-run onboarding modal so both drive the exact same
 * control. Prop-driven (no context) so it works wherever it is mounted. #735
 */
export function ThemeModeControl({
  themeMode,
  onThemeModeChange,
  className = 'settings-control'
}: ThemeModeControlProps): ReactNode {
  return (
    <div className={className} role="group" aria-label="Theme">
      {THEME_MODE_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onThemeModeChange(option.value)}
          aria-pressed={themeMode === option.value}
          className={`settings-control-pill settings-control-pill-button settings-control-preset glass-surface action-hover-scale tracking-wide transition-colors ${
            themeMode === option.value
              ? 'selected-surface text-(--text-primary)'
              : 'accent-subtle-hover text-(--text-secondary) hover:text-(--text-primary)'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
