import { app, BrowserWindow, ipcMain, dialog, nativeImage, screen, Menu, Tray, type WebContents } from 'electron'
import { execFile, spawn, type ChildProcess } from 'child_process'
import path from 'path'
import fs from 'fs'
import { autoUpdater } from 'electron-updater'
import Store from 'electron-store'

const store = new Store({
  schema: {
    appPaths:     { type: 'object',  default: {} },
    gamePaths:    { type: 'object',  default: {} },
    profiles:     { type: 'object',  default: {} },
    appNames:     { type: 'object',  default: {} },
    customSlots:  { type: 'number',  default: 1, minimum: 1 },
    accentPreset: { type: 'string',  default: '' },
    accentCustom: { type: 'string',  default: '' },
    accentBgTint: { type: 'boolean', default: false },
    focusActiveTitle: { type: 'boolean', default: true },
    launchDelayMs: { type: 'number', default: 1000, minimum: 0, maximum: 5000 },
    startWithWindows: { type: 'boolean', default: false },
    startMinimized:   { type: 'boolean', default: false },
    minimizeToTray:   { type: 'boolean', default: false },
    autoCheckUpdates:  { type: 'boolean', default: true },
    zoomFactor:       { type: 'number',  default: 1.0 },
    windowBounds:      { type: 'object',  default: {} },
    migrated:     { type: 'boolean', default: false },
  }
})

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let installAfterDownload = false
let updateDownloaded = false
const runningProcesses = new Map<string, { process: ChildProcess; name: string; gameKey: string; isGame: boolean }>()
const activeLaunches = new Set<string>()
const POST_LAUNCH_BLOCK_MS = 10000
let launchBlockedUntil = 0
let genericIconFingerprint: string | null | undefined
let genericIconFingerprintPromise: Promise<string | null> | null = null
const UTILITY_COMPANION_PROCESS_NAMES: Record<string, string[]> = {
  garage61: ['Garage61 telemetry agent.exe']
}

autoUpdater.autoDownload = false

interface StoredProfile extends Record<string, unknown> {
  trackingEnabled?: boolean
  trackedProcessPaths?: string[]
}

interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

function isWindowBounds(value: unknown): value is WindowBounds {
  if (!value || typeof value !== 'object') {
    return false
  }

  const bounds = value as Record<string, unknown>
  return ['x', 'y', 'width', 'height'].every((key) => {
    const coordinate = bounds[key]
    return typeof coordinate === 'number' && Number.isFinite(coordinate)
  })
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
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

function sendToRenderer(channel: string, payload: unknown) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return
  }

  mainWindow.webContents.send(channel, payload)
}

function getAppIconPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'SimLauncher.ico')
    : path.join(app.getAppPath(), 'SimLauncher.ico')
}

function showMainWindow() {
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

function createTray() {
  if (tray) {
    return
  }

  const icon = nativeImage.createFromPath(getAppIconPath())
  tray = new Tray(icon)
  tray.setToolTip('SimLauncher')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show SimLauncher', click: showMainWindow },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true
        app.quit()
      }
    }
  ]))

  tray.on('click', showMainWindow)
  tray.on('double-click', showMainWindow)
}

function quitAndInstallUpdate() {
  isQuitting = true
  autoUpdater.quitAndInstall()
}

async function checkForUpdates() {
  if (!app.isPackaged) {
    sendToRenderer('update-available', { version: '99.0.0' })
    return null
  }

  return await autoUpdater.checkForUpdates()
}

function runTaskkill(args: string[], description: string) {
  return new Promise<void>((resolve) => {
    execFile('taskkill', args, { windowsHide: true }, (error, _stdout, stderr) => {
      if (error) {
        const detail = stderr.trim() || error.message
        if (!/not found/i.test(detail)) {
          console.error(`Failed to ${description}: ${detail}`)
        }
      }

      resolve()
    })
  })
}

function killProcessTree(child: ChildProcess, appPath: string) {
  if (process.platform === 'win32' && child.pid) {
    return runTaskkill(['/PID', String(child.pid), '/T', '/F'], `kill process tree for ${appPath}`)
  }

  try {
    child.kill()
  } catch (err) {
    console.error(`Error killing ${appPath}:`, err)
  }

  return Promise.resolve()
}

function killProcessByImageName(processName: string) {
  if (process.platform !== 'win32') {
    return Promise.resolve()
  }

  return runTaskkill(['/IM', processName, '/T', '/F'], `kill companion process ${processName}`)
}

