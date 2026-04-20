import { app, BrowserWindow, ipcMain, dialog, nativeImage, screen, Menu, Tray, type WebContents } from 'electron'
import { execFile, spawn, type ChildProcess } from 'child_process'
import path from 'path'
import fs from 'fs'
import { autoUpdater } from 'electron-updater'
import Store from 'electron-store'

const DEFAULT_ZOOM_FACTOR = 1.0
const MIN_ZOOM_FACTOR = 0.5
const MAX_ZOOM_FACTOR = 3.0

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
    zoomFactor:       { type: 'number',  default: DEFAULT_ZOOM_FACTOR },
    windowBounds:      { type: 'object',  default: {} },
    profileUtilityOrderMigrated: { type: 'boolean', default: false },
    profileSetsMigrated: { type: 'boolean', default: false },
    migrated:     { type: 'boolean', default: false },
  }
})

const CONFIG_FILE_NAME = 'simlauncher-config.json'
const EXPECTED_CONFIG_KEYS = new Set([
  'appPaths',
  'gamePaths',
  'profiles',
  'appNames',
  'customSlots',
  'accentPreset',
  'accentCustom',
  'accentBgTint',
  'focusActiveTitle',
  'launchDelayMs',
  'startWithWindows',
  'startMinimized',
  'minimizeToTray',
  'autoCheckUpdates',
  'zoomFactor',
  'windowBounds',
  'profileUtilityOrderMigrated',
  'profileSetsMigrated',
  'migrated'
])
const LEGACY_CONFIG_KEYS = new Set([
  'killOnClose'
])
const IMPORTABLE_CONFIG_KEYS = new Set([...EXPECTED_CONFIG_KEYS, ...LEGACY_CONFIG_KEYS])
const OBJECT_CONFIG_KEYS = new Set(['appPaths', 'gamePaths', 'profiles', 'appNames', 'windowBounds'])
const STRING_CONFIG_KEYS = new Set(['accentPreset', 'accentCustom'])
const BOOLEAN_CONFIG_KEYS = new Set([
  'accentBgTint',
  'focusActiveTitle',
  'startWithWindows',
  'startMinimized',
  'minimizeToTray',
  'autoCheckUpdates',
  'profileUtilityOrderMigrated',
  'profileSetsMigrated',
  'migrated'
])
const LEGACY_BOOLEAN_CONFIG_KEYS = new Set([
  'killOnClose'
])

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let installAfterDownload = false
let updateDownloaded = false
const runningProcesses = new Map<string, { process: ChildProcess; name: string; gameKey: string; isGame: boolean }>()
const unclosedProcesses = new Map<string, { path: string; name: string; gameKey: string; error: string }>()
const activeLaunches = new Set<string>()
const POST_LAUNCH_BLOCK_MS = 10000
let launchBlockedUntil = 0
let genericIconFingerprint: string | null | undefined
let genericIconFingerprintPromise: Promise<string | null> | null = null
const UTILITY_COMPANION_PROCESS_NAMES: Record<string, string[]> = {
  garage61: ['Garage61 telemetry agent.exe']
}
const BUILT_IN_UTILITY_KEYS = ['simhub', 'crewchief', 'tradingpaints', 'garage61', 'secondmonitor']

autoUpdater.autoDownload = false

interface LaunchResult {
  success: boolean
  message?: string
  warning?: string
  error?: string
  launchedCount?: number
  skippedCount?: number
  elevatedCount?: number
  failedCount?: number
}

interface KillAttemptResult {
  processName: string
  success: boolean
  appPath?: string
  gameKey?: string
  error?: string
  accessDenied?: boolean
  notFound?: boolean
  stillRunning?: boolean
}

interface KillResult {
  success: boolean
  message?: string
  warning?: string
  error?: string
  closedCount: number
  failedCount: number
}

type AppLaunchResult =
  | { status: 'launched'; appPath: string }
  | { status: 'elevated'; appPath: string; warning: string }
  | { status: 'failed'; appPath: string; error: string }

interface StoredProfile extends Record<string, unknown> {
  utilities?: StoredProfileUtility[]
  launchAutomatically?: boolean
  trackingEnabled?: boolean
  trackedProcessPaths?: string[]
}
interface StoredNamedProfile extends StoredProfile {
  id: string
  name: string
}
interface StoredProfileSet {
  activeProfileId: string
  profiles: StoredNamedProfile[]
}
type StoredProfileEntry = StoredProfile | StoredProfileSet

