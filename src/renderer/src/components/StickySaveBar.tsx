import { useEffect, useState, type ReactNode } from 'react'
import { useAppDirty } from '../contexts/AppDirtyContext'
import { useNotify } from './Notify'

/**
 * App-level unsaved-changes bar pinned to the bottom of the viewport. Shown
 * whenever any registered scope (Settings, Profile Editor) reports dirty
 * state via AppDirtyContext, regardless of which view is currently visible.
 * Save runs every registered save handler so the user's "Save Changes" click
 * matches the close-dialog behavior — one button, all scopes.
 *
 * Lives at the App level rather than per-view because position: sticky needed
 * the host scroll container to actually overflow; the Profile Editor card is
 * usually shorter than the viewport, so sticky never pinned and the bar sat
 * at the natural end of the card (out of sight after any scroll, #423).
 */
export function StickySaveBar({ onRequestDiscard }: { onRequestDiscard: () => void }): ReactNode {
  const { isAnyDirty, requestSaveAll } = useAppDirty()
  const { notify } = useNotify()
  const [isSaving, setIsSaving] = useState(false)

  // Reset the local saving flag whenever dirty state clears externally (a
  // save dialog elsewhere, a discard, a tab-switch save). Without this the
  // bar could stay disabled after an out-of-band save completes.
  useEffect(() => {
    if (!isAnyDirty) {
      setIsSaving(false)
    }
  }, [isAnyDirty])

  if (!isAnyDirty) {
    return null
  }

  const handleSave = async () => {
    if (isSaving) {
      return
    }
    setIsSaving(true)
    try {
      const ok = await requestSaveAll()
      if (!ok) {
        notify('Failed to save changes.', 'error', 4000)
      }
    } catch (err) {
      console.error('Sticky save handler threw', err)
      notify('Failed to save changes.', 'error', 4000)
    } finally {
      // Always reset the local flag — don't rely on isAnyDirty cascading to
      // false. A successful save where another scope is still dirty (or the
      // user edited again during an in-flight save) would otherwise leave
      // the button permanently disabled.
      setIsSaving(false)
    }
  }

  return (
    <div
      className="fixed bottom-4 left-4 right-4 z-30 animate-fade-slide"
      role="region"
      aria-label="Unsaved changes"
      aria-live="polite"
    >
      <div className="glass-surface-elevated overlay-glass mx-auto flex max-w-3xl items-center gap-3 rounded-2xl border border-(--glass-border) p-3 shadow-[0_12px_30px_#00000040]">
        <span
          aria-hidden="true"
          className="relative flex h-2 w-2 shrink-0 items-center justify-center"
        >
          <span className="absolute inline-flex h-2 w-2 animate-ping rounded-full bg-(--accent) opacity-75" />
          <span className="status-dot relative inline-flex h-2 w-2 rounded-full bg-(--accent)" />
        </span>
        <span className="min-w-0 flex-1 text-xs font-medium text-(--text-secondary)">
          You have unsaved changes.
        </span>
        {/* aria-disabled, not `disabled`, while a save runs (#957, the #830
            shape): Save is the focused control at the moment it becomes
            unavailable, and Chromium moves focus off a focused control that
            is still `disabled` at its next rendering update. Every real save
            awaits a store write past that point, so focus fell to <body>
            (measured on a packaged build; a refused save re-enables within
            the same task and kept focus, which is why it never showed). The
            click handlers are dropped instead, so nothing can run twice. */}
        <button
          type="button"
          onClick={isSaving ? undefined : onRequestDiscard}
          aria-disabled={isSaving || undefined}
          className="neutral-action action-hover-scale cursor-pointer rounded-xl px-4 py-2 text-xs font-semibold"
        >
          Discard
        </button>
        <button
          type="button"
          onClick={isSaving ? undefined : () => void handleSave()}
          aria-disabled={isSaving || undefined}
          className="accent-surface-action action-hover-scale cursor-pointer rounded-xl px-4 py-2 text-xs font-bold"
        >
          {isSaving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>
    </div>
  )
}
