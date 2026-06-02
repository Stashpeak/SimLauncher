import type { ReactNode } from 'react'

import { Toggle } from '../Toggle'

interface ProfileToggleRowProps {
  label: string
  checked: boolean
  onToggle: () => void
  onChange: (checked: boolean) => void
}

export function ProfileToggleRow({
  label,
  checked,
  onToggle,
  onChange
}: ProfileToggleRowProps): ReactNode {
  return (
    <div
      role="switch"
      aria-checked={checked ? 'true' : 'false'}
      aria-label={label}
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onToggle()
        }
      }}
      className="accent-subtle-hover group flex cursor-pointer items-center justify-between rounded-xl bg-(--glass-bg) p-3"
    >
      <span className="text-sm font-medium text-(--text-secondary)">{label}</span>
      {/* The native checkbox is inert (disabled + aria-hidden + tabIndex -1) and
          only drives the visual track. The click bubbles to the row's onToggle,
          so no stopPropagation wrapper and no double toggle. */}
      <Toggle checked={checked} onChange={onChange} aria-label={label} presentational />
    </div>
  )
}
