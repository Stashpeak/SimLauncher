import type { Dispatch, SetStateAction } from 'react'
import { ProfileToggleRow } from './ProfileToggleRow'

interface ProfileBehaviorSectionProps {
  launchAutomatically: boolean
  trackingEnabled: boolean
  onLaunchAutomaticallyChange: Dispatch<SetStateAction<boolean>>
  onTrackingEnabledChange: Dispatch<SetStateAction<boolean>>
}

export function ProfileBehaviorSection({
  launchAutomatically,
  trackingEnabled,
  onLaunchAutomaticallyChange,
  onTrackingEnabledChange
}: ProfileBehaviorSectionProps) {
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
      </div>
    </div>
  )
}
