import { useEffect, useState } from 'react'
import { GAMES, type Game } from '../lib/config'
import { getSettings } from '../lib/store'
import { getFileIcon } from '../lib/electron'
import { useLaunchBlock } from '../hooks/useLaunchBlock'
import { useRunningApps } from '../hooks/useRunningApps'
import { EmptyState } from './EmptyState'
import { GameRow } from './game-list/GameRow'
export function GameList({ onNavigate }: { onNavigate: (view: 'games' | 'settings') => void }) {
  const [configuredGames, setConfiguredGames] = useState<Game[]>([])
  const [activeEditorKey, setActiveEditorKey] = useState<string | null>(null)
  const [appIconCache, setAppIconCache] = useState<Record<string, string>>({})
  const [cacheInitialized, setCacheInitialized] = useState(false)
  const [gamePaths, setGamePaths] = useState<Record<string, string>>({})
  const [focusActiveTitle, setFocusActiveTitle] = useState(true)
  const { launchingGameKey, handleLaunchStart, handleLaunchEnd } = useLaunchBlock()
  const { runningApps, runningStatus, refreshRunningState } = useRunningApps(configuredGames)

  useEffect(() => {
    let mounted = true

    async function loadInitialSettings() {
      try {
        const settings = await getSettings()
        if (!mounted) return

        setGamePaths(settings.gamePaths)
        setFocusActiveTitle(settings.focusActiveTitle !== false)
        setConfiguredGames(GAMES.filter((game) => !!settings.gamePaths[game.key]))

        const cache: Record<string, string> = {}
        await Promise.all(
          Object.values(settings.appPaths)
            .filter((p): p is string => Boolean(p))
            .map(async (p) => {
              const icon = await getFileIcon(p)
              if (icon) cache[p.toLowerCase()] = icon
            })
        )

        if (!mounted) return

        setAppIconCache(cache)
        setCacheInitialized(true)
      } catch (err) {
        console.error('Failed to load game settings', err)
        if (mounted) {
          setCacheInitialized(true)
        }
      }
    }

    loadInitialSettings()

    return () => {
      mounted = false
    }
  }, [])

  if (configuredGames.length === 0) {
    return (
      <EmptyState
        icon={
          <svg
            width="40"
            height="40"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 2a8 8 0 0 0-8 8v12l3-3 2.5 2.5L12 19l2.5 2.5L17 19l3 3V10a8 8 0 0 0-8-8z" />
            <path d="M9 10h.01" />
            <path d="M15 10h.01" />
          </svg>
        }
        title="No games configured"
        description="Configure your simulation game paths in settings to manage their companion apps and profiles here."
        action={{
          label: 'Configure Games',
          onClick: () => onNavigate('settings')
        }}
      />
    )
  }

  return (
    <div className="flex flex-col gap-3 px-1 py-2">
      {configuredGames
        .map((game, index) => ({ game, index }))
        .sort((firstEntry, secondEntry) => {
          if (!focusActiveTitle) {
            return 0
          }

          const runningSort =
            Number(!!runningStatus[secondEntry.game.key]) -
            Number(!!runningStatus[firstEntry.game.key])
          return runningSort || firstEntry.index - secondEntry.index
        })
        .map(({ game }) => {
          const hasActiveTitle = focusActiveTitle && Object.values(runningStatus).some(Boolean)
          const gamePathLower = gamePaths[game.key]?.toLowerCase()
          const appsForGame = runningApps.filter(
            (a) => a.gameKey === game.key && a.path.toLowerCase() !== gamePathLower
          )
          const runningAppIcons = appsForGame.map((a) => ({
            icon: appIconCache[a.path.toLowerCase()] ?? null,
            name: a.name,
            warning: a.warning
          }))

          return (
            <GameRow
              key={game.key}
              game={game}
              isActive={activeEditorKey === game.key}
              isRunning={!!runningStatus[game.key]}
              runningAppIcons={runningAppIcons}
              isDimmed={hasActiveTitle && !runningStatus[game.key]}
              isLaunching={launchingGameKey === game.key}
              isLaunchBlocked={launchingGameKey !== null}
              onLaunchStart={handleLaunchStart}
              onLaunchEnd={handleLaunchEnd}
              onRunningStateRefresh={refreshRunningState}
              onToggleEditor={() =>
                setActiveEditorKey(activeEditorKey === game.key ? null : game.key)
              }
              cacheInitialized={cacheInitialized}
            />
          )
        })}
    </div>
  )
}
