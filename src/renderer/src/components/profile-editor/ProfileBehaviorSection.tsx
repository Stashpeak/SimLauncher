import type { Dispatch, ReactNode, SetStateAction } from 'react'
import type { GamePosition } from '../../lib/config'
import { ProfileToggleRow } from './ProfileToggleRow'

interface ProfileBehaviorSectionProps {
  launchAutomatically: boolean
  gamePosition: GamePosition
  trackingEnabled: boolean
  onLaunchAutomaticallyChange: Dispatch<SetStateAction<boolean>>
  onGamePositionChange: Dispatch<SetStateAction<GamePosition>>
  onTrackingEnabledChange: Dispatch<SetStateAction<boolean>>
}

const GAME_POSITION_OPTIONS: { value: GamePosition; label: string }[] = [
  { value: 'first', label: 'First' },
  { value: 'last', label: 'After apps' }
]

export function ProfileBehaviorSection({
  launchAutomatically,
  gamePosition,
  trackingEnabled,
  onLaunchAutomaticallyChange,
  onGamePositionChange,
  onTrackingEnabledChange
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
          checked={trackingEnabled}
          onToggle={() => onTrackingEnabledChange((value) => !value)}
          onChange={onTrackingEnabledChange}
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
