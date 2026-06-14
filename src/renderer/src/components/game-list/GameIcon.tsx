import { useEffect, useState, type ReactNode } from 'react'
import type { Game } from '../../lib/config'
import { Tooltip } from '../Tooltip'

interface GameIconProps {
  game: Game
  isRunning: boolean
  iconUrl?: string
}

export function GameIcon({ game, isRunning, iconUrl }: GameIconProps): ReactNode {
  const [iconLoadFailed, setIconLoadFailed] = useState(false)

  // Reset the error flag when the URL changes so a newly-configured icon gets
  // a fresh load attempt rather than staying permanently in the fallback state.
  useEffect(() => {
    setIconLoadFailed(false)
  }, [iconUrl])

  return (
    <div className="relative flex h-12 w-12 shrink-0 items-center justify-center">
      {
        iconUrl && !iconLoadFailed ? (
          <img
            src={iconUrl}
            alt={game.name}
            className="game-icon-image h-12 w-12 object-contain animate-fade-slide"
            onError={() => setIconLoadFailed(true)}
          />
        ) : !iconLoadFailed ? (
          // No URL yet (icon still loading from Settings): show a pulsing
          // skeleton placeholder so the row layout is stable during load.
          <div aria-hidden="true" className="h-12 w-12 skeleton-icon animate-pulse" />
        ) : null /* iconLoadFailed: render nothing — no fallback text initial
                  because the 48px icon slot is large enough to look odd with
                  a truncated initial; an empty slot is less distracting. */
      }
      {isRunning && (
        <Tooltip label="Running">
          <div className="status-dot absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-(--status-running) shadow-[0_0_8px_var(--status-running)]">
            <span className="sr-only">{game.name} is running</span>
          </div>
        </Tooltip>
      )}
    </div>
  )
}
