import { useEffect, useState } from 'react'
import { NotifyProvider } from './components/Notify'
import { WindowControls } from './components/WindowControls'
import { GameList } from './components/GameList'
import { SettingsView } from './components/SettingsView'
import { ConfirmDialog } from './components/ConfirmDialog'
import { WarningTriangleIcon, CloseIcon } from './components/icons'
import { getUpdateInfo, onUpdateAvailable } from './lib/electron'
import { runStartupMigrations } from './lib/migrations'
import { useTheme } from './contexts/ThemeContext'

export default function App() {
  const [view, setView] = useState<'games' | 'settings'>('games')
  const { accentBgTint, syncThemeFromStore } = useTheme()
  const [updateInfo, setUpdateInfo] = useState<{ version: string } | null>(null)
  const [showImportWarning, setShowImportWarning] = useState(false)
  const [settingsDirty, setSettingsDirty] = useState(false)
  const [pendingView, setPendingView] = useState<'games' | 'settings' | null>(null)
  const [saveRequested, setSaveRequested] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    runStartupMigrations()
  }, [])

  useEffect(() => {
    syncThemeFromStore().catch((err) => {
      console.error('Failed to sync theme', err)
    })

    const applyUpdateInfo = (info: { version?: string } | null) => {
      if (info?.version) setUpdateInfo({ version: info.version })
    }

    // Listen for auto-updates, then hydrate any update result that arrived before React mounted.
    const unsubscribe = onUpdateAvailable(applyUpdateInfo)
    let cancelled = false
    getUpdateInfo()
      .then((info: { version?: string } | null) => {
        if (!cancelled) applyUpdateInfo(info)
      })
      .catch((err: unknown) => {
        console.error('Failed to load update info', err)
      })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [syncThemeFromStore])

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
        className={`h-screen overflow-hidden relative transition-colors duration-500 ${accentBgTint ? 'bg-tinted' : ''}`}
      >
        <div className="absolute top-0 left-0 w-full z-20 header-glass">
          <WindowControls view={view} onNavigate={handleNavigate} updateInfo={updateInfo} />
        </div>

        {showImportWarning && (
          <div className="glass-surface !absolute left-4 right-4 top-16 z-30 mx-auto flex max-w-3xl animate-fade-slide items-center gap-3 rounded-2xl border border-(--warning-border) px-4 py-3 text-xs font-medium text-(--warning-text) shadow-[0_12px_30px_#00000040] ![--glass-surface-fill:color-mix(in_srgb,var(--warning-surface),var(--glass-bg-elevated))]">
            <WarningTriangleIcon width={17} height={17} className="shrink-0" />
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
              <CloseIcon width={13} height={13} />
            </button>
          </div>
        )}

        <main className="h-full relative overflow-hidden">
          {/* Games View */}
          {view === 'games' && (
            <div className="h-full flex flex-col transition-all duration-300 opacity-100 scale-100">
              <div className="flex-1 overflow-y-auto pt-16 px-4 custom-scrollbar">
                <GameList key={refreshKey} onNavigate={handleNavigate} />
              </div>
            </div>
          )}

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
