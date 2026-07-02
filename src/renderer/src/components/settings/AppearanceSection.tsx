import { useId, type ReactNode } from 'react'
import type { ThemeMode } from '../../lib/theme'
import { Toggle } from '../Toggle'
import { AccentSwatchRow } from '../AccentSwatchRow'
import { ZoomControl } from '../ZoomControl'
import { useAppearanceSettings } from './AppearanceContext'

const THEME_MODE_OPTIONS: Array<{ label: string; value: ThemeMode }> = [
  { label: 'Dark', value: 'dark' },
  { label: 'Light', value: 'light' },
  { label: 'System', value: 'system' }
]

export function AppearanceSection(): ReactNode {
  const accentBgTintId = useId()
  const focusActiveTitleId = useId()
  const {
    accentPreset,
    accentCustom,
    accentBgTint,
    themeMode,
    focusActiveTitle,
    zoomFactor,
    isCustomColor,
    onAccentChange,
    onCustomColorChange,
    onAccentBgTintChange,
    onThemeModeChange,
    onFocusActiveTitleChange,
    onZoomFactorChange
  } = useAppearanceSettings()

  return (
    <>
      <div className="settings-row settings-row-responsive">
        <span className="settings-label text-(--text-secondary)">Theme</span>
        <div className="settings-control" role="group" aria-label="Theme">
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
      </div>

      <div className="settings-row settings-row-responsive">
        <span className="settings-label text-(--text-secondary)">Accent Color</span>
        <AccentSwatchRow
          accentPreset={accentPreset}
          accentCustom={accentCustom}
          isCustomColor={isCustomColor}
          onAccentChange={onAccentChange}
          onCustomColorChange={onCustomColorChange}
        />
      </div>

      <div className="settings-row">
        <label htmlFor={accentBgTintId} className="settings-label text-(--text-secondary)">
          Accent Glow Background
        </label>
        <Toggle id={accentBgTintId} checked={accentBgTint} onChange={onAccentBgTintChange} />
      </div>

      <div className="settings-row">
        <label htmlFor={focusActiveTitleId} className="settings-label text-(--text-secondary)">
          Focus active title
        </label>
        <Toggle
          id={focusActiveTitleId}
          checked={focusActiveTitle}
          onChange={onFocusActiveTitleChange}
        />
      </div>

      <div className="settings-row settings-row-responsive">
        <span className="settings-label text-(--text-secondary)">UI Scale</span>
        <ZoomControl zoomFactor={zoomFactor} onZoomFactorChange={onZoomFactorChange} />
      </div>
    </>
  )
}
