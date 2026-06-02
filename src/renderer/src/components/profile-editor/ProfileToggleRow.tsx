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
      <span onClick={(event) => event.stopPropagation()}>
        <Toggle checked={checked} onChange={onChange} aria-label={label} presentational />
      </span>
    </div>
  )
}
