import { useEffect, useState } from 'react'
import { UTILITIES, GAMES } from '../lib/config'
import { useNotify } from './Notify'
import { Toggle } from './Toggle'


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
  const [killOnClose, setKillOnClose] = useState<boolean>(false)
  const [focusActiveTitle, setFocusActiveTitle] = useState<boolean>(true)
  const [launchDelayMs, setLaunchDelayMs] = useState<number>(1000)

  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [updateStatus, setUpdateStatus] = useState<string | null>(null)

  const [isCustomColor, setIsCustomColor] = useState(false)
  const [appsOpen, setAppsOpen] = useState(false)
  const [gamesOpen, setGamesOpen] = useState(false)

  // Cache for file icons
  const [appIcons, setAppIcons] = useState<Record<string, string>>({})
  const [gameIcons, setGameIcons] = useState<Record<string, string>>({})

  useEffect(() => {
    async function loadSettings() {
      const savedAppPaths = (await window.electronAPI.storeGet('appPaths')) as Record<string, string> || {}
      const savedAppNames = (await window.electronAPI.storeGet('appNames')) as Record<string, string> || {}
      const savedGamePaths = (await window.electronAPI.storeGet('gamePaths')) as Record<string, string> || {}
      const savedAccentPreset = (await window.electronAPI.storeGet('accentPreset')) as string || '#00eaff'
      const savedAccentCustom = (await window.electronAPI.storeGet('accentCustom')) as string || ''
      const savedBgTint = (await window.electronAPI.storeGet('accentBgTint')) as boolean || false
      const savedKillOnClose = (await window.electronAPI.storeGet('killOnClose')) as boolean || false
      const savedFocusActiveTitle = await window.electronAPI.storeGet('focusActiveTitle')
      const savedLaunchDelayMs = (await window.electronAPI.storeGet('launchDelayMs')) as number

      setAppPaths(savedAppPaths)
      setAppNames(savedAppNames)
      setGamePaths(savedGamePaths)
      setAccentPreset(savedAccentPreset)
      setAccentCustom(savedAccentCustom)
      setAccentBgTint(savedBgTint)
      setKillOnClose(savedKillOnClose)
      setFocusActiveTitle(savedFocusActiveTitle !== false)
      setLaunchDelayMs(normalizeLaunchDelayMs(savedLaunchDelayMs))
      
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

    const unsubscribe = window.electronAPI.onUpdateNotAvailable(() => {
      setCheckingUpdate(false)
      setUpdateStatus('up-to-date')
      setTimeout(() => setUpdateStatus(null), 3000)
    })

    return () => unsubscribe()
  }, [])

  const handleManualCheck = async () => {
    setCheckingUpdate(true)
    setUpdateStatus(null)
    await window.electronAPI.checkForUpdates()
  }

  const handleInstallUpdate = () => {
    if (window.confirm(`Restart SimLauncher to install version ${updateInfo?.version}?`)) {
      window.electronAPI.installUpdate()
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
      await window.electronAPI.storeSet('killOnClose', killOnClose)
      await window.electronAPI.storeSet('focusActiveTitle', focusActiveTitle)
      await window.electronAPI.storeSet('launchDelayMs', normalizedLaunchDelayMs)
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
            
            <div className="flex flex-col gap-2">
              {updateInfo ? (
                <button
                  onClick={handleInstallUpdate}
                  className="w-full cursor-pointer rounded-xl bg-(--accent) py-2.5 text-xs font-bold text-white transition-all hover:opacity-90 active:scale-[0.98] shadow-[0_0_15px_-5px_var(--accent-glow)]"
                >
                  Restart to Update (v{updateInfo.version})
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
                    className={`h-8 w-8 rounded-full border-2 transition-transform hover:scale-110 ${accentPreset === preset.hex ? 'border-white scale-110' : 'border-transparent'}`}
                    style={{ backgroundColor: preset.hex }}
                    title={preset.name}
                  />
                ))}
                <button
                  onClick={() => handleAccentChange('custom')}
                  className={`h-8 px-3 rounded-full border-2 text-[10px] font-bold uppercase transition-all ${isCustomColor ? 'border-white bg-white text-black' : 'border-(--glass-border) text-(--text-secondary)'}`}
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
                  />
                  <span className="text-xs font-mono text-(--text-muted) uppercase">{accentCustom}</span>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Behavior Section */}
        <section className="space-y-4">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-(--accent) px-1">Behavior</h3>
          <div className="glass-surface rounded-2xl flex flex-col pt-1">
            <div className="flex items-center justify-between px-4 py-4 border-b border-white/5">
              <span className="text-sm font-medium text-(--text-primary)">Close launched apps when SimLauncher closes</span>
              <Toggle checked={killOnClose} onChange={setKillOnClose} aria-label="Close apps on exit" />
            </div>
            <div className="flex items-center justify-between px-4 py-4 border-b border-white/5">
              <span className="text-sm font-medium text-(--text-primary)">Focus active title</span>
              <Toggle checked={focusActiveTitle} onChange={setFocusActiveTitle} aria-label="Focus active title" />
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
            <div className="flex items-center justify-between px-4 py-4">
              <span className="text-sm font-medium text-(--text-primary)">Accent Glow Background</span>
              <Toggle 
                checked={accentBgTint} 
                onChange={(checked) => {
                  setAccentBgTint(checked)
                  window.dispatchEvent(new CustomEvent('bg-tint-change', { detail: checked }))
                }} 
                aria-label="Toggle accent glow background"
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
                        className="cursor-pointer shrink-0 rounded-xl bg-(--glass-bg-elevated) px-4 py-2 text-xs font-semibold text-(--text-primary) hover:bg-(--glass-border) transition-colors hover:text-white"
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
                      {appIcons[u.key] ? (
                        <img src={appIcons[u.key]} alt="Icon" className="w-8 h-8 object-contain drop-shadow-md shrink-0" />
                      ) : (
                        <div className="w-8 h-8 rounded shrink-0 bg-white/5 border border-white/10 flex items-center justify-center">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/30">
                            <rect x="3" y="3" width="18" height="18" rx="2" />
                          </svg>
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
                        className="cursor-pointer shrink-0 rounded-xl bg-(--glass-bg-elevated) px-4 py-2 text-xs font-semibold text-(--text-primary) hover:bg-(--glass-border) transition-colors hover:text-white"
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
