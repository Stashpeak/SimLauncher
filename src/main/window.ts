import { app, BrowserWindow, dialog, ipcMain, screen, type OpenDialogOptions } from 'electron'
import path from 'path'

import {
  getIsQuitting,
  getPendingMinimizeToTray,
  getRendererDirty,
  setIsQuitting,
  setPendingMinimizeToTray,
  setRendererDirty
} from './app-state'
import { markRecentlyBrowsedPath } from './ipc/icons'
import { getStoredBoolean, getStoredZoomFactor, isWindowBounds, store } from './store'
import { checkForUpdates, registerUpdaterEvents } from './updater'
import { clamp } from './utils'

let mainWindow: BrowserWindow | null = null

// Grace period between the renderer finishing its load and force-showing the
// window when 'ready-to-show' did not arrive (see the #382 comment below).
const READY_TO_SHOW_FALLBACK_MS = 500

export type CloseAction = 'quit' | 'hide' | 'confirm-close' | 'confirm-minimize'

/**
 * Decide what the window's 'close' event should do based on the three inputs
 * that govern its behavior. Pure function so the precedence rules are easy to
 * unit-test and review.
 *
 * Precedence: explicit quit > unsaved changes > tray preference. Dirty must
 * always win over tray so the user explicitly chooses what happens to their
 * pending edits (the previous design silently minimized to tray and left
 * changes "preserved in memory" — invisible to the user, and lost if they
 * later quit from the tray menu).
 */
export function decideCloseAction(opts: {
  isQuitting: boolean
  isDirty: boolean
  effectiveMinimizeToTray: boolean
}): CloseAction {
  if (opts.isQuitting) {
    return 'quit'
  }
  if (opts.isDirty) {
    return opts.effectiveMinimizeToTray ? 'confirm-minimize' : 'confirm-close'
  }
  if (opts.effectiveMinimizeToTray) {
    return 'hide'
  }
  return 'quit'
}

/**
 * Resolve the tray preference the user *currently intends*.
 *
 * When a settings edit is in flight the renderer forwards the EFFECTIVE pending
 * value — already gated by the unsaved `showTrayIcon` (so it's false when the
 * tray is being turned off, true when it's being turned on alongside
 * minimize-to-tray) — so we honour that directly. With no edit in flight we fall
 * back to the persisted values, where minimize-to-tray only applies if the tray
 * icon is actually enabled (no tray ⇒ nothing to minimize to).
 */
function getEffectiveMinimizeToTray(): boolean {
  const pending = getPendingMinimizeToTray()
  if (pending !== null) {
    return pending
  }
  return store.get('showTrayIcon') !== false && store.get('minimizeToTray') === true
}

function getInitialWindowBounds() {
  const defaultBounds = { width: 800, height: 600 }
  const savedBounds = store.get('windowBounds')

  if (!isWindowBounds(savedBounds)) {
    return defaultBounds
  }

  const display = screen.getDisplayMatching(savedBounds)
  const { workArea } = display
  const width = clamp(savedBounds.width, 640, workArea.width)
  const height = clamp(savedBounds.height, 480, workArea.height)

  return {
    x: clamp(savedBounds.x, workArea.x, workArea.x + workArea.width - width),
    y: clamp(savedBounds.y, workArea.y, workArea.y + workArea.height - height),
    width,
    height
  }
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}

export function sendToRenderer(channel: string, payload: unknown): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return
  }

  mainWindow.webContents.send(channel, payload)
}

export function getAppIconPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'SimLauncher.ico')
    : path.join(app.getAppPath(), 'SimLauncher.ico')
}

function getLocalDevRendererUrl() {
  const rendererUrl = process.env['ELECTRON_RENDERER_URL']

  if (!rendererUrl) {
    throw new Error('ELECTRON_RENDERER_URL must be set in development mode')
  }

  let parsedUrl: URL
  try {
    parsedUrl = new URL(rendererUrl)
  } catch {
    throw new Error('ELECTRON_RENDERER_URL must be a valid URL in development mode')
  }

  if (
    parsedUrl.protocol !== 'http:' ||
    (parsedUrl.hostname !== 'localhost' && parsedUrl.hostname !== '127.0.0.1')
  ) {
    throw new Error('ELECTRON_RENDERER_URL must resolve to a local HTTP renderer URL')
  }

  return parsedUrl.toString()
}

export function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }

  mainWindow.show()
  mainWindow.focus()
}

