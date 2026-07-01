import { useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { DEFAULT_ACCENT_COLOR } from '../lib/config'
import { ColorPickerPopover } from './ColorPickerPopover'
import { Tooltip } from './Tooltip'

export const ACCENT_PRESETS = [
  { name: 'Pit Lane Teal', hex: DEFAULT_ACCENT_COLOR },
  { name: 'Horizon Blue', hex: '#3080d8' },
  { name: 'Racing Green', hex: '#008a38' },
  { name: 'Paddock Orange', hex: '#d84e1c' },
  { name: 'Pit Night', hex: '#9147ff' },
  { name: 'Safety Car Gold', hex: '#a88000' },
  { name: 'Milano Red', hex: '#d50000' }
]

interface AccentSwatchRowProps {
  accentPreset: string
  accentCustom: string
  isCustomColor: boolean
  onAccentChange: (hex: string) => void
  onCustomColorChange: (hex: string) => void
  /**
   * Container class for the swatch group. Defaults to the Settings-row control
   * layout; the onboarding modal passes its own so the row fits that surface.
   */
  className?: string
}

/**
 * The accent-color swatch row (presets + custom picker). Shared by
 * AppearanceSection (Settings) and the first-run onboarding modal so both drive
 * the exact same control. Prop-driven (no context) so it works wherever it is
 * mounted. #641
 */
export function AccentSwatchRow({
  accentPreset,
  accentCustom,
  isCustomColor,
  onAccentChange,
  onCustomColorChange,
  className = 'settings-control'
}: AccentSwatchRowProps): ReactNode {
  const [showPicker, setShowPicker] = useState(false)
  const customSwatchRef = useRef<HTMLButtonElement>(null)

  return (
    <div className={className} role="group" aria-label="Accent color">
      {ACCENT_PRESETS.map((preset) => (
        <Tooltip key={preset.hex} label={preset.name}>
          <button
            type="button"
            onClick={() => onAccentChange(preset.hex)}
            aria-label={`Accent color ${preset.name}`}
            aria-pressed={accentPreset === preset.hex}
            className={`h-8 w-8 rounded-full border-2 transition-transform hover:scale-110 active:scale-[0.98] bg-(--preset-color) ${accentPreset === preset.hex ? 'border-(--accent) scale-110' : 'border-transparent'}`}
            style={{ '--preset-color': preset.hex } as CSSProperties}
          />
        </Tooltip>
      ))}
      <div className="relative">
        <Tooltip label="Custom Color">
          <button
            ref={customSwatchRef}
            type="button"
            onClick={() => {
              setShowPicker(!showPicker)
              if (!isCustomColor) onAccentChange('custom')
            }}
            aria-label={isCustomColor ? 'Custom accent color (selected)' : 'Custom accent color'}
            aria-haspopup="dialog"
            aria-expanded={showPicker}
            aria-controls={showPicker ? 'accent-color-picker' : undefined}
            className={`relative flex h-8 w-8 cursor-pointer items-center justify-center transition-transform hover:scale-110 active:scale-[0.98] ${
              isCustomColor ? 'scale-110' : ''
            }`}
          >
            {/* Background gradient/color */}
            <div
              aria-hidden="true"
              className="absolute inset-0 rounded-full"
              style={{
                background: isCustomColor
                  ? accentCustom || DEFAULT_ACCENT_COLOR
                  : 'conic-gradient(from 180deg, #ff5e57, #ffdd59, #0be881, #4bcffa, #575fcf, #ef5777, #ff5e57)'
              }}
            />

            {/* Glass overlay for unselected state */}
            {!isCustomColor && (
              <div
                aria-hidden="true"
                className="absolute inset-0 rounded-full bg-white/10 dark:bg-black/10 pointer-events-none"
              />
            )}

            {/* Border to match presets */}
            <div
              aria-hidden="true"
              className={`absolute inset-0 rounded-full border-2 pointer-events-none ${isCustomColor ? 'border-(--accent)' : 'border-transparent'}`}
            />
          </button>
        </Tooltip>

        {showPicker && (
          <ColorPickerPopover
            color={accentCustom || DEFAULT_ACCENT_COLOR}
            onChange={onCustomColorChange}
            onClose={() => setShowPicker(false)}
            anchorRef={customSwatchRef}
          />
        )}
      </div>
    </div>
  )
}
