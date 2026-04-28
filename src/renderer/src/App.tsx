import { useEffect, useState } from 'react'
import { NotifyProvider } from './components/Notify'
import { WindowControls } from './components/WindowControls'
import { GameList } from './components/GameList'
import { SettingsView } from './components/SettingsView'
import { ConfirmDialog } from './components/ConfirmDialog'
import { getSettings } from './lib/store'
import { getUpdateInfo, onUpdateAvailable, setZoom } from './lib/electron'
import { DEFAULT_ACCENT_COLOR } from './lib/config'
import { applyAccentTheme, applyThemeMode, normalizeThemeMode } from './lib/theme'
import { runStartupMigrations } from './lib/migrations'

export default function App() {
  const [view, setView] = useState<'games' | 'settings'>('games')
  const [bgTinted, setBgTinted] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<{ version: string } | null>(null)
  const [showImportWarning, setShowImportWarning] = useState(false)
  const [settingsDirty, setSettingsDirty] = useState(false)
  const [pendingView, setPendingView] = useState<'games' | 'settings' | null>(null)
  const [saveRequested, setSaveRequested] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    runStartupMigrations()
  }, [])

  const syncThemeFromStore = async () => {
    try {
      const settings = await getSettings()
      const preset = settings.accentPreset || DEFAULT_ACCENT_COLOR
      const custom = settings.accentCustom
      const tint = settings.accentBgTint || false
      const themeMode = normalizeThemeMode(settings.themeMode)

      setBgTinted(tint)
      applyThemeMode(themeMode)

      const hex = preset === 'custom' ? custom : preset
      if (hex) {
        applyAccentTheme(hex)
      }

      if (Number.isFinite(settings.zoomFactor)) {
        setZoom(settings.zoomFactor)
      }
    } catch (err) {
      console.error('Failed to sync theme', err)
    }
  }

  useEffect(() => {
    syncThemeFromStore()

    // Listen for custom events to update bgTint from SettingsView without reload
    const handleTintChange = (e: CustomEvent) => setBgTinted(e.detail)
    window.addEventListener('bg-tint-change', handleTintChange as EventListener)

    const applyUpdateInfo = (info: { version?: string } | null) => {
      if (info?.version) setUpdateInfo({ version: info.version })
    }

    // Listen for auto-updates, then hydrate any update result that arrived before React mounted.
    const unsubscribe = onUpdateAvailable(applyUpdateInfo)
    let cancelled = false
    getUpdateInfo()
      .then((info) => {
        if (!cancelled) applyUpdateInfo(info)
      })
      .catch((err) => {
        console.error('Failed to load update info', err)
      })

    return () => {
      cancelled = true
      window.removeEventListener('bg-tint-change', handleTintChange as EventListener)
      unsubscribe()
    }
  }, [])

  const handleNavigate = (nextView: 'games' | 'settings') => {
    if (view === nextView) return

    if (view === 'settings' && settingsDirty) {
      setPendingView(nextView)
      return
    }
    setView(nextView)
  }

  const handleConfirmDiscard = () => {
    setSettingsDirty(false)
    syncThemeFromStore()
    if (pendingView) {
      setView(pendingView)
      setPendingView(null)
    }
  }

  const handleConfirmCancel = () => {
    setPendingView(null)
    setSaveRequested(false)
  }

  const handleConfirmSave = () => {
    setSaveRequested(true)
  }

  const handleConfigImported = () => {
    syncThemeFromStore()
    setRefreshKey((k) => k + 1)
    setShowImportWarning(true)
  }

  return (
    <NotifyProvider>
      <div
        className={`h-screen overflow-hidden relative transition-colors duration-500 ${bgTinted ? 'bg-tinted' : ''}`}
      >
        <div className="absolute top-0 left-0 w-full z-20 header-glass">
          <WindowControls view={view} onNavigate={handleNavigate} updateInfo={updateInfo} />
        </div>

        {showImportWarning && (
          <div className="absolute left-4 right-4 top-16 z-30 animate-fade-slide">
            <div className="glass-surface mx-auto flex max-w-3xl items-center gap-3 rounded-2xl border border-(--warning-border) px-4 py-3 text-xs font-medium text-(--warning-text) shadow-[0_12px_30px_#00000040] [--glass-surface-fill:var(--warning-surface)]">
              <svg
                width="17"
                height="17"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="shrink-0"
              >
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
                <path d="M12 9v4" />
                <path d="M12 17h.01" />
              </svg>
              <span className="min-w-0 flex-1">
                Config imported. Executable paths from your previous device may need to be updated.
              </span>
              <button
                type="button"
                onClick={() => setShowImportWarning(false)}
                className="icon-action flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-lg"
                aria-label="Dismiss import warning"
                title="Dismiss"
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                >
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </div>
          </div>
        )}

        <main className="h-full relative overflow-hidden">
          {/* Games View */}
          <div
            className={`h-full flex flex-col transition-all duration-300 ${view === 'games' ? 'opacity-100 scale-100' : 'opacity-0 scale-[0.98] pointer-events-none absolute inset-0'}`}
          >
            <div className="flex-1 overflow-y-auto pt-16 px-4 custom-scrollbar">
              <GameList key={refreshKey} onNavigate={handleNavigate} />
            </div>
          </div>

          {/* Settings View */}
          {view === 'settings' && (
            <div className="absolute inset-0 z-10 h-full flex flex-col">
              <div className="flex-1 overflow-y-auto pt-16 px-4 custom-scrollbar">
                <SettingsView
                  onClose={() => handleNavigate('games')}
                  updateInfo={updateInfo}
                  onDirtyChange={setSettingsDirty}
                  shouldSaveTrigger={saveRequested}
                  onConfigImported={handleConfigImported}
                  onSaved={() => {
                    setSaveRequested(false)
                    setRefreshKey((k) => k + 1)
                    if (pendingView) {
                      setView(pendingView)
                      setPendingView(null)
                    }
                  }}
                />
              </div>
            </div>
          )}
        </main>

        <ConfirmDialog
          isOpen={pendingView !== null}
          title="Unsaved Changes"
          message="You have unsaved changes in Settings. Do you want to save them before leaving?"
          onSave={handleConfirmSave}
          onDiscard={handleConfirmDiscard}
          onCancel={handleConfirmCancel}
        />
      </div>
    </NotifyProvider>
  )
}