export function createWindow(): void {
  const zoomFactor = getStoredZoomFactor()
  const windowBounds = getInitialWindowBounds()

  mainWindow = new BrowserWindow({
    ...windowBounds,
    frame: false,
    show: false,
    autoHideMenuBar: true,
    icon: getAppIconPath(),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      zoomFactor,
      preload: path.join(__dirname, '../preload/index.js')
    }
  })

  mainWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault()
  })

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  mainWindow.on('close', (event) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return
    }

    store.set('windowBounds', mainWindow.getBounds())

    const action = decideCloseAction({
      isQuitting: getIsQuitting(),
      isDirty: getRendererDirty(),
      effectiveMinimizeToTray: getEffectiveMinimizeToTray()
    })

    if (action === 'quit') {
      return
    }

    event.preventDefault()
    if (action === 'hide') {
      mainWindow.hide()
      return
    }
    // Confirm dialog: tell the renderer whether picking Save/Discard should
    // minimize (tray enabled) or fully close, so dialog labels and the final
    // action both match the user's tray preference.
    mainWindow.webContents.send('close-requested', { minimizeMode: action === 'confirm-minimize' })
  })

  // Keep the renderer's maximize/restore icon in sync with reality: OS paths
  // (Win+Up, aero-snap drag, taskbar double-click) maximize a frameless window
  // without going through the titlebar button, so the renderer cannot track
  // this state on its own (#500).
  mainWindow.on('maximize', () => sendToRenderer('window-maximized-changed', true))
  mainWindow.on('unmaximize', () => sendToRenderer('window-maximized-changed', false))

  // Show window once ready, or keep it hidden when starting minimized to tray.
  // Only stay hidden if BOTH startMinimized AND the tray exists — otherwise the
  // window would be stranded with no way to restore it.
  const showWindowWhenReady = () => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isVisible()) {
      return
    }
    const startMinimized = getStoredBoolean('startMinimized')
    const showTrayIcon = getStoredBoolean('showTrayIcon', true)
    if (!startMinimized || !showTrayIcon) {
      mainWindow.show()
    }
  }

  mainWindow.once('ready-to-show', showWindowWhenReady)

  // Electron 42 regression (#382): a webContents.setZoomFactor() call landing
  // between did-finish-load and the hidden window's first paint suppresses
  // 'ready-to-show' permanently — and the renderer's boot does exactly that via
  // the set-zoom IPC. The handler now skips same-value calls, but keep a
  // fallback here so the window can never be stranded invisible if the event
  // is lost for any other reason.
  mainWindow.webContents.once('did-finish-load', () => {
    setTimeout(showWindowWhenReady, READY_TO_SHOW_FALLBACK_MS)
  })

  // Apply login-item setting on startup
  const startWithWindows = getStoredBoolean('startWithWindows')
  app.setLoginItemSettings({ openAtLogin: startWithWindows })

  registerUpdaterEvents(sendToRenderer)

  mainWindow.webContents.once('did-finish-load', () => {
    const autoCheckUpdates = store.get('autoCheckUpdates') !== false

    if (app.isPackaged && autoCheckUpdates) {
      checkForUpdates().catch((err) => {
        console.error('Update check failed:', err)
      })
    }

    // In development, simulate update availability so the updater UI can be tested.
    if (!app.isPackaged && autoCheckUpdates) {
      setTimeout(() => {
        checkForUpdates().catch((err) => {
          console.error('Update check failed:', err)
        })
      }, 1500)
    }
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(getLocalDevRendererUrl())
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

export function applyRuntimeConfigSettings(): void {
  const startWithWindows = getStoredBoolean('startWithWindows')
  app.setLoginItemSettings({ openAtLogin: startWithWindows })

  mainWindow?.webContents.setZoomFactor(getStoredZoomFactor())
}

export function registerWindowHandlers(): void {
  /**
   * Opens a file dialog to select an executable file and sends the path back.
   * @param inputId The ID of the input field in the Renderer to update.
   */
  ipcMain.handle('browse-path', async (_event, inputId: unknown) => {
    const safeInputId = typeof inputId === 'string' ? inputId : ''
    try {
      const options: OpenDialogOptions = {
        title: 'Select Executable File (.exe)',
        properties: ['openFile'],
        filters: [{ name: 'Executable Files', extensions: ['exe'] }]
      }
      const result =
        mainWindow && !mainWindow.isDestroyed()
          ? await dialog.showOpenDialog(mainWindow, options)
          : await dialog.showOpenDialog(options)
      if (!result.canceled && result.filePaths.length > 0) {
        const filePath = result.filePaths[0]
        markRecentlyBrowsedPath(filePath)
        return { filePath, inputId: safeInputId }
      }
      return { filePath: null, inputId: safeInputId }
    } catch (err) {
      console.error('Dialog error:', err)
      return { filePath: null, inputId: safeInputId }
    }
  })

  ipcMain.handle('window-minimize', () => {
    mainWindow?.minimize()
  })

  ipcMain.handle('window-maximize', () => {
    if (!mainWindow) return
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()
  })

  ipcMain.handle('window-close', () => {
    // Pre-set isQuitting when the close will result in a real quit, so the
    // 'close' event handler in createWindow() sees the flag and does not
    // re-intercept. When minimize-to-tray is active or there are unsaved
    // changes, the 'close' handler takes its own branch (hide/confirm) and
    // isQuitting must stay false so that branch runs correctly.
    if (!getEffectiveMinimizeToTray() && !getRendererDirty()) {
      setIsQuitting(true)
    }

    mainWindow?.close()
  })

  ipcMain.handle('set-renderer-dirty', (_event, value: unknown) => {
    setRendererDirty(value === true)
  })

  ipcMain.handle('set-pending-minimize-to-tray', (_event, value: unknown) => {
    if (value === null || typeof value === 'boolean') {
      setPendingMinimizeToTray(value)
    } else {
      setPendingMinimizeToTray(null)
    }
  })

  ipcMain.handle('force-close-window', () => {
    setIsQuitting(true)
    setRendererDirty(false)
    mainWindow?.close()
  })

  ipcMain.handle('force-minimize-to-tray', () => {
    // Renderer already ran its save/discard pipeline before invoking us; the
    // dirty state in the renderer will propagate to false on next render. Do
    // NOT setIsQuitting — the window keeps living in the tray.
    //
    // Safety net: the close dialog's minimize-vs-close mode is decided up-front
    // from the (possibly unsaved) tray preference, but Save and Discard can land
    // here with a different *persisted* tray state — e.g. the user enables the
    // tray unsaved, the dialog opens in minimize mode, then they Discard, which
    // reverts showTrayIcon back to off. Hiding with no tray icon would strand
    // the only window, so fall back to a recoverable taskbar minimize whenever
    // the tray isn't actually on.
    if (store.get('showTrayIcon') === false) {
      mainWindow?.minimize()
      return
    }
    mainWindow?.hide()
  })

  ipcMain.handle('restart-app', () => {
    setIsQuitting(true)
    app.relaunch()
    app.exit(0)
  })
}
