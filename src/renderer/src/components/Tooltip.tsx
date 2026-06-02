import { useState, type ReactElement, type ReactNode } from 'react'
import {
  autoUpdate,
  flip,
  FloatingPortal,
  offset,
  shift,
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
export function Tooltip({ label, children, placement = 'top', disabled }: TooltipProps): ReactNode {
  const [isOpen, setIsOpen] = useState(false)

  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement,
    middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate
  })

  const hover = useHover(context, { delay: { open: 350, close: 0 }, move: false })
  const focus = useFocus(context)
  const role = useRole(context, { role: 'tooltip' })
  const dismiss = useDismiss(context)

  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, role, dismiss])

  // Merge our setReference with any ref the child already has so children
  // that carry an existing ref (e.g. customSwatchRef, triggerRef) keep it.
  const childRef = (children as { ref?: React.Ref<unknown> }).ref
  const mergedRef = useMergeRefs([refs.setReference, childRef ?? null])

  // If label is empty or disabled, render child without any tooltip machinery.
  if (!label || disabled) {
    return children
  }

  const referenceProps = getReferenceProps()

  return (
    <>
      {/* React 19: ref is a regular prop; we spread it together with interaction handlers */}
      {<children.type {...children.props} ref={mergedRef} {...referenceProps} />}

      {isOpen && (
        <FloatingPortal>
          {/* style is required: @floating-ui/react writes dynamic x/y/transform position values */}
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className="pointer-events-none z-9999 max-w-xs rounded-lg border border-(--glass-border) bg-(--surface-floating-bg) px-2.5 py-1.5 text-xs font-medium text-(--text-primary) shadow-(--surface-floating-shadow) backdrop-blur-md animate-fade-slide"
          >
            {label}
          </div>
        </FloatingPortal>
      )}
    </>
  )
}
