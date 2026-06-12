import { beforeEach, expect, test, vi } from 'vitest'

type MockIpcHandler = (...args: unknown[]) => unknown | Promise<unknown>

async function invokeWindowHandler(channel: string, ...args: unknown[]) {
  const { __ipcHandlers } = await import('electron')
  return (await (__ipcHandlers as Record<string, MockIpcHandler>)[channel](...args)) as {
    filePath: string | null
    inputId: string
  }
}

async function loadWindowModule() {
  const { clearIpcHandlers } = await import('electron')
  ;(clearIpcHandlers as () => void)()

  vi.doMock('../../src/main/store', () => ({
    getStoredBoolean: vi.fn(),
    getStoredZoomFactor: vi.fn()
  }))
  vi.doMock('electron-updater', () => ({
    autoUpdater: {
      autoDownload: false,
      checkForUpdates: vi.fn(),
      downloadUpdate: vi.fn(),
      on: vi.fn(),
      quitAndInstall: vi.fn()
    }
  }))

  const mod = await import('../../src/main/window')
  mod.registerWindowHandlers()
  return mod
}

async function loadWindowModuleForCreate(
  opts: {
    startMinimized?: boolean
    showTrayIcon?: boolean
    minimizeToTray?: boolean
    autoCheckUpdates?: boolean
  } = {}
) {
  const { clearIpcHandlers } = await import('electron')
  ;(clearIpcHandlers as () => void)()

  const storeValues: Record<string, unknown> = {
    startMinimized: opts.startMinimized ?? false,
    showTrayIcon: opts.showTrayIcon ?? true,
    minimizeToTray: opts.minimizeToTray ?? false,
    autoCheckUpdates: opts.autoCheckUpdates ?? true
  }
  const storeSet = vi.fn((key: string, value: unknown) => {
    storeValues[key] = value
  })
  const checkForUpdates = vi.fn().mockResolvedValue(null)

  vi.doMock('../../src/main/store', () => ({
    getStoredBoolean: vi.fn((key: string, defaultValue = false) => {
      const value = storeValues[key]
      return typeof value === 'boolean' ? value : defaultValue
    }),
    getStoredZoomFactor: vi.fn(() => 1),
    isWindowBounds: vi.fn(() => false),
    store: { get: vi.fn((key: string) => storeValues[key]), set: storeSet }
  }))
  vi.doMock('../../src/main/updater', () => ({
    registerUpdaterEvents: vi.fn(),
    checkForUpdates
  }))

  const mod = await import('../../src/main/window')
  const appState = await import('../../src/main/app-state')
  return { ...mod, appState, checkForUpdates, storeSet }
}

async function getCreatedWindow() {
  const { BrowserWindow } = await import('electron')
  type MockWindow = {
    options: { webPreferences?: Record<string, unknown> }
    show: ReturnType<typeof vi.fn>
    hide: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
    webContents: {
      emit: (event: string, ...args: unknown[]) => void
      send: ReturnType<typeof vi.fn>
      setWindowOpenHandler: ReturnType<typeof vi.fn>
    }
    emit: (event: string, ...args: unknown[]) => void
  }
  return (BrowserWindow as unknown as { instances: MockWindow[] }).instances[0]
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})

// Electron 42 regression context (#382): the renderer's boot-time set-zoom IPC
// lands between did-finish-load and the first paint of the still-hidden window,
// which permanently suppresses 'ready-to-show'. The window must not stay
// stranded hidden when that event never arrives.
test('createWindow shows the window via did-finish-load fallback when ready-to-show never fires (#382)', async () => {
  vi.useFakeTimers()
  try {
    const { createWindow } = await loadWindowModuleForCreate()
    createWindow()
    const win = await getCreatedWindow()

    expect(win.show).not.toHaveBeenCalled()
    win.webContents.emit('did-finish-load')
    await vi.advanceTimersByTimeAsync(3000)

    expect(win.show).toHaveBeenCalled()
  } finally {
    vi.useRealTimers()
  }
})

test('createWindow fallback respects start-minimized-to-tray and keeps the window hidden (#382)', async () => {
  vi.useFakeTimers()
  try {
    const { createWindow } = await loadWindowModuleForCreate({
      startMinimized: true,
      showTrayIcon: true
    })
    createWindow()
    const win = await getCreatedWindow()

    win.emit('ready-to-show')
    win.webContents.emit('did-finish-load')
    await vi.advanceTimersByTimeAsync(3000)

    expect(win.show).not.toHaveBeenCalled()
  } finally {
    vi.useRealTimers()
  }
})

