import { useId } from 'react'
import type { Dispatch, KeyboardEvent, MutableRefObject, ReactNode, SetStateAction } from 'react'
import { autoUpdate, flip, FloatingPortal, offset, shift, useFloating } from '@floating-ui/react'
import type { GameProfileSet, NamedGameProfile } from '../../lib/config'
import { ChevronDownIcon, CheckIcon, PlusIcon } from '../icons'
import { Tooltip } from '../Tooltip'

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
  // The rest of the pill after the trigger: the separator and the primary
  // (play / Close Apps) button. See the comment on the pill below for why the
  // pill is rendered here rather than around this component.
  children?: ReactNode
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
  onNewProfileSubmit,
  children
}: GameRowProfileMenuProps): ReactNode {
  const menuId = useId()
  // Positioning only (#884). The menu used to be `absolute top-full right-0`
  // inside the row, which had three consequences with one ancestor: rows near
  // the bottom of the list had it cut off by the scroller, the `.overlay-glass`
  // blur had nothing to sample because the row's `.glass-surface` is
  // `isolation: isolate` and so a backdrop root, and it lined up with the
  // trigger button rather than with the pill the user sees as one control.
  // Portalling it out of the row with the pill as the reference fixes all
  // three. Same stack as Tooltip and useDismissMenu; `flip` is what opens it
  // upward on the bottom row. Open/close, keyboard and outside-press stay in
  // useProfileMenu, so no floating-ui interactions are wired here.
  const { refs, floatingStyles } = useFloating({
    open: profileMenuOpen,
    placement: 'bottom-end',
    middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate
  })
  // Display order only (#885). The stored list keeps creation order, and this
  // is a sorted copy made at render, never written back: everything that reads
  // `profileSet.profiles` (the active-profile lookup by id, the editor, main)
  // sees the stored order and is unaffected. Creation order was never a choice
  // anyone made, so it is not worth preserving on screen; custom ordering, if
  // it ever comes, is a feature of its own, not a prerequisite for this.
  // `localeCompare` orders by letter regardless of case ("alpha" before "Beta",
  // where a code-point sort puts every capital first) and `numeric` keeps
  // "Profile 2" ahead of "Profile 10". The keyboard handling in useProfileMenu
  // walks the rendered items, so arrow keys follow this order as well.
  const sortedProfiles = [...profileSet.profiles].sort((first, second) =>
    first.name.localeCompare(second.name, undefined, { numeric: true })
  )
  return (
    // The pill (trigger + separator + primary button) is rendered HERE, with
    // the floating reference on it, rather than in GameRowActions around this
    // component: the menu's right edge has to line up with the right edge of
    // the whole pill, and an implementation that anchors to the trigger by
    // reflex is exactly what #884 warns against. Owning the pill makes the
    // reference structural instead of a ref handed across components.
    <div
      ref={refs.setReference}
      className="no-drag glass-surface flex items-center rounded-full p-0.5"
    >
      {/* Outside-press boundary for useProfileMenu: a press on the trigger is
          "inside", a press on the primary button next to it is "outside" and
          closes the menu, as before. */}
      <div ref={profileMenuRef} className="flex">
        <Tooltip label={activeProfile.name} placement="bottom">
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
            aria-controls={profileMenuOpen ? menuId : undefined}
            aria-label={`${gameName} profile: ${activeProfile.name}`}
          >
            <ChevronDownIcon
              width={10}
              height={10}
              className={`shrink-0 text-(--text-muted) transition-transform ${profileMenuOpen ? 'rotate-180' : ''}`}
            />
            <span className="min-w-0 truncate">{activeProfile.name}</span>
          </button>
        </Tooltip>
      </div>
      {children}
      {profileMenuOpen && (
        <FloatingPortal>
          {/* Unstyled outer wrapper carries floating-ui's transform; the glass
              sits on the inner element so the transform does not promote it to
              its own compositing layer, which breaks backdrop-filter (same
              split as Tooltip). */}
          <div ref={refs.setFloating} style={floatingStyles} className="z-9999">
            <div
              ref={menuRef}
              id={menuId}
              role="menu"
              aria-label={`${gameName} profiles`}
              onKeyDown={handleProfileMenuKeyDown}
              className="dropdown-surface overlay-glass min-w-44 overflow-hidden rounded-xl p-1 animate-fade-slide"
            >
              {sortedProfiles.map((profile) => {
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
                      className={`status-dot h-1.5 w-1.5 shrink-0 rounded-full ${selected ? 'bg-(--accent)' : 'bg-(--text-subtle)'}`}
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
                  <Tooltip label="Create profile">
                    <button
                      type="submit"
                      disabled={newProfileName.trim().length === 0}
                      className="accent-action flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md"
                      aria-label="Create profile"
                    >
                      <CheckIcon width={13} height={13} />
                    </button>
                  </Tooltip>
                </form>
              ) : (
                // '__new__' is a sentinel handled by GameRow.switchToProfile to open
                // the inline new-profile form instead of selecting an existing one.
                // It is never a real profile id (real ids are UUIDs).
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
          </div>
        </FloatingPortal>
      )}
    </div>
  )
}
