import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useFocusTrap } from '../hooks/useFocusTrap'

interface ConfirmDialogProps {
  isOpen: boolean
  title: string
  message: string
  onSave: () => void
  onDiscard: () => void
  onCancel: () => void
  saveLabel?: string
  discardLabel?: string
  cancelLabel?: string
  saveClassName?: string
  discardClassName?: string
}

export function ConfirmDialog({
  isOpen,
  title,
  message,
  onSave,
  onDiscard,
  onCancel,
  saveLabel = 'Save Changes',
  discardLabel = 'Discard',
  cancelLabel = 'Cancel',
  saveClassName = 'accent-action',
  discardClassName = 'danger-action'
}: ConfirmDialogProps): ReactNode {
  const dialogRef = useRef<HTMLDivElement>(null)
  useFocusTrap(isOpen, dialogRef)

  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' && e.key !== 'Enter') return
      // Consume Enter/Escape so background window keydown handlers (Settings and
      // the profile editor both close-on-Escape) don't also fire and stack
      // another dialog behind this one. Capture phase + stopImmediatePropagation
      // is required because those listeners were registered earlier on window.
      e.stopImmediatePropagation()
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
        return
      }
      // Enter is the default-confirm shortcut only while focus is outside the
      // dialog's buttons. On a focused button, native activation already clicks
      // it — also calling onSave() here would run two conflicting actions (#476).
      const target = e.target instanceof HTMLElement ? e.target : null
      if (target && dialogRef.current?.contains(target) && target.closest('button')) {
        return
      }
      e.preventDefault()
      onSave()
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [isOpen, onCancel, onSave])

  const titleId = useId()
  const msgId = useId()

  if (!isOpen) return null

  return createPortal(
    <div className="fixed inset-0 z-100 flex items-center justify-center p-4 backdrop-blur-md">
      {/* Backdrop overlay */}
      <div aria-hidden="true" className="absolute inset-0 bg-black/40" onClick={onCancel} />

      {/* Dialog container */}
      {/* Focus is trapped and the background is inerted via useFocusTrap, so aria-modal is honest here. */}
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={msgId}
        className="glass-surface-elevated animate-fade-slide relative w-full max-w-sm rounded-[24px] p-6 shadow-[0_20px_50px_rgba(0,0,0,0.5)] isolation-auto"
      >
        <h2 id={titleId} className="text-lg font-bold text-(--text-primary) mb-2">
          {title}
        </h2>
        <p id={msgId} className="text-sm text-(--text-secondary) mb-8 leading-relaxed">
          {message}
        </p>

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={onSave}
            className={`${saveClassName} action-hover-scale w-full cursor-pointer rounded-xl py-3 text-sm font-bold`}
          >
            {saveLabel}
          </button>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onDiscard}
              className={`${discardClassName} action-hover-scale flex-1 cursor-pointer rounded-xl py-3 text-sm font-semibold`}
            >
              {discardLabel}
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="neutral-action action-hover-scale flex-1 cursor-pointer rounded-xl py-3 text-sm font-semibold"
            >
              {cancelLabel}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
