import { useEffect, useState, type ReactNode } from 'react'
import { GAMES, type Game } from '../lib/config'
import { getSettings } from '../lib/store'
import { getFileIcon } from '../lib/electron'
import { useLaunchBlock } from '../hooks/useLaunchBlock'
import { useRunningApps } from '../hooks/useRunningApps'
import { useNotify } from './Notify'
import { useGamesSettings } from './settings/GamesContext'
import { EmptyState } from './EmptyState'
import { GameRow } from './game-list/GameRow'
import { GamepadIcon } from './icons'

// Case-insensitive path comparison — Windows paths are case-insensitive but
// the main process may return them in any case (e.g. from process snapshots
// vs. settings-stored paths). Without normalization, `C:\foo` and `c:\foo`
// would be treated as different entries and the game's own executable would
// appear as a companion app in the running strip.
const normalizePath = (path: string) => path.toLowerCase()

export function GameList({
  onNavigate
}: {
  onNavigate: (view: 'games' | 'settings') => void
}): ReactNode {
  const [configuredGames, setConfiguredGames] = useState<Game[]>([])
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  // Only one profile editor is open at a time: opening a row closes any other.
  // This is enforced here (single activeEditorKey) rather than in GameRow so
  // closing-by-opening-another-row can still trigger the pending-profile
  // discard effect inside the collapsing row (#453).
  const [activeEditorKey, setActiveEditorKey] = useState<string | null>(null)
  const [appIconCache, setAppIconCache] = useState<Record<string, string>>({})
  const [gamePaths, setGamePaths] = useState<Record<string, string>>({})
  const [focusActiveTitle, setFocusActiveTitle] = useState(true)
  const { announce } = useNotify()
  const { runningApps, runningStatus, refreshRunningState } = useRunningApps(configuredGames)
  // Announce "X is now running" once a launch cooldown settles — but only if the
  // game is actually running by then. The cooldown also runs on partial failures
  // (a companion app started while the game exe failed), where the user has
  // already heard the assertive error; gating on the live runningStatus avoids a
  // contradictory "now running" follow-up. useLaunchBlock always invokes the
  // latest callback, so this reads the freshest running state (the 10s cooldown
  // is exactly the window for process detection to catch up). The name comes
  // from the static GAMES config so the timer closure can't go stale.
  const { launchingGameKey, handleLaunchStart, handleLaunchEnd } = useLaunchBlock({
    onLaunchSettled: (gameKey) => {
      if (!runningStatus[gameKey]) return
      const name = GAMES.find((game) => game.key === gameKey)?.name
      if (name) announce(`${name} is now running`)
    }
  })
  const { gameIcons } = useGamesSettings()

  useEffect(() => {
    let mounted = true

    async function loadInitialSettings() {
      try {
        const settings = await getSettings()
        if (!mounted) return

        setGamePaths(settings.gamePaths)
        setFocusActiveTitle(settings.focusActiveTitle !== false)
        setConfiguredGames(GAMES.filter((game) => !!settings.gamePaths[game.key]))
        setSettingsLoaded(true)
      } catch (err) {
        console.error('Failed to load game settings', err)
      }
    }

    loadInitialSettings()

    return () => {
      mounted = false
    }
  }, [])

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
          // Exclude the game's own executable so it doesn't appear as a
          // companion app in the running strip — the green dot on GameIcon
          // already communicates that the game itself is running.
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
