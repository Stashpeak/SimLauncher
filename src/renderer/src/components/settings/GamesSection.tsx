import { GAMES } from '../../lib/config'

interface GamesSectionProps {
  open: boolean
  gamePaths: Record<string, string>
  gameIcons: Record<string, string>
  onOpenChange: (open: boolean) => void
  onBrowse: (key: string) => void
}

export function GamesSection({
  open,
  gamePaths,
  gameIcons,
  onOpenChange,
  onBrowse
}: GamesSectionProps) {
  return (
    <section className="space-y-4">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className="flex w-full cursor-pointer items-center gap-2 px-1"
      >
        <h3 className="flex-1 text-left text-sm font-semibold uppercase tracking-wider text-(--accent)">
          Games
        </h3>
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`text-(--text-subtle) transition-transform duration-300 ${open ? 'rotate-0' : '-rotate-90'}`}
        >
          <path d="M3 6l5 5 5-5" />
        </svg>
      </button>
      <div
        className={`grid transition-all duration-300 ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
      >
        <div className="overflow-hidden">
          <div className="glass-surface rounded-2xl flex flex-col pt-1">
            {GAMES.map((game, index) => (
              <div
                key={game.key}
                className={`flex flex-col gap-2 px-5 py-3 ${index !== GAMES.length - 1 ? 'border-b border-white/5' : ''}`}
              >
                <div className="text-[10px] font-bold uppercase tracking-widest text-(--text-secondary) opacity-80">
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
                    <div className="w-8 h-8 rounded shrink-0 bg-white/5 border border-white/10 flex items-center justify-center">
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="text-(--text-subtle)"
                      >
                        <rect x="3" y="3" width="18" height="18" rx="2" />
                      </svg>
                    </div>
                  )}

                  <input
                    type="text"
                    value={gamePaths[game.key] || ''}
                    readOnly
                    placeholder="No game path set"
                    className="flex-1 glass-recessed rounded-lg px-3 py-2 text-xs text-(--text-secondary) outline-none font-mono truncate"
                  />

                  <button
                    onClick={() => onBrowse(game.key)}
                    className="accent-surface-action cursor-pointer shrink-0 rounded-xl px-4 py-2 text-xs font-semibold"
                  >
                    Browse
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
