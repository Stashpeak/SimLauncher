import type { Dispatch, KeyboardEvent, MutableRefObject, ReactNode, SetStateAction } from 'react'
import type { GameProfileSet, NamedGameProfile } from '../../lib/config'
import { ChevronDownIcon, CheckIcon, PlusIcon } from '../icons'

export interface GameRowProfileMenuProps {
  profileSet: GameProfileSet
  activeProfile: NamedGameProfile
  profileMenuOpen: boolean
  openProfileMenu: (focusSelectedProfileOnOpen?: boolean) => void
  closeProfileMenu: (returnFocusToTrigger?: boolean) => void
  profileMenuRef: MutableRefObject<HTMLDivElement | null>
  menuRef: MutableRefObject<HTMLDivElement | null>
  triggerRef: MutableRefObject<HTMLButtonElement | null>
  handleProfileMenuTriggerKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void
  handleProfileMenuKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void
  newProfileFormOpen: boolean
  newProfileName: string
  setNewProfileName: Dispatch<SetStateAction<string>>
  newProfileInputRef: MutableRefObject<HTMLInputElement | null>
  gameName: string
  onProfileSelect: (nextProfileId: string) => void
  onNewProfileSubmit: () => void
}

export function GameRowProfileMenu({
  profileSet,
  activeProfile,
  profileMenuOpen,
  openProfileMenu,
  closeProfileMenu,
  profileMenuRef,
  menuRef,
  triggerRef,
  handleProfileMenuTriggerKeyDown,
  handleProfileMenuKeyDown,
  newProfileFormOpen,
  newProfileName,
  setNewProfileName,
  newProfileInputRef,
  gameName,
  onProfileSelect,
  onNewProfileSubmit
}: GameRowProfileMenuProps): ReactNode {
  return (
    <div ref={profileMenuRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          if (profileMenuOpen) {
            closeProfileMenu(false)
          } else {
            openProfileMenu(false)
          }
        }}
        onKeyDown={handleProfileMenuTriggerKeyDown}
        className="dropdown-trigger-surface group/dropdown flex h-9 w-[120px] cursor-pointer items-center gap-1.5 rounded-l-full py-2 pl-3 pr-2.5 text-[10px] font-semibold text-(--text-secondary) transition-all hover:text-(--text-primary)"
        aria-haspopup="menu"
        aria-expanded={profileMenuOpen}
        aria-label={`${gameName} profile`}
        title={activeProfile.name}
      >
        <ChevronDownIcon
          width={10}
          height={10}
          className={`shrink-0 text-(--text-muted) transition-transform ${profileMenuOpen ? 'rotate-180' : ''}`}
        />
        <span className="min-w-0 truncate">{activeProfile.name}</span>
      </button>
      {profileMenuOpen && (
        <div
          ref={menuRef}
          role="menu"
          onKeyDown={handleProfileMenuKeyDown}
          className="dropdown-surface overlay-glass absolute right-0 top-full z-50 mt-1.5 min-w-44 overflow-hidden rounded-xl p-1 animate-fade-slide"
        >
          {profileSet.profiles.map((profile) => {
            const selected = profile.id === profileSet.activeProfileId

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
                className={`dropdown-item flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-semibold ${
                  selected ? 'selected-surface' : ''
                }`}
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
                onChange={(event) => setNewProfileName(event.target.value)}
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
