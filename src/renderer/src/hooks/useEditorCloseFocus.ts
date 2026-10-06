import { type RefObject, useCallback, useEffect, useRef } from 'react'
import { useAppDirty } from '../contexts/AppDirtyContext'

/**
 * Wraps a row's `onCloseEditor` so that a close from inside the profile
 * editor leaves focus on the row's editor toggle instead of on <body> (#957).
 *
 * Every route that closes the editor from inside it (Save on the sticky bar
 * or in the card, Cancel, Escape, a confirm dialog, Delete) removes the
 * control that had focus, and the next Tab restarted at the titlebar. The
 * toggle (the element whose `aria-controls` is `editorId`) outlives the
 * close, and it is where the gear-X close already leaves focus.
 *
 * The check waits for the commit that retracts the editor's dirty report,
 * not for a frame. After an async save the close commits in a later task, so
 * a frame can fire before it; and the sticky bar holding focus unmounts one
 * commit after the editor, when that retraction clears `isAnyDirty`. A
 * frame-based check saw focus still on the bar and did nothing (measured on a
 * packaged build). Focus is taken only when it actually fell: a close that
 * leaves it somewhere real (the bar still up for Settings) keeps it, and an
 * inert row (the other view, after a tab-switch save) is never focused.
 */
export function useEditorCloseFocus({
  isActive,
  editorId,
  rowRef,
  onCloseEditor
}: {
  isActive: boolean
  editorId: string
  rowRef: RefObject<HTMLElement | null>
  onCloseEditor: () => void
}): () => void {
  const { isProfileEditorDirty } = useAppDirty()
  const handOffPendingRef = useRef(false)

  const handleEditorClose = useCallback(() => {
    handOffPendingRef.current = true
    onCloseEditor()
  }, [onCloseEditor])

  useEffect(() => {
    if (isActive || isProfileEditorDirty || !handOffPendingRef.current) return
    handOffPendingRef.current = false
    const active = document.activeElement
    if (active && active !== document.body) return
    const toggle = Array.from(
      rowRef.current?.querySelectorAll<HTMLElement>('[aria-controls]') ?? []
    ).find((element) => element.getAttribute('aria-controls') === editorId)
    if (!toggle || toggle.closest('[inert]')) return
    // No preventScroll: the user was at the editor's foot, not at the toggle,
    // so this is a new target and the default scroll reveals it (#948).
    toggle.focus()
  }, [isActive, isProfileEditorDirty, editorId, rowRef])

  return handleEditorClose
}
