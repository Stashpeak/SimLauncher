import { useId, type ReactNode } from 'react'

import { GAMES, type Game } from '../../lib/config'
import { InfoIcon } from '../icons'
import { Tooltip } from '../Tooltip'
import { useGamesSettings } from './GamesContext'

// The file name a typed or browsed path points at, compared case-insensitively.
// Windows paths come with either separator, and a path pasted from Explorer's
// "Copy as path" keeps its quotes.
function pathFileName(path: string): string {
  return path.trim().replace(/^"|"$/g, '').split(/[\\/]/).pop()?.toLowerCase() ?? ''
}

// A real button, so the tip is reachable by Tab and its tooltip opens on focus
// like on hover (#989). aria-description carries the text too, so Narrator
// reads it on focus without waiting for the tooltip to mount.
function GamePathTip({ gameName, tip }: { gameName: string; tip: string }): ReactNode {
  return (
    <Tooltip label={tip}>
      <button
        type="button"
        aria-label={`Tip for the ${gameName} path`}
        aria-description={tip}
        className="flex cursor-help items-center justify-center rounded-full text-(--text-muted) hover:text-(--text-primary)"
      >
        <InfoIcon width={12} height={12} />
      </button>
    </Tooltip>
  )
}

function GamePathSetting({ game, isLast }: { game: Game; isLast: boolean }): ReactNode {
  const { gamePaths, gameIcons, onBrowse, onGamePathChange } = useGamesSettings()
  const hintId = useId()
  const path = gamePaths[game.key] || ''
  const hint =
    game.pathHint && pathFileName(path) === game.pathHint.fileName.toLowerCase()
      ? game.pathHint.text
      : null

  return (
    <div
      className={`flex flex-col gap-2 px-5 py-3 ${isLast ? '' : 'border-b border-(--header-glass-border)'}`}
    >
      <div className="flex items-center gap-1.5">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-(--text-secondary) opacity-80">
          {game.name}
        </div>
        {game.pathTip && <GamePathTip gameName={game.name} tip={game.pathTip} />}
      </div>

      <div className="flex items-center gap-4">
        {gameIcons[game.key] ? (
          <img
            src={gameIcons[game.key]}
            alt={game.name}
            className="w-8 h-8 object-contain drop-shadow-md shrink-0"
          />
        ) : (
          <div className="w-8 h-8 rounded shrink-0 bg-(--glass-bg) border border-(--glass-border) flex items-center justify-center text-(--text-subtle)">
            <svg
              aria-hidden="true"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
            </svg>
          </div>
        )}

        <input
          type="text"
          value={path}
          onChange={(e) => onGamePathChange(game.key, e.target.value)}
          placeholder="No game path set"
          aria-label={`${game.name} executable path`}
          aria-describedby={hint ? hintId : undefined}
          className="glass-recessed min-w-0 flex-1 truncate rounded-lg px-3 py-2 font-mono text-xs text-(--text-secondary) outline-none placeholder:text-(--text-subtle) focus-visible:ring-2 focus-visible:ring-(--accent) focus:text-(--text-primary)"
        />

        <button
          onClick={() => onBrowse(game.key, true)}
          aria-label={`Browse for ${game.name} executable`}
          className="accent-surface-action action-hover-scale cursor-pointer shrink-0 rounded-xl px-4 py-2 text-xs font-semibold"
        >
          Browse
        </button>
      </div>

      {/* Indented to start under the path field, past the 32px icon and its
          16px gap. An offer, not an error: the path it reacts to works. */}
      {hint && (
        <p id={hintId} className="settings-sublabel pl-12">
          {hint}
        </p>
      )}
    </div>
  )
}

export function GamesSection(): ReactNode {
  return (
    <>
      {GAMES.map((game, index) => (
        <GamePathSetting key={game.key} game={game} isLast={index === GAMES.length - 1} />
      ))}
    </>
  )
}
