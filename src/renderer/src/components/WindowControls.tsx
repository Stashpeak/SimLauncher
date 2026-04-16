import { useState } from 'react'

export function WindowControls() {
  const [isMaximized, setIsMaximized] = useState(false)

  const handleMinimize = () => {
    window.electronAPI.minimize()
  }

  const handleMaximize = () => {
    window.electronAPI.maximize()
    setIsMaximized((current) => !current)
  }

  const handleClose = () => {
    window.electronAPI.close()
  }

  return (
    <div className="drag-region flex h-10 w-full items-center">
      <div className="flex-1" />
      <div className="no-drag flex items-center gap-1 px-3">
        <button
          type="button"
          onClick={handleMinimize}
          className="rounded-full bg-[var(--glass-bg)] px-3 py-1.5 text-[var(--text-subtle)] transition-colors hover:bg-[var(--purple-accent)] hover:text-[var(--text-primary)]"
          title="Minimize"
        >
          —
        </button>
        <button
          type="button"
          onClick={handleMaximize}
          className="rounded-full bg-[var(--glass-bg)] px-3 py-1.5 text-[var(--text-subtle)] transition-colors hover:bg-[var(--purple-accent)] hover:text-[var(--text-primary)]"
          title={isMaximized ? 'Restore' : 'Maximize'}
        >
          □
        </button>
        <button
          type="button"
          onClick={handleClose}
          className="rounded-full bg-[var(--glass-bg)] px-3 py-1.5 text-[var(--text-subtle)] transition-colors hover:bg-[rgba(244,63,94,0.16)] hover:text-[#f43f5e]"
          title="Close"
        >
          ×
        </button>
      </div>
    </div>
  )
}
