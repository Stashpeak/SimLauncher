import { useEffect, useState, useRef } from 'react'
import { GAMES, UTILITIES, type Game, type Profiles } from '../lib/config'
import { ProfileEditor } from './ProfileEditor'
import { useNotify } from './Notify'

function GameRow({ 
  game, 
  isActive, 
  isRunning,
  onToggleEditor 
}: { 
  game: Game
  isActive: boolean
  isRunning: boolean
  onToggleEditor: () => void 
}) {
  const { notify } = useNotify()
  const [iconUrl, setIconUrl] = useState<string | null>(null)

  // Resolve icon URL via IPC
  useEffect(() => {
    async function resolveIcon() {
      const filename = game.icon.split('/').pop() || ''
      const data = await window.electronAPI.getAssetData(filename)
      setIconUrl(data)
    }
    resolveIcon()
  }, [game.icon])



  const handleLaunch = async () => {
    try {
      const profiles = (await window.electronAPI.storeGet('profiles')) as Profiles || {}
      const appPaths = (await window.electronAPI.storeGet('appPaths')) as Record<string, string> || {}
      const gamePaths = (await window.electronAPI.storeGet('gamePaths')) as Record<string, string> || {}

      const profile = profiles[game.key] || {}
      const gamePath = gamePaths[game.key]

      const pathsToLaunch: string[] = []
      let appCount = 0

      // Queue utilities first
      UTILITIES.forEach((u) => {
        if (profile[u.key] && appPaths[u.key]) {
          pathsToLaunch.push(appPaths[u.key])
          appCount++
        }
      })

      // Queue game last
      if (profile.launchAutomatically !== false && gamePath) {
        pathsToLaunch.push(gamePath)
        appCount++
      }

      if (pathsToLaunch.length > 0) {
        await window.electronAPI.launchProfile(pathsToLaunch)
        notify(`Starting ${game.name} + ${appCount - 1} apps`, 'success')
      } else {
        notify('No executable paths configured for launch', 'error')
      }
    } catch (err) {
      notify('Failed to launch profile', 'error')
      console.error(err)
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

  return (
    <div className="flex flex-col gap-2" ref={rowRef}>
      <div className="glass-surface flex h-[72px] w-full items-center justify-between rounded-[20px] px-6 transition-all duration-300 hover:bg-[var(--glass-bg-elevated)] hover:scale-[1.01] hover:border-[rgba(255,255,255,0.1)]">
        <div className="flex items-center gap-5">
          <div className="relative">
            {iconUrl && (
              <img 
                src={iconUrl} 
                alt={game.name} 
                className="h-12 w-12 object-contain animate-fade-slide drop-shadow-md"
                onError={(e) => { e.currentTarget.style.display = 'none' }}
              />
            )}
            {isRunning && (
              <div 
                className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-[#4ade80] shadow-[0_0_8px_#4ade80] outline outline-2 outline-[#1b1921]" 
                title="Running"
              />
            )}
          </div>
          <h3 className="font-semibold text-[var(--text-primary)] text-shadow-sm">{game.name}</h3>
        </div>

        <div className="flex items-center gap-3 no-drag">
          <button
            type="button"
            onClick={handleLaunch}
            className="cursor-pointer rounded-full bg-[var(--accent)] px-6 py-2 text-sm font-semibold text-white transition-all duration-300 hover:opacity-90 neon-glow active:scale-95"
          >
            Launch
          </button>
          <button
            type="button"
            onClick={handleToggle}
            className={`flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-lg leading-none transition-all duration-300
              ${isActive 
                ? 'bg-[var(--accent)] text-white rotate-90 scale-110 neon-glow' 
                : 'text-[var(--text-subtle)] hover:bg-[var(--glass-bg)] hover:text-[var(--text-primary)] rotate-0 hover:rotate-45'
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

  useEffect(() => {
    async function loadGames() {
      try {
        const gamePaths = (await window.electronAPI.storeGet('gamePaths')) as Record<string, string> || {}
        const available = GAMES.filter(game => !!gamePaths[game.key])
        setConfiguredGames(available)
      } catch (err) {
        console.error('Failed to load game paths', err)
      }
    }

    loadGames()
  }, [])

  // Consolidated Polling for all games
  useEffect(() => {
    let mounted = true
    let intervalId: number

    const checkRunningState = async () => {
      try {
        if (configuredGames.length === 0) return

        const [runningApps, profiles, appPaths, gamePaths] = await Promise.all([
          window.electronAPI.getRunningApps(),
          window.electronAPI.storeGet('profiles') as Promise<Profiles>,
          window.electronAPI.storeGet('appPaths') as Promise<Record<string, string>>,
          window.electronAPI.storeGet('gamePaths') as Promise<Record<string, string>>
        ])

        if (!mounted) return

        const newStatus: Record<string, boolean> = {}
        const normalizedRunningPaths = (runningApps || []).map(a => a.path.toLowerCase())

        configuredGames.forEach(game => {
          const profile = (profiles || {})[game.key] || {}
          const gamePath = (gamePaths || {})[game.key]
          
          const pathsToCheck: string[] = []
          if (profile.launchAutomatically !== false && gamePath) {
            pathsToCheck.push(gamePath.toLowerCase())
          }
          UTILITIES.forEach(u => {
            if (profile[u.key] && appPaths?.[u.key]) {
              pathsToCheck.push(appPaths[u.key].toLowerCase())
            }
          })

          newStatus[game.key] = pathsToCheck.some(p => normalizedRunningPaths.includes(p))
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
      <div className="flex flex-col items-center justify-center p-12 text-center text-[var(--text-secondary)]">
        <p>No games configured.</p>
        <p className="mt-1 text-sm text-[var(--text-muted)]">Configure game paths in settings to see them here.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 px-1 py-2">
      {configuredGames.map(game => (
        <GameRow 
          key={game.key} 
          game={game} 
          isActive={activeEditorKey === game.key}
          isRunning={!!runningStatus[game.key]}
          onToggleEditor={() => setActiveEditorKey(activeEditorKey === game.key ? null : game.key)}
        />
      ))}
    </div>
  )
}
