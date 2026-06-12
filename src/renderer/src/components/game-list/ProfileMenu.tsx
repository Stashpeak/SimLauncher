import type { ReactNode, RefObject } from 'react'
import type { NamedGameProfile } from '../../lib/config'
import { ChevronDownIcon, CheckIcon, PlusIcon } from '../icons'

interface ProfileMenuProps {
  gameName: string
  profiles: NamedGameProfile[]
  activeProfileId: string
  activeProfileName: string
  profileMenuOpen: boolean
  newProfileFormOpen: boolean
  newProfileName: string
  profileMenuRef: RefObject<HTMLDivElement | null>
  menuRef: RefObject<HTMLDivElement | null>
  triggerRef: RefObject<HTMLButtonElement | null>
  newProfileInputRef: RefObject<HTMLInputElement | null>
  onOpenProfileMenu: () => void
  onCloseProfileMenu: () => void
  onTriggerKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void
  onMenuKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void
  onProfileSelect: (profileId: string) => void
  onNewProfileNameChange: (name: string) => void
  onNewProfileSubmit: () => void
}

export function ProfileMenu({
  gameName,
  profiles,
  activeProfileId,
  activeProfileName,
  profileMenuOpen,
  newProfileFormOpen,
  newProfileName,
  profileMenuRef,
  menuRef,
  triggerRef,
  newProfileInputRef,
  onOpenProfileMenu,
  onCloseProfileMenu,
  onTriggerKeyDown,
  onMenuKeyDown,
  onProfileSelect,
  onNewProfileNameChange,
  onNewProfileSubmit
}: ProfileMenuProps): ReactNode {
  return (
    <div ref={profileMenuRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          if (profileMenuOpen) onCloseProfileMenu()
          else onOpenProfileMenu()
        }}
        onKeyDown={onTriggerKeyDown}
        className="dropdown-trigger-surface group/dropdown flex h-9 w-[120px] cursor-pointer items-center gap-1.5 rounded-l-full py-2 pl-3 pr-2.5 text-[10px] font-semibold text-(--text-secondary) transition-all hover:text-(--text-primary)"
        aria-haspopup="menu"
        aria-expanded={profileMenuOpen}
        aria-label={`${gameName} profile`}
        title={activeProfileName}
      >
        <ChevronDownIcon
          width={10}
          height={10}
          className={`shrink-0 text-(--text-muted) transition-transform ${profileMenuOpen ? 'rotate-180' : ''}`}
        />
        <span className="min-w-0 truncate">{activeProfileName}</span>
      </button>
      {profileMenuOpen && (
        <div
          ref={menuRef}
          role="menu"
          onKeyDown={onMenuKeyDown}
          className="dropdown-surface absolute right-0 top-full z-50 mt-1.5 min-w-44 overflow-hidden rounded-xl p-1 backdrop-blur-xl animate-fade-slide"
        >
          {profiles.map((profile) => {
            const selected = profile.id === activeProfileId
            return (
              <button
                key={profile.id}
                type="button"
                role="menuitemradio"
                aria-checked={selected ? 'true' : 'false'}
                onClick={(event) => {
                  event.stopPropagation()
                  onProfileSelect(profile.id)
                }}
                className={`dropdown-item flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-semibold ${selected ? 'selected-surface' : ''}`}
              >
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${selected ? 'bg-(--accent)' : 'bg-(--text-subtle)'}`}
                />
                <span className="min-w-0 flex-1 truncate">{profile.name}</span>
              </button>
            )
          })}
          <div className="my-1 h-px bg-(--glass-border)" />
          {newProfileFormOpen ? (
            <form
              onSubmit={(event) => {
                event.preventDefault()
                event.stopPropagation()
                onNewProfileSubmit()
              }}
              className="flex items-center gap-1.5 rounded-lg px-1.5 py-1"
            >
              <input
                ref={newProfileInputRef}
                type="text"
                value={newProfileName}
                onChange={(event) => onNewProfileNameChange(event.target.value)}
                onClick={(event) => event.stopPropagation()}
                placeholder="Profile name"
                className="min-w-0 flex-1 rounded-md border border-(--glass-border) bg-(--glass-bg) px-2 py-1.5 text-xs font-semibold text-(--text-primary) outline-none placeholder:text-(--text-subtle) focus:border-(--accent)"
                aria-label="New profile name"
              />
              <button
                type="submit"
                disabled={newProfileName.trim().length === 0}
                className="accent-action flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md"
                aria-label="Create profile"
                title="Create profile"
              >
                <CheckIcon width={13} height={13} />
              </button>
            </form>
          ) : (
            // '__new__' is a sentinel: callers convert it to the new-profile
            // form path instead of treating it as a real profile id.
            <button
              type="button"
              role="menuitem"
              onClick={(event) => {
                event.stopPropagation()
                onProfileSelect('__new__')
              }}
              className="dropdown-item flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-bold"
            >
              <PlusIcon width={12} height={12} />
              New profile
            </button>
          )}
        </div>
      )}
    </div>
  )
}
