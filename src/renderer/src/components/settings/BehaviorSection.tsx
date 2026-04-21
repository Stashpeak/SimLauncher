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
        <div className="flex items-center justify-between px-4 py-4 border-b border-white/5">
          <div className="flex flex-col">
            <span className="text-sm font-medium text-(--text-primary)">Start with Windows</span>
            <span className="text-[10px] text-(--text-muted)">
              Launch SimLauncher automatically at login
            </span>
          </div>
          <Toggle
            checked={startWithWindows}
            onChange={onStartWithWindowsChange}
            aria-label="Start with Windows"
          />
        </div>
        <div className="flex items-center justify-between px-4 py-4 border-b border-white/5">
          <div className="flex flex-col">
            <span className="text-sm font-medium text-(--text-primary)">Start minimized</span>
            <span className="text-[10px] text-(--text-muted)">Start hidden in the system tray</span>
          </div>
          <Toggle
            checked={startMinimized}
            onChange={onStartMinimizedChange}
            aria-label="Start minimized"
          />
        </div>
        <div className="flex items-center justify-between px-4 py-4 border-b border-white/5">
          <div className="flex flex-col">
            <span className="text-sm font-medium text-(--text-primary)">
              Minimize to tray on close
            </span>
            <span className="text-[10px] text-(--text-muted)">
              Keep SimLauncher running when the window is closed
            </span>
          </div>
          <Toggle
            checked={minimizeToTray}
            onChange={onMinimizeToTrayChange}
            aria-label="Minimize to tray on close"
          />
        </div>
        <div className="flex flex-col gap-3 px-4 py-4 border-b border-white/5">
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm font-medium text-(--text-primary)">
              Launch delay between apps
            </span>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                max="5000"
                step="100"
                value={launchDelayMs}
                onChange={(e) =>
                  onLaunchDelayMsChange(normalizeLaunchDelayMs(Number(e.target.value)))
                }
                className="glass-recessed w-20 rounded-lg px-2 py-1 text-right text-xs text-(--text-primary) outline-none"
                aria-label="Launch delay in milliseconds"
              />
              <span className="text-xs text-(--text-muted)">ms</span>
            </div>
          </div>
          <input
            type="range"
            min="0"
            max="5000"
            step="100"
            value={Number.isFinite(launchDelayMs) ? launchDelayMs : 1000}
            onChange={(e) => onLaunchDelayMsChange(normalizeLaunchDelayMs(Number(e.target.value)))}
            className="w-full accent-(--accent)"
            aria-label="Launch delay slider"
          />
        </div>
      </div>
    </section>
  )
}
