import { beforeEach, expect, test, vi } from 'vitest'

const setZoomFactor = vi.fn()
const getZoomFactor = vi.fn(() => 1.5)

async function loadConfigZoomHandler() {
  const { clearIpcHandlers } = await import('electron')
  ;(clearIpcHandlers as () => void)()

  vi.doMock('../../src/main/window', () => ({
    getMainWindow: vi.fn(() => ({ webContents: { setZoomFactor, getZoomFactor } })),
    applyRuntimeConfigSettings: vi.fn(),
    sendToRenderer: vi.fn()
  }))
  vi.doMock('../../src/main/tray', () => ({ applyTrayVisibility: vi.fn() }))
  vi.doMock('../../src/main/migrator', () => ({ migrateProfilesToNamedSets: vi.fn() }))
  vi.doMock('../../src/main/store', () => ({
    CONFIG_FILE_NAME: 'config.json',
    KNOWN_GAME_KEYS: new Set(['iracing']),
    MAX_CONFIG_IMPORT_BYTES: 1024 * 1024,
    MAX_CUSTOM_SLOTS: 20,
    consumeConfigRecoveryNotice: vi.fn(() => null),
    formatConfigRecoveryNotice: vi.fn(),
    getDroppedSettingsEntries: vi.fn(() => []),
    getSupportedConfigValues: vi.fn(() => ({})),
    getStoredZoomFactor: vi.fn(() => 1.5),
    requireSafeZoomFactor: vi.fn((value: unknown) => {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error('Invalid zoom factor')
      }
      return value
    }),
    sanitizeImportedConfig: vi.fn(() => ({})),
    sanitizeSettingsPatch: vi.fn(() => ({})),
    store: { get: vi.fn(), set: vi.fn(), store: {} }
  }))

  const mod = await import('../../src/main/ipc/config')
  mod.registerConfigHandlers()
  const { __ipcHandlers } = await import('electron')
  return __ipcHandlers as Record<string, (...args: unknown[]) => unknown>
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})

// Re-setting the current zoom factor on a still-hidden window suppresses
// 'ready-to-show' forever on Electron 42 — and the renderer's boot-time
// set-zoom call is always a same-value call (both sides read the same store).
// The handler must skip the Chromium call when nothing changes. (#382)
test('set-zoom skips the Chromium call when the factor matches the current zoom (#382)', async () => {
  const handlers = await loadConfigZoomHandler()

  await handlers['set-zoom']({}, 1.5)

  expect(setZoomFactor).not.toHaveBeenCalled()
})

test('set-zoom applies a changed factor (#382)', async () => {
  const handlers = await loadConfigZoomHandler()

  await handlers['set-zoom']({}, 1.25)

  expect(setZoomFactor).toHaveBeenCalledWith(1.25)
})
