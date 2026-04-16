import { app, BrowserWindow, ipcMain, dialog, nativeImage } from 'electron'
import { spawn, type ChildProcess } from 'child_process'
import path from 'path'
import { autoUpdater } from 'electron-updater'
import Store from 'electron-store'

const store = new Store({
  schema: {
    appPaths:     { type: 'object',  default: {} },
    gamePaths:    { type: 'object',  default: {} },
    profiles:     { type: 'object',  default: {} },
    appNames:     { type: 'object',  default: {} },
    accentPreset: { type: 'string',  default: '' },
    accentCustom: { type: 'string',  default: '' },
    killOnClose:  { type: 'boolean', default: false },
    migrated:     { type: 'boolean', default: false },
  }
})

let mainWindow: BrowserWindow | null = null
const runningProcesses = new Map<string, { process: ChildProcess; name: string }>()

function killLaunchedApps() {
  runningProcesses.forEach(({ process: child }, appPath) => {
    try {
      child.kill()
    } catch (err) {
      console.error(`Error killing ${appPath}:`, err)
    }
  })
  runningProcesses.clear()
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    frame: false,
    autoHideMenuBar: true,
    icon: path.join(__dirname, '../../SimLauncher.ico'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, '../preload/index.js')
    }
  })

  autoUpdater.on('update-available', (info) => {
    mainWindow?.webContents.send('update-available', info)
  })

  autoUpdater.on('update-downloaded', (info) => {
    mainWindow?.webContents.send('update-downloaded', info)
  })

  mainWindow.webContents.once('did-finish-load', () => {
    if (app.isPackaged) {
      autoUpdater.checkForUpdatesAndNotify().catch((err) => {
        console.error('Update check failed:', err)
      })
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(createWindow)

// ----------------------------------------------------------------
// HELPERS
// ----------------------------------------------------------------

function isValidExePath(p: unknown) {
  return typeof p === 'string' && p.trim().length > 0 && /\.exe$/i.test(p.trim())
}

// ----------------------------------------------------------------
// MAIN LAUNCH LOGIC
// ----------------------------------------------------------------

/**
 * Executes a list of applications sequentially with a delay.
 * @param profileApps Array of executable paths to launch.
 */
ipcMain.handle('launch-profile', (event, profileApps) => {
  if (!Array.isArray(profileApps) || profileApps.length === 0) {
    return { success: false, error: 'Profile is empty.' }
  }

  let delay = 0
  profileApps.forEach((appPath) => {
    if (!isValidExePath(appPath)) {
      console.error(`Skipping invalid path: ${appPath}`)
      return
    }
    setTimeout(() => {
      const child = spawn(appPath, [], { detached: true, stdio: 'ignore' })
      runningProcesses.set(appPath, { process: child, name: path.basename(appPath) })
      child.on('error', (err) => {
        runningProcesses.delete(appPath)
        console.error(`Error launching ${appPath}: ${err.message}`)
        event.sender.send('app-launch-error', { app: appPath, error: err.message })
      })
      child.on('exit', () => {
        runningProcesses.delete(appPath)
      })
      child.unref()
    }, delay)
    delay += 1000 // 1 second delay between app launches for stability
  })

  return { success: true, message: 'All profile applications launching.' }
})

// ----------------------------------------------------------------
// FILE BROWSER DIALOG LISTENER
// ----------------------------------------------------------------

/**
 * Opens a file dialog to select an executable file and sends the path back.
 * @param inputId The ID of the input field in the Renderer to update.
 */
ipcMain.handle('browse-path', async (event, inputId) => {
  try {
    const result = await dialog.showOpenDialog(null as unknown as BrowserWindow, {
      title: 'Select Executable File (.exe)',
      properties: ['openFile'],
      filters: [{ name: 'Executable Files', extensions: ['exe'] }]
    })
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
  mainWindow?.close()
})

ipcMain.handle('get-running-apps', () => {
  return Array.from(runningProcesses.entries()).map(([appPath, appProcess]) => ({
    path: appPath,
    name: appProcess.name
  }))
})

ipcMain.handle('kill-launched-apps', () => {
  killLaunchedApps()
})

ipcMain.handle('install-update', () => {
  autoUpdater.quitAndInstall()
})

ipcMain.handle('get-asset-data', async (_event, filename: string) => {
  const assetsPath = app.isPackaged
    ? path.join(process.resourcesPath, 'assets')
    : path.join(app.getAppPath(), 'assets')
  const fullPath = path.join(assetsPath, filename)
  try {
    const img = nativeImage.createFromPath(fullPath)
    if (img.isEmpty()) return null
    return img.toDataURL()
  } catch (err) {
    console.error(`Error loading asset ${filename}:`, err)
    return null
  }
})

ipcMain.handle('store-get', (_event, key) => {
  return store.get(key)
})

ipcMain.handle('store-set', (_event, key, value) => {
  store.set(key, value)
})

app.on('before-quit', () => {
  if (store.get('killOnClose')) {
    killLaunchedApps()
  }
})