function getProfileCompanionProcessNames(gameKey?: string) {
  const profiles = store.get('profiles') as Record<string, StoredProfile> | undefined
  const gamePaths = store.get('gamePaths') as Record<string, string> | undefined
  const companionNames = new Set<string>()

  Object.entries(profiles || {}).forEach(([profileGameKey, profile]) => {
    if (gameKey && profileGameKey !== gameKey) {
      return
    }

    Object.entries(UTILITY_COMPANION_PROCESS_NAMES).forEach(([utilityKey, processNames]) => {
      if (profile?.[utilityKey] === true) {
        processNames.forEach((processName) => companionNames.add(processName.toLowerCase()))
      }
    })

    const gameExeName = isValidExePath(gamePaths?.[profileGameKey])
      ? getExeName(gamePaths![profileGameKey])
      : null

    if (Array.isArray(profile?.trackedProcessPaths)) {
      profile.trackedProcessPaths.filter(isValidExePath).forEach((processPath) => {
        const processName = getExeName(processPath)
        if (processName !== gameExeName) {
          companionNames.add(processName)
        }
      })
    }
  })

  return companionNames
}

async function killLaunchedApps(gameKey?: string) {
  const processNames = await readRunningProcessNames()
  const companionProcessNames = getProfileCompanionProcessNames(gameKey)
  const killTasks: Promise<void>[] = []

  runningProcesses.forEach(({ process: child }, appPath) => {
    const appProcess = runningProcesses.get(appPath)
    if (gameKey && appProcess?.gameKey !== gameKey) {
      return
    }
    if (appProcess?.isGame) {
      return
    }

    companionProcessNames.delete(getExeName(appPath))
    killTasks.push(killProcessTree(child, appPath))
    runningProcesses.delete(appPath)
  })

  companionProcessNames.forEach((processName) => {
    if (processNames.has(processName)) {
      killTasks.push(killProcessByImageName(processName))
    }
  })

  await Promise.all(killTasks)
}

