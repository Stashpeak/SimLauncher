import { useEffect, useState } from 'react'
import { UTILITIES, GAMES } from '../lib/config'
import { useNotify } from './Notify'


const ACCENT_PRESETS = [
  { name: 'Electric Aqua', hex: '#00eaff' },
  { name: 'Sky Blue', hex: '#4d9fff' },
  { name: 'Racing Green', hex: '#00c853' },
  { name: 'Sunset Orange', hex: '#ff6b35' },
  { name: 'Cyber Purple', hex: '#c850c0' },
  { name: 'Caution Yellow', hex: '#ffd600' },
]

export function SettingsView({ onClose }: { onClose: () => void }) {
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

  const [isCustomColor, setIsCustomColor] = useState(false)
  const [appsOpen, setAppsOpen] = useState(true)
  const [gamesOpen, setGamesOpen] = useState(true)

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

      setAppPaths(savedAppPaths)
      setAppNames(savedAppNames)
      setGamePaths(savedGamePaths)
      setAccentPreset(savedAccentPreset)
      setAccentCustom(savedAccentCustom)
      setAccentBgTint(savedBgTint)
      setKillOnClose(savedKillOnClose)
      
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

  const handleSave = async () => {
    try {
      await window.electronAPI.storeSet('appPaths', appPaths)
      await window.electronAPI.storeSet('appNames', appNames)
      await window.electronAPI.storeSet('gamePaths', gamePaths)
      await window.electronAPI.storeSet('accentPreset', accentPreset)
      await window.electronAPI.storeSet('accentCustom', accentCustom)
      await window.electronAPI.storeSet('accentBgTint', accentBgTint)
      await window.electronAPI.storeSet('killOnClose', killOnClose)

      notify('Settings saved!', 'success', 2500)
    } catch (err) {
      notify('Failed to save settings', 'error')
      console.error(err)
    }
  }

  if (loading) return null

  return (
    <div className="animate-fade-slide flex flex-col h-full overflow-hidden">


      <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-8 pb-10">
        {/* Apps Section */}
        <section className="space-y-4">
          <button
            type="button"
            onClick={() => setAppsOpen(v => !v)}
            className="flex w-full cursor-pointer items-center gap-2 px-1"
          >
            <h3 className="flex-1 text-left text-sm font-semibold uppercase tracking-wider text-[var(--accent)]">Utility Apps</h3>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
              className={`text-[var(--text-subtle)] transition-transform duration-300 ${appsOpen ? 'rotate-0' : '-rotate-90'}`}>
              <path d="M3 6l5 5 5-5" />
            </svg>
          </button>
          <div className={`grid transition-all duration-300 ${appsOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
            <div className="overflow-hidden">
              <div className="glass-surface rounded-2xl flex flex-col pt-1">
                {UTILITIES.map((u, index) => (
                  <div key={u.key} className={`flex flex-col gap-2 px-5 py-3 ${index !== UTILITIES.length - 1 ? 'border-b border-white/5' : ''}`}>
                    {/* Utility Title Above */}
                    <div className="text-[10px] font-bold uppercase tracking-widest text-[var(--accent)] opacity-60">
                      {u.isCustom ? (
                        <input
                          type="text"
                          value={appNames[u.key] || u.name}
                          onChange={(e) => setAppNames(prev => ({ ...prev, [u.key]: e.target.value }))}
                          className="bg-transparent border-b border-transparent focus:border-[var(--accent)] outline-none text-[var(--text-primary)] w-full py-0"
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
                        className="flex-1 glass-recessed rounded-lg px-3 py-2 text-xs text-[var(--text-secondary)] outline-none font-mono truncate"
                      />
                      
                      <button
                        onClick={() => handleBrowse(u.key, false)}
                        className="cursor-pointer shrink-0 rounded-xl bg-[var(--glass-bg-elevated)] px-4 py-2 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--glass-border)] transition-colors hover:text-white"
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

        {/* Games Section */}
        <section className="space-y-4">
          <button
            type="button"
            onClick={() => setGamesOpen(v => !v)}
            className="flex w-full cursor-pointer items-center gap-2 px-1"
          >
            <h3 className="flex-1 text-left text-sm font-semibold uppercase tracking-wider text-[var(--accent)]">Games</h3>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
              className={`text-[var(--text-subtle)] transition-transform duration-300 ${gamesOpen ? 'rotate-0' : '-rotate-90'}`}>
              <path d="M3 6l5 5 5-5" />
            </svg>
          </button>
          <div className={`grid transition-all duration-300 ${gamesOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
            <div className="overflow-hidden">
              <div className="glass-surface rounded-2xl flex flex-col pt-1">
                {GAMES.map((g, index) => (
                  <div key={g.key} className={`flex flex-col gap-2 px-5 py-3 ${index !== GAMES.length - 1 ? 'border-b border-white/5' : ''}`}>
                    {/* Game Title Above */}
                    <div className="text-[10px] font-bold uppercase tracking-widest text-[var(--accent)] opacity-60">
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
                        className="flex-1 glass-recessed rounded-lg px-3 py-2 text-xs text-[var(--text-secondary)] outline-none font-mono truncate"
                      />
                      
                      <button
                        onClick={() => handleBrowse(g.key, true)}
                        className="cursor-pointer shrink-0 rounded-xl bg-[var(--glass-bg-elevated)] px-4 py-2 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--glass-border)] transition-colors hover:text-white"
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

        {/* Appearance Section */}
        <section className="space-y-4">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-[var(--accent)] px-1">Appearance</h3>
          <div className="glass-surface p-5 rounded-2xl space-y-6">
            <div className="space-y-3">
              <label className="text-sm text-[var(--text-secondary)]">Accent Color</label>
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
                  className={`h-8 px-3 rounded-full border-2 text-[10px] font-bold uppercase transition-all ${isCustomColor ? 'border-white bg-white text-black' : 'border-[var(--glass-border)] text-[var(--text-secondary)]'}`}
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
                  <span className="text-xs font-mono text-[var(--text-muted)] uppercase">{accentCustom}</span>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Behavior Section */}
        <section className="space-y-4">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-[var(--accent)] px-1">Behavior</h3>
          <div className="glass-surface rounded-2xl flex flex-col pt-1">
            <div className="flex items-center justify-between px-4 py-4 border-b border-white/5">
              <span className="text-sm font-medium text-[var(--text-primary)]">Kill launched apps when SimLauncher closes</span>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={killOnClose}
                  onChange={(e) => setKillOnClose(e.target.checked)}
                  className="peer sr-only"
                />
                <div className="h-6 w-11 rounded-full bg-white/10 shadow-[inset_0_2px_4px_rgba(0,0,0,0.4)] peer-checked:bg-[var(--accent)] transition-colors duration-300 relative after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full peer-checked:after:border-white"></div>
              </label>
            </div>
            <div className="flex items-center justify-between px-4 py-4">
              <span className="text-sm font-medium text-[var(--text-primary)]">Accent Glow Background</span>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={accentBgTint}
                  onChange={(e) => {
                    setAccentBgTint(e.target.checked)
                    window.dispatchEvent(new CustomEvent('bg-tint-change', { detail: e.target.checked }))
                  }}
                  className="peer sr-only"
                />
                <div className="h-6 w-11 rounded-full bg-white/10 shadow-[inset_0_2px_4px_rgba(0,0,0,0.4)] peer-checked:bg-[var(--accent)] transition-colors duration-300 relative after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full peer-checked:after:border-white"></div>
              </label>
            </div>
          </div>
        </section>

        {/* Actions */}
        <div className="flex gap-4 pt-4 px-1">
          <button
            onClick={handleSave}
            className="flex-1 cursor-pointer rounded-xl bg-[var(--accent)] py-3 text-sm font-bold text-white transition-all hover:opacity-90 active:scale-[0.98]"
          >
            Save Changes
          </button>
          <button
            onClick={onClose}
            className="flex-1 cursor-pointer rounded-xl bg-[var(--glass-bg-elevated)] py-3 text-sm font-bold text-[var(--text-primary)] transition-colors hover:bg-[var(--glass-border)] active:scale-[0.98]"
          >
            Back to Games
          </button>
        </div>
      </div>
    </div>
  )
}
