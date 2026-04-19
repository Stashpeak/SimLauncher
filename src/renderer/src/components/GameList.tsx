import { useEffect, useState, useRef } from 'react'
import { GAMES, UTILITIES, type Game, type Profiles } from '../lib/config'
import { ProfileEditor } from './ProfileEditor'
import { useNotify } from './Notify'

const POST_LAUNCH_BLOCK_MS = 10000

function GameRow({
  game,
  isActive,
  isRunning,
  runningAppIcons,
  runningApps,
  isDimmed,
  isLaunching,
  isLaunchBlocked,
  onLaunchStart,
  onLaunchEnd,
  onToggleEditor
}: {
  game: Game
  isActive: boolean
  isRunning: boolean
  runningAppIcons: string[]
  runningApps: { path: string; name: string; gameKey: string }[]
  isDimmed: boolean
  isLaunching: boolean
  isLaunchBlocked: boolean
  onLaunchStart: (gameKey: string) => void
  onLaunchEnd: (gameKey: string, cooldownMs?: number) => void
  onToggleEditor: () => void
}) {
  const { notify } = useNotify()
  const [iconUrl, setIconUrl] = useState<string | null>(null)
  const [iconLoadFailed, setIconLoadFailed] = useState(false)
  const [failedRunningIcons, setFailedRunningIcons] = useState<Record<string, true>>({})

  useEffect(() => {
    async function resolveIcon() {
      const filename = game.icon.split('/').pop() || ''
      const data = await window.electronAPI.getAssetData(filename)
      setIconLoadFailed(false)
      setIconUrl(data)
    }
    resolveIcon()
  }, [game.icon])

  const getProfileLaunchPaths = async () => {
    const profiles = (await window.electronAPI.storeGet('profiles')) as Profiles || {}
    const appPaths = (await window.electronAPI.storeGet('appPaths')) as Record<string, string> || {}
    const gamePaths = (await window.electronAPI.storeGet('gamePaths')) as Record<string, string> || {}

    const profile = profiles[game.key] || {}
    const configuredGamePath = gamePaths[game.key]

    const pathsToLaunch: string[] = []
    let appCount = 0

    // Queue utilities first
    UTILITIES.forEach((u) => {
      if (profile[u.key] === true && appPaths[u.key]) {
        pathsToLaunch.push(appPaths[u.key])
        appCount++
      }
    })

    // Queue game last
    if (profile.launchAutomatically !== false && configuredGamePath) {
      pathsToLaunch.push(configuredGamePath)
      appCount++
    }

    return { profile, pathsToLaunch, appCount }
  }

  const handleLaunch = async () => {
    if (isLaunchBlocked) {
      return
    }

    let cooldownMs = 0

    try {
      const { pathsToLaunch, appCount } = await getProfileLaunchPaths()

      if (pathsToLaunch.length === 0) {
        notify('No executable paths configured for launch', 'error')
        return
      }

      onLaunchStart(game.key)
      const result = await window.electronAPI.launchProfile(game.key, pathsToLaunch)
      if (!result.success) {
        notify(result.error || 'Failed to launch profile', 'error')
        return
      }

      cooldownMs = result.launchedCount === 0 ? 0 : POST_LAUNCH_BLOCK_MS
      notify(result.message || `Starting ${game.name} + ${appCount - 1} apps`, 'success')
    } catch (err) {
      notify('Failed to launch profile', 'error')
      console.error(err)
    } finally {
      onLaunchEnd(game.key, cooldownMs)
    }
  }

  const handleKill = async () => {
    try {
      await window.electronAPI.killLaunchedApps(game.key)
      notify(`Closing companion apps for ${game.name}`, 'warn')
    } catch (err) {
      notify('Failed to close companion apps', 'error')
      console.error(err)
    }
  }

  const handleRelaunchMissing = async () => {
    if (isLaunchBlocked) {
      return
    }

    let cooldownMs = 0

    try {
      const { pathsToLaunch } = await getProfileLaunchPaths()
      const runningPathSet = new Set(runningApps.map((appProcess) => appProcess.path.toLowerCase()))
      const missingPaths = pathsToLaunch.filter((launchPath) => !runningPathSet.has(launchPath.toLowerCase()))

      if (missingPaths.length === 0) {
        notify('All profile apps are already running', 'success')
        return
      }

      onLaunchStart(game.key)
      const result = await window.electronAPI.launchProfile(game.key, missingPaths)
      if (!result.success) {
        notify(result.error || 'Failed to relaunch missing apps', 'error')
        return
      }

      cooldownMs = result.launchedCount === 0 ? 0 : POST_LAUNCH_BLOCK_MS
      notify(result.message || `Relaunching ${missingPaths.length} missing app${missingPaths.length === 1 ? '' : 's'}`, 'success')
    } catch (err) {
      notify('Failed to relaunch missing apps', 'error')
      console.error(err)
    } finally {
      onLaunchEnd(game.key, cooldownMs)
    }
  }

  const rowRef = useRef<HTMLDivElement | null>(null)

  const handleToggle = () => {
    onToggleEditor()
    if (!isActive && rowRef.current) {
      setTimeout(() => {
        rowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 50)
    }
  }

  const [profileState, setProfileState] = useState({
    killControlsEnabled: false,
    relaunchControlsEnabled: false
  })

  useEffect(() => {
    let mounted = true

    async function loadProfileState() {
      const profiles = (await window.electronAPI.storeGet('profiles')) as Profiles || {}
      const profile = profiles[game.key] || {}

      if (!mounted) {
        return
      }

      setProfileState({
        killControlsEnabled: profile.killControlsEnabled === true,
        relaunchControlsEnabled: profile.relaunchControlsEnabled === true
      })
    }

    loadProfileState()
    window.addEventListener('focus', loadProfileState)

    return () => {
      mounted = false
      window.removeEventListener('focus', loadProfileState)
    }
  }, [game.key, isActive])

  const canKill = isRunning && profileState.killControlsEnabled
  const canRelaunch = isRunning && profileState.relaunchControlsEnabled
  const primaryAction = canKill ? handleKill : handleLaunch
  const primaryLabel = isLaunching && !canKill ? 'Launching...' : canKill ? 'Close Apps' : 'Launch'
  const primaryButtonClass = canKill
    ? 'bg-(--danger-surface) text-(--danger-text) shadow-[0_0_15px_-5px_var(--danger-border)] hover:bg-(--danger-border)'
    : 'bg-(--accent) text-white neon-glow hover:opacity-90'

  return (
    <div className={`flex flex-col gap-2 transition-opacity duration-300 ${isDimmed ? 'opacity-45' : 'opacity-100'}`} ref={rowRef}>
      <div className="glass-surface flex h-[72px] w-full items-center justify-between rounded-[20px] px-6 transition-all duration-300 hover:bg-(--glass-bg-elevated) hover:border-[rgba(255,255,255,0.1)]">
        <div className="flex items-center gap-5">
          <div className="relative">
            {iconUrl && !iconLoadFailed && (
              <img
                src={iconUrl}
                alt={game.name}
                className="h-12 w-12 object-contain animate-fade-slide drop-shadow-md"
                onError={() => setIconLoadFailed(true)}
              />
            )}
            {isRunning && (
              <div
                className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-[#4ade80] shadow-[0_0_8px_#4ade80]"
                title="Running"
              />
            )}
          </div>
          <div className="flex flex-col gap-0.5">
            <h3 className="font-semibold text-(--text-primary) text-shadow-sm">{game.name}</h3>
            {runningAppIcons.length > 0 && (
              <div className="flex items-center gap-1">
                {runningAppIcons.filter((icon) => !failedRunningIcons[icon]).map((icon, i) => (
                  <img
                    key={i}
                    src={icon}
                    alt=""
                    className="h-4 w-4 object-contain opacity-80"
                    onError={() => setFailedRunningIcons((current) => ({ ...current, [icon]: true }))}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 no-drag">
          <button
            type="button"
            onClick={primaryAction}
            disabled={isLaunchBlocked && !canKill}
            className={`cursor-pointer rounded-full px-6 py-2 text-sm font-semibold transition-all duration-300 active:scale-95 disabled:cursor-wait disabled:opacity-60 disabled:active:scale-100 ${primaryButtonClass}`}
          >
            {primaryLabel}
          </button>
          {canRelaunch && (
            <button
              type="button"
              onClick={handleRelaunchMissing}
              disabled={isLaunchBlocked}
              className="cursor-pointer rounded-full bg-(--glass-bg-elevated) px-5 py-2 text-sm font-semibold text-(--text-primary) transition-all duration-300 hover:bg-(--glass-border) active:scale-95 disabled:cursor-wait disabled:opacity-60 disabled:active:scale-100"
            >
              {isLaunching ? 'Launching...' : 'Relaunch'}
            </button>
          )}
          <button
            type="button"
            onClick={handleToggle}
            className={`flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-lg leading-none transition-all duration-300
              ${isActive
                ? 'bg-(--accent) text-white rotate-90 scale-110 neon-glow'
                : 'text-(--text-subtle) hover:bg-(--glass-bg) hover:text-(--text-primary) rotate-0 hover:rotate-45'
              }`}
            title="Profile Settings"
          >
            ⚙
          </button>
        </div>
      </div>

      <div className={`profile-editor-wrapper mx-2 ${isActive ? 'profile-editor-open' : 'profile-editor-closed'}`}>
        <div className="overflow-hidden px-4 pb-12 pt-4 -mx-4 -mb-12 -mt-4">
          {isActive && (
            <div className="animate-fade-slide">
              <ProfileEditor
                gameKey={game.key}
                gameName={game.name}
                onClose={onToggleEditor}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function GameList() {
  const [configuredGames, setConfiguredGames] = useState<Game[]>([])
  const [activeEditorKey, setActiveEditorKey] = useState<string | null>(null)
  const [runningStatus, setRunningStatus] = useState<Record<string, boolean>>({})
  const [runningApps, setRunningApps] = useState<{ path: string; name: string; gameKey: string }[]>([])
  const [appIconCache, setAppIconCache] = useState<Record<string, string>>({})
  const [gamePaths, setGamePaths] = useState<Record<string, string>>({})
  const [focusActiveTitle, setFocusActiveTitle] = useState(true)
  const [launchingGameKey, setLaunchingGameKey] = useState<string | null>(null)
  const launchBlockTimeoutRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (launchBlockTimeoutRef.current !== null) {
        window.clearTimeout(launchBlockTimeoutRef.current)
      }
    }
  }, [])

  const handleLaunchStart = (gameKey: string) => {
    if (launchBlockTimeoutRef.current !== null) {
      window.clearTimeout(launchBlockTimeoutRef.current)
      launchBlockTimeoutRef.current = null
    }

    setLaunchingGameKey(gameKey)
  }

  const handleLaunchEnd = (finishedGameKey: string, cooldownMs = 0) => {
    setLaunchingGameKey((currentGameKey) => {
      if (currentGameKey !== finishedGameKey) {
        return currentGameKey
      }

      if (cooldownMs <= 0) {
        return null
      }

      launchBlockTimeoutRef.current = window.setTimeout(() => {
        setLaunchingGameKey((latestGameKey) => latestGameKey === finishedGameKey ? null : latestGameKey)
        launchBlockTimeoutRef.current = null
      }, cooldownMs)

      return currentGameKey
    })
  }

  useEffect(() => {
    async function loadGames() {
      try {
        const paths = (await window.electronAPI.storeGet('gamePaths')) as Record<string, string> || {}
        setGamePaths(paths)
        const available = GAMES.filter(game => !!paths[game.key])
        setConfiguredGames(available)
      } catch (err) {
        console.error('Failed to load game paths', err)
      }
    }

    loadGames()
  }, [])

  useEffect(() => {
    let mounted = true

    async function loadFocusActiveTitle() {
      const savedFocusActiveTitle = await window.electronAPI.storeGet('focusActiveTitle')

      if (mounted) {
        setFocusActiveTitle(savedFocusActiveTitle !== false)
      }
    }

    loadFocusActiveTitle()
    window.addEventListener('focus', loadFocusActiveTitle)

    return () => {
      mounted = false
      window.removeEventListener('focus', loadFocusActiveTitle)
    }
  }, [])

  // Load app icons once at mount
  useEffect(() => {
    async function loadAppIcons() {
      try {
        const appPaths = (await window.electronAPI.storeGet('appPaths')) as Record<string, string> || {}
        const cache: Record<string, string> = {}
        await Promise.all(
          Object.values(appPaths).filter(Boolean).map(async (p) => {
            const icon = await window.electronAPI.getFileIcon(p)
            if (icon) cache[p.toLowerCase()] = icon
          })
        )
        setAppIconCache(cache)
      } catch (err) {
        console.error('Failed to load app icons', err)
      }
    }

    loadAppIcons()
  }, [])

  // Poll running state every 2s
  useEffect(() => {
    let mounted = true
    let intervalId: number

    const checkRunningState = async () => {
      try {
        if (configuredGames.length === 0) return

        const apps = await window.electronAPI.getRunningApps()
        if (!mounted) return

        setRunningApps(apps || [])

        const newStatus: Record<string, boolean> = {}
        configuredGames.forEach(game => {
          newStatus[game.key] = (apps || []).some((a: { gameKey: string }) => a.gameKey === game.key)
        })
        setRunningStatus(newStatus)
      } catch (err) {
        console.error('Consolidated polling error:', err)
      }
    }

    checkRunningState()
    intervalId = window.setInterval(checkRunningState, 2000)

    return () => {
      mounted = false
      window.clearInterval(intervalId)
    }
  }, [configuredGames])

  if (configuredGames.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center text-(--text-secondary)">
        <p>No games configured.</p>
        <p className="mt-1 text-sm text-(--text-muted)">Configure game paths in settings to see them here.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 px-1 py-2">
      {configuredGames.map((game, index) => ({ game, index })).sort((firstEntry, secondEntry) => {
        if (!focusActiveTitle) {
          return 0
        }

        const runningSort = Number(!!runningStatus[secondEntry.game.key]) - Number(!!runningStatus[firstEntry.game.key])
        return runningSort || firstEntry.index - secondEntry.index
      }).map(({ game }) => {
        const hasActiveTitle = focusActiveTitle && Object.values(runningStatus).some(Boolean)
        const gamePathLower = gamePaths[game.key]?.toLowerCase()
        const appsForGame = runningApps.filter(
          a => a.gameKey === game.key && a.path.toLowerCase() !== gamePathLower
        )
        const runningAppIcons = appsForGame
          .map(a => appIconCache[a.path.toLowerCase()])
          .filter(Boolean) as string[]

        return (
          <GameRow
            key={game.key}
            game={game}
            isActive={activeEditorKey === game.key}
            isRunning={!!runningStatus[game.key]}
            runningAppIcons={runningAppIcons}
            runningApps={runningApps.filter(a => a.gameKey === game.key)}
            isDimmed={hasActiveTitle && !runningStatus[game.key]}
            isLaunching={launchingGameKey === game.key}
            isLaunchBlocked={launchingGameKey !== null}
            onLaunchStart={handleLaunchStart}
            onLaunchEnd={handleLaunchEnd}
            onToggleEditor={() => setActiveEditorKey(activeEditorKey === game.key ? null : game.key)}
          />
        )
      })}
    </div>
  )
}
