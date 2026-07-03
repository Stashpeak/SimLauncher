import { expect, test, vi, beforeEach } from 'vitest'

/**
 * 'save-settings' regression coverage (#669): the sanitizer used to silently
 * DROP invalid appPaths/gamePaths/appNames/appArgs entries while the IPC
 * returned void, so the renderer had no way to know a value it thought it
 * saved never made it to disk. These tests exercise the REAL store.ts
 * sanitizer + drop-detector (only electron-store itself is mocked) through
 * the actual 'save-settings' ipcMain handler, so a future change that
 * silently drops-not-reports an entry fails here.
 */

type MockIpcHandler = (...args: unknown[]) => unknown
interface SaveSettingsResult {
  settings: { appPaths: Record<string, string>; gamePaths: Record<string, string> }
  dropped: { field: string; key: string }[]
}

async function invokeSaveSettings(patch: unknown): Promise<SaveSettingsResult> {
  const { __ipcHandlers } = await import('electron')
  return (await (__ipcHandlers as Record<string, MockIpcHandler>)['save-settings'](
    {},
    patch
  )) as SaveSettingsResult
}

async function loadConfigModule() {
  const { clearIpcHandlers } = await import('electron')
  ;(clearIpcHandlers as () => void)()

  vi.doMock('electron-store', () => ({
    default: class MockStore {
      store: Record<string, unknown> = { customSlots: 1 }

      get(key: string) {
        return this.store[key]
      }

      set(key: string, value: unknown) {
        this.store[key] = value
      }

      clear() {
        this.store = {}
      }
    }
  }))
  vi.doMock('../../src/main/migrator', () => ({ migrateProfilesToNamedSets: vi.fn() }))
  vi.doMock('../../src/main/profiles', () => ({ isStoredProfileSet: vi.fn() }))
  vi.doMock('../../src/main/tray', () => ({ applyTrayVisibility: vi.fn() }))
  vi.doMock('../../src/main/window', () => ({
    applyRuntimeConfigSettings: vi.fn(),
    getMainWindow: vi.fn(),
    sendToRenderer: vi.fn()
  }))

  const mod = await import('../../src/main/ipc/config')
  mod.registerConfigHandlers()
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})

test('save-settings persists a valid patch and reports nothing dropped', async () => {
  await loadConfigModule()

  const result = await invokeSaveSettings({
    appPaths: { simhub: 'C:/Tools/SimHub.exe' },
    customSlots: 1
  })

  expect(result.dropped).toEqual([])
  expect(result.settings.appPaths).toEqual({ simhub: 'C:/Tools/SimHub.exe' })
})

// The exact bug: a .bat companion path used to vanish with no signal at all.
test('save-settings reports (rather than silently drops) an invalid appPaths entry (#669)', async () => {
  await loadConfigModule()

  const result = await invokeSaveSettings({
    appPaths: { simhub: 'C:/Tools/SimHub.bat' },
    customSlots: 1
  })

  expect(result.dropped).toEqual([{ field: 'appPaths', key: 'simhub' }])
  // And it genuinely isn't persisted — the returned settings is the truth.
  expect(result.settings.appPaths).toEqual({})
})

test('save-settings reports an over-length gamePaths entry as dropped', async () => {
  await loadConfigModule()

  const overlongPath = `C:/${'x'.repeat(301)}.exe`

  const result = await invokeSaveSettings({
    gamePaths: { iracing: overlongPath },
    customSlots: 1
  })

  expect(result.dropped).toEqual([{ field: 'gamePaths', key: 'iracing' }])
  expect(result.settings.gamePaths).toEqual({})
})

// Clearing a field (empty string) is an intentional "unset", not a rejected
// value — it must never be reported as dropped.
test('save-settings does not report clearing a path (empty string) as dropped', async () => {
  await loadConfigModule()

  const result = await invokeSaveSettings({
    appPaths: { simhub: '' },
    customSlots: 1
  })

  expect(result.dropped).toEqual([])
})

test('save-settings returns settings + dropped: [] even for a non-object patch', async () => {
  await loadConfigModule()

  const result = await invokeSaveSettings('not-an-object')

  expect(result.dropped).toEqual([])
  expect(result.settings).toBeDefined()
})
