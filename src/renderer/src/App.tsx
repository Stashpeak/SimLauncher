import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { NotifyProvider, useNotify } from './components/Notify'
import { WindowControls } from './components/WindowControls'
import { GameList } from './components/GameList'
import { SettingsView } from './components/SettingsView'
import { ConfirmDialog } from './components/ConfirmDialog'
import { StickySaveBar } from './components/StickySaveBar'
import { WarningTriangleIcon, CloseIcon } from './components/icons'
import {
  forceClose,
  forceMinimizeToTray,
  getStartupNotice,
  getUpdateInfo,
  onCloseRequested,
  onUpdateAvailable,
  setPendingMinimizeToTray,
  setRendererDirty
} from './lib/electron'
import { subscribeGlobalErrors } from './lib/globalErrors'
import { runStartupMigrations } from './lib/migrations'
import { useTheme } from './contexts/ThemeContext'
import { SettingsProvider } from './components/settings/SettingsContext'
import { AppDirtyProvider, useAppDirty } from './contexts/AppDirtyContext'

// AppDirtyProvider must wrap AppContent so the dirty-state aggregator is
// available before any child mounts and registers save/discard handlers.
// NotifyProvider is outermost so toasts survive error states at any depth.
export default function App(): ReactNode {
  return (
    <NotifyProvider>
      <AppDirtyProvider>
        <AppContent />
      </AppDirtyProvider>
    </NotifyProvider>
  )
}

