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
  opts: { startMinimized?: boolean; showTrayIcon?: boolean } = {}
) {
  const { clearIpcHandlers } = await import('electron')
  ;(clearIpcHandlers as () => void)()

  vi.doMock('../../src/main/store', () => ({
    getStoredBoolean: vi.fn((key: string, defaultValue = false) => {
      if (key === 'startMinimized') return opts.startMinimized ?? false
      if (key === 'showTrayIcon') return opts.showTrayIcon ?? true
      return defaultValue
    }),
    getStoredZoomFactor: vi.fn(() => 1),
    isWindowBounds: vi.fn(() => false),
    store: { get: vi.fn(() => undefined), set: vi.fn() }
  }))
  vi.doMock('../../src/main/updater', () => ({
    registerUpdaterEvents: vi.fn(),
    checkForUpdates: vi.fn().mockResolvedValue(null)
  }))

  return await import('../../src/main/window')
}

async function getCreatedWindow() {
  const { BrowserWindow } = await import('electron')
  type MockWindow = {
    show: ReturnType<typeof vi.fn>
    webContents: { emit: (event: string, ...args: unknown[]) => void }
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
