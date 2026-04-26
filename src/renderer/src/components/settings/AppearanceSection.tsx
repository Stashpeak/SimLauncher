import type { CSSProperties } from 'react'
import { DEFAULT_ACCENT_COLOR } from '../../lib/config'
import type { ThemeMode } from '../../lib/theme'
import { Toggle } from '../Toggle'

const ZOOM_PRESETS = [
  { label: '100%', factor: 1.0 },
  { label: '125%', factor: 1.25 },
  { label: '150%', factor: 1.5 },
  { label: '175%', factor: 1.75 }
]

const ACCENT_PRESETS = [
  { name: 'Electric Aqua', hex: DEFAULT_ACCENT_COLOR },
  { name: 'Sky Blue', hex: '#4d9fff' },
  { name: 'Racing Green', hex: '#00c853' },
  { name: 'Sunset Orange', hex: '#ff6b35' },
  { name: 'Cyber Purple', hex: '#c850c0' },
  { name: 'Caution Yellow', hex: '#ffd600' }
]

const THEME_MODE_OPTIONS: Array<{ label: string; value: ThemeMode }> = [
  { label: 'Dark', value: 'dark' },
  { label: 'Light', value: 'light' },
  { label: 'System', value: 'system' }
]

interface AppearanceSectionProps {
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

export function AppearanceSection({
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
}: AppearanceSectionProps) {
  return (
    <section className="space-y-4">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-(--accent) px-1">
        Appearance
      </h3>
      <div className="glass-surface rounded-2xl flex flex-col pt-1">
        <div className="settings-row">
          <label className="settings-label text-(--text-secondary)">Theme</label>
          <div className="settings-control">
            {THEME_MODE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => onThemeModeChange(option.value)}
                className={`settings-control-pill settings-control-pill-button glass-surface tracking-wide transition-colors ${
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

        <div className="settings-row">
          <label className="settings-label text-(--text-secondary)">Accent Color</label>
          <div className="settings-control">
            {ACCENT_PRESETS.map((preset) => (
              <button
                key={preset.hex}
                type="button"
                onClick={() => onAccentChange(preset.hex)}
                className={`h-8 w-8 rounded-full border-2 transition-transform hover:scale-110 active:scale-[0.98] bg-(--preset-color) ${accentPreset === preset.hex ? 'border-(--text-primary) scale-110' : 'border-transparent'}`}
                style={{ '--preset-color': preset.hex } as CSSProperties}
                title={preset.name}
              />
            ))}
            <div
              className={`settings-control-pill settings-control-pill-input glass-surface relative shrink-0 transition-all duration-200 ${
                isCustomColor ? 'selected-surface' : ''
              }`}
            >
              <button
                type="button"
                onClick={() => onAccentChange('custom')}
                className={`cursor-pointer px-3 text-[9px] font-bold uppercase tracking-wide transition-colors ${
                  isCustomColor
                    ? 'text-(--text-primary)'
                    : 'accent-subtle-hover text-(--text-secondary) hover:text-(--text-primary)'
                }`}
              >
                Custom
              </button>
              {isCustomColor && (
                <div className="animate-fade-slide-inline flex h-full items-center">
                  <div className="relative z-10 h-4 w-px bg-(--glass-border) opacity-35" />
                  <label className="relative flex h-full min-w-0 items-center gap-2 pl-2 pr-2.5 cursor-pointer">
                    <input
                      type="color"
                      value={accentCustom || '#ad46ff'}
                      onChange={(e) => onCustomColorChange(e.target.value)}
                      className="absolute inset-0 cursor-pointer opacity-0"
                      aria-label="Custom accent color"
                      title="Custom accent color"
                    />
                    <span
                      className="h-4 w-7 shrink-0 rounded-full border border-(--glass-border) bg-(--custom-accent)"
                      style={{ '--custom-accent': accentCustom || '#ad46ff' } as CSSProperties}
                    />
                    <span className="min-w-0 truncate text-[10px] font-mono uppercase text-(--text-muted)">
                      {accentCustom}
                    </span>
                  </label>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="settings-row">
          <label className="settings-label text-(--text-secondary)">Accent Glow Background</label>
          <Toggle
            checked={accentBgTint}
            onChange={onAccentBgTintChange}
            aria-label="Toggle accent glow background"
          />
        </div>

        <div className="settings-row">
          <label className="settings-label text-(--text-secondary)">Focus active title</label>
          <Toggle
            checked={focusActiveTitle}
            onChange={onFocusActiveTitleChange}
            aria-label="Focus active title"
          />
        </div>

        <div className="settings-row">
          <label className="settings-label text-(--text-secondary)">UI Scale</label>
          <div className="settings-control">
            {ZOOM_PRESETS.map((preset) => (
              <button
                key={preset.factor}
                onClick={() => onZoomFactorChange(preset.factor)}
                className={`settings-control-pill settings-control-pill-button settings-control-preset glass-surface tracking-wide transition-colors ${
                  zoomFactor === preset.factor
                    ? 'selected-surface text-(--text-primary)'
                    : 'accent-subtle-hover text-(--text-secondary) hover:text-(--text-primary)'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
