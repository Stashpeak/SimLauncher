import { type RefObject, useCallback, useEffect, useRef, useState } from 'react'
import { useAppDirty } from '../contexts/AppDirtyContext'

export interface EditorHandOff {
  /** Part of the editor's key: bumping it remounts the editor from the store. */
  revision: number
  /** The editor's `onClose`: closes it and hands focus to the toggle (#957). */
  close: () => void
  /** The editor's `onReverted`: reloads it in place, focus likewise (#951). */
  revert: () => void
}

/**
 * Owns the two ways a row's profile editor goes away from inside: closing
 * (#957) and a discard that keeps it open (#951), and where focus lands after
 * either. Both remove the control that had focus (the editor's own button,
 * or the sticky bar, which unmounts once the edits are gone), so focus fell to
 * <body> and the next Tab restarted at the titlebar. It is handed to the row's
 * editor toggle (the element whose `aria-controls` is `editorId`), which
 * outlives both, sits directly above the editor, and is where the gear-X
 * close already leaves focus.
 *
 * A revert remounts the editor rather than resetting it: the dirty baseline
 * is captured once per mount, so a reused instance would carry the discarded
 * edits' baseline (#880), and a remount reloads the stored profile.
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
export function useEditorHandOff({
  game,
  isActive,
  editorId,
  rowRef,
  onCloseEditor
}: {
  game: { key: string }
  isActive: boolean
  editorId: string
  rowRef: RefObject<HTMLElement | null>
  onCloseEditor: () => void
}): EditorHandOff {
  const { isAnyDirty, activeProfileEditorScope } = useAppDirty()
  const gameKey = game.key
  const [revision, setRevision] = useState(0)
  const handOffPendingRef = useRef<'close' | 'revert' | null>(null)

  const close = useCallback(() => {
    handOffPendingRef.current = 'close'
    onCloseEditor()
  }, [onCloseEditor])

  const revert = useCallback(() => {
    handOffPendingRef.current = 'revert'
    setRevision((current) => current + 1)
  }, [])

  useEffect(() => {
    const pending = handOffPendingRef.current
    if (!pending) return
    // A close hands off once the editor is gone. A revert keeps it open, so
    // if it has since closed some other way (another row opened), the
    // hand-off belongs to nobody.
    if (pending === 'close' && isActive) return
    if (pending === 'revert' && !isActive) {
      handOffPendingRef.current = null
      return
    }
    if (activeProfileEditorScope !== null) {
      // This editor's own report (scope `${gameKey}:<profile>`, as
      // ProfileEditor reports it) is retracted one commit after the close or
      // the remount: wait for it. Another game's editor reporting changes
      // means the user has moved on, so a hand-off still waiting on the bar
      // is dropped rather than firing at that row's close later.
      if (!activeProfileEditorScope.startsWith(`${gameKey}:`)) handOffPendingRef.current = null
      return
    }
    const active = document.activeElement
    const fell = !active || active === document.body
    // Another scope (Settings) still dirty keeps the sticky bar up, possibly
    // with focus on its Save, and requestSaveAll saves that scope after the
    // profile: the bar can leave one save later. Keep waiting for it rather
    // than giving up while focus still looks fine (CodeRabbit on PR #1015).
    if (!fell && isAnyDirty) return
    handOffPendingRef.current = null
    if (!fell) return
    const toggle = Array.from(
      rowRef.current?.querySelectorAll<HTMLElement>('[aria-controls]') ?? []
    ).find((element) => element.getAttribute('aria-controls') === editorId)
    if (!toggle || toggle.closest('[inert]')) return
    // No preventScroll: the user was at the editor's foot or the sticky bar,
    // not at the toggle, so this is a new target and the default scroll
    // reveals it (#948).
    toggle.focus()
  }, [isActive, isAnyDirty, activeProfileEditorScope, gameKey, editorId, rowRef])

  return { revision, close, revert }
}
