import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { GAMES, type Game } from '../lib/config'
import { getSettings, onStoreConfigChanged } from '../lib/store'
import { getFileIcon } from '../lib/electron'
import { useLaunchBlock } from '../hooks/useLaunchBlock'
import { useRunningApps } from '../hooks/useRunningApps'
import { useGamesSettings } from './settings/GamesContext'
import { EmptyState } from './EmptyState'
import { GameRow } from './game-list/GameRow'
import { GamepadIcon } from './icons'

const normalizePath = (path: string) => path.toLowerCase()

export function GameList({
  onNavigate
}: {
  onNavigate: (view: 'games' | 'settings') => void
}): ReactNode {
  const [configuredGames, setConfiguredGames] = useState<Game[]>([])
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [activeEditorKey, setActiveEditorKey] = useState<string | null>(null)
  const [appIconCache, setAppIconCache] = useState<Record<string, string>>({})
  const [gamePaths, setGamePaths] = useState<Record<string, string>>({})
  const [focusActiveTitle, setFocusActiveTitle] = useState(true)
  const { launchingGameKey, handleLaunchStart, handleLaunchEnd } = useLaunchBlock()
  const { runningApps, runningStatus, refreshRunningState } = useRunningApps(configuredGames)
  const { gameIcons } = useGamesSettings()

  // Read the configured-games list (+ derived UI state) from the store. Kept in
  // a callback so it can run on mount AND on every store config change: the
  // Games view stays mounted (#479), so without a reactive re-read it would hold
  // its mount-time snapshot. The normal save paths (sticky bar, in-Settings
  // footer) persist without bumping App's refreshKey, so a newly-configured game
  // stayed hidden and a removed one lingered until the next app restart (#601).
  const loadSettings = useCallback(async (alive: { current: boolean }) => {
    try {
      const settings = await getSettings()
      if (!alive.current) return

      setGamePaths(settings.gamePaths)
      setFocusActiveTitle(settings.focusActiveTitle !== false)
      setConfiguredGames(GAMES.filter((game) => !!settings.gamePaths[game.key]))
      setSettingsLoaded(true)
    } catch (err) {
      console.error('Failed to load game settings', err)
    }
  }, [])

  useEffect(() => {
    const alive = { current: true }
    void loadSettings(alive)
    // GameList is a pure reader with no dirty baseline, so — unlike
    // useSettingsLoad — it must NOT skip the 'save-settings' reason: that's the
    // write that carries gamePaths. The event fires after the store write, and
    // GameList never writes the store, so there is no feedback loop.
    const unsubscribe = onStoreConfigChanged(() => {
      void loadSettings(alive)
    })

    return () => {
      alive.current = false
      unsubscribe()
    }
  }, [loadSettings])

  // Lazy-load Windows shell icons for newly-seen running app paths. Uses the
  // undefined sentinel (vs '' for "loaded but no icon") so re-fetching on
  // every render is avoided while still retrying if the cache entry is missing.
  useEffect(() => {
    let mounted = true
    const pathsToLoad = Array.from(
      new Set(
        runningApps
          .map((app) => app.path)
          .filter((path) => path && appIconCache[normalizePath(path)] === undefined)
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
          icons[normalizePath(path)] = icon ?? ''
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

  if (!settingsLoaded) {
    return null
  }

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
            path: a.path,
            gameKey: a.gameKey,
            warning: a.warning,
            elevated: a.elevated,
            tracked: a.tracked
          }))

          return (
            <GameRow
              key={game.key}
              game={game}
              gameIconUrl={gameIcons[game.key]}
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
                setActiveEditorKey((current) => (current === game.key ? null : game.key))
              }
              onCloseEditor={() =>
                setActiveEditorKey((current) => (current === game.key ? null : current))
              }
              cacheInitialized={true}
            />
          )
        })}
    </div>
  )
}
