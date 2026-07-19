import { useState, type MouseEvent, type ReactNode } from 'react'
import {
  autoUpdate,
  flip,
  FloatingFocusManager,
  FloatingPortal,
  offset,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
  useRole
} from '@floating-ui/react'

import { dismissAppIcon } from '../lib/electron'
import { buildDismissLabel } from '../lib/contextMenuLabel'

export interface DismissMenuTarget {
  /** The running-app path used to key the dismiss (matches the main-process entry). */
  path: string
  gameKey: string
  /** Display name, used to build the accessible dismiss label. */
  name: string
  /** When absent, the trigger stays inert: no menu, no keyboard/right-click affordance. */
  warning?: string
  /** Whether the entry is actively tracked (Dismiss Warning) vs orphaned (Dismiss Icon). */
  tracked?: boolean
}

/**
 * Shared "right-click / keyboard → Dismiss" menu behavior (#466, #543) used by
 * both the running-apps strip companion icons and the game icon's stuck-status
 * dot (#737). The caller owns the trigger element's markup — it spreads
 * `getTriggerProps()` and attaches `setTriggerRef` — so each surface keeps its
 * own visuals while sharing one menu implementation, aria wiring and dismiss
 * call. The menu only arms when `target.warning` is set; without it the trigger
 * is inert so a normal icon keeps the native context menu (dev inspect).
 */
export function useDismissMenu(target: DismissMenuTarget): {
  isMenuOpen: boolean
  setTriggerRef: (node: HTMLElement | null) => void
  getTriggerProps: (userProps?: Record<string, unknown>) => Record<string, unknown>
  menu: ReactNode
} {
  const [isMenuOpen, setIsMenuOpen] = useState(false)

  const { refs, floatingStyles, context } = useFloating({
    open: isMenuOpen,
    onOpenChange: setIsMenuOpen,
    placement: 'bottom-start',
    middleware: [offset(4), flip({ padding: 8 }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate
  })

  // useClick makes the trigger keyboard-operable (Enter/Space) and opens on a
  // plain left-click alongside right-click — only when there's a warning, so
  // non-warning icons stay inert.
  const click = useClick(context, { enabled: !!target.warning })
  const dismiss = useDismiss(context)
  const role = useRole(context, { role: 'menu' })
  const { getReferenceProps, getFloatingProps } = useInteractions([click, dismiss, role])

  const handleContextMenu = (event: MouseEvent) => {
    // Only intercept right-click when there's something to dismiss; otherwise let
    // the native Chromium menu through (dev inspect).
    if (target.warning) {
      event.preventDefault()
      setIsMenuOpen(true)
    }
  }

  const handleDismissClick = async (event: MouseEvent) => {
    event.stopPropagation()
    // For untracked apps the icon unmounts when the warning clears; for tracked
    // ones the icon remains, so close the menu explicitly.
    setIsMenuOpen(false)
    try {
      await dismissAppIcon(target.path, target.gameKey)
    } catch (err) {
      console.error('Failed to dismiss app warning:', err)
    }
  }

  const getTriggerProps = (userProps?: Record<string, unknown>) =>
    getReferenceProps({
      onContextMenu: handleContextMenu,
      'aria-haspopup': target.warning ? ('menu' as const) : undefined,
      'aria-expanded': target.warning ? isMenuOpen : undefined,
      ...userProps
    })

  const dismissLabel = buildDismissLabel(target.path, {
    tracked: target.tracked,
    name: target.name
  })

  const menu = isMenuOpen ? (
    <FloatingPortal>
      <FloatingFocusManager context={context} modal={false}>
        <div
          ref={refs.setFloating}
          style={floatingStyles}
          {...getFloatingProps()}
          className="z-9999"
        >
          <div className="dropdown-surface overlay-glass rounded-xl p-1 border border-(--glass-border) shadow-(--surface-floating-shadow) animate-fade-slide min-w-[180px]">
            <button
              type="button"
              role="menuitem"
              onClick={handleDismissClick}
              className="dropdown-item flex w-full cursor-pointer items-center rounded-lg px-2.5 py-1.5 text-left text-xs font-semibold"
            >
              {dismissLabel}
            </button>
          </div>
        </div>
      </FloatingFocusManager>
    </FloatingPortal>
  ) : null

  return { isMenuOpen, setTriggerRef: refs.setReference, getTriggerProps, menu }
}
