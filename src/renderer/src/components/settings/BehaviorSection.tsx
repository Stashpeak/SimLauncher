import { Toggle } from '../Toggle'
import { normalizeLaunchDelayMs } from './settingsUtils'

interface BehaviorSectionProps {
  startWithWindows: boolean
  startMinimized: boolean
  minimizeToTray: boolean
  launchDelayMs: number
  onStartWithWindowsChange: (checked: boolean) => void
  onStartMinimizedChange: (checked: boolean) => void
  onMinimizeToTrayChange: (checked: boolean) => void
  onLaunchDelayMsChange: (delayMs: number) => void
}

export function BehaviorSection({
  startWithWindows,
  startMinimized,
  minimizeToTray,
  launchDelayMs,
  onStartWithWindowsChange,
  onStartMinimizedChange,
  onMinimizeToTrayChange,
  onLaunchDelayMsChange
}: BehaviorSectionProps) {
  return (
    <section className="space-y-4">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-(--accent) px-1">
        Behavior
      </h3>
      <div className="glass-surface rounded-2xl flex flex-col pt-1">
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
        <div className="settings-row">
          <div className="settings-label-group">
            <span className="settings-label">Launch delay between apps</span>
            <div className="mt-2 pr-4">
              <input
                type="range"
                min="0"
                max="5000"
                step="100"
                value={Number.isFinite(launchDelayMs) ? launchDelayMs : 1000}
                onChange={(e) =>
                  onLaunchDelayMsChange(normalizeLaunchDelayMs(Number(e.target.value)))
                }
                className="w-full accent-(--accent) cursor-pointer"
                aria-label="Launch delay slider"
              />
            </div>
          </div>
          <div className="settings-control">
            <input
              type="number"
              min="0"
              max="5000"
              step="100"
              value={launchDelayMs}
              onChange={(e) =>
                onLaunchDelayMsChange(normalizeLaunchDelayMs(Number(e.target.value)))
              }
              className="glass-recessed w-16 rounded-lg px-2 py-1.5 text-right text-xs text-(--text-primary) outline-none"
              aria-label="Launch delay in milliseconds"
            />
            <span className="text-[10px] font-bold text-(--text-muted) uppercase">ms</span>
          </div>
        </div>
      </div>
    </section>
  )
}
