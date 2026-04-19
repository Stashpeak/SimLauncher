import { useEffect, useState } from 'react'
import { UTILITIES, GAMES } from '../lib/config'
import { useNotify } from './Notify'
import { Toggle } from './Toggle'

const ZOOM_PRESETS = [
  { label: '100%', factor: 1.0 },
  { label: '125%', factor: 1.25 },
  { label: '150%', factor: 1.5 },
  { label: '175%', factor: 1.75 },
]


const ACCENT_PRESETS = [
  { name: 'Electric Aqua', hex: '#00eaff' },
  { name: 'Sky Blue', hex: '#4d9fff' },
  { name: 'Racing Green', hex: '#00c853' },
  { name: 'Sunset Orange', hex: '#ff6b35' },
  { name: 'Cyber Purple', hex: '#c850c0' },
  { name: 'Caution Yellow', hex: '#ffd600' },
]

function normalizeLaunchDelayMs(value: number) {
  if (!Number.isFinite(value)) {
    return 1000
  }

  return Math.min(Math.max(Math.round(value), 0), 5000)
}

function getInitials(label: string) {
  const words = label
    .trim()
    .split(/\s+/)
    .filter(Boolean)

  if (words.length === 0) {
    return 'APP'
  }

  return words
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase()
}

export function SettingsView({ onClose, updateInfo }: { onClose: () => void, updateInfo: { version: string } | null }) {
  const { notify } = useNotify()
  const [loading, setLoading] = useState(true)

  // Settings State
  const [appPaths, setAppPaths] = useState<Record<string, string>>({})
  const [appNames, setAppNames] = useState<Record<string, string>>({})
  const [gamePaths, setGamePaths] = useState<Record<string, string>>({})
  const [accentPreset, setAccentPreset] = useState<string>('#00eaff')
  const [accentCustom, setAccentCustom] = useState<string>('')
  const [accentBgTint, setAccentBgTint] = useState<boolean>(false)
  const [focusActiveTitle, setFocusActiveTitle] = useState<boolean>(true)
  const [launchDelayMs, setLaunchDelayMs] = useState<number>(1000)
  const [startWithWindows, setStartWithWindows] = useState<boolean>(false)
  const [startMinimized, setStartMinimized] = useState<boolean>(false)
  const [minimizeToTray, setMinimizeToTray] = useState<boolean>(false)
  const [autoCheckUpdates, setAutoCheckUpdates] = useState<boolean>(true)
  const [zoomFactor, setZoomFactor] = useState<number>(1.0)

  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [installingUpdate, setInstallingUpdate] = useState(false)
  const [updateProgress, setUpdateProgress] = useState<number | null>(null)
  const [updateStatus, setUpdateStatus] = useState<string | null>(null)

  const [isCustomColor, setIsCustomColor] = useState(false)
  const [appsOpen, setAppsOpen] = useState(false)
  const [gamesOpen, setGamesOpen] = useState(false)

  // Cache for file icons
  const [appIcons, setAppIcons] = useState<Record<string, string>>({})
  const [gameIcons, setGameIcons] = useState<Record<string, string>>({})
  const [iconLoadErrors, setIconLoadErrors] = useState<Set<string>>(new Set())

  useEffect(() => {
    async function loadSettings() {
      const savedAppPaths = (await window.electronAPI.storeGet('appPaths')) as Record<string, string> || {}
      const savedAppNames = (await window.electronAPI.storeGet('appNames')) as Record<string, string> || {}
      const savedGamePaths = (await window.electronAPI.storeGet('gamePaths')) as Record<string, string> || {}
      const savedAccentPreset = (await window.electronAPI.storeGet('accentPreset')) as string || '#00eaff'
      const savedAccentCustom = (await window.electronAPI.storeGet('accentCustom')) as string || ''
      const savedBgTint = (await window.electronAPI.storeGet('accentBgTint')) as boolean || false
      const savedFocusActiveTitle = await window.electronAPI.storeGet('focusActiveTitle')
      const savedLaunchDelayMs = (await window.electronAPI.storeGet('launchDelayMs')) as number
      const savedStartWithWindows = (await window.electronAPI.storeGet('startWithWindows')) as boolean || false
      const savedStartMinimized = (await window.electronAPI.storeGet('startMinimized')) as boolean || false
      const savedMinimizeToTray = (await window.electronAPI.storeGet('minimizeToTray')) as boolean || false
      const savedAutoCheckUpdates = await window.electronAPI.storeGet('autoCheckUpdates')
      const savedZoomFactor = (await window.electronAPI.storeGet('zoomFactor')) as number

      setAppPaths(savedAppPaths)
      setAppNames(savedAppNames)
      setGamePaths(savedGamePaths)
      setAccentPreset(savedAccentPreset)
      setAccentCustom(savedAccentCustom)
      setAccentBgTint(savedBgTint)
      setFocusActiveTitle(savedFocusActiveTitle !== false)
      setLaunchDelayMs(normalizeLaunchDelayMs(savedLaunchDelayMs))
      setStartWithWindows(savedStartWithWindows)
      setStartMinimized(savedStartMinimized)
      setMinimizeToTray(savedMinimizeToTray)
      setAutoCheckUpdates(savedAutoCheckUpdates !== false)
      setZoomFactor(typeof savedZoomFactor === 'number' && Number.isFinite(savedZoomFactor) ? savedZoomFactor : 1.0)
      
      setIsCustomColor(savedAccentPreset === 'custom')

      // Load icons for configured app paths (extracted from EXE)
      const icons: Record<string, string> = {}
      for (const [key, path] of Object.entries(savedAppPaths)) {
        if (path) {
          const icon = await window.electronAPI.getFileIcon(path)
          if (icon) icons[key] = icon
        }
      }
      setAppIcons(icons)

      // Load icons for games (bundled assets)
      const gIcons: Record<string, string> = {}
      for (const game of GAMES) {
        const filename = game.icon.split('/').pop() || ''
        const data = await window.electronAPI.getAssetData(filename)
        if (data) gIcons[game.key] = data
      }
      setGameIcons(gIcons)

      setLoading(false)
    }
    loadSettings()
  }, [])

  const updateAccentCSS = (hex: string) => {
    if (!hex) return
    document.documentElement.style.setProperty('--accent', hex)
    
    // Compute glow rgba
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    document.documentElement.style.setProperty('--accent-glow', `rgba(${r}, ${g}, ${b}, 0.24)`)
  }

  const handleAccentChange = (presetHex: string) => {
    setAccentPreset(presetHex)
    if (presetHex !== 'custom') {
      setIsCustomColor(false)
      updateAccentCSS(presetHex)
    } else {
      setIsCustomColor(true)
      if (accentCustom) updateAccentCSS(accentCustom)
    }
  }

  const handleCustomColorChange = (hex: string) => {
    setAccentCustom(hex)
    updateAccentCSS(hex)
  }

  const handleBrowse = async (key: string, isGame: boolean) => {
    const result = (await window.electronAPI.browsePath(key)) as { filePath: string; inputId: string }
    if (result && result.filePath) {
      if (isGame) {
        setGamePaths(prev => ({ ...prev, [key]: result.filePath }))
      } else {
        setAppPaths(prev => ({ ...prev, [key]: result.filePath }))
        // Fetch icon immediately when a new path is selected
        const icon = await window.electronAPI.getFileIcon(result.filePath)
        if (icon) {
          setAppIcons(prev => ({ ...prev, [key]: icon }))
          setIconLoadErrors(prev => {
            const next = new Set(prev)
            next.delete(key)
            return next
          })
        }
      }
    }
  }

  const [appVersion, setAppVersion] = useState<string>('')

  useEffect(() => {
    async function load() {
      const v = await window.electronAPI.getVersion()
      setAppVersion(v)
    }
    load()

    const unsubscribeAvailable = window.electronAPI.onUpdateAvailable(() => {
      setCheckingUpdate(false)
      setUpdateStatus(null)
    })
    const unsubscribeNotAvailable = window.electronAPI.onUpdateNotAvailable(() => {
      setCheckingUpdate(false)
      setUpdateStatus('up-to-date')
      setTimeout(() => setUpdateStatus(null), 3000)
    })
    const unsubscribeProgress = window.electronAPI.onUpdateDownloadProgress((progress: any) => {
      if (typeof progress?.percent === 'number') {
        setUpdateProgress(progress.percent)
      }
    })
    const unsubscribeDownloaded = window.electronAPI.onUpdateDownloaded(() => {
      setCheckingUpdate(false)
      setInstallingUpdate(false)
      setUpdateProgress(null)
      setUpdateStatus('downloaded')
    })
    const unsubscribeError = window.electronAPI.onUpdateError((error: any) => {
      setCheckingUpdate(false)
      setInstallingUpdate(false)
      setUpdateProgress(null)
      setUpdateStatus('error')
      notify(error?.message || 'Update check failed', 'error')
      setTimeout(() => setUpdateStatus(null), 4000)
    })

    return () => {
      unsubscribeAvailable()
      unsubscribeNotAvailable()
      unsubscribeProgress()
      unsubscribeDownloaded()
      unsubscribeError()
    }
  }, [notify])

  const handleManualCheck = async () => {
    setCheckingUpdate(true)
    setUpdateStatus(null)
    try {
      await window.electronAPI.checkForUpdates()
    } catch (err) {
      setCheckingUpdate(false)
      setUpdateStatus('error')
      notify('Update check failed', 'error')
      console.error(err)
    }
  }

  const handleInstallUpdate = async () => {
    if (!updateInfo) {
      return
    }

    if (window.confirm(`Download and install version ${updateInfo.version}? SimLauncher will restart when ready.`)) {
      setInstallingUpdate(true)
      setUpdateProgress(null)
      setUpdateStatus(null)

      try {
        await window.electronAPI.installUpdate()
      } catch (err) {
        setInstallingUpdate(false)
        setUpdateProgress(null)
        setUpdateStatus('error')
        notify('Failed to install update', 'error')
        console.error(err)
      }
    }
  }

  const handleSave = async () => {
    try {
      const normalizedLaunchDelayMs = normalizeLaunchDelayMs(launchDelayMs)

      await window.electronAPI.storeSet('appPaths', appPaths)
      await window.electronAPI.storeSet('appNames', appNames)
      await window.electronAPI.storeSet('gamePaths', gamePaths)
      await window.electronAPI.storeSet('accentPreset', accentPreset)
      await window.electronAPI.storeSet('accentCustom', accentCustom)
      await window.electronAPI.storeSet('accentBgTint', accentBgTint)
      await window.electronAPI.storeSet('focusActiveTitle', focusActiveTitle)
      await window.electronAPI.storeSet('launchDelayMs', normalizedLaunchDelayMs)
      await window.electronAPI.storeSet('startMinimized', startMinimized)
      await window.electronAPI.storeSet('minimizeToTray', minimizeToTray)
      await window.electronAPI.storeSet('autoCheckUpdates', autoCheckUpdates)
      setLaunchDelayMs(normalizedLaunchDelayMs)

      notify('Settings saved!', 'success', 2500)
    } catch (err) {
      notify('Failed to save settings', 'error')
      console.error(err)
    }
  }

  if (loading) return null

  return (
    <div className="animate-fade-slide space-y-8 pb-10">
        
        {/* About Section */}
        <section className="space-y-4">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-(--accent) px-1">About</h3>
          <div className="glass-surface p-5 rounded-2xl space-y-4">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-(--text-secondary)">Installed Version</span>
              <span className="text-xs font-mono text-(--text-muted)">v{appVersion}</span>
            </div>

            <div className="flex items-center justify-between border-t border-white/5 pt-4">
              <div className="flex flex-col">
                <span className="text-sm font-medium text-(--text-primary)">Automatically check for updates</span>
                <span className="text-[10px] text-(--text-muted)">Check on startup when enabled</span>
              </div>
              <Toggle
                checked={autoCheckUpdates}
                onChange={setAutoCheckUpdates}
                aria-label="Automatically check for updates"
              />
            </div>
            
            <div className="flex flex-col gap-2">
              {updateInfo ? (
                <button
                  onClick={handleInstallUpdate}
                  disabled={installingUpdate}
                  className="w-full cursor-pointer rounded-xl bg-(--accent) py-2.5 text-xs font-bold text-white transition-all hover:opacity-90 active:scale-[0.98] shadow-[0_0_15px_-5px_var(--accent-glow)] disabled:cursor-wait disabled:opacity-60 disabled:active:scale-100"
                >
                  {installingUpdate
                    ? updateProgress !== null
                      ? `Downloading ${Math.round(updateProgress)}%`
                      : 'Preparing update...'
                    : `Download & Install (v${updateInfo.version})`}
                </button>
              ) : (
                <button
                  onClick={handleManualCheck}
                  disabled={checkingUpdate}
                  className={`w-full cursor-pointer rounded-xl bg-(--glass-bg-elevated) py-2.5 text-xs font-bold text-(--text-primary) transition-all hover:bg-(--glass-border) active:scale-[0.98] disabled:opacity-50 disabled:cursor-wait`}
                >
                  {checkingUpdate ? 'Checking for updates...' : 'Check for Updates'}
                </button>
              )}
              
              {updateStatus === 'up-to-date' && (
                <p className="text-[10px] text-center text-(--status-success) animate-fade-slide">
                  SimLauncher is up to date!
                </p>
              )}
              {updateStatus === 'error' && (
                <p className="text-[10px] text-center text-red-400 animate-fade-slide">
                  Update failed. Try again later.
                </p>
              )}
            </div>
          </div>
        </section>

        {/* Appearance Section */}
        <section className="space-y-4">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-(--accent) px-1">Appearance</h3>
          <div className="glass-surface p-5 rounded-2xl space-y-6">
            <div className="space-y-3">
              <label className="text-sm text-(--text-secondary)">Accent Color</label>
              <div className="flex flex-wrap gap-2">
                {ACCENT_PRESETS.map(preset => (
                  <button
                    key={preset.hex}
                    onClick={() => handleAccentChange(preset.hex)}
                    className={`h-8 w-8 rounded-full border-2 transition-transform hover:scale-110 active:scale-[0.98] bg-(--preset-color) ${accentPreset === preset.hex ? 'border-white scale-110' : 'border-transparent'}`}
                    style={{ '--preset-color': preset.hex } as React.CSSProperties}
                    title={preset.name}
                  />
                ))}
                <button
                  onClick={() => handleAccentChange('custom')}
                  className={`h-8 px-3 rounded-full border-2 text-[10px] font-bold uppercase transition-all active:scale-[0.98] ${isCustomColor ? 'border-white bg-white text-black' : 'border-(--glass-border) text-(--text-secondary)'}`}
                >
                  Custom
                </button>
              </div>
              {isCustomColor && (
                <div className="flex items-center gap-3 pt-2 animate-fade-slide">
                  <input
                    type="color"
                    value={accentCustom || '#ad46ff'}
                    onChange={(e) => handleCustomColorChange(e.target.value)}
                    className="h-10 w-20 cursor-pointer rounded bg-transparent p-0"
                    aria-label="Custom accent color"
                    title="Custom accent color"
                  />
                  <span className="text-xs font-mono text-(--text-muted) uppercase">{accentCustom}</span>
                </div>
              )}
            </div>

            {/* Accent Glow Background */}
            <div className="flex items-center justify-between pt-2 border-t border-white/5">
              <label className="text-sm text-(--text-secondary)">Accent Glow Background</label>
              <Toggle
                checked={accentBgTint}
                onChange={(checked) => {
                  setAccentBgTint(checked)
                  window.dispatchEvent(new CustomEvent('bg-tint-change', { detail: checked }))
                }}
                aria-label="Toggle accent glow background"
              />
            </div>

            {/* Focus Active Title */}
            <div className="flex items-center justify-between pt-2 border-t border-white/5">
              <label className="text-sm text-(--text-secondary)">Focus active title</label>
              <Toggle checked={focusActiveTitle} onChange={setFocusActiveTitle} aria-label="Focus active title" />
            </div>

            {/* UI Scale */}
            <div className="space-y-3 pt-2 border-t border-white/5">
              <label className="text-sm text-(--text-secondary)">UI Scale</label>
              <div className="flex rounded-xl overflow-hidden border border-(--glass-border)">
                {ZOOM_PRESETS.map(preset => (
                  <button
                    key={preset.factor}
                    onClick={() => {
                      setZoomFactor(preset.factor)
                      window.electronAPI.setZoom(preset.factor)
                    }}
                    className={`flex-1 cursor-pointer py-2 text-xs font-bold tracking-wide transition-all active:scale-[0.98] ${
                      zoomFactor === preset.factor
                        ? 'bg-(--accent) text-white shadow-[0_0_15px_-5px_var(--accent-glow)]'
                        : 'bg-(--glass-bg-elevated) text-(--text-secondary) hover:bg-(--glass-border) hover:text-(--text-primary)'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Behavior Section */}
        <section className="space-y-4">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-(--accent) px-1">Behavior</h3>
          <div className="glass-surface rounded-2xl flex flex-col pt-1">
            <div className="flex items-center justify-between px-4 py-4 border-b border-white/5">
              <div className="flex flex-col">
                <span className="text-sm font-medium text-(--text-primary)">Start with Windows</span>
                <span className="text-[10px] text-(--text-muted)">Launch SimLauncher automatically at login</span>
              </div>
              <Toggle
                checked={startWithWindows}
                onChange={(checked) => {
                  setStartWithWindows(checked)
                  window.electronAPI.setLoginItem(checked)
                }}
                aria-label="Start with Windows"
              />
            </div>
            <div className="flex items-center justify-between px-4 py-4 border-b border-white/5">
              <div className="flex flex-col">
                <span className="text-sm font-medium text-(--text-primary)">Start minimized</span>
                <span className="text-[10px] text-(--text-muted)">Start hidden in the system tray</span>
              </div>
              <Toggle checked={startMinimized} onChange={setStartMinimized} aria-label="Start minimized" />
            </div>
            <div className="flex items-center justify-between px-4 py-4 border-b border-white/5">
              <div className="flex flex-col">
                <span className="text-sm font-medium text-(--text-primary)">Minimize to tray on close</span>
                <span className="text-[10px] text-(--text-muted)">Keep SimLauncher running when the window is closed</span>
              </div>
              <Toggle checked={minimizeToTray} onChange={setMinimizeToTray} aria-label="Minimize to tray on close" />
            </div>
            <div className="flex flex-col gap-3 px-4 py-4 border-b border-white/5">
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm font-medium text-(--text-primary)">Launch delay between apps</span>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="0"
                    max="5000"
                    step="100"
                    value={launchDelayMs}
                    onChange={(e) => setLaunchDelayMs(normalizeLaunchDelayMs(Number(e.target.value)))}
                    className="glass-recessed w-20 rounded-lg px-2 py-1 text-right text-xs text-(--text-primary) outline-none"
                    aria-label="Launch delay in milliseconds"
                  />
                  <span className="text-xs text-(--text-muted)">ms</span>
                </div>
              </div>
              <input
                type="range"
                min="0"
                max="5000"
                step="100"
                value={Number.isFinite(launchDelayMs) ? launchDelayMs : 1000}
                onChange={(e) => setLaunchDelayMs(normalizeLaunchDelayMs(Number(e.target.value)))}
                className="w-full accent-(--accent)"
                aria-label="Launch delay slider"
              />
            </div>
          </div>
        </section>

        {/* Games Section */}
        <section className="space-y-4">
          <button
            type="button"
            onClick={() => setGamesOpen(v => !v)}
            className="flex w-full cursor-pointer items-center gap-2 px-1"
          >
            <h3 className="flex-1 text-left text-sm font-semibold uppercase tracking-wider text-(--accent)">Games</h3>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
              className={`text-(--text-subtle) transition-transform duration-300 ${gamesOpen ? 'rotate-0' : '-rotate-90'}`}>
              <path d="M3 6l5 5 5-5" />
            </svg>
          </button>
          <div className={`grid transition-all duration-300 ${gamesOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
            <div className="overflow-hidden">
              <div className="glass-surface rounded-2xl flex flex-col pt-1">
                {GAMES.map((g, index) => (
                  <div key={g.key} className={`flex flex-col gap-2 px-5 py-3 ${index !== GAMES.length - 1 ? 'border-b border-white/5' : ''}`}>
                    {/* Game Title Above */}
                    <div className="text-[10px] font-bold uppercase tracking-widest text-(--text-secondary) opacity-80">
                      {g.name}
                    </div>

                    {/* Functional Row */}
                    <div className="flex items-center gap-4">
                      {gameIcons[g.key] ? (
                        <img src={gameIcons[g.key]} alt={g.name} className="w-8 h-8 object-contain drop-shadow-md shrink-0" />
                      ) : (
                        <div className="w-8 h-8 rounded shrink-0 bg-white/5 border border-white/10 flex items-center justify-center">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/30">
                            <rect x="3" y="3" width="18" height="18" rx="2" />
                          </svg>
                        </div>
                      )}

                      <input
                        type="text"
                        value={gamePaths[g.key] || ''}
                        readOnly
                        placeholder="No game path set"
                        className="flex-1 glass-recessed rounded-lg px-3 py-2 text-xs text-(--text-secondary) outline-none font-mono truncate"
                      />
                      
                      <button
                        onClick={() => handleBrowse(g.key, true)}
                        className="cursor-pointer shrink-0 rounded-xl bg-(--glass-bg-elevated) px-4 py-2 text-xs font-semibold text-(--text-primary) hover:bg-(--glass-border) transition-all active:scale-[0.98] hover:text-white"
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

        {/* Apps Section */}
        <section className="space-y-4">
          <button
            type="button"
            onClick={() => setAppsOpen(v => !v)}
            className="flex w-full cursor-pointer items-center gap-2 px-1"
          >
            <h3 className="flex-1 text-left text-sm font-semibold uppercase tracking-wider text-(--accent)">Utility Apps</h3>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
              className={`text-(--text-subtle) transition-transform duration-300 ${appsOpen ? 'rotate-0' : '-rotate-90'}`}>
              <path d="M3 6l5 5 5-5" />
            </svg>
          </button>
          <div className={`grid transition-all duration-300 ${appsOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
            <div className="overflow-hidden">
              <div className="glass-surface rounded-2xl flex flex-col pt-1">
                {UTILITIES.map((u, index) => (
                  <div key={u.key} className={`flex flex-col gap-2 px-5 py-3 ${index !== UTILITIES.length - 1 ? 'border-b border-white/5' : ''}`}>
                    {/* Utility Title Above */}
                    <div className="text-[10px] font-bold uppercase tracking-widest text-(--text-secondary) opacity-80">
                      {u.isCustom ? (
                        <input
                          type="text"
                          value={appNames[u.key] || u.name}
                          onChange={(e) => setAppNames(prev => ({ ...prev, [u.key]: e.target.value }))}
                          className="bg-transparent border-none outline-none text-inherit w-full py-0 font-bold uppercase tracking-widest"
                          placeholder="App Name"
                        />
                      ) : u.name}
                    </div>

                    {/* Functional Row */}
                    <div className="flex items-center gap-4">
                      {appIcons[u.key] && !iconLoadErrors.has(u.key) ? (
                        <img
                          src={appIcons[u.key]}
                          alt="Icon"
                          className="w-8 h-8 object-contain drop-shadow-md shrink-0"
                          onError={() => setIconLoadErrors(prev => new Set([...prev, u.key]))}
                        />
                      ) : (
                        <div
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-(--accent)/30 bg-(--accent)/10 text-[10px] font-black text-(--accent) shadow-[0_0_12px_-7px_var(--accent-glow)]"
                          title={`${appNames[u.key] || u.name} icon fallback`}
                        >
                          {getInitials(appNames[u.key] || u.name)}
                        </div>
                      )}
                      
                      <input
                        type="text"
                        value={appPaths[u.key] || ''}
                        readOnly
                        placeholder="No executable path set"
                        className="flex-1 glass-recessed rounded-lg px-3 py-2 text-xs text-(--text-secondary) outline-none font-mono truncate"
                      />
                      
                      <button
                        onClick={() => handleBrowse(u.key, false)}
                        className="cursor-pointer shrink-0 rounded-xl bg-(--glass-bg-elevated) px-4 py-2 text-xs font-semibold text-(--text-primary) hover:bg-(--glass-border) transition-all active:scale-[0.98] hover:text-white"
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

        {/* Actions */}
        <div className="flex gap-4 pt-4 px-1">
          <button
            onClick={handleSave}
            className="flex-1 cursor-pointer rounded-xl bg-(--accent) py-3 text-sm font-bold text-white transition-all hover:opacity-90 active:scale-[0.98]"
          >
            Save Changes
          </button>
          <button
            onClick={onClose}
            className="flex-1 cursor-pointer rounded-xl bg-(--glass-bg-elevated) py-3 text-sm font-bold text-(--text-primary) transition-colors hover:bg-(--glass-border) active:scale-[0.98]"
          >
            Back to Games
          </button>
        </div>
    </div>
  )
}
