import { beforeEach, expect, test, vi } from 'vitest'

type MockIpcHandler = (...args: unknown[]) => Promise<unknown>

const migrateProfilesToNamedSets = vi.fn()
const importedConfig = {
  customSlots: 2,
  appPaths: { simhub: 'C:/Tools/NewSimHub.exe' }
}

class MockStore {
  data: Record<string, unknown>

  constructor(initial: Record<string, unknown>) {
    this.data = { ...initial }
  }

  get store() {
    return { ...this.data }
  }

  get(key: string) {
    return this.data[key]
  }

  set(key: string, value: unknown) {
    this.data[key] = value
  }

  clear() {
    this.data = {}
  }
}

async function loadConfigHandlers(initialStore: Record<string, unknown>) {
  const { clearIpcHandlers } = await import('electron')
  ;(clearIpcHandlers as () => void)()

  const mockStore = new MockStore(initialStore)

  vi.doMock('fs', () => ({
    default: {
      promises: {
        stat: vi.fn(async () => ({ size: 100 })),
        readFile: vi.fn(async () => JSON.stringify({ customSlots: 2 })),
        writeFile: vi.fn()
      }
    }
  }))

  const migratorMock = { migrateProfilesToNamedSets }
  vi.doMock('../migrator', () => migratorMock)
  vi.doMock('/src/main/migrator.ts', () => migratorMock)
  vi.doMock('../../src/main/migrator', () => migratorMock)
  vi.doMock('../../src/main/migrator.ts', () => migratorMock)

  const windowMock = {
    getMainWindow: vi.fn(() => null),
    applyRuntimeConfigSettings: vi.fn(),
    sendToRenderer: vi.fn()
  }
  vi.doMock('../window', () => windowMock)
  vi.doMock('/src/main/window.ts', () => windowMock)
  vi.doMock('../../src/main/window', () => windowMock)
  vi.doMock('../../src/main/window.ts', () => windowMock)

  const trayMock = { applyTrayVisibility: vi.fn() }
  vi.doMock('../tray', () => trayMock)
  vi.doMock('/src/main/tray.ts', () => trayMock)
  vi.doMock('../../src/main/tray', () => trayMock)
  vi.doMock('../../src/main/tray.ts', () => trayMock)

  const storeMock = {
    CONFIG_FILE_NAME: 'simlauncher-config.json',
    KNOWN_GAME_KEYS: new Set(['iracing']),
    LOCAL_ONLY_STORE_KEYS: ['onboardingSeen'],
    MAX_CONFIG_IMPORT_BYTES: 1024 * 1024,
    MAX_CUSTOM_SLOTS: 20,
    consumeConfigRecoveryNotice: vi.fn(() => null),
    formatConfigRecoveryNotice: vi.fn(),
    getDroppedSettingsEntries: vi.fn(() => []),
    getSupportedConfigValues: vi.fn(() => ({})),
    getStoredZoomFactor: vi.fn(() => 1),
    requireSafeZoomFactor: vi.fn((value: unknown) => value),
    sanitizeImportedConfig: vi.fn(() => ({ ...importedConfig })),
    sanitizeSettingsPatch: vi.fn(() => ({})),
    store: mockStore
  }
  vi.doMock('../store', () => storeMock)
  vi.doMock('/src/main/store.ts', () => storeMock)
  vi.doMock('../../src/main/store', () => storeMock)
  vi.doMock('../../src/main/store.ts', () => storeMock)

  const profilesMock = { isStoredProfileSet: vi.fn(() => false) }
  vi.doMock('../profiles', () => profilesMock)
  vi.doMock('/src/main/profiles.ts', () => profilesMock)
  vi.doMock('../../src/main/profiles', () => profilesMock)
  vi.doMock('../../src/main/profiles.ts', () => profilesMock)

  const configModule = await import('../../src/main/ipc/config')
  configModule.registerConfigHandlers()

  const { dialog, __ipcHandlers } = await import('electron')
  vi.mocked(dialog.showOpenDialog).mockResolvedValue({
    canceled: false,
    filePaths: ['C:/Backups/simlauncher-config.json']
  } as never)

  return {
    handlers: __ipcHandlers as Record<string, MockIpcHandler>,
    mockStore
  }
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})

