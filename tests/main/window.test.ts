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

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
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
