import { useState } from 'react'
import { minimize, maximize, close } from '../lib/electron'

interface WindowControlsProps {
  view: 'games' | 'settings'
  onNavigate: (view: 'games' | 'settings') => void
  updateInfo: { version: string } | null
}

export function WindowControls({ view, onNavigate, updateInfo }: WindowControlsProps) {
  const [isMaximized, setIsMaximized] = useState(false)

  const handleMinimize = () => minimize()
  const handleMaximize = () => {
    maximize()
    setIsMaximized((current) => !current)
  }
  const handleClose = () => close()
  const handleInstallUpdate = () => {
    onNavigate('settings')
  }

  return (
    <div className="drag-region flex h-12 w-full items-center px-4 gap-2 shrink-0">
      {/* Pill: branding + settings gear */}
      <div className="no-drag glass-surface rounded-full flex items-center shrink-0 overflow-hidden">
        {/* Launcher branding */}
        <button
          type="button"
          onClick={() => onNavigate('games')}
          className="group cursor-pointer flex items-center rounded-l-full py-1.5 pl-3 pr-2"
        >
          <span className="select-none font-black italic uppercase text-sm leading-none flex items-center">
            <span className="tracking-tight text-(--text-primary)">Sim</span>
            <span
              className={`transition-colors flex items-center ${
                view === 'games'
                  ? 'tracking-[0.01em] text-(--accent)'
                  : 'tracking-[0.01em] text-(--text-muted) group-hover:text-(--accent)'
              }`}
            >
              {'Launcher'}
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="var(--launcher-play)"
                className="launcher-play-mark -ml-[2px] shrink-0"
              >
                <path d="M7.4 4.5A1.5 1.5 0 0 0 5 5.8v12.4a1.5 1.5 0 0 0 2.4 1.3l9.8-6.2a1.5 1.5 0 0 0 0-2.6L7.4 4.5z" />
              </svg>
            </span>
          </span>
        </button>

        {/* Divider */}
        <div className="relative z-10 h-4 w-px bg-(--glass-border) opacity-35" />

        {/* Settings gear */}
        <button
          type="button"
          onClick={() => onNavigate('settings')}
          className={`icon-action cursor-pointer flex items-center rounded-r-full py-1.5 pl-2 pr-2.5 ${
            view === 'settings' ? 'icon-action-active' : ''
          }`}
          title="Settings"
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>

      {/* Update Pill */}
      {updateInfo && (
        <button
          type="button"
          onClick={handleInstallUpdate}
          className="accent-surface-action no-drag animate-fade-slide rounded-full flex items-center px-3 py-1.5 gap-2 cursor-pointer border border-(--accent)/30"
        >
          <div className="h-2 w-2 rounded-full bg-(--accent) animate-pulse shadow-[0_0_8px_var(--accent)]" />
          <span className="text-[10px] font-medium uppercase tracking-wider text-(--accent)">
            Update v{updateInfo.version} Available
          </span>
        </button>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Window controls */}
      <div className="no-drag flex items-center gap-1">
        <button
          type="button"
          onClick={handleMinimize}
          className="icon-action cursor-pointer rounded-full p-2"
          title="Minimize"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M2 8h12" />
          </svg>
        </button>
        <button
          type="button"
          onClick={handleMaximize}
          className="icon-action cursor-pointer rounded-full p-2"
          title={isMaximized ? 'Restore' : 'Maximize'}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
            strokeLinecap="round"
          >
            <rect x="2" y="2" width="12" height="12" rx="2" />
          </svg>
        </button>
        <button
          type="button"
          onClick={handleClose}
          className="icon-action danger-action cursor-pointer rounded-full p-2"
          title="Close"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>
    </div>
  )
}
