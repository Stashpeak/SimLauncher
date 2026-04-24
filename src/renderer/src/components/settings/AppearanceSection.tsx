import type { CSSProperties } from 'react'
import { DEFAULT_ACCENT_COLOR } from '../../lib/config'
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

interface AppearanceSectionProps {
  accentPreset: string
  accentCustom: string
  accentBgTint: boolean
  focusActiveTitle: boolean
  zoomFactor: number
  isCustomColor: boolean
  onAccentChange: (presetHex: string) => void
  onCustomColorChange: (hex: string) => void
  onAccentBgTintChange: (checked: boolean) => void
  onFocusActiveTitleChange: (checked: boolean) => void
  onZoomFactorChange: (factor: number) => void
}

export function AppearanceSection({
  accentPreset,
  accentCustom,
  accentBgTint,
  focusActiveTitle,
  zoomFactor,
  isCustomColor,
  onAccentChange,
  onCustomColorChange,
  onAccentBgTintChange,
  onFocusActiveTitleChange,
  onZoomFactorChange
}: AppearanceSectionProps) {
  return (
    <section className="space-y-4">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-(--accent) px-1">
        Appearance
      </h3>
      <div className="glass-surface p-5 rounded-2xl space-y-6">
        <div className="space-y-3">
          <label className="text-sm text-(--text-secondary)">Accent Color</label>
          <div className="flex flex-wrap items-center gap-2">
            {ACCENT_PRESETS.map((preset) => (
              <button
                key={preset.hex}
                type="button"
                onClick={() => onAccentChange(preset.hex)}
                className={`h-8 w-8 rounded-full border-2 transition-transform hover:scale-110 active:scale-[0.98] bg-(--preset-color) ${accentPreset === preset.hex ? 'border-white scale-110' : 'border-transparent'}`}
                style={{ '--preset-color': preset.hex } as CSSProperties}
                title={preset.name}
              />
            ))}
            <button
              type="button"
              onClick={() => onAccentChange('custom')}
              className={`h-8 cursor-pointer rounded-full px-3 text-[10px] font-bold uppercase tracking-wide ${
                isCustomColor ? 'selected-surface' : 'neutral-action text-(--text-secondary)'
              }`}
            >
              Custom
            </button>
            {isCustomColor && (
              <label className="glass-input-surface neutral-action relative flex h-8 min-w-0 items-center gap-2 rounded-full border border-(--glass-border) pl-1.5 pr-2.5 animate-fade-slide cursor-pointer">
                <input
                  type="color"
                  value={accentCustom || '#ad46ff'}
                  onChange={(e) => onCustomColorChange(e.target.value)}
                  className="absolute inset-0 cursor-pointer opacity-0"
                  aria-label="Custom accent color"
                  title="Custom accent color"
                />
                <span
                  className="h-5 w-9 shrink-0 rounded-full border border-white/10 bg-(--custom-accent)"
                  style={{ '--custom-accent': accentCustom || '#ad46ff' } as CSSProperties}
                />
                <span className="min-w-0 truncate text-xs font-mono uppercase text-(--text-muted)">
                  {accentCustom}
                </span>
              </label>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-white/5">
          <label className="text-sm text-(--text-secondary)">Accent Glow Background</label>
          <Toggle
            checked={accentBgTint}
            onChange={onAccentBgTintChange}
            aria-label="Toggle accent glow background"
          />
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-white/5">
          <label className="text-sm text-(--text-secondary)">Focus active title</label>
          <Toggle
            checked={focusActiveTitle}
            onChange={onFocusActiveTitleChange}
            aria-label="Focus active title"
          />
        </div>

        <div className="space-y-3 pt-2 border-t border-white/5">
          <label className="text-sm text-(--text-secondary)">UI Scale</label>
          <div className="flex rounded-xl overflow-hidden border border-(--glass-border)">
            {ZOOM_PRESETS.map((preset) => (
              <button
                key={preset.factor}
                onClick={() => onZoomFactorChange(preset.factor)}
                className={`flex-1 cursor-pointer py-2 text-xs font-bold tracking-wide ${
                  zoomFactor === preset.factor
                    ? 'selected-surface'
                    : 'neutral-action text-(--text-secondary)'
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
