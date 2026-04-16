import { useEffect, useState } from 'react'
import { NotifyProvider } from './components/Notify'
import { WindowControls } from './components/WindowControls'
import { UpdateBanner } from './components/UpdateBanner'
import { GameList } from './components/GameList'
import { SettingsView } from './components/SettingsView'

export default function App() {
  const [view, setView] = useState<'games' | 'settings'>('games')

  useEffect(() => {
    // Restore saved theme on startup
    async function initTheme() {
      try {
        const preset = await window.electronAPI.storeGet('accentPreset') as string || '#00eaff'
        const custom = await window.electronAPI.storeGet('accentCustom') as string

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
  }, [])

  return (
    <NotifyProvider>
      <div className="flex flex-col h-screen overflow-hidden">
        <WindowControls />
        <UpdateBanner />

        <main className="flex-1 flex flex-col min-h-0 relative">
          {/* Games View */}
          <div className={`p-[2rem] h-full flex flex-col transition-all duration-300 ${view === 'games' ? 'opacity-100 scale-100' : 'opacity-0 scale-[0.98] pointer-events-none absolute inset-0'}`}>
            <div className="flex items-center justify-between mb-2 px-1">
              <h1 className="text-3xl font-black italic tracking-tighter uppercase text-[var(--text-primary)]">
                Sim<span className="text-[var(--accent)]">Launcher</span>
              </h1>
              <button
                onClick={() => setView('settings')}
                className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full text-xl transition-colors hover:bg-[var(--glass-bg)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] no-drag"
                title="Settings"
              >
                ⚙
              </button>
            </div>
            <div className="flex-1 overflow-y-auto pr-1 -mr-1 custom-scrollbar">
              <GameList key={view} />
            </div>
          </div>

          {/* Settings View */}
          {view === 'settings' && (
            <div className="absolute inset-0 p-[2rem] h-full z-10">
              <SettingsView onClose={() => setView('games')} />
            </div>
          )}
        </main>
      </div>
    </NotifyProvider>
  )
}
