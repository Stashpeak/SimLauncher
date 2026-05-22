import { beforeEach, expect, test, vi } from 'vitest'

type MockIpcHandler = (...args: unknown[]) => unknown | Promise<unknown>

async function invokeWindowHandler(channel: string, ...args: unknown[]) {
  const { __ipcHandlers } = await import('electron')
  return await (__ipcHandlers as Record<string, MockIpcHandler>)[channel](...args)
}

async function loadWindowModule() {
  const { clearIpcHandlers } = await import('electron')
  ;(clearIpcHandlers as () => void)()

  vi.doMock('../../src/main/store', () => {
    const inMemoryStore: Record<string, unknown> = {}
    return {
      getStoredBoolean: vi.fn(),
      getStoredZoomFactor: vi.fn(),
      store: {
        get: (key: string) => inMemoryStore[key],
        set: (key: string, value: unknown) => {
          inMemoryStore[key] = value
        }
      },
      isWindowBounds: () => false
    }
  })
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

test('set-renderer-dirty flips dirty flag and force-close-window resets it', async () => {
  await loadWindowModule()
  const appState = await import('../../src/main/app-state')

  expect(appState.getRendererDirty()).toBe(false)

  await invokeWindowHandler('set-renderer-dirty', {}, true)
  expect(appState.getRendererDirty()).toBe(true)

  await invokeWindowHandler('set-renderer-dirty', {}, false)
  expect(appState.getRendererDirty()).toBe(false)
})

test('set-pending-minimize-to-tray accepts boolean and null, ignores other values', async () => {
  await loadWindowModule()
  const appState = await import('../../src/main/app-state')

  await invokeWindowHandler('set-pending-minimize-to-tray', {}, true)
  expect(appState.getPendingMinimizeToTray()).toBe(true)

  await invokeWindowHandler('set-pending-minimize-to-tray', {}, false)
  expect(appState.getPendingMinimizeToTray()).toBe(false)

  await invokeWindowHandler('set-pending-minimize-to-tray', {}, null)
  expect(appState.getPendingMinimizeToTray()).toBe(null)

  // Non-boolean, non-null values reset the pending preference
  await invokeWindowHandler('set-pending-minimize-to-tray', {}, 'invalid')
  expect(appState.getPendingMinimizeToTray()).toBe(null)
})

test('force-close-window sets quitting and clears renderer dirty flag (Closes #387)', async () => {
  await loadWindowModule()
  const appState = await import('../../src/main/app-state')

  await invokeWindowHandler('set-renderer-dirty', {}, true)
  expect(appState.getRendererDirty()).toBe(true)

  await invokeWindowHandler('force-close-window', {})

  expect(appState.getIsQuitting()).toBe(true)
  expect(appState.getRendererDirty()).toBe(false)
})
