import type { ReactNode } from 'react'

import { Toggle } from '../Toggle'

interface ProfileToggleRowProps {
  label: string
  checked: boolean
  onToggle: () => void
  onChange: (checked: boolean) => void
  // Dims and inerts the row while keeping it in the a11y tree as a disabled
  // switch, so a dependent toggle reads as unavailable rather than missing.
  disabled?: boolean
  sublabel?: string
}

export function ProfileToggleRow({
  label,
  checked,
  onToggle,
  onChange,
  disabled = false,
  sublabel
}: ProfileToggleRowProps): ReactNode {
  return (
    <div
      role="switch"
      aria-checked={checked ? 'true' : 'false'}
      aria-label={label}
      aria-disabled={disabled ? 'true' : undefined}
      aria-description={sublabel}
      tabIndex={disabled ? -1 : 0}
      onClick={disabled ? undefined : onToggle}
      onKeyDown={(event) => {
        if (!disabled && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault()
          onToggle()
        }
      }}
      className={`accent-subtle-hover group flex items-center justify-between rounded-xl bg-(--glass-bg) p-3 transition-opacity ${
        disabled ? 'pointer-events-none opacity-50' : 'cursor-pointer'
      }`}
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
  )
}
