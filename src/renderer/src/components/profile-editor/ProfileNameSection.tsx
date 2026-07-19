import { useId, type ReactNode } from 'react'
import { Tooltip } from '../Tooltip'

interface ProfileNameSectionProps {
  profileName: string
  onProfileNameChange: (profileName: string) => void
  onCreateProfile?: () => void
}

export function ProfileNameSection({
  profileName,
  onProfileNameChange,
  onCreateProfile
}: ProfileNameSectionProps): ReactNode {
  const profileNameId = useId()

  return (
    <div className="space-y-2">
      <label
        htmlFor={profileNameId}
        className="block text-xs font-medium uppercase tracking-wider text-(--text-muted)"
      >
        Profile name
      </label>
      <div className="flex items-center gap-2">
        <input
          id={profileNameId}
          type="text"
          value={profileName}
          onChange={(event) => onProfileNameChange(event.target.value)}
          className="glass-recessed min-w-0 flex-1 rounded-lg px-3 py-2 text-sm text-(--text-primary) outline-none transition-colors placeholder:text-(--text-subtle) focus:ring-2 focus:ring-(--accent)"
          aria-label="Profile name"
        />
        {onCreateProfile !== undefined && (
          <Tooltip label="New profile">
            <button
              type="button"
              onClick={onCreateProfile}
              className="accent-surface-action action-hover-scale cursor-pointer flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-all"
              aria-label="New profile"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 5v14" />
                <path d="M5 12h14" />
              </svg>
            </button>
          </Tooltip>
        )}
      </div>
    </div>
  )
}
