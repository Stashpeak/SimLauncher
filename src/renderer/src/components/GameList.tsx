import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { GAMES, type Game } from '../lib/config'
import { getSettings, onStoreConfigChanged } from '../lib/store'
import { getFileIcon } from '../lib/electron'
import { useLaunchBlock } from '../hooks/useLaunchBlock'
import { useRunningApps } from '../hooks/useRunningApps'
import { isGameExeRunning } from '../lib/runningGame'
import { getPathComparisonKey } from '../../../shared/path'
import { useNotify } from './Notify'
import { useAppsSettings } from './settings/AppsContext'
import { useGamesSettings } from './settings/GamesContext'
import { EmptyState } from './EmptyState'
import { GameRow } from './game-list/GameRow'
import { BrandedGhostIcon } from './icons'
import type { SettingsSectionKey } from './settings/types'

// Derive the payload type from the store binding (same approach as
// useSettingsLoad) so the reason gate below stays in sync with
// StoreConfigChangeReason without a second import.
type StoreConfigChangePayload = Parameters<typeof onStoreConfigChanged>[0] extends (
  payload: infer Payload
) => void
  ? Payload
  : never

// Case-insensitive path comparison — Windows paths are case-insensitive but
// the main process may return them in any case (e.g. from process snapshots
// vs. settings-stored paths). Without normalization, `C:\foo` and `c:\foo`
// would be treated as different entries and the game's own executable would
// appear as a companion app in the running strip.
const normalizePath = (path: string) => path.toLowerCase()

