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
    <div className="drag-region flex h-12 w-full items-center">
      <div className="flex-1" />
      <div className="no-drag flex items-center gap-2 px-4">
        <button
          type="button"
          onClick={handleMinimize}
          className="cursor-pointer rounded-full p-2 text-[var(--text-subtle)] transition-colors hover:bg-[var(--glass-bg)] hover:text-[var(--text-primary)]"
          title="Minimize"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M2 8h12" />
          </svg>
        </button>
        <button
          type="button"
          onClick={handleMaximize}
          className="cursor-pointer rounded-full p-2 text-[var(--text-subtle)] transition-colors hover:bg-[var(--glass-bg)] hover:text-[var(--text-primary)]"
          title={isMaximized ? 'Restore' : 'Maximize'}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round">
            <rect x="2" y="2" width="12" height="12" rx="2" />
          </svg>
        </button>
        <button
          type="button"
          onClick={handleClose}
          className="cursor-pointer rounded-full p-2 text-[var(--text-subtle)] transition-colors hover:bg-[rgba(255,0,0,0.1)] hover:text-red-500"
          title="Close"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>
    </div>
  )
}
