import { useState, type CSSProperties } from 'react'
import { DEFAULT_ACCENT_COLOR } from '../../lib/config'
import type { ThemeMode } from '../../lib/theme'
import { Toggle } from '../Toggle'
import { ColorPickerPopover } from '../ColorPickerPopover'

const ZOOM_PRESETS = [
  { label: '100%', factor: 1.0 },
  { label: '125%', factor: 1.25 },
  { label: '150%', factor: 1.5 },
  { label: '175%', factor: 1.75 }
]

const ACCENT_PRESETS = [
  { name: 'Pit Lane Teal', hex: DEFAULT_ACCENT_COLOR },
  { name: 'Horizon Blue', hex: '#3080d8' },
  { name: 'Racing Green', hex: '#008a38' },
  { name: 'Paddock Orange', hex: '#d84e1c' },
  { name: 'Pit Night', hex: '#9147ff' },
  { name: 'Safety Car Gold', hex: '#a88000' },
  { name: 'Milano Red', hex: '#d50000' }
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
  const [showPicker, setShowPicker] = useState(false)

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

        <div className="settings-row">
          <label className="settings-label text-(--text-secondary)">Accent Color</label>
          <div className="settings-control">
            {ACCENT_PRESETS.map((preset) => (
              <button
                key={preset.hex}
                type="button"
                onClick={() => onAccentChange(preset.hex)}
                className={`h-8 w-8 rounded-full border-2 transition-transform hover:scale-110 active:scale-[0.98] bg-(--preset-color) ${accentPreset === preset.hex ? 'border-(--accent) scale-110' : 'border-transparent'}`}
                style={{ '--preset-color': preset.hex } as CSSProperties}
                title={preset.name}
              />
            ))}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setShowPicker(!showPicker)
                  if (!isCustomColor) onAccentChange('custom')
                }}
                className={`relative flex h-8 w-8 cursor-pointer items-center justify-center transition-transform hover:scale-110 active:scale-[0.98] ${
                  isCustomColor ? 'scale-110' : ''
                }`}
                title="Custom Color"
              >
                {/* Background gradient/color */}
                <div
                  className="absolute inset-0 rounded-full"
                  style={{
                    background: isCustomColor
                      ? accentCustom || '#ad46ff'
                      : 'conic-gradient(from 180deg, #ff5e57, #ffdd59, #0be881, #4bcffa, #575fcf, #ef5777, #ff5e57)'
                  }}
                />

                {/* Glass overlay for unselected state */}
                {!isCustomColor && (
                  <div className="absolute inset-0 rounded-full bg-white/10 dark:bg-black/10 pointer-events-none" />
                )}

                {/* Border to match presets */}
                <div
                  className={`absolute inset-0 rounded-full border-2 pointer-events-none ${isCustomColor ? 'border-(--accent)' : 'border-transparent'}`}
                />
              </button>

              {showPicker && (
                <ColorPickerPopover
                  color={accentCustom || '#ad46ff'}
                  onChange={onCustomColorChange}
                  onClose={() => setShowPicker(false)}
                />
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
                className={`settings-control-pill settings-control-pill-button settings-control-preset glass-surface action-hover-scale tracking-wide transition-colors ${
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
