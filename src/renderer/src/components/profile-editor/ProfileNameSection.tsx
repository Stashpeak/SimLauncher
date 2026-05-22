import type { ReactNode } from 'react'

interface ProfileNameSectionProps {
  profileName: string
  onProfileNameChange: (profileName: string) => void
}

export function ProfileNameSection({
  profileName,
  onProfileNameChange
}: ProfileNameSectionProps): ReactNode {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wider text-(--text-muted)">
        Profile name
      </p>
      <input
        type="text"
        value={profileName}
        onChange={(event) => onProfileNameChange(event.target.value)}
        className="glass-recessed w-full rounded-lg px-3 py-2 text-sm text-(--text-primary) outline-none transition-colors placeholder:text-(--text-subtle) focus:ring-2 focus:ring-(--accent)"
        aria-label="Profile name"
      />
    </div>
  )
}