async function previewThenApply(handlers: Record<string, MockIpcHandler>) {
  const preview = (await handlers['preview-import-config']({})) as {
    success: boolean
    token: string
  }
  expect(preview.success).toBe(true)
  return handlers['apply-import-config']({}, preview.token)
}

test('applying an import replaces the store with the sanitized config', async () => {
  const { handlers, mockStore } = await loadConfigHandlers({
    customSlots: 5,
    gamePaths: { iracing: 'C:/Games/Old.exe' }
  })

  await expect(previewThenApply(handlers)).resolves.toEqual({
    success: true,
    filePath: 'C:/Backups/simlauncher-config.json'
  })
  // clear() before apply: keys absent from the import must not survive.
  expect(mockStore.data).toEqual(importedConfig)
  expect(migrateProfilesToNamedSets).toHaveBeenCalled()
})

// Local-only UX flags (onboardingSeen) are excluded from import by design, but
// import clears the whole store — they must be carried over or they silently
// reset and re-trigger onboarding for an existing user. #641
test('applying an import preserves local-only keys (onboardingSeen)', async () => {
  const { handlers, mockStore } = await loadConfigHandlers({
    customSlots: 5,
    onboardingSeen: true
  })

  await expect(previewThenApply(handlers)).resolves.toMatchObject({ success: true })
  expect(mockStore.data).toEqual({ ...importedConfig, onboardingSeen: true })
})

// Data-loss guard: a mid-apply failure leaves the store half-written unless
// the snapshot is restored — the user's entire config is on the line.
test('applying an import rolls the store back when the apply throws', async () => {
  const initial = { customSlots: 5, gamePaths: { iracing: 'C:/Games/Old.exe' } }
  const { handlers, mockStore } = await loadConfigHandlers(initial)
  migrateProfilesToNamedSets.mockImplementationOnce(() => {
    throw new Error('corrupted profile set')
  })

  const result = (await previewThenApply(handlers)) as { success: boolean; error?: string }

  expect(result.success).toBe(false)
  expect(result.error).toContain('corrupted profile set')
  expect(mockStore.data).toEqual(initial)
})

test('apply-import-config only accepts the token issued by the matching preview', async () => {
  const { handlers, mockStore } = await loadConfigHandlers({ customSlots: 5 })

  const preview = (await handlers['preview-import-config']({})) as {
    success: boolean
    token: string
  }
  expect(preview.success).toBe(true)

  await expect(handlers['apply-import-config']({}, 'forged-token')).resolves.toMatchObject({
    success: false
  })
  expect(mockStore.data).toEqual({ customSlots: 5 })

  await expect(handlers['apply-import-config']({}, preview.token)).resolves.toMatchObject({
    success: true
  })
  expect(mockStore.data).toEqual(importedConfig)

  // The token is single-use: a replay after apply must fail.
  await expect(handlers['apply-import-config']({}, preview.token)).resolves.toMatchObject({
    success: false
  })
})

test('apply-import-config rejects a preview token after the 5-minute TTL', async () => {
  vi.useFakeTimers()
  try {
    const { handlers, mockStore } = await loadConfigHandlers({ customSlots: 5 })

    const preview = (await handlers['preview-import-config']({})) as { token: string }
    vi.setSystemTime(Date.now() + 5 * 60 * 1000 + 1)

    const result = (await handlers['apply-import-config']({}, preview.token)) as {
      success: boolean
      error?: string
    }

    expect(result.success).toBe(false)
    expect(result.error).toContain('expired')
    expect(mockStore.data).toEqual({ customSlots: 5 })
  } finally {
    vi.useRealTimers()
  }
})
