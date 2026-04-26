import { useEffect, useRef } from 'react'
import { HexColorPicker } from 'react-colorful'

interface ColorPickerPopoverProps {
  color: string
  onChange: (color: string) => void
  onClose: () => void
}

export function ColorPickerPopover({ color, onChange, onClose }: ColorPickerPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        onClose()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onClose])

  return (
    <div
      ref={popoverRef}
      className="glass-surface-elevated absolute bottom-full right-0 z-50 mb-4 flex flex-col items-center gap-3 rounded-2xl p-4 shadow-[0_12px_30px_#00000040] backdrop-blur-xl animate-fade-slide"
    >
      <HexColorPicker color={color} onChange={onChange} />

      <div className="flex w-full items-center gap-2 px-1">
        <span className="text-[10px] font-bold uppercase tracking-wider text-(--text-muted)">
          HEX
        </span>
        <input
          type="text"
          value={color.toUpperCase()}
          onChange={(e) => {
            let val = e.target.value
            // Auto-prepend # if missing
            if (val && !val.startsWith('#')) {
              val = '#' + val
            }
            // Only update if it's a valid partial or full hex
            if (/^#[0-9A-F]{0,6}$/i.test(val)) {
              onChange(val)
            }
          }}
          onBlur={() => {
            // Ensure we don't leave it as just '#'
            if (color === '#' || color.length < 4) {
              onChange('#AD46FF')
            }
          }}
          className="w-full rounded-lg bg-black/20 px-2 py-1.5 text-xs font-medium text-(--text-primary) outline-none transition-colors focus:bg-black/30"
          spellCheck={false}
        />
      </div>
    </div>
  )
}