interface StoredProfileUtility {
  id: string
  enabled: boolean
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

function requireSafeZoomFactor(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Zoom factor must be a finite number from ${MIN_ZOOM_FACTOR} to ${MAX_ZOOM_FACTOR}.`)
  }

  return clamp(value, MIN_ZOOM_FACTOR, MAX_ZOOM_FACTOR)
}

function getSafeZoomFactor(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_ZOOM_FACTOR
  }

  return clamp(value, MIN_ZOOM_FACTOR, MAX_ZOOM_FACTOR)
}

function getStoredZoomFactor() {
  const storedZoomFactor = store.get('zoomFactor')
  const safeZoomFactor = getSafeZoomFactor(storedZoomFactor)

  if (storedZoomFactor !== safeZoomFactor) {
    store.set('zoomFactor', safeZoomFactor)
  }

  return safeZoomFactor
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function validateImportedConfig(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error('Config file must contain a JSON object.')
  }

  const keys = Object.keys(value)

  if (keys.length === 0) {
    throw new Error('Config file is empty.')
  }

  const unexpectedKeys = keys.filter((key) => !IMPORTABLE_CONFIG_KEYS.has(key))

  if (unexpectedKeys.length > 0) {
    throw new Error(`Config file contains unsupported keys: ${unexpectedKeys.join(', ')}`)
  }

  if (!keys.some((key) => EXPECTED_CONFIG_KEYS.has(key))) {
    throw new Error('Config file does not contain SimLauncher settings.')
  }

  keys.forEach((key) => {
    const setting = value[key]

    if (OBJECT_CONFIG_KEYS.has(key) && !isRecord(setting)) {
      throw new Error(`Config value "${key}" must be an object.`)
    }

    if (STRING_CONFIG_KEYS.has(key) && typeof setting !== 'string') {
      throw new Error(`Config value "${key}" must be a string.`)
    }

    if (BOOLEAN_CONFIG_KEYS.has(key) && typeof setting !== 'boolean') {
      throw new Error(`Config value "${key}" must be a boolean.`)
    }

    if (LEGACY_BOOLEAN_CONFIG_KEYS.has(key) && typeof setting !== 'boolean') {
      throw new Error(`Config value "${key}" must be a boolean.`)
    }

    if (key === 'customSlots') {
      if (typeof setting !== 'number' || !Number.isFinite(setting) || setting < 1) {
        throw new Error('Config value "customSlots" must be a number greater than or equal to 1.')
      }
    }

    if (key === 'launchDelayMs') {
      if (typeof setting !== 'number' || !Number.isFinite(setting) || setting < 0 || setting > 5000) {
        throw new Error('Config value "launchDelayMs" must be a number from 0 to 5000.')
      }
    }

    if (key === 'zoomFactor') {
      if (typeof setting !== 'number' || !Number.isFinite(setting)) {
        throw new Error(`Config value "zoomFactor" must be a finite number from ${MIN_ZOOM_FACTOR} to ${MAX_ZOOM_FACTOR}.`)
      }
    }
  })

  return true
}

function getSupportedConfigValues(config: Record<string, unknown>) {
  const supportedConfig: Record<string, unknown> = {}

  Object.entries(config).forEach(([key, value]) => {
    if (EXPECTED_CONFIG_KEYS.has(key)) {
      supportedConfig[key] = key === 'zoomFactor' ? requireSafeZoomFactor(value) : value
    }
  })

  return supportedConfig
}

function applyRuntimeConfigSettings() {
  const startWithWindows = store.get('startWithWindows') as boolean
  app.setLoginItemSettings({ openAtLogin: !!startWithWindows })

  mainWindow?.webContents.setZoomFactor(getStoredZoomFactor())
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

function isAccessDeniedMessage(message: string) {
  return /access is denied/i.test(message)
}

function isNotFoundMessage(message: string) {
  return /not found/i.test(message)
}

function runTaskkill(args: string[], description: string) {
  return new Promise<{ success: boolean; detail?: string; accessDenied?: boolean; notFound?: boolean }>((resolve) => {
    execFile('taskkill', args, { windowsHide: true }, (error, stdout, stderr) => {
      if (!error) {
        resolve({ success: true })
        return
      }

      const detail = stderr.trim() || stdout.trim() || error.message
      const notFound = isNotFoundMessage(detail)
      const accessDenied = isAccessDeniedMessage(detail)

      if (!notFound) {
        console.error(`Failed to ${description}: ${detail}`)
      }

      resolve({
        success: notFound,
        detail,
        accessDenied,
        notFound
      })
    })
  })
}

async function killProcessTree(child: ChildProcess, appPath: string, gameKey?: string): Promise<KillAttemptResult> {
  const processName = getExeName(appPath)

  if (process.platform === 'win32' && child.pid) {
    const result = await runTaskkill(['/PID', String(child.pid), '/T', '/F'], `kill process tree for ${appPath}`)
    return {
      processName,
      appPath,
      gameKey,
      success: result.success,
      error: result.detail,
      accessDenied: result.accessDenied,
      notFound: result.notFound
    }
  }

  try {
    child.kill()
    return { processName, appPath, gameKey, success: true }
  } catch (err) {
    const error = getErrorMessage(err)
    console.error(`Error killing ${appPath}:`, err)
    return {
      processName,
      appPath,
      gameKey,
      success: false,
      error,
      accessDenied: isAccessDeniedMessage(error)
    }
  }
}

async function killProcessByImageName(processName: string, appPath?: string, gameKey?: string): Promise<KillAttemptResult> {
  if (process.platform !== 'win32') {
    return { processName, appPath, gameKey, success: true }
  }

  const result = await runTaskkill(['/IM', processName, '/T', '/F'], `kill companion process ${processName}`)
  return {
    processName,
    appPath,
    gameKey,
    success: result.success,
    error: result.detail,
    accessDenied: result.accessDenied,
    notFound: result.notFound
  }
}

function getUnclosedProcessKey(gameKey: string | undefined, appPath: string, processName: string) {
  return `${gameKey || 'unknown'}:${(appPath || processName).toLowerCase()}`
}

function clearUnclosedProcess(gameKey: string | undefined, appPath: string | undefined, processName: string) {
  unclosedProcesses.delete(getUnclosedProcessKey(gameKey, appPath || processName, processName))
}

function registerUnclosedProcess(attempt: KillAttemptResult) {
  const appPath = attempt.appPath || attempt.processName
  const gameKey = attempt.gameKey || ''
  const error =
    attempt.error ||
    (attempt.accessDenied
      ? 'Windows denied permission to close this app.'
      : 'The app is still running after the close request.')

  unclosedProcesses.set(getUnclosedProcessKey(gameKey, appPath, attempt.processName), {
    path: appPath,
    name: path.basename(appPath),
    gameKey,
    error
  })
}

function pruneUnclosedProcesses(processNames: Set<string>) {
  unclosedProcesses.forEach((entry, key) => {
    if (!processNames.has(getExeName(entry.path))) {
      unclosedProcesses.delete(key)
    }
  })
}

function formatKillWarning(failedAttempts: KillAttemptResult[]) {
  if (failedAttempts.length === 0) {
    return undefined
  }

  const first = failedAttempts[0]
  const appName = path.basename(first.appPath || first.processName)

  if (failedAttempts.length === 1) {
    return first.accessDenied
      ? `${appName} is still running because Windows denied permission to close it.`
      : `${appName} could not be closed and is still running.`
  }

  return `${failedAttempts.length} apps could not be closed and are still running.`
}

async function finalizeKillAttempts(attempts: KillAttemptResult[]): Promise<KillResult> {
  if (attempts.length === 0) {
    return {
      success: true,
      message: 'No running companion apps to close.',
      closedCount: 0,
      failedCount: 0
    }
  }

  const processNamesAfterKill = await readRunningProcessNames()
  const finalizedAttempts = attempts.map((attempt) => ({
    ...attempt,
    stillRunning: processNamesAfterKill.has(attempt.processName)
  }))

  finalizedAttempts.forEach((attempt) => {
    if (attempt.stillRunning) {
      registerUnclosedProcess(attempt)
      return
    }

    clearUnclosedProcess(attempt.gameKey, attempt.appPath, attempt.processName)
    runningProcesses.forEach((_appProcess, runningPath) => {
      if (
        (attempt.appPath && runningPath.toLowerCase() === attempt.appPath.toLowerCase()) ||
        getExeName(runningPath) === attempt.processName
      ) {
        runningProcesses.delete(runningPath)
      }
    })
  })

  const failedAttempts = finalizedAttempts.filter((attempt) => attempt.stillRunning)
  const closedCount = finalizedAttempts.length - failedAttempts.length
  const warning = formatKillWarning(failedAttempts)

  return {
    success: failedAttempts.length === 0,
    message: closedCount > 0 ? `Closed ${closedCount} companion app${closedCount === 1 ? '' : 's'}.` : undefined,
    warning,
    error: warning,
    closedCount,
    failedCount: failedAttempts.length
  }
}

function getProfileCompanionTargets(gameKey?: string) {
  const profiles = store.get('profiles') as Record<string, StoredProfileEntry> | undefined
  const gamePaths = store.get('gamePaths') as Record<string, string> | undefined
  const appPaths = store.get('appPaths') as Record<string, string> | undefined
  const companionTargets = new Map<string, { processName: string; appPath: string; gameKey: string }>()

  Object.entries(profiles || {}).forEach(([profileGameKey, profileEntry]) => {
    if (gameKey && profileGameKey !== gameKey) {
      return
    }

    const profile = getActiveStoredProfile(profileEntry)
    const gameExeName = isValidExePath(gamePaths?.[profileGameKey])
      ? getExeName(gamePaths![profileGameKey])
      : null

    Object.entries(UTILITY_COMPANION_PROCESS_NAMES).forEach(([utilityKey, processNames]) => {
      if (isUtilityEnabled(profile, utilityKey)) {
        processNames.forEach((processName) => {
          const normalizedProcessName = processName.toLowerCase()
          companionTargets.set(normalizedProcessName, {
            processName: normalizedProcessName,
            appPath: processName,
            gameKey: profileGameKey
          })
        })
      }
    })

    getProfileTrackablePaths(profileGameKey, profile, appPaths, gamePaths).forEach((processPath) => {
      const processName = getExeName(processPath)
      if (processName !== gameExeName) {
        companionTargets.set(processName, {
          processName,
          appPath: processPath,
          gameKey: profileGameKey
        })
      }
    })
  })

  return companionTargets
}

async function killLaunchedApps(gameKey?: string) {
  const processNames = await readRunningProcessNames()
  const companionTargets = getProfileCompanionTargets(gameKey)
  const killTasks: Promise<KillAttemptResult>[] = []

  runningProcesses.forEach(({ process: child }, appPath) => {
    const appProcess = runningProcesses.get(appPath)
    if (gameKey && appProcess?.gameKey !== gameKey) {
      return
    }
    if (appProcess?.isGame) {
      return
    }

    const processName = getExeName(appPath)
    companionTargets.delete(processName)

    if (processNames.has(processName)) {
      killTasks.push(killProcessTree(child, appPath, appProcess?.gameKey))
    } else {
      runningProcesses.delete(appPath)
    }
  })

  companionTargets.forEach((target) => {
    if (processNames.has(target.processName)) {
      killTasks.push(killProcessByImageName(target.processName, target.appPath, target.gameKey))
    }
  })

  return finalizeKillAttempts(await Promise.all(killTasks))
}

async function killProfileApps(gameKey: string, appPathsToKill: string[]) {
  const processNames = await readRunningProcessNames()
  const gamePaths = store.get('gamePaths') as Record<string, string> | undefined
  const gamePath = gamePaths?.[gameKey]?.toLowerCase()
  const killTasks: Promise<KillAttemptResult>[] = []
  const killedExeNames = new Set<string>()

  appPathsToKill.filter(isValidExePath).forEach((appPath) => {
    if (gamePath && appPath.toLowerCase() === gamePath) {
      return
    }
    if (!processNames.has(getExeName(appPath))) {
      return
    }

    const runningAppEntry = Array.from(runningProcesses.entries()).find(([runningPath, runningApp]) => (
      runningPath.toLowerCase() === appPath.toLowerCase() &&
      runningApp.gameKey === gameKey &&
      !runningApp.isGame
    ))

    if (runningAppEntry) {
      const [runningPath, runningApp] = runningAppEntry
      killTasks.push(killProcessTree(runningApp.process, appPath, runningApp.gameKey))
      killedExeNames.add(getExeName(appPath))
      return
    }
  })

  appPathsToKill.filter(isValidExePath).forEach((appPath) => {
    if (gamePath && appPath.toLowerCase() === gamePath) {
      return
    }

    const processName = getExeName(appPath)

    if (!killedExeNames.has(processName) && processNames.has(processName)) {
      killTasks.push(killProcessByImageName(processName, appPath, gameKey))
      killedExeNames.add(processName)
    }
  })

  return finalizeKillAttempts(await Promise.all(killTasks))
}

function createWindow() {
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

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.on('before-quit', () => {
  isQuitting = true
})

app.whenReady().then(() => {
  migrateProfilesToNamedSets()
  createTray()
  createWindow()
})

// ----------------------------------------------------------------
// HELPERS
// ----------------------------------------------------------------

function isValidExePath(p: unknown): p is string {
  return typeof p === 'string' && p.trim().length > 0 && /\.exe$/i.test(p.trim())
}

function resolveActiveProfile(entry: StoredProfileEntry | undefined): StoredNamedProfile {
  if (!entry) {
    return { id: 'default', name: 'Default' }
  }
  if (isStoredProfileSet(entry)) {
    const validProfiles = entry.profiles.filter(
      (p): p is StoredNamedProfile =>
        !!p && typeof p === 'object' && typeof (p as Record<string, unknown>).id === 'string'
    )
    if (validProfiles.length === 0) return { id: 'default', name: 'Default' }
    return validProfiles.find((p) => p.id === entry.activeProfileId) || validProfiles[0]
  }
  return { ...(entry as StoredProfile), id: 'default', name: 'Default' }
}

function resolveNamedProfile(entry: StoredProfileEntry | undefined, profileId: string): StoredNamedProfile {
  if (isStoredProfileSet(entry)) {
    const validProfiles = entry.profiles.filter(
      (p): p is StoredNamedProfile =>
        !!p && typeof p === 'object' && typeof (p as Record<string, unknown>).id === 'string'
    )
    return validProfiles.find((p) => p.id === profileId) || validProfiles[0] || { id: 'default', name: 'Default' }
  }
  return { ...(entry as StoredProfile | undefined || {}), id: 'default', name: 'Default' }
}

function getEnabledUtilityPaths(
  profile: StoredProfile,
  appPaths: Record<string, string>,
  customSlots: unknown
): string[] {
  const count =
    typeof customSlots === 'number' && Number.isFinite(customSlots) ? Math.max(1, Math.floor(customSlots)) : 1
  const utilityKeys = [
    ...BUILT_IN_UTILITY_KEYS,
    ...Array.from({ length: count }, (_, i) => `customapp${i + 1}`)
  ]
  const paths: string[] = []

  if (Array.isArray(profile.utilities)) {
    profile.utilities
      .filter(
        (u): u is StoredProfileUtility =>
          !!u &&
          typeof u === 'object' &&
          typeof (u as Record<string, unknown>).id === 'string' &&
          typeof (u as Record<string, unknown>).enabled === 'boolean'
      )
      .filter((u) => u.enabled && utilityKeys.includes(u.id) && appPaths[u.id])
      .forEach((u) => paths.push(appPaths[u.id]))
  } else {
    utilityKeys.forEach((key) => {
      if (profile[key] === true && appPaths[key]) paths.push(appPaths[key])
    })
  }

  return paths
}

function buildActiveProfileLaunchPaths(gameKey: string): string[] {
  const appPaths = (store.get('appPaths') as Record<string, string> | undefined) || {}
  const gamePaths = (store.get('gamePaths') as Record<string, string> | undefined) || {}
  const profiles = (store.get('profiles') as Record<string, StoredProfileEntry> | undefined) || {}
  const customSlots = store.get('customSlots')
  const profile = resolveActiveProfile(profiles[gameKey])
  const paths: string[] = []

  if (profile.launchAutomatically !== false && gamePaths[gameKey]) paths.push(gamePaths[gameKey])
  getEnabledUtilityPaths(profile, appPaths, customSlots).forEach((p) => paths.push(p))

  return paths
}

function buildNamedProfileLaunchPaths(gameKey: string, profileId: string): string[] {
  const appPaths = (store.get('appPaths') as Record<string, string> | undefined) || {}
  const gamePaths = (store.get('gamePaths') as Record<string, string> | undefined) || {}
  const profiles = (store.get('profiles') as Record<string, StoredProfileEntry> | undefined) || {}
  const customSlots = store.get('customSlots')
  const profile = resolveNamedProfile(profiles[gameKey], profileId)
  const paths: string[] = []

  if (profile.launchAutomatically !== false && gamePaths[gameKey]) paths.push(gamePaths[gameKey])
  getEnabledUtilityPaths(profile, appPaths, customSlots).forEach((p) => paths.push(p))

  return paths
}

async function launchProfileApps(
  sender: WebContents,
  gameKey: string,
  profileApps: string[]
): Promise<LaunchResult> {
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
    if (!isValidExePath(appPath)) {
      console.error(`Skipping invalid path: ${appPath}`)
      return false
    }
    if (!fs.existsSync(appPath.trim())) {
      console.error(`Skipping missing executable: ${appPath}`)
      return false
    }
    return true
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

    const launchResults: AppLaunchResult[] = []

    for (let index = 0; index < appsToLaunch.length; index += 1) {
      launchedAny = true
      launchResults.push(await spawnDetachedApp(sender, gameKey, appsToLaunch[index], gamePath))

      if (index < appsToLaunch.length - 1 && launchDelayMs > 0) {
        await wait(launchDelayMs)
      }
    }

    const elevatedResults = launchResults.filter(
      (result): result is Extract<AppLaunchResult, { status: 'elevated' }> => result.status === 'elevated'
    )
    const failedResults = launchResults.filter(
      (result): result is Extract<AppLaunchResult, { status: 'failed' }> => result.status === 'failed'
    )
    const launchedCount = launchResults.length - failedResults.length

    if (failedResults.length > 0) {
      const firstFailure = failedResults[0]
      const failedAppName = path.basename(firstFailure.appPath)

      return {
        success: false,
        error:
          failedResults.length === 1
            ? `Failed to launch ${failedAppName}: ${firstFailure.error}`
            : `Failed to launch ${failedResults.length} apps. First error: ${failedAppName}: ${firstFailure.error}`,
        launchedCount,
        skippedCount,
        elevatedCount: elevatedResults.length,
        failedCount: failedResults.length
      }
    }

    const elevatedWarning =
      elevatedResults.length === 1
        ? elevatedResults[0].warning
        : elevatedResults.length > 1
          ? `${elevatedResults.length} apps requested administrator permission. SimLauncher cannot track or close elevated apps after launch.`
          : undefined

    return {
      success: true,
      message:
        skippedCount > 0
          ? `Started ${launchedCount} app${launchedCount === 1 ? '' : 's'}; skipped ${skippedCount} already running.`
          : 'All profile applications launched.',
      warning: elevatedWarning,
      launchedCount,
      skippedCount,
      elevatedCount: elevatedResults.length
    }
  } finally {
    if (launchedAny) {
      launchBlockedUntil = Date.now() + POST_LAUNCH_BLOCK_MS
    }
    activeLaunches.delete(gameKey)
  }
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

function isStoredProfileUtility(value: unknown): value is StoredProfileUtility {
  if (!value || typeof value !== 'object') {
    return false
  }

  const utility = value as Record<string, unknown>
  return typeof utility.id === 'string' && typeof utility.enabled === 'boolean'
}

function isStoredProfileSet(value: unknown): value is StoredProfileSet {
  if (!value || typeof value !== 'object') {
    return false
  }

  const profileSet = value as Record<string, unknown>
  return typeof profileSet.activeProfileId === 'string' && Array.isArray(profileSet.profiles)
}

function getCustomSlotNumber(key: string) {
  const match = key.match(/^customapp(\d+)$/)
  return match ? Number(match[1]) : null
}

function getHighestCustomSlot(...records: Array<Record<string, unknown> | undefined>) {
  let highestSlot = 0

  const scanRecord = (record: Record<string, unknown> | undefined) => {
    Object.entries(record || {}).forEach(([key, value]) => {
      if (key === 'profiles' && Array.isArray(value)) {
        value.forEach((profile) => {
          if (profile && typeof profile === 'object') {
            scanRecord(profile as Record<string, unknown>)
          }
        })
        return
      }

      const slotNumber = getCustomSlotNumber(key)

      if (slotNumber !== null && (value === true || (typeof value === 'string' && value.trim().length > 0))) {
        highestSlot = Math.max(highestSlot, slotNumber)
      }

      if (key === 'utilities' && Array.isArray(value)) {
        value.filter(isStoredProfileUtility).forEach((utility) => {
          const utilitySlotNumber = getCustomSlotNumber(utility.id)

          if (utility.enabled && utilitySlotNumber !== null) {
            highestSlot = Math.max(highestSlot, utilitySlotNumber)
          }
        })
      }
    })
  }

  records.forEach((record) => {
    scanRecord(record)
  })

  return highestSlot
}

function getUtilityKeys(customSlots: unknown) {
  const slotCount = typeof customSlots === 'number' && Number.isFinite(customSlots)
    ? Math.max(1, Math.floor(customSlots))
    : 1

  return [
    ...BUILT_IN_UTILITY_KEYS,
    ...Array.from({ length: slotCount }, (_value, index) => `customapp${index + 1}`)
  ]
}

function getEnabledUtilityKeys(profile: StoredProfile | undefined) {
  if (!profile) {
    return []
  }

  if (Array.isArray(profile.utilities)) {
    return profile.utilities
      .filter((utility) => isStoredProfileUtility(utility) && utility.enabled)
      .map((utility) => utility.id)
  }

  return Object.entries(profile)
    .filter(([_key, value]) => value === true)
    .map(([key]) => key)
}

function isUtilityEnabled(profile: StoredProfile | undefined, utilityKey: string) {
  if (!profile) {
    return false
  }

  if (Array.isArray(profile.utilities)) {
    return profile.utilities.some((utility) => (
      isStoredProfileUtility(utility) && utility.id === utilityKey && utility.enabled
    ))
  }

  return profile[utilityKey] === true
}

function getActiveStoredProfile(profileEntry: StoredProfileEntry | undefined) {
  if (!profileEntry) {
    return undefined
  }

  if (isStoredProfileSet(profileEntry)) {
    return profileEntry.profiles.find((profile) => profile.id === profileEntry.activeProfileId) || profileEntry.profiles[0]
  }

  return profileEntry
}

function normalizeStoredProfileUtilityOrder(profile: StoredProfile, utilityKeys: string[]) {
  const normalizedProfile: StoredProfile = {
    ...profile,
    utilities: Array.isArray(profile.utilities)
      ? profile.utilities.filter(isStoredProfileUtility)
      : utilityKeys.map((utilityKey) => ({
        id: utilityKey,
        enabled: profile[utilityKey] === true
      }))
  }

  utilityKeys.forEach((utilityKey) => {
    delete normalizedProfile[utilityKey]
  })

  return normalizedProfile
}

function normalizeStoredNamedProfile(value: unknown, utilityKeys: string[], fallbackIndex: number): StoredNamedProfile | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const profile = value as StoredProfile
  const orderedProfile = normalizeStoredProfileUtilityOrder(profile, utilityKeys)
  const rawProfile = value as Record<string, unknown>

  return {
    ...orderedProfile,
    id: typeof rawProfile.id === 'string' && rawProfile.id.trim().length > 0
      ? rawProfile.id
      : `profile-${Date.now().toString(36)}-${fallbackIndex}`,
    name: typeof rawProfile.name === 'string' && rawProfile.name.trim().length > 0
      ? rawProfile.name.trim()
      : fallbackIndex === 0 ? 'Default' : `Profile ${fallbackIndex + 1}`
  }
}

function normalizeStoredProfileSet(profileEntry: StoredProfileEntry, utilityKeys: string[]) {
  if (isStoredProfileSet(profileEntry)) {
    const seen = new Set<string>()
    const profiles = profileEntry.profiles.flatMap((profile, index) => {
      const normalizedProfile = normalizeStoredNamedProfile(profile, utilityKeys, index)

      if (!normalizedProfile || seen.has(normalizedProfile.id)) {
        return []
      }

      seen.add(normalizedProfile.id)
      return [normalizedProfile]
    })

    if (profiles.length === 0) {
      const defaultProfile = normalizeStoredNamedProfile({}, utilityKeys, 0)!
      defaultProfile.id = 'default'
      defaultProfile.name = 'Default'
      return {
        activeProfileId: defaultProfile.id,
        profiles: [defaultProfile]
      }
    }

    return {
      activeProfileId: profiles.some((profile) => profile.id === profileEntry.activeProfileId)
        ? profileEntry.activeProfileId
        : profiles[0].id,
      profiles
    }
  }

  const defaultProfile = normalizeStoredNamedProfile(profileEntry, utilityKeys, 0)!
  defaultProfile.id = 'default'
  defaultProfile.name = 'Default'

  return {
    activeProfileId: defaultProfile.id,
    profiles: [defaultProfile]
  }
}

function migrateProfilesToNamedSets() {
  if (store.get('profileSetsMigrated') === true) {
    return
  }

  const profiles = store.get('profiles') as Record<string, StoredProfileEntry> | undefined
  const appPaths = store.get('appPaths') as Record<string, string> | undefined

  if (!profiles || Object.keys(profiles).length === 0) {
    store.set('profileUtilityOrderMigrated', true)
    store.set('profileSetsMigrated', true)
    return
  }

  const savedCustomSlots = store.get('customSlots')
  const customSlots = Math.max(
    typeof savedCustomSlots === 'number' && Number.isFinite(savedCustomSlots) ? savedCustomSlots : 1,
    getHighestCustomSlot(appPaths, ...Object.values(profiles).map((profile) => profile as Record<string, unknown>))
  )
  const utilityKeys = getUtilityKeys(customSlots)
  const migratedProfiles = Object.fromEntries(
    Object.entries(profiles).map(([gameKey, profileEntry]) => [
      gameKey,
      normalizeStoredProfileSet(profileEntry, utilityKeys)
    ])
  )

  store.set('customSlots', customSlots)
  store.set('profiles', migratedProfiles)
  store.set('profileUtilityOrderMigrated', true)
  store.set('profileSetsMigrated', true)
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

function getErrorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err)
}

function getErrorCode(err: unknown) {
  return err && typeof err === 'object' && 'code' in err ? String((err as { code?: unknown }).code) : undefined
}

function isElevatedLaunchError(err: unknown) {
  return process.platform === 'win32' && getErrorCode(err) === 'EACCES'
}

function launchElevated(appPath: string) {
  return new Promise<AppLaunchResult>((resolve) => {
    const escapedAppPath = appPath.replace(/'/g, "''")

    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', `Start-Process -FilePath '${escapedAppPath}' -Verb RunAs`],
      { windowsHide: true },
      (error) => {
        if (error) {
          const message = `Administrator permission was requested for ${path.basename(appPath)}, but Windows did not start it. ${getErrorMessage(error)}`
          console.error(`Error launching ${appPath} as administrator: ${getErrorMessage(error)}`)
          resolve({ status: 'failed', appPath, error: message })
          return
        }

        resolve({
          status: 'elevated',
          appPath,
          warning: `${path.basename(appPath)} requested administrator permission. SimLauncher cannot track or close elevated apps after launch.`
        })
      }
    )
  })
}

function spawnDetachedApp(sender: WebContents, gameKey: string, appPath: string, gamePath?: string) {
  return new Promise<AppLaunchResult>((resolve) => {
    let settled = false
    let fallbackTimer: ReturnType<typeof setTimeout> | undefined

    const resolveOnce = (result: AppLaunchResult) => {
      if (!settled) {
        settled = true
        if (fallbackTimer) {
          clearTimeout(fallbackTimer)
        }
        resolve(result)
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
        resolveOnce({ status: 'launched', appPath })
      })

      child.once('error', async (err) => {
        runningProcesses.delete(appPath)
        if (fallbackTimer) {
          clearTimeout(fallbackTimer)
        }
        const message = getErrorMessage(err)
        console.error(`Error launching ${appPath}: ${message}`)

        if (settled) {
          sendLaunchError(sender, appPath, message)
          return
        }

        if (isElevatedLaunchError(err)) {
          resolveOnce(await launchElevated(appPath))
          return
        }

        resolveOnce({ status: 'failed', appPath, error: message })
      })

      child.once('exit', () => {
        runningProcesses.delete(appPath)
      })

      fallbackTimer = setTimeout(() => resolveOnce({ status: 'launched', appPath }), 500)
    } catch (err) {
      const message = getErrorMessage(err)
      console.error(`Error launching ${appPath}: ${message}`)

      if (isElevatedLaunchError(err)) {
        launchElevated(appPath).then(resolveOnce)
        return
      }

      resolveOnce({ status: 'failed', appPath, error: message })
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

function getProfileTrackablePaths(
  gameKey: string,
  profile: StoredProfile | undefined,
  appPaths: Record<string, string> | undefined,
  gamePaths: Record<string, string> | undefined
) {
  const trackablePaths = [
    gamePaths?.[gameKey],
    ...getEnabledUtilityKeys(profile)
      .filter((profileKey) => isValidExePath(appPaths?.[profileKey]))
      .map((profileKey) => appPaths![profileKey]),
    ...(Array.isArray(profile?.trackedProcessPaths) ? profile.trackedProcessPaths : [])
  ].filter(isValidExePath)
  const seen = new Set<string>()

  return trackablePaths.filter((trackablePath) => {
    const key = trackablePath.toLowerCase()

    if (seen.has(key)) {
      return false
    }

    seen.add(key)
    return true
  })
}

function getExternallyAdoptableGameKeys(
  processNames: Set<string>,
  profiles: Record<string, StoredProfileEntry> | undefined,
  gamePaths: Record<string, string> | undefined,
  launchedGameKeys: Set<string>
) {
  const gameExeOwners = new Map<string, Set<string>>()

  Object.entries(profiles || {}).forEach(([gameKey]) => {
    const gamePath = gamePaths?.[gameKey]

    if (!isValidExePath(gamePath)) {
      return
    }

    const exeName = getExeName(gamePath)
    const owners = gameExeOwners.get(exeName) || new Set<string>()
    owners.add(gameKey)
    gameExeOwners.set(exeName, owners)
  })

  const adoptableGameKeys = new Set<string>()

  Object.entries(profiles || {}).forEach(([gameKey]) => {
    if (launchedGameKeys.has(gameKey)) {
      return
    }

    const gamePath = gamePaths?.[gameKey]

    if (!isValidExePath(gamePath)) {
      return
    }

    const exeName = getExeName(gamePath)
    const owners = gameExeOwners.get(exeName)

    if (owners?.size === 1 && processNames.has(exeName)) {
      adoptableGameKeys.add(gameKey)
    }
  })

  return adoptableGameKeys
}

// INVARIANT: manual companion utilities are only surfaced when the owning game is
// already launched by SimLauncher or its configured game exe is externally running.
async function getTrackedRunningApps(
  processNames: Set<string>,
  adoptedOrLaunchedGameKeys: Set<string>,
  profiles: Record<string, StoredProfileEntry> | undefined,
  appPaths: Record<string, string> | undefined,
  gamePaths: Record<string, string> | undefined
) {
  const trackedApps: { path: string; name: string; gameKey: string; tracked: boolean }[] = []
  const seen = new Set<string>()

  Object.entries(profiles || {}).forEach(([gameKey, profileEntry]) => {
    if (!adoptedOrLaunchedGameKeys.has(gameKey)) {
      return
    }

    const profile = getActiveStoredProfile(profileEntry)

    if (profile?.trackingEnabled === false) {
      return
    }

    const pathsToTrack = getProfileTrackablePaths(gameKey, profile, appPaths, gamePaths)

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

ipcMain.handle('launch-profile', async (event, gameKey: string) => {
  const profileApps = buildActiveProfileLaunchPaths(gameKey)

  if (profileApps.length === 0) {
    return { success: false, error: 'No executable paths configured for this profile.' }
  }

  return launchProfileApps(event.sender, gameKey, profileApps)
})

ipcMain.handle('relaunch-missing-profile', async (event, gameKey: string) => {
  const allPaths = buildActiveProfileLaunchPaths(gameKey)

  if (allPaths.length === 0) {
    return { success: false, error: 'No executable paths configured for this profile.' }
  }

  const processNames = await readRunningProcessNames()
  const missingPaths = allPaths.filter((p) => !isRunningExePath(processNames, p))

  if (missingPaths.length === 0) {
    return { success: true, message: 'All profile apps are already running.', launchedCount: 0, skippedCount: 0 }
  }

  return launchProfileApps(event.sender, gameKey, missingPaths)
})

ipcMain.handle('get-profile-switch-diff', async (_event, gameKey: string, fromProfileId: string, toProfileId: string) => {
  const gamePaths = (store.get('gamePaths') as Record<string, string> | undefined) || {}
  const gamePath = gamePaths[gameKey]?.toLowerCase()
  const processNames = await readRunningProcessNames()

  const utilityPaths = (profileId: string) =>
    new Set(
      buildNamedProfileLaunchPaths(gameKey, profileId)
        .filter((p) => !gamePath || p.toLowerCase() !== gamePath)
        .map((p) => p.toLowerCase())
    )

  const fromPaths = utilityPaths(fromProfileId)
  const toPaths = utilityPaths(toProfileId)
  const toStopCount = [...fromPaths].filter((p) => !toPaths.has(p) && processNames.has(getExeName(p))).length
  const toStartCount = [...toPaths].filter((p) => !processNames.has(getExeName(p))).length

  return { toStopCount, toStartCount }
})

ipcMain.handle(
  'switch-profile-apps',
  async (event, gameKey: string, fromProfileId: string, toProfileId: string) => {
    const gamePaths = (store.get('gamePaths') as Record<string, string> | undefined) || {}
    const gamePath = gamePaths[gameKey]?.toLowerCase()

    const fromPaths = buildNamedProfileLaunchPaths(gameKey, fromProfileId).filter(
      (p) => !gamePath || p.toLowerCase() !== gamePath
    )
    const toPaths = buildNamedProfileLaunchPaths(gameKey, toProfileId).filter(
      (p) => !gamePath || p.toLowerCase() !== gamePath
    )
    const toPathSet = new Set(toPaths.map((p) => p.toLowerCase()))
    const processNamesBeforeSwitch = await readRunningProcessNames()

    const pathsToStop = fromPaths.filter(
      (p) => !toPathSet.has(p.toLowerCase()) && processNamesBeforeSwitch.has(getExeName(p))
    )
    let killResult: KillResult | undefined

    if (pathsToStop.length > 0) {
      killResult = await killProfileApps(gameKey, pathsToStop)
    }

    const processNamesAfterStop = await readRunningProcessNames()
    const pathsToStart = toPaths.filter((p) => !processNamesAfterStop.has(getExeName(p)))

    if (pathsToStart.length === 0) {
      return {
        success: true,
        message: killResult?.message,
        warning: killResult?.warning,
        launchedCount: 0,
        skippedCount: 0,
        failedCount: killResult?.failedCount
      }
    }

    const launchResult = await launchProfileApps(event.sender, gameKey, pathsToStart)
    const warnings = [killResult?.warning, launchResult.warning].filter(Boolean)

    return {
      ...launchResult,
      warning: warnings.length > 0 ? warnings.join(' ') : undefined,
      failedCount: (launchResult.failedCount || 0) + (killResult?.failedCount || 0)
    }
  }
)

// ----------------------------------------------------------------
// CONFIG EXPORT / IMPORT
// ----------------------------------------------------------------

ipcMain.handle('export-config', async () => {
  try {
    const options = {
      title: 'Export SimLauncher Config',
      defaultPath: CONFIG_FILE_NAME,
      filters: [{ name: 'JSON Files', extensions: ['json'] }]
    }
    const result = mainWindow && !mainWindow.isDestroyed()
      ? await dialog.showSaveDialog(mainWindow, options)
      : await dialog.showSaveDialog(options)

    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true }
    }

    await fs.promises.writeFile(result.filePath, JSON.stringify(getSupportedConfigValues(store.store), null, 2), 'utf8')
    return { success: true, filePath: result.filePath }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('Failed to export config:', err)
    return { success: false, error: message }
  }
})

ipcMain.handle('import-config', async () => {
  try {
    const options = {
      title: 'Import SimLauncher Config',
      properties: ['openFile'] as const,
      filters: [{ name: 'JSON Files', extensions: ['json'] }]
    }
    const result = mainWindow && !mainWindow.isDestroyed()
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options)

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, canceled: true }
    }

    const rawConfig = await fs.promises.readFile(result.filePaths[0], 'utf8')
    const parsedConfig = JSON.parse(rawConfig) as unknown
    validateImportedConfig(parsedConfig)
    const supportedConfig = getSupportedConfigValues(parsedConfig)

    store.clear()
    store.set(supportedConfig)
    migrateProfilesToNamedSets()
    applyRuntimeConfigSettings()

    return { success: true, filePath: result.filePaths[0] }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('Failed to import config:', err)
    return { success: false, error: message }
  }
})

// ----------------------------------------------------------------
// FILE BROWSER DIALOG LISTENER
// ----------------------------------------------------------------

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
    isQuitting = true
  }

  mainWindow?.close()
})

ipcMain.handle('get-running-apps', async () => {
  const processNames = await readRunningProcessNames()
  pruneStoppedRunningProcesses(processNames)
  pruneUnclosedProcesses(processNames)

  const launchedApps = Array.from(runningProcesses.entries()).map(([appPath, appProcess]) => ({
    path: appPath,
    name: appProcess.name,
    gameKey: appProcess.gameKey,
    tracked: false
  }))
  const unclosedApps = Array.from(unclosedProcesses.values())
    .filter((appProcess) => processNames.has(getExeName(appProcess.path)))
    .map((appProcess) => ({
      path: appProcess.path,
      name: appProcess.name,
      gameKey: appProcess.gameKey,
      tracked: true,
      warning: appProcess.error
    }))
  const surfacedApps = [...launchedApps, ...unclosedApps]
  const launchedKeys = new Set(surfacedApps.map((appProcess) => `${appProcess.gameKey}:${appProcess.path.toLowerCase()}`))
  const launchedExeNames = new Set(surfacedApps.map((appProcess) => path.basename(appProcess.path).toLowerCase()))
  const profiles = store.get('profiles') as Record<string, StoredProfileEntry> | undefined
  const appPaths = store.get('appPaths') as Record<string, string> | undefined
  const gamePaths = store.get('gamePaths') as Record<string, string> | undefined
  const launchedGameKeys = new Set(surfacedApps.map((appProcess) => appProcess.gameKey))
  const adoptedGameKeys = getExternallyAdoptableGameKeys(processNames, profiles, gamePaths, launchedGameKeys)
  const adoptedOrLaunchedGameKeys = new Set([...launchedGameKeys, ...adoptedGameKeys])
  const trackedApps = (await getTrackedRunningApps(
    processNames,
    adoptedOrLaunchedGameKeys,
    profiles,
    appPaths,
    gamePaths
  )).filter(
    (appProcess) =>
      !launchedKeys.has(`${appProcess.gameKey}:${appProcess.path.toLowerCase()}`) &&
      !launchedExeNames.has(path.basename(appProcess.path).toLowerCase())
  )

  return [...surfacedApps, ...trackedApps]
})

ipcMain.handle('kill-launched-apps', (_event, gameKey?: string) => {
  return killLaunchedApps(gameKey)
})

ipcMain.handle('kill-profile-apps', (_event, gameKey: string, appPathsToKill: string[]) => {
  return killProfileApps(gameKey, Array.isArray(appPathsToKill) ? appPathsToKill : [])
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

ipcMain.handle('get-asset-data', async (_event, filename: unknown) => {
  if (typeof filename !== 'string' || path.basename(filename) !== filename || !filename) return null
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
  const storedPaths = [
    ...Object.values((store.get('gamePaths') as Record<string, string>) ?? {}),
    ...Object.values((store.get('appPaths') as Record<string, string>) ?? {})
  ]
  if (!storedPaths.includes(filePath)) return null

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

ipcMain.handle('set-zoom', (_event, factor: unknown) => {
  const zoomFactor = requireSafeZoomFactor(factor)

  store.set('zoomFactor', zoomFactor)
  mainWindow?.webContents.setZoomFactor(zoomFactor)
})

ipcMain.handle('store-get', (_event, key: unknown) => {
  if (typeof key !== 'string' || !EXPECTED_CONFIG_KEYS.has(key)) return undefined
  return store.get(key)
})

ipcMain.handle('store-set', (_event, key: unknown, value: unknown) => {
  if (typeof key !== 'string' || !EXPECTED_CONFIG_KEYS.has(key)) return
  if (key === 'zoomFactor') {
    store.set('zoomFactor', requireSafeZoomFactor(value))
    return
  }

  store.set(key, value)
})

