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
export function StickySaveBar(): ReactNode {
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
        setIsSaving(false)
      }
    } catch (err) {
      console.error('Sticky save handler threw', err)
      notify('Failed to save changes.', 'error', 4000)
      setIsSaving(false)
    }
  }

  return (
    <div
      className="fixed bottom-4 left-4 right-4 z-30 animate-fade-slide"
      role="region"
      aria-label="Unsaved changes"
    >
      <div className="glass-surface-elevated mx-auto flex max-w-3xl items-center gap-3 rounded-2xl border border-(--glass-border) p-3 shadow-[0_12px_30px_#00000040] backdrop-blur-xl">
        <span className="relative flex h-2 w-2 shrink-0 items-center justify-center">
          <span className="absolute inline-flex h-2 w-2 animate-ping rounded-full bg-(--accent) opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-(--accent)" />
        </span>
        <span className="min-w-0 flex-1 text-xs font-medium text-(--text-secondary)">
          You have unsaved changes.
        </span>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={isSaving}
          className="accent-surface-action action-hover-scale cursor-pointer rounded-xl px-4 py-2 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSaving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>
    </div>
  )
}