test('createWindow does not double-show when ready-to-show fired before the fallback (#382)', async () => {
  vi.useFakeTimers()
  try {
    const { createWindow } = await loadWindowModuleForCreate()
    createWindow()
    const win = await getCreatedWindow()

    win.emit('ready-to-show')
    win.webContents.emit('did-finish-load')
    await vi.advanceTimersByTimeAsync(3000)

    expect(win.show).toHaveBeenCalledTimes(1)
  } finally {
    vi.useRealTimers()
  }
})

test('close quits by default and persists the window bounds first', async () => {
  const { createWindow, storeSet } = await loadWindowModuleForCreate()
  createWindow()
  const win = await getCreatedWindow()
  const closeEvent = { preventDefault: vi.fn() }

  win.emit('close', closeEvent)

  // Bounds are saved on every close path so the next start restores them.
  expect(storeSet).toHaveBeenCalledWith('windowBounds', { x: 0, y: 0, width: 800, height: 600 })
  expect(closeEvent.preventDefault).not.toHaveBeenCalled()
})

test('close hides to tray when minimize-to-tray is enabled', async () => {
  const { createWindow } = await loadWindowModuleForCreate({
    showTrayIcon: true,
    minimizeToTray: true
  })
  createWindow()
  const win = await getCreatedWindow()
  const closeEvent = { preventDefault: vi.fn() }

  win.emit('close', closeEvent)

  expect(closeEvent.preventDefault).toHaveBeenCalled()
  expect(win.hide).toHaveBeenCalled()
})

test('minimize-to-tray without a tray icon does not swallow the close', async () => {
  // No tray ⇒ nothing to minimize to; hiding would strand the only window.
  const { createWindow } = await loadWindowModuleForCreate({
    showTrayIcon: false,
    minimizeToTray: true
  })
  createWindow()
  const win = await getCreatedWindow()
  const closeEvent = { preventDefault: vi.fn() }

  win.emit('close', closeEvent)

  expect(closeEvent.preventDefault).not.toHaveBeenCalled()
  expect(win.hide).not.toHaveBeenCalled()
})

test('close with unsaved changes asks the renderer instead of closing or hiding', async () => {
  const { createWindow, appState } = await loadWindowModuleForCreate()
  appState.setRendererDirty(true)
  createWindow()
  const win = await getCreatedWindow()
  const closeEvent = { preventDefault: vi.fn() }

  win.emit('close', closeEvent)

  expect(closeEvent.preventDefault).toHaveBeenCalled()
  expect(win.hide).not.toHaveBeenCalled()
  expect(win.webContents.send).toHaveBeenCalledWith('close-requested', { minimizeMode: false })
})

test('close with unsaved changes and tray enabled asks in minimize mode', async () => {
  // Dirty must win over the tray preference — silently hiding would leave the
  // pending edits invisible and lost on a later tray-menu quit.
  const { createWindow, appState } = await loadWindowModuleForCreate({
    showTrayIcon: true,
    minimizeToTray: true
  })
  appState.setRendererDirty(true)
  createWindow()
  const win = await getCreatedWindow()
  const closeEvent = { preventDefault: vi.fn() }

  win.emit('close', closeEvent)

  expect(closeEvent.preventDefault).toHaveBeenCalled()
  expect(win.webContents.send).toHaveBeenCalledWith('close-requested', { minimizeMode: true })
})

test('explicit quit overrides both dirty state and tray preference', async () => {
  const { createWindow, appState } = await loadWindowModuleForCreate({
    showTrayIcon: true,
    minimizeToTray: true
  })
  appState.setRendererDirty(true)
  appState.setIsQuitting(true)
  createWindow()
  const win = await getCreatedWindow()
  const closeEvent = { preventDefault: vi.fn() }

  win.emit('close', closeEvent)

  expect(closeEvent.preventDefault).not.toHaveBeenCalled()
})

test('window-close IPC marks the app as quitting only on a clean, tray-less close', async () => {
  const { createWindow, registerWindowHandlers, appState } = await loadWindowModuleForCreate()
  createWindow()
  registerWindowHandlers()
  const win = await getCreatedWindow()
  const { __ipcHandlers } = await import('electron')
  const handlers = __ipcHandlers as Record<string, MockIpcHandler>

  await handlers['window-close']()

  // Without the isQuitting flag the 'close' interceptor would re-enter the
  // hide/confirm logic and the titlebar X could never actually quit.
  expect(appState.getIsQuitting()).toBe(true)
  expect(win.close).toHaveBeenCalled()
})

