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

test('force-minimize-to-tray does NOT set quitting (renderer keeps living in tray, refs #424)', async () => {
  await loadWindowModule()
  const appState = await import('../../src/main/app-state')

  await invokeWindowHandler('set-renderer-dirty', {}, true)
  expect(appState.getRendererDirty()).toBe(true)
  expect(appState.getIsQuitting()).toBe(false)

  await invokeWindowHandler('force-minimize-to-tray', {})

  // Quitting must stay false: the renderer keeps running in the tray and the
  // dirty flag will propagate to false on the next render after the save or
  // discard handler completes. We must NOT clear it here, otherwise a later
  // tray menu "Quit" would lose any state that hadn't been propagated yet.
  expect(appState.getIsQuitting()).toBe(false)
  expect(appState.getRendererDirty()).toBe(true)
})

test('decideCloseAction: dirty takes precedence over tray (covers #424 scenarios 2 & 4)', async () => {
  const { decideCloseAction } = await import('../../src/main/window')

  // Scenario 1: tray off + dirty → confirm-close
  expect(
    decideCloseAction({ isQuitting: false, isDirty: true, effectiveMinimizeToTray: false })
  ).toBe('confirm-close')

  // Scenarios 2 & 4: tray on (persisted or pending) + dirty → confirm-minimize
  // (previously: silent hide bypassed dirty confirm)
  expect(
    decideCloseAction({ isQuitting: false, isDirty: true, effectiveMinimizeToTray: true })
  ).toBe('confirm-minimize')

  // Clean state + tray on → silent hide (correct existing behavior)
  expect(
    decideCloseAction({ isQuitting: false, isDirty: false, effectiveMinimizeToTray: true })
  ).toBe('hide')

  // Clean state + tray off → quit
  expect(
    decideCloseAction({ isQuitting: false, isDirty: false, effectiveMinimizeToTray: false })
  ).toBe('quit')

  // Explicit quit short-circuits everything (force-close-window path)
  expect(
    decideCloseAction({ isQuitting: true, isDirty: true, effectiveMinimizeToTray: true })
  ).toBe('quit')
})
