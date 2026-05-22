import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

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
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
      if (e.key === 'Enter') onSave()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onCancel, onSave])

  if (!isOpen) return null

  return createPortal(
    <div className="fixed inset-0 z-100 flex items-center justify-center p-4 backdrop-blur-md">
      {/* Backdrop overlay */}
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />

      {/* Dialog container */}
      <div className="glass-surface-elevated animate-fade-slide relative w-full max-w-sm rounded-[24px] p-6 shadow-[0_20px_50px_rgba(0,0,0,0.5)] isolation-auto">
        <h2 className="text-lg font-bold text-(--text-primary) mb-2">{title}</h2>
        <p className="text-sm text-(--text-secondary) mb-8 leading-relaxed">{message}</p>

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