test('window-close IPC keeps the app alive when minimize-to-tray is on', async () => {
  const { createWindow, registerWindowHandlers, appState } = await loadWindowModuleForCreate({
    showTrayIcon: true,
    minimizeToTray: true
  })
  createWindow()
  registerWindowHandlers()
  const { __ipcHandlers } = await import('electron')
  const handlers = __ipcHandlers as Record<string, MockIpcHandler>

  await handlers['window-close']()

  expect(appState.getIsQuitting()).toBe(false)
})

// OS paths (Win+Up, aero-snap) maximize a frameless window without the
// titlebar button — the renderer's icon state relies on this push (#500).
test('maximize and unmaximize events push the window state to the renderer', async () => {
  const { createWindow } = await loadWindowModuleForCreate()
  createWindow()
  const win = await getCreatedWindow()

  win.emit('maximize')
  expect(win.webContents.send).toHaveBeenCalledWith('window-maximized-changed', true)

  win.emit('unmaximize')
  expect(win.webContents.send).toHaveBeenCalledWith('window-maximized-changed', false)
})

test('createWindow pins the renderer security hardening', async () => {
  const { createWindow } = await loadWindowModuleForCreate()
  createWindow()
  const win = await getCreatedWindow()

  expect(win.options.webPreferences).toMatchObject({
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true
  })

  // window.open and in-place navigation are both dead ends for the renderer.
  const openHandler = win.webContents.setWindowOpenHandler.mock.calls[0][0] as () => unknown
  expect(openHandler()).toEqual({ action: 'deny' })

  const navigateEvent = { preventDefault: vi.fn() }
  win.webContents.emit('will-navigate', navigateEvent)
  expect(navigateEvent.preventDefault).toHaveBeenCalled()
})

// Packaged-mode tests run outside real Electron, where process.resourcesPath
// (used for the window icon path) does not exist — stub it for the duration.
function withResourcesPath() {
  const processWithResources = process as NodeJS.Process & { resourcesPath?: string }
  processWithResources.resourcesPath = 'C:/resources'
  return () => delete processWithResources.resourcesPath
}

test('packaged builds check for updates on load only when auto-check is enabled', async () => {
  const restoreResourcesPath = withResourcesPath()
  const { app } = await import('electron')
  ;(app as { isPackaged: boolean }).isPackaged = true
  try {
    const { createWindow, checkForUpdates } = await loadWindowModuleForCreate({
      autoCheckUpdates: false
    })
    createWindow()
    const win = await getCreatedWindow()

    win.webContents.emit('did-finish-load')
    expect(checkForUpdates).not.toHaveBeenCalled()
  } finally {
    ;(app as { isPackaged: boolean }).isPackaged = false
    restoreResourcesPath()
  }
})

test('packaged builds check for updates immediately on load', async () => {
  const restoreResourcesPath = withResourcesPath()
  const { app } = await import('electron')
  ;(app as { isPackaged: boolean }).isPackaged = true
  try {
    const { createWindow, checkForUpdates } = await loadWindowModuleForCreate()
    createWindow()
    const win = await getCreatedWindow()

    win.webContents.emit('did-finish-load')
    expect(checkForUpdates).toHaveBeenCalledTimes(1)
  } finally {
    ;(app as { isPackaged: boolean }).isPackaged = false
    restoreResourcesPath()
  }
})

test('dev builds simulate the update check on a delay', async () => {
  vi.useFakeTimers()
  try {
    const { createWindow, checkForUpdates } = await loadWindowModuleForCreate()
    createWindow()
    const win = await getCreatedWindow()

    win.webContents.emit('did-finish-load')
    expect(checkForUpdates).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(2000)
    expect(checkForUpdates).toHaveBeenCalledTimes(1)
  } finally {
    vi.useRealTimers()
  }
})

test('browse-path echoes only string input ids', async () => {
  await loadWindowModule()
  const { dialog } = await import('electron')

  vi.mocked(dialog.showOpenDialog).mockResolvedValue({
    canceled: false,
    filePaths: ['C:/Tools/SimHub.exe']
  })

  await expect(invokeWindowHandler('browse-path', {}, { id: 'appPaths.simhub' })).resolves.toEqual({
    filePath: 'C:/Tools/SimHub.exe',
    inputId: ''
  })

  await expect(invokeWindowHandler('browse-path', {}, 'appPaths.simhub')).resolves.toEqual({
    filePath: 'C:/Tools/SimHub.exe',
    inputId: 'appPaths.simhub'
  })
})