function AppContent() {
  const [view, setView] = useState<'games' | 'settings'>('games')
  const { accentBgTint, syncThemeFromStore } = useTheme()
  const { notify, announce } = useNotify()
  const [updateInfo, setUpdateInfo] = useState<{ version: string } | null>(null)
  const [showImportWarning, setShowImportWarning] = useState(false)
  const [pendingView, setPendingView] = useState<'games' | 'settings' | null>(null)
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false)
  // When true, the close dialog's actions minimize to tray instead of fully
  // quitting. Set from the `close-requested` payload so the dialog labels and
  // the terminal IPC call both match the user's current tray preference.
  const [closeConfirmMinimizeMode, setCloseConfirmMinimizeMode] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  // App-level discard confirm, opened by the sticky bar's Discard button. Lifted
  // here (rather than living inside StickySaveBar) so the OS close-request
  // handler can avoid stacking it with the close dialog — two open ConfirmDialogs
  // would both bind global Enter/Escape and a single keypress could fire both.
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false)
  const { isAnyDirty, reportSettingsDirty, requestSaveAll, requestDiscardAll } = useAppDirty()

  // Remembers the version we last announced so the live event and the
  // getUpdateInfo() hydration (which can both deliver the same version) don't
  // announce it twice.
  const announcedUpdateRef = useRef<string | null>(null)

  // Mirror so the once-registered close-request handler reads the latest value
  // without re-subscribing.
  const discardConfirmOpenRef = useRef(false)
  useEffect(() => {
    discardConfirmOpenRef.current = discardConfirmOpen
  }, [discardConfirmOpen])

  // Run once on mount; migrations are idempotent, so running them again on hot
  // reload in dev is safe and gives no false positives.
  useEffect(() => {
    runStartupMigrations()
  }, [])

  // Surface non-React errors (async rejections, event-handler throws, errors
  // outside the render tree) as a toast — the ErrorBoundary only covers render.
  useEffect(() => subscribeGlobalErrors((message) => notify(message, 'error', 6000)), [notify])

  // One-shot: if the persisted config was unreadable on boot and reset to
  // defaults, tell the user why their settings reverted. Consumed server-side,
  // so a StrictMode double-mount can't double-toast.
  useEffect(() => {
    let cancelled = false
    getStartupNotice()
      .then((notice: { type: 'success' | 'warn' | 'error'; message: string } | null) => {
        if (!cancelled && notice) notify(notice.message, notice.type, 8000)
      })
      .catch((err: unknown) => {
        console.error('Failed to load startup notice', err)
      })
    return () => {
      cancelled = true
    }
  }, [notify])

  // Keep the main process in sync so it can show a native "unsaved changes"
  // prompt if the OS sends a close signal before the React dialog is open.
  useEffect(() => {
    void setRendererDirty(isAnyDirty)
  }, [isAnyDirty])

  useEffect(() => {
    const unsubscribe = onCloseRequested(({ minimizeMode }: { minimizeMode: boolean }) => {
      // Avoid stacking the close dialog on top of the tab-switch OR discard
      // confirm — two simultaneous confirms attach independent Enter/Escape
      // handlers and a single keypress would trigger conflicting flows. Those
      // flows are more contextual (the user just clicked a tab / Discard), so
      // let them finish first.
      setPendingView((current) => {
        if (current === null && !discardConfirmOpenRef.current) {
          setCloseConfirmMinimizeMode(minimizeMode)
          setCloseConfirmOpen(true)
        }
        return current
      })
    })
    return () => {
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    syncThemeFromStore().catch((err) => {
      console.error('Failed to sync theme', err)
    })

    const applyUpdateInfo = (info: { version?: string } | null) => {
      if (!info?.version) return
      setUpdateInfo({ version: info.version })
      // The update pill is otherwise silent on the Games view — announce it once
      // per version through the SR live region.
      if (announcedUpdateRef.current !== info.version) {
        announcedUpdateRef.current = info.version
        announce(`Update version ${info.version} available`)
      }
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
  }, [syncThemeFromStore, announce])

  // Gate tab navigation behind the discard/save confirm dialog when dirty.
  // The actual view switch is deferred to handleConfirmDiscard/Save so the
  // user's choice (save vs discard) determines the transition.
  const handleNavigate = (nextView: 'games' | 'settings') => {
    if (view === nextView) return

    if (isAnyDirty) {
      setPendingView(nextView)
      return
    }
    setView(nextView)
  }

  const handleDiscardAll = useCallback(async () => {
    // Await the discard pipeline BEFORE remounting: GameRow's pending "+"
    // profile cleanup writes to the store, and bumping refreshKey first would
    // tear the row down mid-cleanup and reload the orphan from the store (#478).
    await requestDiscardAll()
    reportSettingsDirty(false)
    // Reset main-process state the renderer forwarded ahead of save (the pending
    // Minimize-to-tray toggle), remount the SettingsProvider so discarded toggles
    // reload from the store, and re-sync theme so a discarded theme/accent preview
    // reverts.
    void setPendingMinimizeToTray(null)
    setRefreshKey((k) => k + 1)
    syncThemeFromStore().catch((err) => {
      console.error('Failed to re-sync theme after discard', err)
    })
  }, [reportSettingsDirty, requestDiscardAll, syncThemeFromStore])

  const handleConfirmDiscard = useCallback(async () => {
    await handleDiscardAll()
    if (pendingView) {
      setView(pendingView)
      setPendingView(null)
    }
  }, [handleDiscardAll, pendingView])

  const handleConfirmCancel = () => {
    setPendingView(null)
  }

  const handleConfirmSave = useCallback(async () => {
    // Save every dirty scope through the aggregator, not just the settings
    // pipeline. If both Settings and the Profile Editor were dirty, routing
    // through the settings-only trigger would have left profile edits unsaved
    // even though the unified confirm dialog promised to save everything.
    const success = await requestSaveAll()
    if (!success) {
      // Keep the dialog open so the user can retry or discard; the failed
      // save handler already surfaced its own error toast.
      return
    }
    // Remount the games view so it reloads settings-derived state (game
    // list, paths). GameList caches configured games once on mount, so a
    // save-through-dialog that updates Settings without bumping refreshKey
    // would otherwise leave the Games tab showing stale paths.
    setRefreshKey((k) => k + 1)
    if (pendingView) {
      setView(pendingView)
      setPendingView(null)
    }
  }, [pendingView, requestSaveAll])

  const handleCloseConfirmSave = useCallback(async () => {
    let success: boolean
    try {
      success = await requestSaveAll()
    } catch (err) {
      // requestSaveAll catches handler errors internally, but guard anyway.
      console.error('Failed to save before close', err)
      success = false
    }
    if (!success) {
      // Do NOT force-close — leave dialog open so the user keeps their data.
      notify('Failed to save changes. Window not closed.', 'error', 4000)
      return
    }
    // Mirror handleConfirmSave: remount provider so cached settings-derived
    // state (game list paths, etc.) reloads from store. Matters in minimize
    // mode where the renderer keeps living; harmless on the force-close path.
    setRefreshKey((k) => k + 1)
    setCloseConfirmOpen(false)
    await (closeConfirmMinimizeMode ? forceMinimizeToTray() : forceClose())
  }, [closeConfirmMinimizeMode, notify, requestSaveAll])

  const handleCloseConfirmDiscard = useCallback(async () => {
    // Await async discard work (pending "+" profile removal, #478) before the
    // remount and the close/minimize IPC tear the renderer state down.
    await requestDiscardAll()
    reportSettingsDirty(false)
    // Mirror the tab-switch discard: clear any pending Minimize-to-tray
    // override, remount the SettingsProvider, and re-sync theme so a
    // discarded tray/theme/accent toggle doesn't keep steering the main
    // process or leak visually after the user picked Discard. Matters most
    // in minimize mode — the renderer stays alive in the tray, so any
    // stale state would otherwise surface on the next show.
    void setPendingMinimizeToTray(null)
    setRefreshKey((k) => k + 1)
    syncThemeFromStore().catch((err) => {
      console.error('Failed to re-sync theme after discard', err)
    })
    setCloseConfirmOpen(false)
    await (closeConfirmMinimizeMode ? forceMinimizeToTray() : forceClose())
  }, [closeConfirmMinimizeMode, reportSettingsDirty, requestDiscardAll, syncThemeFromStore])

  const handleCloseConfirmCancel = () => {
    setCloseConfirmOpen(false)
  }

  // After an import the store is completely replaced, so remount the provider
  // subtree (refreshKey) and re-sync the theme CSS variables. The warning
  // banner reminds the user that executable paths may need updating on this device.
  const handleConfigImported = () => {
    syncThemeFromStore()
    setRefreshKey((k) => k + 1)
    setShowImportWarning(true)
  }

  return (
    <div
      className={`h-screen overflow-hidden relative transition-colors duration-500 ${accentBgTint ? 'bg-tinted' : ''}`}
    >
      <header className="absolute top-0 left-0 w-full z-20 header-glass">
        <h1 className="sr-only">SimLauncher</h1>
        <WindowControls view={view} onNavigate={handleNavigate} updateInfo={updateInfo} />
      </header>

      {showImportWarning && (
        <div
          role="status"
          aria-live="polite"
          className="glass-surface absolute! left-4 right-4 top-16 z-30 mx-auto flex max-w-3xl animate-fade-slide items-center gap-3 rounded-2xl border border-(--warning-border) px-4 py-3 text-xs font-medium text-(--warning-text) shadow-[0_12px_30px_#00000040] [--glass-surface-fill:color-mix(in_srgb,var(--warning-surface),var(--glass-bg-elevated))]!"
        >
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

      <SettingsProvider
        key={refreshKey}
        onDirtyChange={reportSettingsDirty}
        onConfigImported={handleConfigImported}
      >
        <main className="h-full relative overflow-hidden">
          {/* Games View */}
          {/* `inert` removes the hidden view from the Tab order and the a11y
              tree — pointer-events-none only blocks the mouse, so without it
              keyboard users tab through invisible controls (#479). */}
          <div
            inert={view !== 'games'}
            className={`h-full flex flex-col transition-all duration-300 ${
              view === 'games'
                ? 'opacity-100 scale-100 pointer-events-auto'
                : 'opacity-0 scale-95 pointer-events-none'
            }`}
          >
            <div
              className={`flex-1 overflow-y-auto pt-16 px-4 ${isAnyDirty ? 'pb-24' : ''} custom-scrollbar`}
            >
              <GameList key={refreshKey} onNavigate={handleNavigate} />
            </div>
          </div>

          {/* Settings View */}
          <div
            inert={view !== 'settings'}
            className={`absolute inset-0 z-10 h-full flex flex-col transition-all duration-300 ${
              view === 'settings'
                ? 'opacity-100 scale-100 pointer-events-auto'
                : 'opacity-0 scale-95 pointer-events-none'
            }`}
          >
            <div
              className={`flex-1 overflow-y-auto pt-16 px-4 ${isAnyDirty ? 'pb-24' : ''} custom-scrollbar`}
            >
              <SettingsView onClose={() => handleNavigate('games')} updateInfo={updateInfo} />
            </div>
          </div>
        </main>
      </SettingsProvider>

      <StickySaveBar onRequestDiscard={() => setDiscardConfirmOpen(true)} />

      <ConfirmDialog
        isOpen={pendingView !== null}
        title="Unsaved Changes"
        message="You have unsaved changes. Do you want to save them before leaving?"
        onSave={() => {
          void handleConfirmSave()
        }}
        onDiscard={() => {
          void handleConfirmDiscard()
        }}
        onCancel={handleConfirmCancel}
      />

      <ConfirmDialog
        isOpen={closeConfirmOpen}
        title="Unsaved Changes"
        message={
          closeConfirmMinimizeMode
            ? 'You have unsaved changes. Save them before minimizing SimLauncher to the tray?'
            : 'You have unsaved changes. Save them before closing SimLauncher?'
        }
        saveLabel={closeConfirmMinimizeMode ? 'Save & Minimize' : 'Save & Close'}
        discardLabel={closeConfirmMinimizeMode ? 'Discard & Minimize' : 'Discard & Close'}
        onSave={() => {
          void handleCloseConfirmSave()
        }}
        onDiscard={() => {
          void handleCloseConfirmDiscard()
        }}
        onCancel={handleCloseConfirmCancel}
      />

      <ConfirmDialog
        isOpen={discardConfirmOpen}
        title="Discard changes?"
        message="This reverts all unsaved changes across Settings and any open profile editor. This can't be undone."
        saveLabel="Discard Changes"
        discardLabel="Keep Editing"
        saveClassName="danger-action"
        discardClassName="neutral-action"
        onSave={() => {
          setDiscardConfirmOpen(false)
          void handleDiscardAll()
        }}
        onDiscard={() => setDiscardConfirmOpen(false)}
        onCancel={() => setDiscardConfirmOpen(false)}
      />
    </div>
  )
}
