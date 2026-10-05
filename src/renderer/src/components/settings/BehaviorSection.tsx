import { useEffect, useId, useState, type ReactNode } from 'react'

import { Toggle } from '../Toggle'
import { useBehaviorSettings } from './BehaviorContext'
import { normalizeLaunchDelayMs } from './settingsUtils'

const DELAY_PRESETS = [
  { label: '1s', value: 1000 },
  { label: '1.5s', value: 1500 },
  { label: '2s', value: 2000 }
]

// What the custom-delay field shows: launchDelayMs expressed in seconds, with
// no trailing zeros (so a preset-derived 1500 reads "1.5", not "1.5000...").
function formatLaunchDelaySeconds(launchDelayMs: number): string {
  return Number.isFinite(launchDelayMs) ? String(launchDelayMs / 1000) : ''
}

// What committing this draft right now would produce, i.e. the same
// transform the onChange handler below applies. Used only to tell a change
// the draft itself just caused apart from one that came from outside it.
function commitFromDraft(draft: string): number {
  const parsed = parseFloat(draft)
  return isNaN(parsed) ? NaN : normalizeLaunchDelayMs(parsed * 1000)
}

export function BehaviorSection(): ReactNode {
  const startWithWindowsId = useId()
  const showTrayIconId = useId()
  const startMinimizedId = useId()
  const minimizeToTrayId = useId()
  const gracefulCloseId = useId()

  const {
    startWithWindows,
    startMinimized,
    minimizeToTray,
    showTrayIcon,
    gracefulCloseEnabled,
    launchDelayMs,
    onStartWithWindowsChange,
    onStartMinimizedChange,
    onMinimizeToTrayChange,
    onShowTrayIconChange,
    onGracefulCloseEnabledChange,
    onLaunchDelayMsChange
  } = useBehaviorSettings()
  const isPreset = DELAY_PRESETS.some((p) => p.value === launchDelayMs)

  // Local draft so the field's DOM value is exactly what was typed, the same
  // pattern #888 shipped for the HEX field's draft in ColorPickerPopover.
  // Without it, the controlled `value` was derived straight from
  // launchDelayMs: clearing the input made e.target.value "", parseFloat('')
  // is NaN, the onChange guard below skipped the commit, and React's
  // controlled-input restore wrote the unchanged prop value right back into
  // the DOM node before the next keystroke - the field could never be
  // emptied, and typing e.g. "4" then "5" toward "4.5" produced 45000ms,
  // which the clamp below snapped to 30000, visibly jumping the field to 30
  // mid-edit (#959).
  const [draft, setDraft] = useState(() => formatLaunchDelaySeconds(launchDelayMs))

  // A launchDelayMs change this field's own onChange just committed matches
  // what committing the current draft produces, so the draft is left alone
  // (it is already showing the keystroke that caused this). Anything else -
  // a preset click, the post-save write-back, a store-changed reload - takes
  // over the draft, same as ColorPickerPopover's effect for `color`. Depends
  // on launchDelayMs only (not on draft): a draft that does not parse all
  // the way (an empty field, a trailing ".") never changes launchDelayMs, so
  // this must not re-run and overwrite it on every keystroke either.
  useEffect(() => {
    setDraft((current) =>
      commitFromDraft(current) === launchDelayMs ? current : formatLaunchDelaySeconds(launchDelayMs)
    )
  }, [launchDelayMs])

  return (
    <>
      <div className="settings-row">
        <div className="settings-label-group">
          <label htmlFor={startWithWindowsId} className="settings-label">
            Start with Windows
          </label>
          <span className="settings-sublabel">Launch SimLauncher automatically at login</span>
        </div>
        <Toggle
          id={startWithWindowsId}
          checked={startWithWindows}
          onChange={onStartWithWindowsChange}
        />
      </div>
      <div className="settings-row">
        <div className="settings-label-group">
          <label htmlFor={showTrayIconId} className="settings-label">
            Show tray icon
          </label>
          <span className="settings-sublabel">Keep a SimLauncher icon in the system tray</span>
        </div>
        <Toggle id={showTrayIconId} checked={showTrayIcon} onChange={onShowTrayIconChange} />
      </div>
      <div className="settings-row">
        <div className="settings-label-group">
          <label htmlFor={startMinimizedId} className="settings-label">
            Start minimized
          </label>
          <span className="settings-sublabel">Start hidden in the system tray</span>
        </div>
        <Toggle
          id={startMinimizedId}
          checked={startMinimized}
          onChange={onStartMinimizedChange}
          disabled={!showTrayIcon}
        />
      </div>
      <div className="settings-row">
        <div className="settings-label-group">
          {/* Leads with the trigger (close), not the mechanism (minimize): a
              user scanning the list for "close" did not find it as "Minimize
              to tray on close". The stored key stays minimizeToTray. #891 */}
          <label htmlFor={minimizeToTrayId} className="settings-label">
            Close to tray
          </label>
          <span className="settings-sublabel">
            Closing the window sends SimLauncher to the tray instead of quitting
          </span>
        </div>
        <Toggle
          id={minimizeToTrayId}
          checked={minimizeToTray}
          onChange={onMinimizeToTrayChange}
          disabled={!showTrayIcon}
        />
      </div>
      <div className="settings-row">
        <div className="settings-label-group">
          <label htmlFor={gracefulCloseId} className="settings-label">
            Close apps gracefully
          </label>
          <span className="settings-sublabel">
            When you use Close Apps, ask them to save and close first, then force-close anything
            still running
          </span>
        </div>
        <Toggle
          id={gracefulCloseId}
          checked={gracefulCloseEnabled}
          onChange={onGracefulCloseEnabledChange}
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
              type="button"
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
              value={draft}
              onChange={(e) => {
                const next = e.target.value
                // Always reflect the keystroke, whether or not it parses -
                // this is what makes the field editable at all (#959).
                setDraft(next)
                const val = parseFloat(next)
                if (!isNaN(val)) {
                  onLaunchDelayMsChange(normalizeLaunchDelayMs(val * 1000))
                }
              }}
              onBlur={() => {
                // Whatever was typed and not taken (an empty field, a
                // trailing ".") gives way to the value actually in effect -
                // same restore-on-blur contract as the HEX field.
                setDraft(formatLaunchDelaySeconds(launchDelayMs))
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