export function GameList({
  onNavigate
}: {
  onNavigate: (view: 'games' | 'settings', target?: SettingsSectionKey) => void
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
  // game EXECUTABLE itself is detected running by then. The cooldown also runs on
  // partial failures (a companion app started while the game exe failed), and
  // runningStatus[key] is an aggregate that's true for any app under the key
  // (companions included), so it would still fire there after the user already
  // heard the assertive error. Match a running app against the configured game
  // path instead (same game-vs-companion split used for the running strip), so a
  // failed game launch stays silent. useLaunchBlock always invokes the latest
  // callback, so this reads the freshest snapshot (the 10s cooldown is the window
  // for process detection to catch up). Name comes from the static GAMES config
  // so the timer closure can't go stale.
  const { launchingGameKey, handleLaunchStart, handleLaunchEnd } = useLaunchBlock({
    onLaunchSettled: (gameKey) => {
      if (!isGameExeRunning(runningApps, gameKey, gamePaths[gameKey])) return
      const name = GAMES.find((game) => game.key === gameKey)?.name
      if (name) announce(`${name} is now running`)
    }
  })
  const { gameIcons } = useGamesSettings()
  const { appPaths: utilityAppPaths, utilityIcons } = useAppsSettings()

  // Reverse-lookup: normalized configured exe path -> bundled curated icon
  // (#652, bundled-first precedence since #727). Built-in utilities that ship
  // one are preferred here over Windows shell icon extraction on that same
  // path — the loop below — since shell extraction is unreliable across app
  // versions/icon formats. Keys use getPathComparisonKey (NOT the bare
  // lowercase normalizePath above): the configured settings value and the
  // main-process running-entry path can differ in slash style / stray
  // whitespace, not just case, and main canonicalises its own comparisons via
  // normalizePathForComparison — a bare toLowerCase() key misses those.
  const bundledIconByPath = useMemo(() => {
    const map: Record<string, string> = {}
    Object.entries(utilityIcons).forEach(([key, data]) => {
      const path = utilityAppPaths[key]
      if (path && data) {
        map[getPathComparisonKey(path)] = data
      }
    })
    return map
  }, [utilityAppPaths, utilityIcons])

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
      // Keep the previous configuredGames array reference when the game SET is
      // unchanged. Every Settings save sends the full settings object, so
      // 'save-settings' carries gamePaths in its changed keys even when gamePaths
      // didn't actually change (theme/tray/accent saves). Without this guard a
      // fresh array would churn useRunningApps' effect, re-subscribing the
      // running-apps IPC/monitor on every unrelated save (#603).
      setConfiguredGames((prev) => {
        const next = GAMES.filter((game) => !!settings.gamePaths[game.key])
        const unchanged =
          prev.length === next.length && prev.every((game, index) => game.key === next[index].key)
        return unchanged ? prev : next
      })
      setSettingsLoaded(true)
    } catch (err) {
      console.error('Failed to load game settings', err)
    }
  }, [])

  useEffect(() => {
    const alive = { current: true }
    void loadSettings(alive)
    // Reload only for reasons that can carry gamePaths: 'import-config' (full
    // store replace, keys ['*']) and 'save-settings'. Skip 'save-profile' /
    // 'save-profiles' (profiles only) and 'set-migration-flags' (boolean flags)
    // so those writes don't trigger a needless getSettings round-trip. Every
    // Settings save sends the FULL settings object, so 'save-settings' also fires
    // on theme/tray/accent changes — loadSettings absorbs that cheaply by keeping
    // the configuredGames reference stable when the game set is unchanged (see the
    // guard above), so useRunningApps doesn't re-subscribe (#603). GameList never
    // writes the store, so there is no feedback loop.
    const unsubscribe = onStoreConfigChanged((payload: StoreConfigChangePayload) => {
      if (payload.reason !== 'import-config' && payload.reason !== 'save-settings') return
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
  // Paths already covered by a bundled curated icon are skipped entirely:
  // bundled is preferred at display time (#727), so a shell-extracted result
  // for those paths would be fetched but never shown — wasted IPC and
  // exe-icon-extraction work on every newly-seen built-in path.
  useEffect(() => {
    let mounted = true
    const pathsToLoad = Array.from(
      new Set(
        runningApps
          .map((app) => app.path)
          .filter(
            (path) =>
              path &&
              appIconCache[normalizePath(path)] === undefined &&
              !bundledIconByPath[getPathComparisonKey(path)]
          )
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
    // bundledIconByPath is a useMemo over [utilityAppPaths, utilityIcons]
    // (both stable context state), so including it re-runs the effect only
    // when Settings actually change those — no per-render churn.
  }, [appIconCache, bundledIconByPath, runningApps])

  if (!settingsLoaded) {
    return null
  }

  if (configuredGames.length === 0) {
    return (
      <EmptyState
        icon={<BrandedGhostIcon width={86} height={80} />}
        title="No games configured"
        description="Configure your simulation game paths in settings to manage their companion apps and profiles here."
        action={{
          label: 'Configure Games',
          // Deep-link straight to the Games section, opened + scrolled into
          // view, rather than the top of Settings (#583 / #642).
          onClick: () => onNavigate('settings', 'games')
        }}
      />
    )
  }

  return (
    <div role="list" aria-label="Games" className="flex flex-col gap-3 px-1 py-2">
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
          // The green dot means the game's own exe is running — NOT the
          // runningStatus[key] aggregate, which is also true when only a
          // companion (e.g. SimHub) is up (#587). See isGameExeRunning.
          const gameExeRunning = isGameExeRunning(runningApps, game.key, gamePaths[game.key])
          // Exclude the game's own executable so it doesn't appear as a
          // companion app in the running strip — the dot above already
          // represents the game itself.
          const appsForGame = runningApps.filter(
            (a) => a.gameKey === game.key && normalizePath(a.path) !== gamePathLower
          )
          const runningAppIcons = appsForGame.map((a) => ({
            // Bundled-first (#727): a built-in's curated icon is preferred
            // over its shell-extracted exe icon — for a built-in slot the app
            // identity is known, so the curated icon is always at least as
            // correct as shell extraction, which can "succeed" with a broken
            // image (e.g. Crew Chief's black-square alpha artifact). Applied
            // at read time (not baked into appIconCache) so it isn't gated on
            // load-order between the two icon sources.
            icon:
              bundledIconByPath[getPathComparisonKey(a.path)] ||
              appIconCache[normalizePath(a.path)] ||
              null,
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
              isGameRunning={gameExeRunning}
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