function createWindow() {
  const savedZoom = store.get('zoomFactor') as number
  const zoomFactor = typeof savedZoom === 'number' && Number.isFinite(savedZoom) ? savedZoom : 1.0
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

  mainWindow.on('close', (event) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return
    }

    store.set('windowBounds', mainWindow.getBounds())

    const minimizeToTray = store.get('minimizeToTray') === true

    if (!isQuitting && minimizeToTray) {
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

  autoUpdater.on('update-available', (info) => {
    updateDownloaded = false
    sendToRenderer('update-available', info)
  })

  autoUpdater.on('update-downloaded', (info) => {
    updateDownloaded = true
    sendToRenderer('update-downloaded', info)

    if (installAfterDownload) {
      quitAndInstallUpdate()
    }
  })

  autoUpdater.on('update-not-available', (info) => {
    sendToRenderer('update-not-available', info)
  })

  autoUpdater.on('download-progress', (progress) => {
    sendToRenderer('update-download-progress', progress)
  })

  autoUpdater.on('error', (err) => {
    installAfterDownload = false
    sendToRenderer('update-error', { message: err.message })
  })

  mainWindow.webContents.once('did-finish-load', () => {
    const autoCheckUpdates = store.get('autoCheckUpdates') !== false

    if (app.isPackaged && autoCheckUpdates) {
      checkForUpdates().catch((err) => {
        console.error('Update check failed:', err)
      })
    }

    // DEV: fake update — remove this block to disable
    if (!app.isPackaged && autoCheckUpdates) {
      setTimeout(() => sendToRenderer('update-available', { version: '99.0.0' }), 1500)
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.on('before-quit', () => {
  isQuitting = true
})

app.whenReady().then(() => {
  createTray()
  createWindow()
})

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

function isRunningExePath(processNames: Set<string>, appPath: string) {
  return processNames.has(getExeName(appPath))
}

function pruneStoppedRunningProcesses(processNames: Set<string>) {
  runningProcesses.forEach((_appProcess, appPath) => {
    if (!processNames.has(getExeName(appPath))) {
      runningProcesses.delete(appPath)
    }
  })
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function sendLaunchError(sender: WebContents, appPath: string, error: string) {
  if (!sender.isDestroyed()) {
    sender.send('app-launch-error', { app: appPath, error })
  }
}

function spawnDetachedApp(sender: WebContents, gameKey: string, appPath: string, gamePath?: string) {
  return new Promise<void>((resolve) => {
    let settled = false

    const resolveOnce = () => {
      if (!settled) {
        settled = true
        resolve()
      }
    }

    try {
      const child = spawn(appPath, [], { detached: true, stdio: 'ignore' })
      runningProcesses.set(appPath, {
        process: child,
        name: path.basename(appPath),
        gameKey,
        isGame: !!gamePath && appPath.toLowerCase() === gamePath
      })

      child.once('spawn', () => {
        child.unref()
        resolveOnce()
      })

      child.once('error', (err) => {
        runningProcesses.delete(appPath)
        console.error(`Error launching ${appPath}: ${err.message}`)
        sendLaunchError(sender, appPath, err.message)
        resolveOnce()
      })

      child.once('exit', () => {
        runningProcesses.delete(appPath)
      })

      setTimeout(resolveOnce, 500)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`Error launching ${appPath}: ${message}`)
      sendLaunchError(sender, appPath, message)
      resolveOnce()
    }
  })
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

async function computeGenericIconFingerprint() {
  if (process.platform !== 'win32') {
    return null
  }

  const tempExePath = path.join(
    app.getPath('temp'),
    `simlauncher-generic-icon-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.exe`
  )
  let tempFileCreated = false

  try {
    const fileDescriptor = fs.openSync(tempExePath, 'wx')
    fs.closeSync(fileDescriptor)
    tempFileCreated = true

    const icon = await app.getFileIcon(tempExePath, { size: 'normal' })
    return icon.isEmpty() ? null : icon.toDataURL()
  } catch (err) {
    console.error('Failed to fingerprint generic Windows app icon:', err)
    return null
  } finally {
    if (tempFileCreated) {
      try {
        fs.unlinkSync(tempExePath)
      } catch {
        // Cleanup failures should not hide valid executable icons.
      }
    }
  }
}

function getGenericIconFingerprint() {
  if (genericIconFingerprint !== undefined) {
    return Promise.resolve(genericIconFingerprint)
  }

  if (!genericIconFingerprintPromise) {
    genericIconFingerprintPromise = computeGenericIconFingerprint()
      .then((fingerprint) => {
        genericIconFingerprint = fingerprint
        return fingerprint
      })
      .catch((err) => {
        console.error('Failed to cache generic Windows app icon fingerprint:', err)
        genericIconFingerprint = null
        return null
      })
      .finally(() => {
        genericIconFingerprintPromise = null
      })
  }

  return genericIconFingerprintPromise
}

// INVARIANT: an exe name can only be "running" for one gameKey at a time.
// Never match by exe name globally without deduplicating across all gameKeys.
async function getTrackedRunningApps(processNames: Set<string>) {
  const profiles = store.get('profiles') as Record<string, StoredProfile> | undefined
  const appPaths = store.get('appPaths') as Record<string, string> | undefined
  const gamePaths = store.get('gamePaths') as Record<string, string> | undefined
  const trackedApps: { path: string; name: string; gameKey: string; tracked: boolean }[] = []
  const seen = new Set<string>()

  Object.entries(profiles || {}).forEach(([gameKey, profile]) => {
    if (profile?.trackingEnabled === false) {
      return
    }

    const pathsToTrack = [
      gamePaths?.[gameKey],
      ...Object.entries(profile || {})
        .filter(([profileKey, value]) => value === true && isValidExePath(appPaths?.[profileKey]))
        .map(([profileKey]) => appPaths![profileKey]),
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
ipcMain.handle('launch-profile', async (event, gameKey: string, profileApps: string[]) => {
  if (!Array.isArray(profileApps) || profileApps.length === 0) {
    return { success: false, error: 'Profile is empty.' }
  }

  if (activeLaunches.size > 0) {
    return { success: false, error: 'Another profile is already launching.' }
  }

  const cooldownRemainingMs = launchBlockedUntil - Date.now()
  if (cooldownRemainingMs > 0) {
    return {
      success: false,
      error: `Launch is settling. Try again in ${Math.ceil(cooldownRemainingMs / 1000)}s.`
    }
  }

  activeLaunches.add(gameKey)
  const launchDelayMs = getLaunchDelayMs()
  const gamePaths = store.get('gamePaths') as Record<string, string> | undefined
  const gamePath = gamePaths?.[gameKey]?.toLowerCase()
  const processNames = await readRunningProcessNames()
  const validApps = profileApps.filter((appPath) => {
    const valid = isValidExePath(appPath)
    if (!valid) {
      console.error(`Skipping invalid path: ${appPath}`)
    }
    return valid
  })

  if (validApps.length === 0) {
    activeLaunches.delete(gameKey)
    return { success: false, error: 'No valid executable paths configured.' }
  }

  let launchedAny = false

  try {
    const appsToLaunch = validApps.filter((appPath) => !isRunningExePath(processNames, appPath))
    const skippedCount = validApps.length - appsToLaunch.length

    if (appsToLaunch.length === 0) {
      return {
        success: true,
        message: 'All profile applications are already running.',
        launchedCount: 0,
        skippedCount
      }
    }

    for (let index = 0; index < appsToLaunch.length; index += 1) {
      launchedAny = true
      await spawnDetachedApp(event.sender, gameKey, appsToLaunch[index], gamePath)

      if (index < appsToLaunch.length - 1 && launchDelayMs > 0) {
        await wait(launchDelayMs)
      }
    }

    return {
      success: true,
      message: skippedCount > 0
        ? `Started ${appsToLaunch.length} app${appsToLaunch.length === 1 ? '' : 's'}; skipped ${skippedCount} already running.`
        : 'All profile applications launched.',
      launchedCount: appsToLaunch.length,
      skippedCount
    }
  } finally {
    if (launchedAny) {
      launchBlockedUntil = Date.now() + POST_LAUNCH_BLOCK_MS
    }
    activeLaunches.delete(gameKey)
  }
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
  if (store.get('minimizeToTray') !== true) {
    isQuitting = true
  }

  mainWindow?.close()
})

ipcMain.handle('get-running-apps', async () => {
  const processNames = await readRunningProcessNames()
  pruneStoppedRunningProcesses(processNames)

  const launchedApps = Array.from(runningProcesses.entries()).map(([appPath, appProcess]) => ({
    path: appPath,
    name: appProcess.name,
    gameKey: appProcess.gameKey,
    tracked: false
  }))
  const launchedKeys = new Set(launchedApps.map((appProcess) => `${appProcess.gameKey}:${appProcess.path.toLowerCase()}`))
  const launchedExeNames = new Set(launchedApps.map((appProcess) => path.basename(appProcess.path).toLowerCase()))
  // INVARIANT: only surface tracked apps for gameKeys that SimLauncher actually launched.
  // Prevents manually-launched utility apps from triggering a false "running" state. (refs #100)
  const launchedGameKeys = new Set(launchedApps.map((appProcess) => appProcess.gameKey))
  const trackedApps = (await getTrackedRunningApps(processNames)).filter(
    (appProcess) =>
      launchedGameKeys.has(appProcess.gameKey) &&
      !launchedKeys.has(`${appProcess.gameKey}:${appProcess.path.toLowerCase()}`) &&
      !launchedExeNames.has(path.basename(appProcess.path).toLowerCase())
  )

  return [...launchedApps, ...trackedApps]
})

ipcMain.handle('kill-launched-apps', (_event, gameKey?: string) => {
  return killLaunchedApps(gameKey)
})

ipcMain.handle('install-update', async () => {
  if (!app.isPackaged) {
    sendToRenderer('update-downloaded', { version: '99.0.0' })
    return { success: true }
  }

  installAfterDownload = true

  if (updateDownloaded) {
    quitAndInstallUpdate()
    return { success: true }
  }

  try {
    await autoUpdater.downloadUpdate()
    return { success: true }
  } catch (err) {
    installAfterDownload = false
    throw err
  }
})

ipcMain.handle('check-for-updates', async () => {
  return await checkForUpdates()
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

    if (icon.isEmpty()) {
      return null
    }

    const iconDataUrl = icon.toDataURL()
    const genericFingerprint = await getGenericIconFingerprint()

    if (genericFingerprint && iconDataUrl === genericFingerprint) {
      return null
    }

    return iconDataUrl
  } catch (err) {
    console.error(`Failed to get file icon for ${filePath}:`, err)
    return null
  }
})

ipcMain.handle('get-version', () => {
  return app.getVersion()
})

ipcMain.handle('set-login-item', (_event, openAtLogin: boolean) => {
  store.set('startWithWindows', openAtLogin)
  app.setLoginItemSettings({ openAtLogin })
})

ipcMain.handle('set-zoom', (_event, factor: number) => {
  store.set('zoomFactor', factor)
  mainWindow?.webContents.setZoomFactor(factor)
})

ipcMain.handle('store-get', (_event, key) => {
  return store.get(key)
})

ipcMain.handle('store-set', (_event, key, value) => {
  store.set(key, value)
})

