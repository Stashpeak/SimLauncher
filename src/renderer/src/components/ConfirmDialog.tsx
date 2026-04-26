import { useEffect } from 'react'

interface ConfirmDialogProps {
  isOpen: boolean
  title: string
  message: string
  onSave: () => void
  onDiscard: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  isOpen,
  title,
  message,
  onSave,
  onDiscard,
  onCancel
}: ConfirmDialogProps) {
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

  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center p-4 backdrop-blur-md animate-fade-slide">
      {/* Backdrop overlay */}
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />

      {/* Dialog container */}
      <div className="glass-surface-elevated relative w-full max-w-sm rounded-[24px] p-6 shadow-[0_20px_50px_rgba(0,0,0,0.5)] isolation-auto">
        <h2 className="text-lg font-bold text-(--text-primary) mb-2">{title}</h2>
        <p className="text-sm text-(--text-secondary) mb-8 leading-relaxed">{message}</p>

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={onSave}
            className="accent-action w-full cursor-pointer rounded-xl py-3 text-sm font-bold"
          >
            Save Changes
          </button>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onDiscard}
              className="danger-action flex-1 cursor-pointer rounded-xl py-3 text-sm font-semibold"
            >
              Discard
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="neutral-action flex-1 cursor-pointer rounded-xl py-3 text-sm font-semibold"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
