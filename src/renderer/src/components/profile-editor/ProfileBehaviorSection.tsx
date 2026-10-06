import type { Dispatch, ReactNode, SetStateAction } from 'react'
import type { GamePosition } from '../../lib/config'
import { AUTO_CLOSE_GRACE_MS, MIN_SESSION_MS } from '../../../../shared/domain/autoCloseTiming'
import { ProfileToggleRow } from './ProfileToggleRow'
import {
  TRACKING_OFF_SUBLABEL,
  TRACKING_ON_SUBLABEL,
  TRACKING_REQUIRED_SUBLABEL
} from './trackingCopy'

// The numbers come from the values main runs on, so the copy cannot drift.
// "A few seconds" read as "it did not fire" during a 15 s wait, and the
// two-minute session floor was not mentioned at all, so a quick test of the
// toggle looked broken (#945). The refusal when two games watch the same exe
// name stays unmentioned: rare, and it would turn the line into a paragraph.
const AUTO_CLOSE_SUBLABEL = `After ${MIN_SESSION_MS / 60000}+ minutes of play, waits ${AUTO_CLOSE_GRACE_MS / 1000} s so tools can save`

interface ProfileBehaviorSectionProps {
  launchAutomatically: boolean
  gamePosition: GamePosition
  trackingEnabled: boolean
  closeAppsOnGameExit: boolean
  onLaunchAutomaticallyChange: Dispatch<SetStateAction<boolean>>
  onGamePositionChange: Dispatch<SetStateAction<GamePosition>>
  onTrackingEnabledChange: Dispatch<SetStateAction<boolean>>
  onCloseAppsOnGameExitChange: Dispatch<SetStateAction<boolean>>
}

const GAME_POSITION_OPTIONS: { value: GamePosition; label: string }[] = [
  { value: 'first', label: 'First' },
  { value: 'last', label: 'After apps' }
]

export function ProfileBehaviorSection({
  launchAutomatically,
  gamePosition,
  trackingEnabled,
  closeAppsOnGameExit,
  onLaunchAutomaticallyChange,
  onGamePositionChange,
  onTrackingEnabledChange,
  onCloseAppsOnGameExitChange
}: ProfileBehaviorSectionProps): ReactNode {
  return (
    <div className="border-t border-(--glass-border) pt-4">
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <ProfileToggleRow
          label="Launch game with profile"
          checked={launchAutomatically}
          onToggle={() => onLaunchAutomaticallyChange((value) => !value)}
          onChange={onLaunchAutomaticallyChange}
        />
        <ProfileToggleRow
          label="Track running indicator for this game"
          sublabel={trackingEnabled ? TRACKING_ON_SUBLABEL : TRACKING_OFF_SUBLABEL}
          checked={trackingEnabled}
          onToggle={() => onTrackingEnabledChange((value) => !value)}
          onChange={onTrackingEnabledChange}
        />
        {/* Auto-close needs the running indicator: without tracking there is no
            exit to detect, so the toggle is disabled rather than left settable
            and silently inert. */}
        <ProfileToggleRow
          label="Close apps when the game exits"
          sublabel={trackingEnabled ? AUTO_CLOSE_SUBLABEL : TRACKING_REQUIRED_SUBLABEL}
          checked={closeAppsOnGameExit}
          disabled={!trackingEnabled}
          onToggle={() => onCloseAppsOnGameExitChange((value) => !value)}
          onChange={onCloseAppsOnGameExitChange}
        />
        {/* Game position is only meaningful when "Launch game with profile" is
            on; dim and disable it via pointer-events-none + opacity rather than
            unmounting so the current value is preserved if the user re-enables. */}
        <div
          className={`flex items-center justify-between rounded-xl bg-(--glass-bg) p-3 transition-opacity ${
            launchAutomatically ? '' : 'pointer-events-none opacity-50'
          }`}
        >
          <span className="text-sm font-medium text-(--text-secondary)">Game position</span>
          <div role="group" aria-label="Game position" className="flex gap-1.5">
            {GAME_POSITION_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                disabled={!launchAutomatically}
                onClick={() => onGamePositionChange(option.value)}
                aria-pressed={gamePosition === option.value}
                className={`glass-surface action-hover-scale rounded-lg px-3 py-1.5 text-xs font-medium tracking-wide transition-colors ${
                  gamePosition === option.value
                    ? 'selected-surface text-(--text-primary)'
                    : 'accent-subtle-hover text-(--text-secondary) hover:text-(--text-primary)'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
