import { useEffect, useState } from 'react'
import { NotifyProvider } from './components/Notify'
import { WindowControls } from './components/WindowControls'
import { UpdateBanner } from './components/UpdateBanner'
import { GameList } from './components/GameList'
import { SettingsView } from './components/SettingsView'


export default function App() {
  const [view, setView] = useState<'games' | 'settings'>('games')
  const [bgTinted, setBgTinted] = useState(false)

  useEffect(() => {
    // One-time migration from localStorage (vanilla app) to electron-store
    async function migrateFromLocalStorage() {
      try {
        const migrated = await window.electronAPI.storeGet('migrated') as boolean
        if (migrated) return

        const appPathsRaw = localStorage.getItem('simLauncherAppPaths')
        const gamePathsRaw = localStorage.getItem('simLauncherGamePaths')
        if (appPathsRaw) await window.electronAPI.storeSet('appPaths', JSON.parse(appPathsRaw))
        if (gamePathsRaw) await window.electronAPI.storeSet('gamePaths', JSON.parse(gamePathsRaw))

        const accentPreset = localStorage.getItem('simLauncherAccentPreset')
        const accentCustom = localStorage.getItem('simLauncherAccentCustom')
        if (accentPreset) await window.electronAPI.storeSet('accentPreset', accentPreset)
        if (accentCustom) await window.electronAPI.storeSet('accentCustom', accentCustom)

        const utilityKeys = ['simhub', 'crewchief', 'tradingpaints', 'garage61', 'secondmonitor', 'customapp1', 'customapp2', 'customapp3', 'customapp4', 'customapp5']
        const appNames: Record<string, string> = {}
        for (const key of utilityKeys) {
          const name = localStorage.getItem(`simLauncherAppName_${key}`)
          if (name) appNames[key] = name
        }
        if (Object.keys(appNames).length > 0) await window.electronAPI.storeSet('appNames', appNames)

        const gameKeys = ['ac', 'acc', 'acevo', 'acrally', 'ams', 'ams2', 'beamng', 'dcsw', 'dirtrally', 'dirtrally2', 'eawrc', 'f124', 'f125', 'iracing', 'lmu', 'pmr', 'raceroom', 'rbr', 'rennsport', 'rf1', 'rf2']
        const profiles: Record<string, unknown> = {}
        for (const key of gameKeys) {
          const raw = localStorage.getItem(`profile_${key}`)
          if (raw) profiles[key] = JSON.parse(raw)
        }
        if (Object.keys(profiles).length > 0) await window.electronAPI.storeSet('profiles', profiles)

        await window.electronAPI.storeSet('migrated', true)
      } catch (err) {
        console.error('Failed to migrate from localStorage', err)
      }
    }
    migrateFromLocalStorage()
  }, [])

  useEffect(() => {
    // Restore saved theme on startup
    async function initTheme() {
      try {
        const preset = await window.electronAPI.storeGet('accentPreset') as string || '#00eaff'
        const custom = await window.electronAPI.storeGet('accentCustom') as string
        const tint = await window.electronAPI.storeGet('accentBgTint') as boolean || false

        setBgTinted(tint)

        const hex = preset === 'custom' ? custom : preset
        if (hex) {
          document.documentElement.style.setProperty('--accent', hex)

          // Re-calculate glows from hex
          const r = parseInt(hex.slice(1, 3), 16)
          const g = parseInt(hex.slice(3, 5), 16)
          const b = parseInt(hex.slice(5, 7), 16)
          document.documentElement.style.setProperty('--accent-glow', `rgba(${r}, ${g}, ${b}, 0.15)`)
          document.documentElement.style.setProperty('--accent-glow-strong', `rgba(${r}, ${g}, ${b}, 0.4)`)
        }
      } catch (err) {
        console.error('Failed to initialize theme', err)
      }
    }
    initTheme()

    // Listen for custom events to update bgTint from SettingsView without reload
    const handleTintChange = (e: CustomEvent) => setBgTinted(e.detail)
    window.addEventListener('bg-tint-change', handleTintChange as EventListener)
    return () => window.removeEventListener('bg-tint-change', handleTintChange as EventListener)
  }, [])

  return (
    <NotifyProvider>
      <div className={`h-screen overflow-hidden relative transition-colors duration-500 ${bgTinted ? 'bg-tinted' : ''}`}>
        <div className="absolute top-0 left-0 w-full z-20 header-glass">
          <WindowControls view={view} onNavigate={setView} />
          <UpdateBanner />
        </div>

        <main className="h-full relative overflow-hidden">
          {/* Games View */}
          <div className={`h-full flex flex-col transition-all duration-300 ${view === 'games' ? 'opacity-100 scale-100' : 'opacity-0 scale-[0.98] pointer-events-none absolute inset-0'}`}>
            <div className="flex-1 overflow-y-auto pt-16 px-4 custom-scrollbar">
              <GameList />
            </div>
          </div>

          {/* Settings View */}
          {view === 'settings' && (
            <div className="absolute inset-0 pt-16 h-full z-10 px-4 pb-4">
              <SettingsView onClose={() => setView('games')} />
            </div>
          )}
        </main>
      </div>
    </NotifyProvider>
  )
}
