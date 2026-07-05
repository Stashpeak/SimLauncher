import { useId, type ReactNode } from 'react'
import { Toggle } from '../Toggle'
import { AccentSwatchRow } from '../AccentSwatchRow'
import { ThemeModeControl } from '../ThemeModeControl'
import { ZoomControl } from '../ZoomControl'
import { useAppearanceSettings } from './AppearanceContext'

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
        <ThemeModeControl themeMode={themeMode} onThemeModeChange={onThemeModeChange} />
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
