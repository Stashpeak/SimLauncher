import type { ReactNode } from 'react'

interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  id?: string
  'aria-label'?: string
  // When true, the native checkbox is fully inert: removed from the a11y tree
  // (aria-hidden), out of tab order (tabIndex -1) AND disabled so a mouse click
  // on the wrapping <label> can't focus/activate it. Used when an ancestor is
  // the exposed switch (see ProfileToggleRow) — that ancestor is the single
  // control; the checkbox here only drives the visual track via `peer-checked`.
  presentational?: boolean
  // When true, disables the input and dims the label with cursor-not-allowed.
  disabled?: boolean
}

export function Toggle({
  checked,
  onChange,
  id,
  'aria-label': ariaLabel,
  presentational,
  disabled
}: ToggleProps): ReactNode {
  return (
    <label
      className={`relative inline-flex items-center no-drag ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
    >
      <input
        id={id}
        aria-label={ariaLabel || id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
        {...(presentational ? { 'aria-hidden': true, tabIndex: -1, disabled: true } : {})}
        {...(disabled ? { disabled: true } : {})}
      />
      <div className="toggle-track h-6 w-11 rounded-full bg-(--glass-bg-elevated) peer-checked:bg-(--accent) transition-colors duration-300 relative after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-(--glass-border) after:border after:rounded-full after:h-5 after:w-5 after:shadow-[0_1px_3px_rgba(0,0,0,0.2)] after:transition-all peer-checked:after:translate-x-full peer-checked:after:border-white"></div>
    </label>
  )
}
