import type { ReactNode } from 'react'

interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  id?: string
  'aria-label'?: string
  // When true, the native checkbox is removed from the a11y tree and tab order.
  // Used when an ancestor element is the exposed switch (see ProfileToggleRow)
  // so the control is announced once and has a single tab stop.
  presentational?: boolean
}

export function Toggle({
  checked,
  onChange,
  id,
  'aria-label': ariaLabel,
  presentational
}: ToggleProps): ReactNode {
  return (
    <label className="relative inline-flex items-center cursor-pointer no-drag">
      <input
        id={id}
        aria-label={ariaLabel || id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
        {...(presentational ? { 'aria-hidden': true, tabIndex: -1 } : {})}
      />
      <div className="toggle-track h-6 w-11 rounded-full bg-(--glass-bg-elevated) peer-checked:bg-(--accent) transition-colors duration-300 relative after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-(--glass-border) after:border after:rounded-full after:h-5 after:w-5 after:shadow-[0_1px_3px_rgba(0,0,0,0.2)] after:transition-all peer-checked:after:translate-x-full peer-checked:after:border-white"></div>
    </label>
  )
}
