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

const DELAY_PRESETS = [
  { label: '1s', value: 1000 },
  { label: '1.5s', value: 1500 },
  { label: '2s', value: 2000 }
]

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
  const isPreset = DELAY_PRESETS.some((p) => p.value === launchDelayMs)

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
            <span className="settings-sublabel">Wait time before starting the next app</span>
          </div>
          <div className="settings-control">
            {DELAY_PRESETS.map((preset) => (
              <button
                key={preset.value}
                onClick={() => onLaunchDelayMsChange(preset.value)}
                className={`settings-control-pill settings-control-pill-button settings-control-preset glass-surface tracking-wide transition-colors ${
                  launchDelayMs === preset.value
                    ? 'selected-surface text-(--text-primary)'
                    : 'accent-subtle-hover text-(--text-secondary) hover:text-(--text-primary)'
                }`}
              >
                {preset.label}
              </button>
            ))}
            <div
              className={`settings-control-pill settings-control-pill-input settings-control-preset glass-surface transition-all duration-200 ${
                !isPreset ? 'selected-surface' : ''
              }`}
            >
              <input
                type="number"
                min="0"
                max="9.9"
                step="0.1"
                value={Number.isFinite(launchDelayMs) ? launchDelayMs / 1000 : ''}
                onChange={(e) => {
                  const val = parseFloat(e.target.value)
                  if (!isNaN(val)) {
                    onLaunchDelayMsChange(normalizeLaunchDelayMs(val * 1000))
                  }
                }}
                className="w-full bg-transparent pl-1 text-right text-[11px] font-bold text-(--text-primary) outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                placeholder="0.0"
              />
              <div className="mx-1 h-4 w-px bg-(--glass-border) opacity-35" />
              <span className="pr-1 text-[9px] font-bold text-(--text-muted) uppercase">s</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
