import { useEffect, useState } from 'react'
import { UTILITIES, GAMES } from '../lib/config'
import { useNotify } from './Notify'

const ACCENT_PRESETS = [
  { name: 'Electric Aqua', hex: '#00eaff' },
  { name: 'SimHub Blue', hex: '#3498db' },
  { name: 'Racing Green', hex: '#00ff88' },
  { name: 'CrewChief Yellow', hex: '#f1c40f' },
  { name: 'Cyber Purple', hex: '#6e5bfb' },
  { name: 'Milano Red', hex: '#ff2233' },
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
  const [killOnClose, setKillOnClose] = useState<boolean>(false)

  const [isCustomColor, setIsCustomColor] = useState(false)

  useEffect(() => {
    async function loadSettings() {
      const savedAppPaths = (await window.electronAPI.storeGet('appPaths')) as Record<string, string> || {}
      const savedAppNames = (await window.electronAPI.storeGet('appNames')) as Record<string, string> || {}
      const savedGamePaths = (await window.electronAPI.storeGet('gamePaths')) as Record<string, string> || {}
      const savedAccentPreset = (await window.electronAPI.storeGet('accentPreset')) as string || '#00eaff'
      const savedAccentCustom = (await window.electronAPI.storeGet('accentCustom')) as string || ''
      const savedKillOnClose = (await window.electronAPI.storeGet('killOnClose')) as boolean || false

      setAppPaths(savedAppPaths)
      setAppNames(savedAppNames)
      setGamePaths(savedGamePaths)
      setAccentPreset(savedAccentPreset)
      setAccentCustom(savedAccentCustom)
      setKillOnClose(savedKillOnClose)
      
      setIsCustomColor(savedAccentPreset === 'custom')
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
      {/* Header */}
      <div className="flex items-center justify-between mb-6 px-1">
        <h2 className="text-2xl font-bold text-[var(--text-primary)]">Settings</h2>
        <button
          onClick={onClose}
          className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full text-2xl leading-none text-[var(--text-subtle)] transition-colors hover:bg-[var(--glass-bg)] hover:text-[var(--text-primary)]"
        >
          ×
        </button>
      </div>

      <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-8 pb-10">
        {/* Apps Section */}
        <section className="space-y-4">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-[var(--accent)] px-1">Utility Apps</h3>
          <div className="grid grid-cols-1 gap-3">
            {UTILITIES.map(u => (
              <div key={u.key} className="glass-surface p-4 rounded-2xl flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-[var(--text-secondary)]">
                    {u.isCustom ? (
                      <input
                        type="text"
                        value={appNames[u.key] || u.name}
                        onChange={(e) => setAppNames(prev => ({ ...prev, [u.key]: e.target.value }))}
                        className="bg-transparent border-b border-transparent focus:border-[var(--accent)] outline-none text-[var(--text-primary)]"
                        placeholder="App Name"
                      />
                    ) : u.name}
                  </span>
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={appPaths[u.key] || ''}
                    readOnly
                    placeholder="No path set"
                    className="flex-1 rounded-xl bg-[var(--glass-bg)] px-4 py-2.5 text-sm text-[var(--text-primary)] outline-none border border-transparent focus:border-[var(--glass-border)]"
                  />
                  <button
                    onClick={() => handleBrowse(u.key, false)}
                    className="cursor-pointer rounded-xl bg-[var(--glass-bg-elevated)] px-4 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--glass-border)] transition-colors"
                  >
                    Browse
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Games Section */}
        <section className="space-y-4">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-[var(--accent)] px-1">Games</h3>
          <div className="grid grid-cols-1 gap-3">
            {GAMES.map(g => (
              <div key={g.key} className="glass-surface p-4 rounded-2xl space-y-3">
                <span className="text-sm font-medium text-[var(--text-secondary)]">{g.name}</span>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={gamePaths[g.key] || ''}
                    readOnly
                    placeholder="No path set"
                    className="flex-1 rounded-xl bg-[var(--glass-bg)] px-4 py-2.5 text-sm text-[var(--text-primary)] outline-none border border-transparent focus:border-[var(--glass-border)]"
                  />
                  <button
                    onClick={() => handleBrowse(g.key, true)}
                    className="cursor-pointer rounded-xl bg-[var(--glass-bg-elevated)] px-4 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--glass-border)] transition-colors"
                  >
                    Browse
                  </button>
                </div>
              </div>
            ))}
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
          <div className="glass-surface p-5 rounded-2xl">
            <label className="flex cursor-pointer items-center justify-between">
              <span className="text-sm text-[var(--text-primary)]">Kill launched apps when SimLauncher closes</span>
              <div className="relative inline-flex items-center">
                <input
                  type="checkbox"
                  checked={killOnClose}
                  onChange={(e) => setKillOnClose(e.target.checked)}
                  className="peer sr-only"
                />
                <div className="h-6 w-11 rounded-full bg-[var(--glass-bg-elevated)] transition-colors peer-checked:bg-[var(--accent)]"></div>
                <div className="absolute left-1 top-1 h-4 w-4 rounded-full bg-white transition-transform peer-checked:translate-x-5"></div>
              </div>
            </label>
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
