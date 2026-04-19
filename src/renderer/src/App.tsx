import { useEffect, useState } from 'react'
import { NotifyProvider } from './components/Notify'
import { WindowControls } from './components/WindowControls'
import { GameList } from './components/GameList'
import { SettingsView } from './components/SettingsView'
import {
  DEFAULT_ACCENT_COLOR,
  DEFAULT_PROFILE_ID,
  createDefaultProfile,
  getHighestCustomSlot,
  getUtilities,
  migrateProfileToUtilityOrder,
  type GameProfileSet,
  type GameProfile
} from './lib/config'

const CONFIG_IMPORT_WARNING_KEY = 'simlauncher-config-import-warning'

export default function App() {
  const [view, setView] = useState<'games' | 'settings'>('games')
  const [bgTinted, setBgTinted] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<{ version: string } | null>(null)
  const [showImportWarning, setShowImportWarning] = useState(false)

  useEffect(() => {
    if (window.sessionStorage.getItem(CONFIG_IMPORT_WARNING_KEY) === '1') {
      window.sessionStorage.removeItem(CONFIG_IMPORT_WARNING_KEY)
      setShowImportWarning(true)
    }
  }, [])

  useEffect(() => {
    // One-time migration from localStorage (vanilla app) to electron-store
    async function migrateFromLocalStorage() {
      try {
        const migrated = await window.electronAPI.storeGet('migrated') as boolean
        if (migrated) return

        const appPathsRaw = localStorage.getItem('simLauncherAppPaths')
        const gamePathsRaw = localStorage.getItem('simLauncherGamePaths')
        let appPaths: Record<string, unknown> = {}
        if (appPathsRaw) {
          appPaths = JSON.parse(appPathsRaw)
          await window.electronAPI.storeSet('appPaths', appPaths)
        }
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
        const profiles: Record<string, GameProfile> = {}
        for (const key of gameKeys) {
          const raw = localStorage.getItem(`profile_${key}`)
          if (raw) profiles[key] = JSON.parse(raw)
        }
        const migratedCustomSlots = getHighestCustomSlot(appPaths, appNames, ...Object.values(profiles))
        const utilities = getUtilities(migratedCustomSlots)
        const migratedProfiles: Record<string, GameProfileSet> = Object.fromEntries(
          Object.entries(profiles).map(([gameKey, profile]) => [
            gameKey,
            {
              activeProfileId: DEFAULT_PROFILE_ID,
              profiles: [createDefaultProfile(migrateProfileToUtilityOrder(profile, utilities))]
            }
          ])
        ) as Record<string, GameProfileSet>

        if (migratedCustomSlots > 1) await window.electronAPI.storeSet('customSlots', migratedCustomSlots)
        if (Object.keys(migratedProfiles).length > 0) await window.electronAPI.storeSet('profiles', migratedProfiles)
        await window.electronAPI.storeSet('profileUtilityOrderMigrated', true)

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
        const preset = await window.electronAPI.storeGet('accentPreset') as string || DEFAULT_ACCENT_COLOR
        const custom = await window.electronAPI.storeGet('accentCustom') as string
        const tint = await window.electronAPI.storeGet('accentBgTint') as boolean || false

        setBgTinted(tint)

        const hex = preset === 'custom' ? custom : preset
        if (hex) {
          document.documentElement.style.setProperty('--accent', hex)

          // Re-calculate glow from hex
          const r = parseInt(hex.slice(1, 3), 16)
          const g = parseInt(hex.slice(3, 5), 16)
          const b = parseInt(hex.slice(5, 7), 16)
          document.documentElement.style.setProperty('--accent-glow', `rgba(${r}, ${g}, ${b}, 0.24)`)
        }
      } catch (err) {
        console.error('Failed to initialize theme', err)
      }
    }
    initTheme()

    // Listen for custom events to update bgTint from SettingsView without reload
    const handleTintChange = (e: CustomEvent) => setBgTinted(e.detail)
    window.addEventListener('bg-tint-change', handleTintChange as EventListener)

    // Listen for auto-updates
    const unsubscribe = window.electronAPI.onUpdateAvailable((info: any) => {
      if (info?.version) setUpdateInfo({ version: info.version })
    })

    return () => {
      window.removeEventListener('bg-tint-change', handleTintChange as EventListener)
      unsubscribe()
    }
  }, [])

  return (
    <NotifyProvider>
      <div className={`h-screen overflow-hidden relative transition-colors duration-500 ${bgTinted ? 'bg-tinted' : ''}`}>
        <div className="absolute top-0 left-0 w-full z-20 header-glass">
          <WindowControls view={view} onNavigate={setView} updateInfo={updateInfo} />
        </div>

        {showImportWarning && (
          <div className="absolute left-4 right-4 top-16 z-30 animate-fade-slide">
            <div className="mx-auto flex max-w-3xl items-center gap-3 rounded-2xl border border-(--warning-border) bg-(--warning-surface) px-4 py-3 text-xs font-medium text-(--warning-text) shadow-[0_12px_30px_#00000040]">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
                <path d="M12 9v4" />
                <path d="M12 17h.01" />
              </svg>
              <span className="min-w-0 flex-1">Config imported. Executable paths from your previous device may need to be updated.</span>
              <button
                type="button"
                onClick={() => setShowImportWarning(false)}
                className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-(--warning-text) transition-colors hover:bg-white/10 active:scale-[0.98]"
                aria-label="Dismiss import warning"
                title="Dismiss"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </div>
          </div>
        )}

        <main className="h-full relative overflow-hidden">
          {/* Games View */}
          <div className={`h-full flex flex-col transition-all duration-300 ${view === 'games' ? 'opacity-100 scale-100' : 'opacity-0 scale-[0.98] pointer-events-none absolute inset-0'}`}>
            <div className="flex-1 overflow-y-auto pt-16 px-4 custom-scrollbar">
              <GameList />
            </div>
          </div>

          {/* Settings View */}
          {view === 'settings' && (
            <div className="absolute inset-0 z-10 h-full flex flex-col">
              <div className="flex-1 overflow-y-auto pt-16 px-4 custom-scrollbar">
                <SettingsView onClose={() => setView('games')} updateInfo={updateInfo} />
              </div>
            </div>
          )}
        </main>
      </div>
    </NotifyProvider>
  )
}
