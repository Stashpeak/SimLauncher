import { cloneElement, useState, type ReactElement, type ReactNode, type Ref } from 'react'
import {
  autoUpdate,
  flip,
  FloatingPortal,
  offset,
  shift,
  size,
  useDismiss,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
  useMergeRefs,
  useRole,
  type Placement
} from '@floating-ui/react'

interface TooltipProps {
  /** Tooltip content. If falsy, renders the child untouched (no tooltip). */
  label: ReactNode
  /**
   * A single DOM element (button, div, img, span, input, …).
   * Must accept a ref and spread arbitrary HTML event props.
   */
  children: ReactElement<Record<string, unknown>>
  /** Where to prefer rendering the tooltip. Defaults to 'top'. */
  placement?: Placement
  /**
   * When true, the child is rendered untouched — useful for conditionally
   * disabling tooltips without changing the call site.
   */
  disabled?: boolean
  /**
   * Makes the tooltip exactly as wide as the element it describes, instead of
   * sizing to its text up to max-w-xs. For a full-width row (a profile toggle
   * row), where a narrower or wider box centred over it reads as misaligned.
   */
  matchWidth?: boolean
}

/**
 * Glassmorphism tooltip powered by @floating-ui/react.
 *
 * - Shows on hover (350 ms delay) and keyboard focus.
 * - Auto-flips and shifts near screen edges.
 * - Rendered in a FloatingPortal (z-9999) so it appears above dialogs.
 * - Merges refs so children that already carry a ref (e.g. customSwatchRef,
 *   triggerRef) keep their original reference.
 */
export function Tooltip({
  label,
  children,
  placement = 'top',
  disabled,
  matchWidth = false
}: TooltipProps): ReactNode {
  const [isOpen, setIsOpen] = useState(false)

  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement,
    // No height cap, unlike the profile menu (#954): a tooltip is a few lines
    // at most and never taller than the room. `size` here only matches width.
    middleware: [
      offset(8),
      flip({ padding: 8 }),
      ...(matchWidth
        ? [
            size({
              apply({ rects, elements }) {
                elements.floating.style.width = `${rects.reference.width}px`
              }
            })
          ]
        : []),
      shift({ padding: 8 })
    ],
    whileElementsMounted: autoUpdate
  })

  const hover = useHover(context, { delay: { open: 350, close: 0 }, move: false })
  const focus = useFocus(context)
  const role = useRole(context, { role: 'tooltip' })
  const dismiss = useDismiss(context)

  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, role, dismiss])

  // React 19 stores ref as a regular prop, so read it from children.props (the
  // children.ref accessor is deprecated) and merge it with floating-ui's
  // reference ref. Children that already carry a ref — customSwatchRef (the
  // color-picker anchor) and triggerRef (the dropdown's focus-return) — must
  // keep it, or those features break.
  const childRef = (children.props as { ref?: Ref<unknown> }).ref ?? null
  const mergedRef = useMergeRefs([refs.setReference, childRef])

  // If label is empty or disabled, render child without any tooltip machinery.
  if (!label || disabled) {
    return children
  }

  return (
    <>
      {/* Pass children.props INTO getReferenceProps so floating-ui COMPOSES the
          child's own event handlers with its hover/focus/dismiss handlers rather
          than overwriting them; cloneElement then applies the merged ref. */}
      {cloneElement(children, {
        ...getReferenceProps(children.props as Parameters<typeof getReferenceProps>[0]),
        ref: mergedRef
      })}

      {isOpen && (
        <FloatingPortal>
          {/*
            Outer wrapper handles absolute positioning and event composition from floating-ui.
            Keep it visually unstyled to prevent CSS transforms from promoting this element
            to a separate compositing layer, which breaks `backdrop-filter` (blur) in Chromium.
          */}
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className="pointer-events-none z-9999"
          >
            {/*
              Inner container holds the actual visuals and entrance animation.
              - Uses `overlay-glass` to match other floating surfaces (frosted glass look).
              - Uses `animate-tooltip-in` (snappy fade/scale) to eliminate vertical bounciness.
              - Since this element has no persistent position transforms, the backdrop-filter
                (blur) renders at 100% fidelity.
            */}
            <div
              className={`${matchWidth ? 'w-full' : 'max-w-xs'} rounded-lg border border-(--glass-border) overlay-glass shadow-(--surface-floating-shadow) px-2.5 py-1.5 text-xs font-medium text-(--text-primary) animate-tooltip-in`}
            >
              {label}
            </div>
          </div>
        </FloatingPortal>
      )}
    </>
  )
}
