import { useEffect, useState } from 'react'
import { GAMES, type Game } from '../lib/config'
import { getSettings } from '../lib/store'
import { getFileIcon } from '../lib/electron'
import { useLaunchBlock } from '../hooks/useLaunchBlock'
import { useRunningApps } from '../hooks/useRunningApps'
import { EmptyState } from './EmptyState'
import { GameRow } from './game-list/GameRow'
import { GamepadIcon } from './icons'

const normalizePath = (path: string) => path.toLowerCase()

export function GameList({ onNavigate }: { onNavigate: (view: 'games' | 'settings') => void }) {
  const [configuredGames, setConfiguredGames] = useState<Game[]>([])
  const [activeEditorKey, setActiveEditorKey] = useState<string | null>(null)
  const [appIconCache, setAppIconCache] = useState<Record<string, string>>({})
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
      } catch (err) {
        console.error('Failed to load game settings', err)
      }
    }

    loadInitialSettings()

    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    let mounted = true
    const pathsToLoad = Array.from(
      new Set(
        runningApps
          .map((app) => app.path)
          .filter((path) => path && !appIconCache[normalizePath(path)])
      )
    )

    if (pathsToLoad.length === 0) {
      return () => {
        mounted = false
      }
    }

    async function loadRunningAppIcons() {
      const icons: Record<string, string> = {}

      await Promise.all(
        pathsToLoad.map(async (path) => {
          const icon = await getFileIcon(path)
          if (icon) icons[normalizePath(path)] = icon
        })
      )

      if (!mounted || Object.keys(icons).length === 0) return

      setAppIconCache((current) => ({ ...current, ...icons }))
    }

    loadRunningAppIcons().catch((err) => {
      console.error('Failed to load running app icons', err)
    })

    return () => {
      mounted = false
    }
  }, [appIconCache, runningApps])

  if (configuredGames.length === 0) {
    return (
      <EmptyState
        icon={<GamepadIcon width={40} height={40} />}
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
          const gamePathLower = gamePaths[game.key] ? normalizePath(gamePaths[game.key]) : undefined
          const appsForGame = runningApps.filter(
            (a) => a.gameKey === game.key && normalizePath(a.path) !== gamePathLower
          )
          const runningAppIcons = appsForGame.map((a) => ({
            icon: appIconCache[normalizePath(a.path)] ?? null,
            name: a.name,
            warning: a.warning,
            elevated: a.elevated
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
              cacheInitialized={true}
            />
          )
        })}
    </div>
  )
}
