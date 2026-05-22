import { useEffect, useState, type ReactNode } from 'react'
import type { Game } from '../../lib/config'

interface GameIconProps {
  game: Game
  isRunning: boolean
  iconUrl?: string
}

export function GameIcon({ game, isRunning, iconUrl }: GameIconProps): ReactNode {
  const [iconLoadFailed, setIconLoadFailed] = useState(false)

  useEffect(() => {
    setIconLoadFailed(false)
  }, [iconUrl])

  return (
    <div className="relative flex h-12 w-12 shrink-0 items-center justify-center">
      {iconUrl && !iconLoadFailed ? (
        <img
          src={iconUrl}
          alt={game.name}
          className="game-icon-image h-12 w-12 object-contain animate-fade-slide"
          onError={() => setIconLoadFailed(true)}
        />
      ) : !iconLoadFailed ? (
        <div className="h-12 w-12 skeleton-icon animate-pulse" />
      ) : null}
      {isRunning && (
        <div
          className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-(--status-running) shadow-[0_0_8px_var(--status-running)]"
          title="Running"
        />
      )}
    </div>
  )
}
