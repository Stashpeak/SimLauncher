import type { ReactNode } from 'react'

import { Toggle } from '../Toggle'
import { useBehaviorSettings } from './BehaviorContext'
import { normalizeLaunchDelayMs } from './settingsUtils'

const DELAY_PRESETS = [
  { label: '1s', value: 1000 },
  { label: '1.5s', value: 1500 },
  { label: '2s', value: 2000 }
]

export function BehaviorSection(): ReactNode {
  const {
    startWithWindows,
    startMinimized,
    minimizeToTray,
    launchDelayMs,
    onStartWithWindowsChange,
    onStartMinimizedChange,
    onMinimizeToTrayChange,
    onLaunchDelayMsChange
  } = useBehaviorSettings()
  const isPreset = DELAY_PRESETS.some((p) => p.value === launchDelayMs)

  return (
    <>
      <div className="settings-row">
        <div className="settings-label-group">
          <span className="settings-label">Start with Windows</span>
          <span className="settings-sublabel">Launch SimLauncher automatically at login</span>
        </div>
        <Toggle
          checked={startWithWindows}
          onChange={onStartWithWindowsChange}
          aria-label="Start with Windows"
        />
      </div>
      <div className="settings-row">
        <div className="settings-label-group">
          <span className="settings-label">Start minimized</span>
          <span className="settings-sublabel">Start hidden in the system tray</span>
        </div>
        <Toggle
          checked={startMinimized}
          onChange={onStartMinimizedChange}
          aria-label="Start minimized"
        />
      </div>
      <div className="settings-row">
        <div className="settings-label-group">
          <span className="settings-label">Minimize to tray on close</span>
          <span className="settings-sublabel">
            Keep SimLauncher running when the window is closed
          </span>
        </div>
        <Toggle
          checked={minimizeToTray}
          onChange={onMinimizeToTrayChange}
          aria-label="Minimize to tray on close"
        />
      </div>
      <div className="settings-row settings-row-responsive">
        <div className="settings-label-group">
          <span className="settings-label">Launch delay between apps</span>
          <span className="settings-sublabel">Wait time before starting the next app</span>
        </div>
        <div className="settings-control" role="group" aria-label="Launch delay between apps">
          {DELAY_PRESETS.map((preset) => (
            <button
              key={preset.value}
              onClick={() => onLaunchDelayMsChange(preset.value)}
              aria-pressed={launchDelayMs === preset.value}
              className={`settings-control-pill settings-control-pill-button settings-control-preset glass-surface action-hover-scale tracking-wide transition-colors ${
                launchDelayMs === preset.value
                  ? 'selected-surface text-(--text-primary)'
                  : 'accent-subtle-hover text-(--text-secondary) hover:text-(--text-primary)'
              }`}
            >
              {preset.label}
            </button>
          ))}
          <div
            className={`settings-control-pill settings-control-pill-input settings-control-preset glass-surface action-hover-scale transition-all duration-200 ${
              !isPreset ? 'selected-surface' : ''
            }`}
          >
            <svg
              aria-hidden="true"
              width="8"
              height="8"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="ml-1 shrink-0 text-(--text-subtle) opacity-50"
            >
              <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
            </svg>
            <input
              type="number"
              min="0"
              max="30"
              step="0.1"
              aria-label="Custom launch delay in seconds"
              value={Number.isFinite(launchDelayMs) ? launchDelayMs / 1000 : ''}
              onChange={(e) => {
                const val = parseFloat(e.target.value)
                if (!isNaN(val)) {
                  onLaunchDelayMsChange(normalizeLaunchDelayMs(val * 1000))
                }
              }}
              className="w-full bg-transparent pl-1 text-right text-[11px] font-semibold text-(--text-primary) outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              placeholder="0.0"
            />
            <div className="mx-1 h-4 w-px bg-(--glass-border) opacity-35" />
            <span className="pr-1 text-[9px] font-semibold text-(--text-muted) uppercase">s</span>
          </div>
        </div>
      </div>
    </>
  )
}
