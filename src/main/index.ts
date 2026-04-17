import { app, BrowserWindow, ipcMain, dialog, nativeImage } from 'electron'
import { execFile, spawn, type ChildProcess } from 'child_process'
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
    accentBgTint: { type: 'boolean', default: false },
    killOnClose:  { type: 'boolean', default: false },
    focusActiveTitle: { type: 'boolean', default: true },
    launchDelayMs: { type: 'number', default: 1000, minimum: 0, maximum: 5000 },
    migrated:     { type: 'boolean', default: false },
  }
})

let mainWindow: BrowserWindow | null = null
const runningProcesses = new Map<string, { process: ChildProcess; name: string; gameKey: string }>()

interface StoredProfile {
  trackingEnabled?: boolean
  trackedProcessPaths?: string[]
}

function killLaunchedApps(gameKey?: string) {
  runningProcesses.forEach(({ process: child }, appPath) => {
    const appProcess = runningProcesses.get(appPath)
    if (gameKey && appProcess?.gameKey !== gameKey) {
      return
    }

    try {
      child.kill()
    } catch (err) {
      console.error(`Error killing ${appPath}:`, err)
    }
    runningProcesses.delete(appPath)
  })
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

  autoUpdater.on('update-not-available', (info) => {
    mainWindow?.webContents.send('update-not-available', info)
  })

  mainWindow.webContents.once('did-finish-load', () => {
    if (app.isPackaged) {
      autoUpdater.checkForUpdatesAndNotify().catch((err) => {
        console.error('Update check failed:', err)
      })
    }

    // DEV: fake update — remove this block to disable
    if (!app.isPackaged) {
      setTimeout(() => mainWindow?.webContents.send('update-available', { version: '99.0.0' }), 1500)
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

function isValidExePath(p: unknown): p is string {
  return typeof p === 'string' && p.trim().length > 0 && /\.exe$/i.test(p.trim())
}

function getLaunchDelayMs() {
  const value = store.get('launchDelayMs')

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 1000
  }

  return Math.min(Math.max(Math.round(value), 0), 5000)
}

function getExeName(filePath: string) {
  return path.basename(filePath).toLowerCase()
}

function readRunningProcessNames() {
  return new Promise<Set<string>>((resolve) => {
    execFile('tasklist', ['/fo', 'csv', '/nh'], { windowsHide: true }, (error, stdout) => {
      if (error) {
        console.error('Failed to read running processes:', error)
        resolve(new Set())
        return
      }

      const names = new Set<string>()
      stdout.split(/\r?\n/).forEach((line) => {
        const match = line.match(/^"([^"]+)"/)
        if (match) {
          names.add(match[1].toLowerCase())
        }
      })
      resolve(names)
    })
  })
}

async function getTrackedRunningApps() {
  const processNames = await readRunningProcessNames()
  const profiles = store.get('profiles') as Record<string, StoredProfile> | undefined
  const gamePaths = store.get('gamePaths') as Record<string, string> | undefined
  const trackedApps: { path: string; name: string; gameKey: string; tracked: boolean }[] = []
  const seen = new Set<string>()

  Object.entries(profiles || {}).forEach(([gameKey, profile]) => {
    if (profile?.trackingEnabled === false) {
      return
    }

    const pathsToTrack = [
      gamePaths?.[gameKey],
      ...(Array.isArray(profile?.trackedProcessPaths) ? profile.trackedProcessPaths : [])
    ].filter(isValidExePath)

    pathsToTrack.forEach((trackedPath) => {
      const processName = getExeName(trackedPath)
      const dedupeKey = `${gameKey}:${trackedPath.toLowerCase()}`

      if (processNames.has(processName) && !seen.has(dedupeKey)) {
        trackedApps.push({
          path: trackedPath,
          name: path.basename(trackedPath),
          gameKey,
          tracked: true
        })
        seen.add(dedupeKey)
      }
    })
  })

  return trackedApps
}

// ----------------------------------------------------------------
// MAIN LAUNCH LOGIC
// ----------------------------------------------------------------

/**
 * Executes a list of applications sequentially with a delay.
 * @param profileApps Array of executable paths to launch.
 */
ipcMain.handle('launch-profile', (event, gameKey: string, profileApps: string[]) => {
  if (!Array.isArray(profileApps) || profileApps.length === 0) {
    return { success: false, error: 'Profile is empty.' }
  }

  let delay = 0
  const launchDelayMs = getLaunchDelayMs()
  profileApps.forEach((appPath) => {
    if (!isValidExePath(appPath)) {
      console.error(`Skipping invalid path: ${appPath}`)
      return
    }
    setTimeout(() => {
      const child = spawn(appPath, [], { detached: true, stdio: 'ignore' })
      runningProcesses.set(appPath, { process: child, name: path.basename(appPath), gameKey })
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
    delay += launchDelayMs
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

ipcMain.handle('get-running-apps', async () => {
  const launchedApps = Array.from(runningProcesses.entries()).map(([appPath, appProcess]) => ({
    path: appPath,
    name: appProcess.name,
    gameKey: appProcess.gameKey,
    tracked: false
  }))
  const launchedKeys = new Set(launchedApps.map((appProcess) => `${appProcess.gameKey}:${appProcess.path.toLowerCase()}`))
  const trackedApps = (await getTrackedRunningApps()).filter(
    (appProcess) => !launchedKeys.has(`${appProcess.gameKey}:${appProcess.path.toLowerCase()}`)
  )

  return [...launchedApps, ...trackedApps]
})

ipcMain.handle('kill-launched-apps', (_event, gameKey?: string) => {
  killLaunchedApps(gameKey)
})

ipcMain.handle('install-update', () => {
  autoUpdater.quitAndInstall()
})

ipcMain.handle('check-for-updates', async () => {
  return await autoUpdater.checkForUpdatesAndNotify()
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

ipcMain.handle('get-file-icon', async (_event, filePath: string) => {
  try {
    const icon = await app.getFileIcon(filePath, { size: 'normal' })
    if (!icon.isEmpty()) {
      return icon.toDataURL()
    }
    return null
  } catch (err) {
    console.error(`Failed to get file icon for ${filePath}:`, err)
    return null
  }
})

ipcMain.handle('get-version', () => {
  return app.getVersion()
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
