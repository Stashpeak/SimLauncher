import type { ReactNode } from 'react'

export const ZOOM_PRESETS = [
  { label: '100%', factor: 1.0 },
  { label: '125%', factor: 1.25 },
  { label: '150%', factor: 1.5 },
  { label: '175%', factor: 1.75 }
]

interface ZoomControlProps {
  zoomFactor: number
  onZoomFactorChange: (factor: number) => void
  /**
   * Container class for the preset group. Defaults to the Settings-row control
   * layout; the onboarding modal passes its own. #641
   */
  className?: string
}

/**
 * The UI-scale zoom preset pills. Shared by AppearanceSection (Settings) and the
 * first-run onboarding modal. Prop-driven so it works wherever it is mounted.
 */
export function ZoomControl({
  zoomFactor,
  onZoomFactorChange,
  className = 'settings-control'
}: ZoomControlProps): ReactNode {
  return (
    <div className={className} role="group" aria-label="UI scale">
      {ZOOM_PRESETS.map((preset) => (
        <button
          key={preset.factor}
          type="button"
          onClick={() => onZoomFactorChange(preset.factor)}
          aria-pressed={zoomFactor === preset.factor}
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
  )
}
