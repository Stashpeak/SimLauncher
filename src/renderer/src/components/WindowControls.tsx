import { useEffect, useState, type ReactNode } from 'react'
import { minimize, maximize, close, onWindowMaximizedChanged } from '../lib/electron'
import {
  BrandWordmarkIcon,
  SettingsIcon,
  MinimizeIcon,
  MaximizeIcon,
  CloseWindowIcon
} from './icons'
import { Tooltip } from './Tooltip'

interface WindowControlsProps {
  view: 'games' | 'settings'
  onNavigate: (view: 'games' | 'settings') => void
  updateInfo: { version: string } | null
}

export function WindowControls({ view, onNavigate, updateInfo }: WindowControlsProps): ReactNode {
  // Optimistic toggle for instant button feedback, corrected by the main
  // process's maximize/unmaximize push — OS paths (Win+Up, aero-snap drag)
  // maximize a frameless window without going through this button, so local
  // state alone would drift (#500).
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => onWindowMaximizedChanged(setIsMaximized), [])

  const handleMinimize = () => minimize()
  const handleMaximize = () => {
    maximize()
    setIsMaximized((current) => !current)
  }
  const handleClose = () => close()
  // Navigate to Settings rather than immediately installing: the About section
  // shows update progress and the user can confirm before the restart happens.
  const handleInstallUpdate = () => {
    onNavigate('settings')
  }

  return (
    <div className="drag-region flex h-12 w-full items-center px-4 gap-2 shrink-0">
      {/* Pill: branding + settings gear */}
      <div className="no-drag glass-surface rounded-full flex items-center shrink-0 overflow-hidden">
        {/* Launcher branding */}
        <Tooltip label="SimLauncher" placement="bottom">
          <button
            type="button"
            onClick={() => onNavigate('games')}
            className="group cursor-pointer flex items-center rounded-l-full py-1.5 pl-3 pr-2"
            aria-label="SimLauncher"
            aria-current={view === 'games' ? 'page' : undefined}
          >
            <BrandWordmarkIcon
              aria-hidden="true"
              className={`launcher-wordmark h-[15px] w-auto shrink-0 transition-colors ${
                view === 'games'
                  ? 'text-(--accent)'
                  : 'text-(--text-muted) group-hover:text-(--accent)'
              }`}
            />
          </button>
        </Tooltip>

        {/* Divider */}
        <div className="relative z-10 h-4 w-px bg-(--glass-border) opacity-35" />

        {/* Settings gear */}
        <Tooltip label="Settings" placement="bottom">
          <button
            type="button"
            onClick={() => onNavigate('settings')}
            className={`icon-action cursor-pointer flex items-center rounded-r-full py-1.5 pl-2 pr-2.5 ${
              view === 'settings' ? 'icon-action-active' : ''
            }`}
            aria-label="Settings"
            aria-current={view === 'settings' ? 'page' : undefined}
          >
            <SettingsIcon width={13} height={13} />
          </button>
        </Tooltip>
      </div>

      {/* Update Pill */}
      {updateInfo && (
        <button
          type="button"
          onClick={handleInstallUpdate}
          className="accent-surface-action no-drag animate-fade-slide rounded-full flex items-center px-3 py-1.5 gap-2 cursor-pointer border border-(--accent)/30"
        >
          <div
            aria-hidden="true"
            className="h-2 w-2 rounded-full bg-(--accent) animate-pulse shadow-[0_0_8px_var(--accent)]"
          />
          <span className="text-[10px] font-medium uppercase tracking-wider text-(--accent)">
            Update v{updateInfo.version} Available
          </span>
        </button>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Window controls */}
      <div className="no-drag flex items-center gap-1">
        <Tooltip label="Minimize" placement="bottom">
          <button
            type="button"
            onClick={handleMinimize}
            className="icon-action cursor-pointer rounded-full p-2"
            aria-label="Minimize"
          >
            <MinimizeIcon width={14} height={14} />
          </button>
        </Tooltip>
        <Tooltip label={isMaximized ? 'Restore' : 'Maximize'} placement="bottom">
          <button
            type="button"
            onClick={handleMaximize}
            className="icon-action cursor-pointer rounded-full p-2"
            aria-label={isMaximized ? 'Restore' : 'Maximize'}
          >
            <MaximizeIcon width={14} height={14} />
          </button>
        </Tooltip>
        <Tooltip label="Close" placement="bottom">
          <button
            type="button"
            onClick={handleClose}
            className="icon-action danger-action cursor-pointer rounded-full p-2"
            aria-label="Close"
          >
            <CloseWindowIcon width={14} height={14} />
          </button>
        </Tooltip>
      </div>
    </div>
  )
}
