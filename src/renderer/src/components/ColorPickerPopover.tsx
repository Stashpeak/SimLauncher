import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject
} from 'react'
import { createPortal } from 'react-dom'
import { HexColorPicker } from 'react-colorful'
import { useFocusTrap } from '../hooks/useFocusTrap'

interface ColorPickerPopoverProps {
  color: string
  onChange: (color: string) => void
  onClose: () => void
  anchorRef: RefObject<HTMLElement | null>
}

const POPOVER_GAP = 12
// Matches the intrinsic width of react-colorful's HexColorPicker (200px) so the
// popover does not stretch to the parent container's width.
const POPOVER_WIDTH = 200

export function ColorPickerPopover({
  color,
  onChange,
  onClose,
  anchorRef
}: ColorPickerPopoverProps): ReactNode {
  const popoverRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<CSSProperties | null>(null)

  // This component is only mounted while the picker is open, so active is always true.
  // Focus is trapped here rather than via aria-modal because the popover is
  // portalled to document.body and positioned absolutely — a real modal focus
  // trap keeps keyboard users from tabbing into the background settings form.
  useFocusTrap(true, popoverRef, undefined, onClose)

  useLayoutEffect(() => {
    const updatePosition = () => {
      const anchor = anchorRef.current
      const popover = popoverRef.current
      if (!anchor) return

      const rect = anchor.getBoundingClientRect()

      // Defensive: if the anchor has not been laid out yet (zero width), retry
      // on the next animation frame so we measure against a real rect.
      if (rect.width === 0) {
        requestAnimationFrame(updatePosition)
        return
      }

      const popoverHeight = popover?.offsetHeight ?? 280
      const viewportHeight = window.innerHeight

      // Prefer rendering above the swatch; fall back to below if there is not enough room.
      const spaceAbove = rect.top
      const renderAbove = spaceAbove >= popoverHeight + POPOVER_GAP

      const top = renderAbove
        ? Math.max(POPOVER_GAP, rect.top - popoverHeight - POPOVER_GAP)
        : Math.min(viewportHeight - popoverHeight - POPOVER_GAP, rect.bottom + POPOVER_GAP)

      // Right-align the popover with the swatch's right edge using direct left math.
      // left = rect.right - POPOVER_WIDTH places the popover's right edge at the
      // swatch's right edge. Then clamp left into the viewport with a gap.
      const desiredLeft = rect.right - POPOVER_WIDTH
      const left = Math.max(
        POPOVER_GAP,
        Math.min(desiredLeft, window.innerWidth - POPOVER_WIDTH - POPOVER_GAP)
      )

      setPosition({ top, left, width: POPOVER_WIDTH })
    }

    updatePosition()
    // Capture-phase scroll listener so the position updates even when an
    // ancestor intercepts the scroll event before it bubbles to window.
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [anchorRef])

  return createPortal(
    // z-110 sits above the app's modal tier (ConfirmDialog / the onboarding modal
    // are z-100). The picker is a transient interaction owned by whatever surface
    // opened it, so it must render above that surface - including a modal. In
    // Settings it stays above the page content as before (nothing else is open at
    // this tier there). #641
    <div className="fixed inset-0 z-110">
      {/* Backdrop dismisses the picker on click without affecting underlying layout. */}
      <div aria-hidden="true" className="absolute inset-0" onClick={onClose} />
      <div
        ref={popoverRef}
        id="accent-color-picker"
        role="dialog"
        aria-modal="true"
        aria-label="Choose color"
        style={position ?? { visibility: 'hidden', width: POPOVER_WIDTH }}
        className="glass-surface-elevated fixed flex flex-col items-center gap-3 overflow-hidden rounded-2xl px-4 pb-4 shadow-[0_12px_30px_#00000040] backdrop-blur-xl animate-fade-slide"
      >
        <HexColorPicker color={color} onChange={onChange} />

        <div className="flex w-full items-center gap-2 px-1">
          <span className="text-[10px] font-bold uppercase tracking-wider text-(--text-muted)">
            HEX
          </span>
          <input
            type="text"
            aria-label="Hex color value"
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

        <button
          type="button"
          onClick={onClose}
          className="accent-action action-hover-scale w-full cursor-pointer rounded-xl py-2 text-xs font-bold"
        >
          Done
        </button>
      </div>
    </div>,
    document.body
  )
}
