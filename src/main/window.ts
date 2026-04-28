import { app, BrowserWindow, dialog, ipcMain, screen } from 'electron'
import path from 'path'

import { getIsQuitting, setIsQuitting } from './app-state'
import { getStoredZoomFactor, isWindowBounds, store } from './store'
import { checkForUpdates, registerUpdaterEvents } from './updater'
import { clamp } from './utils'

let mainWindow: BrowserWindow | null = null

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

export function getMainWindow() {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}

export function sendToRenderer(channel: string, payload: unknown) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return
  }

  mainWindow.webContents.send(channel, payload)
}

export function getAppIconPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'SimLauncher.ico')
    : path.join(app.getAppPath(), 'SimLauncher.ico')
}

export function showMainWindow() {
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

export function createWindow() {
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

    const minimizeToTray = store.get('minimizeToTray') === true

    if (!getIsQuitting() && minimizeToTray) {
      event.preventDefault()
      mainWindow.hide()
    }
  })

  // Show window once ready, or keep it hidden when starting minimized to tray.
  mainWindow.once('ready-to-show', () => {
    const startMinimized = store.get('startMinimized') as boolean
    if (!startMinimized) {
      mainWindow!.show()
    }
  })

  // Apply login-item setting on startup
  const startWithWindows = store.get('startWithWindows') as boolean
  app.setLoginItemSettings({ openAtLogin: !!startWithWindows })

  registerUpdaterEvents(sendToRenderer)

  mainWindow.webContents.once('did-finish-load', () => {
    const autoCheckUpdates = store.get('autoCheckUpdates') !== false

    if (app.isPackaged && autoCheckUpdates) {
      checkForUpdates().catch((err) => {
        console.error('Update check failed:', err)
      })
    }

    // DEV: fake update - remove this block to disable
    if (!app.isPackaged && autoCheckUpdates) {
      setTimeout(() => {
        checkForUpdates().catch((err) => {
          console.error('Update check failed:', err)
        })
      }, 1500)
    }
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

export function applyRuntimeConfigSettings() {
  const startWithWindows = store.get('startWithWindows') as boolean
  app.setLoginItemSettings({ openAtLogin: !!startWithWindows })

  mainWindow?.webContents.setZoomFactor(getStoredZoomFactor())
}

export function registerWindowHandlers() {
  /**
   * Opens a file dialog to select an executable file and sends the path back.
   * @param inputId The ID of the input field in the Renderer to update.
   */
  ipcMain.handle('browse-path', async (_event, inputId) => {
    try {
      const options = {
        title: 'Select Executable File (.exe)',
        properties: ['openFile'] as const,
        filters: [{ name: 'Executable Files', extensions: ['exe'] }]
      }
      const result =
        mainWindow && !mainWindow.isDestroyed()
          ? await dialog.showOpenDialog(mainWindow, options)
          : await dialog.showOpenDialog(options)
      if (!result.canceled && result.filePaths.length > 0) {
        return { filePath: result.filePaths[0], inputId }
      }
      return { filePath: null, inputId }
    } catch (err) {
      console.error('Dialog error:', err)
      return { filePath: null, inputId }
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
    if (store.get('minimizeToTray') !== true) {
      setIsQuitting(true)
    }

    mainWindow?.close()
  })

  ipcMain.handle('restart-app', () => {
    setIsQuitting(true)
    app.relaunch()
    app.exit(0)
  })
}
