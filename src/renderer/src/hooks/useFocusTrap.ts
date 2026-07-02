import { useEffect, useRef, type RefObject } from 'react'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

// Module-level depth counter so stacked dialogs keep the background inert until
// the last one closes.
let trapDepth = 0

// Stack of active Escape-capable traps (most recently opened on top). Each trap
// pushes a unique token while active; only the token on top reacts to Escape, so
// a stacked picker/dialog dismisses itself before the surface that opened it
// (both register document-capture listeners, and the first-registered would
// otherwise stopImmediatePropagation and win). #641
const escapeStack: object[] = []

function setBackgroundInert(inert: boolean): void {
  const root = document.getElementById('root')
  if (!root) return
  if (inert) root.setAttribute('inert', '')
  else root.removeAttribute('inert')
}

/**
 * Focus management for modal dialogs:
 *  - moves focus into the container when activated (first focusable, an explicit
 *    initialFocusRef, or the container itself as a fallback)
 *  - traps Tab / Shift+Tab within the container
 *  - marks the app root (#root) `inert` while a dialog is open, removing the
 *    background from the tab order and the accessibility tree (ref-counted so
 *    stacked dialogs keep it inert until the last one closes)
 *  - restores focus to the previously-focused element on deactivation
 *
 * The container MUST be rendered OUTSIDE #root (e.g. portaled to document.body)
 * so it is not itself inerted.
 *
 * When `onEscape` is provided, Escape closes the dialog. It is handled on the
 * document in the capture phase with stopImmediatePropagation so it dismisses
 * this dialog before any background keydown handler (Settings, profile editor)
 * can see the key — matching ConfirmDialog's own Escape behaviour.
 */
export function useFocusTrap(
  active: boolean,
  containerRef: RefObject<HTMLElement | null>,
  initialFocusRef?: RefObject<HTMLElement | null>,
  onEscape?: () => void
): void {
  // Stable ref so passing a fresh onEscape each render does not re-run the trap
  // (which would re-inert the background and steal focus).
  const onEscapeRef = useRef(onEscape)
  useEffect(() => {
    onEscapeRef.current = onEscape
  }, [onEscape])

  useEffect(() => {
    if (!active) return
    const container = containerRef.current
    if (!container) return

    const previouslyFocused = document.activeElement as HTMLElement | null

    const getFocusable = (): HTMLElement[] =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => el.offsetParent !== null || el.getClientRects().length > 0
      )

    // Inert the background (ref-counted for stacked dialogs).
    trapDepth += 1
    setBackgroundInert(true)

    // Move focus into the dialog.
    const initial = initialFocusRef?.current ?? getFocusable()[0] ?? container
    if (initial === container && !container.hasAttribute('tabindex')) {
      container.setAttribute('tabindex', '-1')
    }
    initial.focus()

    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Tab') return
      const focusable = getFocusable()
      if (focusable.length === 0) {
        e.preventDefault()
        container.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const activeEl = document.activeElement as HTMLElement | null

      if (e.shiftKey) {
        if (activeEl === first || activeEl === container || !container.contains(activeEl)) {
          e.preventDefault()
          last.focus()
        }
      } else if (activeEl === last || !container.contains(activeEl)) {
        e.preventDefault()
        first.focus()
      }
    }

    container.addEventListener('keydown', handleKeyDown)

    // Escape-to-dismiss (when a handler was supplied). Capture phase so it wins
    // over background document listeners. Only the topmost Escape-capable trap
    // reacts, so a stacked picker/dialog closes itself first instead of the
    // surface underneath it (see escapeStack). A no-op when no onEscape.
    const escapeToken = onEscapeRef.current ? {} : null
    if (escapeToken) escapeStack.push(escapeToken)
    const handleEscape = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      const onEscape = onEscapeRef.current
      if (!onEscape) return
      // Not the topmost trap — let the event reach the one that is.
      if (escapeStack[escapeStack.length - 1] !== escapeToken) return
      e.preventDefault()
      e.stopImmediatePropagation()
      onEscape()
    }
    if (escapeToken) document.addEventListener('keydown', handleEscape, true)

    return () => {
      container.removeEventListener('keydown', handleKeyDown)
      if (escapeToken) {
        document.removeEventListener('keydown', handleEscape, true)
        const idx = escapeStack.lastIndexOf(escapeToken)
        if (idx !== -1) escapeStack.splice(idx, 1)
      }
      trapDepth = Math.max(0, trapDepth - 1)
      if (trapDepth === 0) setBackgroundInert(false)
      // Restore focus only AFTER un-inerting; focusing an element inside an inert
      // subtree is a no-op.
      previouslyFocused?.focus?.()
    }
  }, [active, containerRef, initialFocusRef])
}
