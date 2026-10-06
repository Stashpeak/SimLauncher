import type { KeyboardEvent, ReactNode } from 'react'

import { Toggle } from '../Toggle'
import { Tooltip } from '../Tooltip'

interface ProfileToggleRowProps {
  label: string
  checked: boolean
  onToggle: () => void
  onChange: (checked: boolean) => void
  // Unavailable in the #830 shape: aria-disabled, still focusable and
  // hoverable, but neither a click nor Space/Enter toggles it. It used to be
  // pointer-events-none and out of the tab order, which left its reason
  // unreachable by mouse hover and by Tab, the two ways a tooltip opens (#836).
  disabled?: boolean
  // A short line under the label, kept short so it fits the half-width cell.
  sublabel?: string
  // The full explanation, shown on hover and keyboard focus. It is also the
  // switch's accessible description, so Narrator reads all of it rather than
  // the short line.
  tooltip?: string
}

export function ProfileToggleRow({
  label,
  checked,
  onToggle,
  onChange,
  disabled = false,
  sublabel,
  tooltip
}: ProfileToggleRowProps): ReactNode {
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    // Swallowed even when unavailable: Space on a focused div would otherwise
    // scroll the editor.
    event.preventDefault()
    if (!disabled) onToggle()
  }

  return (
    <Tooltip label={tooltip}>
      <div
        role="switch"
        aria-checked={checked ? 'true' : 'false'}
        aria-label={label}
        aria-disabled={disabled || undefined}
        aria-description={tooltip ?? sublabel}
        tabIndex={0}
        onClick={disabled ? undefined : onToggle}
        onKeyDown={handleKeyDown}
        className="accent-subtle-hover group flex cursor-pointer items-center justify-between rounded-xl bg-(--glass-bg) p-3 transition-opacity"
      >
        <span className="flex min-w-0 flex-col pr-3">
          <span className="text-sm font-medium text-(--text-secondary)">{label}</span>
          {sublabel ? <span className="mt-0.5 text-xs text-(--text-muted)">{sublabel}</span> : null}
        </span>
        {/* The native checkbox is inert (disabled + aria-hidden + tabIndex -1) and
            only drives the visual track. The click bubbles to the row's onToggle,
            so no stopPropagation wrapper and no double toggle. */}
        <Toggle checked={checked} onChange={onChange} aria-label={label} presentational />
      </div>
    </Tooltip>
  )
}
