import { GameRowProfileMenu, type GameRowProfileMenuProps } from './GameRowProfileMenu'
import { RefreshIcon, KillIcon, PlayMarkIcon, SettingsIcon } from '../icons'

export interface GameRowActionsProps {
  isActive: boolean
  isLaunching: boolean
  isLaunchBlocked: boolean
  canKill: boolean
  canRelaunch: boolean
  onPrimary: () => void
  onKill: () => void
  onRelaunchMissing: () => void
  onToggleEditor: () => void
  profileMenuProps: GameRowProfileMenuProps
}

export function GameRowActions({
  isActive,
  isLaunching,
  isLaunchBlocked,
  canKill,
  canRelaunch,
  onPrimary,
  onKill,
  onRelaunchMissing,
  onToggleEditor,
  profileMenuProps
}: GameRowActionsProps) {
  const primaryAction = canKill ? onKill : onPrimary
  const primaryButtonClass = canKill ? 'danger-action' : 'accent-surface-action'
  const primaryTitle = isLaunching && !canKill ? 'Launching' : canKill ? 'Close Apps' : 'Launch'

  return (
    <div className="flex items-center gap-3 no-drag">
      <div className="flex h-9 w-9 items-center justify-center">
        {canRelaunch && (
          <button
            type="button"
            onClick={onRelaunchMissing}
            disabled={isLaunchBlocked}
            className="icon-action flex h-9 w-9 cursor-pointer items-center justify-center rounded-full"
            title="Relaunch missing apps"
            aria-label="Relaunch missing apps"
          >
            <RefreshIcon
              width={18}
              height={18}
              strokeWidth="2.2"
              className="transition-transform group-hover/btn:scale-110 group-active/btn:scale-95"
            />
          </button>
        )}
      </div>

      <div className="no-drag glass-surface flex items-center rounded-full p-0.5">
        <GameRowProfileMenu {...profileMenuProps} />

        <div className="relative z-10 h-4 w-px bg-(--glass-border) opacity-15" />

        <button
          type="button"
          onClick={primaryAction}
          disabled={isLaunchBlocked && !canKill}
          className={`launcher-play-btn group/btn flex h-9 w-[54px] shrink-0 cursor-pointer items-center justify-center rounded-r-full transition-all ${primaryButtonClass}`}
          title={primaryTitle}
          aria-label={primaryTitle}
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
      </div>

      <button
        type="button"
        onClick={onToggleEditor}
        className={`flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full transition-all duration-300 ${
          isActive
            ? 'icon-action-active'
            : 'icon-action opacity-40 group-hover/row:opacity-100 group-hover/row:bg-(--glass-bg)'
        }`}
        title={isActive ? 'Close Profile Settings' : 'Profile Settings'}
        aria-label={isActive ? 'Close Profile Settings' : 'Profile Settings'}
      >
        {isActive ? (
          <KillIcon width={18} height={18} className="transition-transform hover:scale-110" />
        ) : (
          <SettingsIcon width={18} height={18} className="transition-transform hover:rotate-90" />
        )}
      </button>
    </div>
  )
}
