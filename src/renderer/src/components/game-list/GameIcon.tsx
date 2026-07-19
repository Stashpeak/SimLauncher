import { useEffect, useState, type ReactNode } from 'react'
import type { Game } from '../../lib/config'
import { Tooltip } from '../Tooltip'
import { useDismissMenu } from '../../hooks/useDismissMenu'

interface GameIconProps {
  game: Game
  isRunning: boolean
  iconUrl?: string
  // When the green dot is driven by a stale process-name-mismatch entry (a
  // launcher stub that self-exited, #737) rather than a confirmed live process,
  // `warning` carries its text and `dismissPath` the path to dismiss. The dot
  // then offers a right-click / keyboard Dismiss menu; otherwise the icon is
  // inert (a normal running dot clears itself when the process exits).
  warning?: string
  dismissPath?: string
}

const STATUS_DOT_CLASS =
  'status-dot absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-(--status-running) shadow-[0_0_8px_var(--status-running)]'

export function GameIcon({
  game,
  isRunning,
  iconUrl,
  warning,
  dismissPath
}: GameIconProps): ReactNode {
  const [iconLoadFailed, setIconLoadFailed] = useState(false)

  // Reset the error flag when the URL changes so a newly-configured icon gets
  // a fresh load attempt rather than staying permanently in the fallback state.
  useEffect(() => {
    setIconLoadFailed(false)
  }, [iconUrl])

  // Called unconditionally (rules of hooks). The menu only arms when `warning`
  // is set, so a normally-running or idle icon stays inert and keeps the native
  // context menu (dev inspect).
  const dismissMenu = useDismissMenu({
    path: dismissPath ?? '',
    gameKey: game.key,
    name: game.name,
    warning
  })
  const isDismissible = isRunning && !!warning && !!dismissPath

  const iconContent =
    iconUrl && !iconLoadFailed ? (
      <img
        src={iconUrl}
        alt={game.name}
        className="game-icon-image h-12 w-12 object-contain animate-fade-slide"
        onError={() => setIconLoadFailed(true)}
      />
    ) : !iconLoadFailed ? (
      // No URL yet (icon still loading from Settings): show a pulsing skeleton
      // placeholder so the row layout is stable during load.
      <div aria-hidden="true" className="h-12 w-12 skeleton-icon animate-pulse" />
    ) : null /* iconLoadFailed: render nothing — the 48px slot looks odd with a
                truncated initial, so an empty slot is less distracting. */

  // Stuck-dot case (#737): the dot reflects a mismatch warning, not a confirmed
  // live process. The whole icon becomes a focusable trigger that opens a
  // Dismiss menu on right-click / Enter / Space (mirrors the running-strip
  // warning affordance, #543). The warning text itself tells the user to
  // right-click to dismiss, so it doubles as the tooltip and the accessible name.
  if (isDismissible) {
    return (
      <>
        <Tooltip label={warning} disabled={dismissMenu.isMenuOpen}>
          <button
            ref={dismissMenu.setTriggerRef}
            type="button"
            aria-label={`${game.name}: ${warning}`}
            className="relative flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center rounded-xl"
            {...dismissMenu.getTriggerProps()}
          >
            {iconContent}
            <span aria-hidden="true" className={STATUS_DOT_CLASS} />
          </button>
        </Tooltip>
        {dismissMenu.menu}
      </>
    )
  }

  return (
    <div className="relative flex h-12 w-12 shrink-0 items-center justify-center">
      {iconContent}
      {isRunning && (
        <Tooltip label="Running">
          <div className={STATUS_DOT_CLASS}>
            <span className="sr-only">{game.name} is running</span>
          </div>
        </Tooltip>
      )}
    </div>
  )
}
