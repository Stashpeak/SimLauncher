import type { ReactNode } from 'react'

import { GameRowProfileMenu, type GameRowProfileMenuProps } from './GameRowProfileMenu'
import { RefreshIcon, KillIcon, PlayMarkIcon, SettingsIcon } from '../icons'
import { Tooltip } from '../Tooltip'

export interface GameRowActionsProps {
  isActive: boolean
  isLaunching: boolean
  isLaunchBlocked: boolean
  canKill: boolean
  // Ambient closable state: this profile's companions are running but none of
  // them is in the strip (#673). Renders a SECONDARY control and must never
  // reach `primaryAction` — see the comment on it below.
  canCloseLeftovers: boolean
  canRelaunch: boolean
  onPrimary: () => void
  onKill: () => void
  onRelaunchMissing: () => void
  onToggleEditor: () => void
  gameName: string
  // Name of the profile that will actually launch (#643). Always present:
  // getActiveGameProfile → normalizeGameProfileSet guarantees at least one
  // profile with a non-empty name ("Default" / "Profile N" fallbacks).
  activeProfileName: string
  editorId: string
  profileMenuProps: GameRowProfileMenuProps
}

export function GameRowActions({
  isActive,
  isLaunching,
  isLaunchBlocked,
  canKill,
  canCloseLeftovers,
  canRelaunch,
  onPrimary,
  onKill,
  onRelaunchMissing,
  onToggleEditor,
  gameName,
  activeProfileName,
  editorId,
  profileMenuProps
}: GameRowActionsProps): ReactNode {
  // `canKill` REPLACES the primary action, it does not add to it, which is why
  // ambient closable state (#673) must not feed it: a user whose SimHub
  // autostarts would get a red Close Apps here on every app start, on every row
  // whose profile enables SimHub, and no way to launch the game from that row.
  // Launch is the recovery path for that state, so it stays primary and the
  // close goes in the secondary slot below.
  const primaryAction = canKill ? onKill : onPrimary
  const primaryButtonClass = canKill ? 'danger-action' : 'accent-surface-action'
  // What will actually start: the game AND its active profile — the profile
  // determines which companion apps launch even when it's the default one
  // (#643 — the button previously just said "Launch", leaving that ambiguous).
  // WHY a colon separator: no em dashes in public-facing copy, and profile
  // names often contain hyphens, so a dash-style separator would get lost.
  const launchTarget = `${gameName}: ${activeProfileName} profile`
  // While a launch is in flight, or in its post-launch cooldown, these buttons
  // do nothing — so their tooltip and accessible name have to say why instead of
  // naming an action that cannot run (#830). `isLaunchBlocked` is global (any
  // game launching blocks every row), so the reason depends on whose launch it
  // is; `isLaunching` is this row's. Deliberately not two sentences: the tooltip
  // is 350ms of hover, and "please wait" is the part that says it is temporary.
  const blockedReason = isLaunching ? 'Launching, please wait' : 'Another launch is in progress'
  const isPrimaryBlocked = isLaunchBlocked && !canKill
  const primaryTitle = canKill
    ? 'Close Apps'
    : isPrimaryBlocked
      ? blockedReason
      : `Launch ${launchTarget}`

  const relaunchButton = canRelaunch ? (
    <Tooltip label={isLaunchBlocked ? blockedReason : 'Relaunch missing apps'}>
      <button
        type="button"
        // aria-disabled rather than `disabled`, for both buttons here
        // (#830). A `disabled` button is removed from the tab order AND
        // is dispatched no mouse events, so the very tooltip that
        // explains the block is the one thing a blocked user cannot
        // reach, by hover or by keyboard. Dropping the handler is what
        // makes the click inert; the attribute is what announces it.
        onClick={isLaunchBlocked ? undefined : onRelaunchMissing}
        aria-disabled={isLaunchBlocked || undefined}
        className="icon-action flex h-9 w-9 cursor-pointer items-center justify-center rounded-full"
        aria-label={
          isLaunchBlocked
            ? `Relaunch missing apps for ${gameName}. ${blockedReason}`
            : `Relaunch missing apps for ${gameName}`
        }
      >
        <RefreshIcon
          width={18}
          height={18}
          strokeWidth="2.2"
          className="transition-transform group-hover/btn:scale-110 group-active/btn:scale-95"
        />
      </button>
    </Tooltip>
  ) : null

  const closeLeftoversButton = canCloseLeftovers ? (
    // Says what is true and no more. It does NOT say "from a previous
    // session": the same state is reached by cycling the process tracking
    // toggle, and by a companion that autostarts with Windows and was never
    // ours to begin with. What the predicate proves is only that this
    // profile's companions are running and that clicking would close them.
    <Tooltip label="Close companion apps that are still running">
      <button
        type="button"
        onClick={onKill}
        // `icon-action danger-action`: transparent at rest, danger on
        // hover, matching the window close button. A destructive action
        // should not look identical to the benign one beside it, and this
        // pair already exists rather than being invented here.
        className="icon-action danger-action flex h-9 w-9 cursor-pointer items-center justify-center rounded-full"
        aria-label={`Close companion apps for ${gameName} that are still running`}
      >
        <KillIcon
          width={18}
          height={18}
          className="transition-transform group-hover/btn:scale-110 group-active/btn:scale-95"
        />
      </button>
    </Tooltip>
  ) : null

  return (
    <div className="flex items-center gap-3 no-drag">
      {/* The two CAN both apply (Codex on #853), which an earlier reading of
          this file denied: relaunch keys off the aggregate running state, which
          the game's own exe satisfies on its own, while the strip behind
          `canKill` deliberately excludes that exe. A profile whose companion
          runs ambiently — never ours to launch, so never in the strip — while
          the game is up therefore reaches both, and collapsing them into one
          slot would put the close out of reach in exactly the state #673 is
          about. So the close gets a slot of its own in that overlap, and the
          reserved slot below keeps its existing occupant so row alignment does
          not move for every other row. */}
      {relaunchButton && closeLeftoversButton && (
        <div className="flex h-9 w-9 items-center justify-center">{closeLeftoversButton}</div>
      )}
      <div className="flex h-9 w-9 items-center justify-center">
        {relaunchButton || closeLeftoversButton}
      </div>

      <div className="no-drag glass-surface flex items-center rounded-full p-0.5">
        <GameRowProfileMenu {...profileMenuProps} />

        <div className="relative z-10 h-4 w-px bg-(--glass-border) opacity-15" />

        <Tooltip label={primaryTitle}>
          <button
            type="button"
            onClick={isPrimaryBlocked ? undefined : primaryAction}
            aria-disabled={isPrimaryBlocked || undefined}
            className={`launcher-play-btn group/btn flex h-9 w-[54px] shrink-0 cursor-pointer items-center justify-center rounded-r-full transition-all ${primaryButtonClass}`}
            aria-label={
              canKill
                ? `Close companion apps for ${gameName}`
                : isLaunching
                  ? `Launching ${gameName}`
                  : isPrimaryBlocked
                    ? `Launch ${launchTarget}. ${blockedReason}`
                    : `Launch ${launchTarget}`
            }
            aria-busy={isLaunching && !canKill ? true : undefined}
          >
            {isLaunching && !canKill ? (
              <RefreshIcon
                width={21}
                height={21}
                stroke="var(--launcher-play)"
                strokeWidth="2.8"
                className="animate-spin transition-transform group-hover/btn:scale-110 group-active/btn:scale-95"
              />
            ) : canKill ? (
              <KillIcon
                width={21}
                height={21}
                className="transition-transform group-hover/btn:scale-110 group-active/btn:scale-95"
              />
            ) : (
              <PlayMarkIcon
                width={24}
                height={24}
                className="ml-0.5 transition-transform group-hover/btn:scale-110 group-active/btn:scale-95"
              />
            )}
          </button>
        </Tooltip>
      </div>

      <Tooltip label={isActive ? 'Close Profile Settings' : 'Profile Settings'}>
        <button
          type="button"
          onClick={onToggleEditor}
          className={`flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full transition-all duration-300 ${
            isActive
              ? 'icon-action-active'
              : 'icon-action opacity-60 group-hover/row:opacity-100 group-focus-within/row:opacity-100 focus-visible:opacity-100 group-hover/row:bg-(--glass-bg)'
          }`}
          aria-label={
            isActive ? `Close profile settings for ${gameName}` : `Profile settings for ${gameName}`
          }
          aria-expanded={isActive ? 'true' : 'false'}
          aria-controls={editorId}
        >
          {isActive ? (
            <KillIcon width={18} height={18} className="transition-transform hover:scale-110" />
          ) : (
            <SettingsIcon width={18} height={18} className="transition-transform hover:rotate-90" />
          )}
        </button>
      </Tooltip>
    </div>
  )
}
