import { GAMES } from '../../lib/config'
import { useSettings } from './SettingsContext'

export function GamesSection() {
  const { gamePaths, gameIcons, onBrowse, onGamePathChange } = useSettings()

  return (
    <>
      {GAMES.map((game, index) => (
        <div
          key={game.key}
          className={`flex flex-col gap-2 px-5 py-3 ${index !== GAMES.length - 1 ? 'border-b border-(--header-glass-border)' : ''}`}
        >
          <div className="text-[10px] font-semibold uppercase tracking-widest text-(--text-secondary) opacity-80">
            {game.name}
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
              value={gamePaths[game.key] || ''}
              onChange={(e) => onGamePathChange(game.key, e.target.value)}
              placeholder="No game path set"
              className="glass-recessed flex-1 truncate rounded-lg px-3 py-2 font-mono text-xs text-(--text-secondary) outline-none placeholder:text-(--text-subtle) focus:text-(--text-primary)"
            />

            <button
              onClick={() => onBrowse(game.key, true)}
              className="accent-surface-action action-hover-scale cursor-pointer shrink-0 rounded-xl px-4 py-2 text-xs font-semibold"
            >
              Browse
            </button>
          </div>
        </div>
      ))}
    </>
  )
}
