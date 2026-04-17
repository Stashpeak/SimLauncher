import React from 'react'

interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  id?: string
}

export function Toggle({ checked, onChange, id }: ToggleProps) {
  return (
    <label className="relative inline-flex items-center cursor-pointer no-drag">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <div className="h-6 w-11 rounded-full bg-white/10 shadow-[inset_0_2px_4px_rgba(0,0,0,0.4)] peer-checked:bg-[var(--accent)] transition-colors duration-300 relative after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-200 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full peer-checked:after:border-white"></div>
    </label>
  )
}
