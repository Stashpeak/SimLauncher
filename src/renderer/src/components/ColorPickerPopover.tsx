import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { HexColorPicker } from 'react-colorful'

interface ColorPickerPopoverProps {
  color: string
  onChange: (color: string) => void
  onClose: () => void
  anchorRef: RefObject<HTMLElement | null>
}

const POPOVER_GAP = 12

export function ColorPickerPopover({
  color,
  onChange,
  onClose,
  anchorRef
}: ColorPickerPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<CSSProperties | null>(null)

  useLayoutEffect(() => {
    const updatePosition = () => {
      const anchor = anchorRef.current
      const popover = popoverRef.current
      if (!anchor) return

      const rect = anchor.getBoundingClientRect()
      const popoverWidth = popover?.offsetWidth ?? 240
      const popoverHeight = popover?.offsetHeight ?? 280
      const viewportHeight = window.innerHeight
      const viewportWidth = window.innerWidth

      // Prefer rendering above the swatch; fall back to below if there is not enough room.
      const spaceAbove = rect.top
      const renderAbove = spaceAbove >= popoverHeight + POPOVER_GAP

      const top = renderAbove
        ? Math.max(POPOVER_GAP, rect.top - popoverHeight - POPOVER_GAP)
        : Math.min(viewportHeight - popoverHeight - POPOVER_GAP, rect.bottom + POPOVER_GAP)

      // Right-align with the swatch, clamped to viewport.
      const desiredLeft = rect.right - popoverWidth
      const left = Math.max(
        POPOVER_GAP,
        Math.min(desiredLeft, viewportWidth - popoverWidth - POPOVER_GAP)
      )

      setPosition({ top, left })
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [anchorRef])

  return createPortal(
    <div className="fixed inset-0 z-50">
      {/* Backdrop dismisses the picker on click without affecting underlying layout. */}
      <div className="absolute inset-0" onClick={onClose} />
      <div
        ref={popoverRef}
        style={position ?? { visibility: 'hidden' }}
        className="glass-surface-elevated fixed flex flex-col items-center gap-3 rounded-2xl p-4 shadow-[0_12px_30px_#00000040] backdrop-blur-xl animate-fade-slide"
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
    </div>,
    document.body
  )
}
