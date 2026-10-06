import { expect, test, vi, beforeEach } from 'vitest'

type MockIpcHandler = (...args: unknown[]) => unknown | Promise<unknown>
type ConfigImportResult = {
  success: boolean
  canceled?: boolean
  error?: string
  filePath?: string
  token?: string
  summary?: {
    gamePaths: { key: string; path?: string }[]
  }
}

const mockStats = (size: number) =>
  ({ size }) as Awaited<ReturnType<typeof import('fs').promises.stat>>

async function invokeConfigHandler(channel: string, ...args: unknown[]) {
  const { __ipcHandlers } = await import('electron')
  return (await (__ipcHandlers as Record<string, MockIpcHandler>)[channel](
    ...args
  )) as ConfigImportResult
}

async function loadConfigModule() {
  const { clearIpcHandlers } = await import('electron')
  ;(clearIpcHandlers as () => void)()
  vi.doMock('../../src/main/migrator', () => ({ migrateProfilesToNamedSets: vi.fn() }))
  vi.doMock('../../src/main/profiles', () => ({
    isStoredProfileSet: vi.fn(),
    getProfileSwitchLeavingKeys: vi.fn(() => []),
    getProfileLaunchEntryId: (entry: { key: string; path: string }) =>
      `${entry.key} ${entry.path.toLowerCase()}`
  }))
  const storeModuleMock = {
    CONFIG_FILE_NAME: 'simlauncher-config.json',
    KNOWN_GAME_KEYS: new Set(['ac', 'acc']),
    LOCAL_ONLY_STORE_KEYS: ['onboardingSeen'],
    MAX_CONFIG_IMPORT_BYTES: 1_000_000,
    MAX_CUSTOM_SLOTS: 20,
    consumeConfigRecoveryNotice: vi.fn(() => null),
    formatConfigRecoveryNotice: vi.fn(),
    getDroppedSettingsEntries: vi.fn(() => []),
    getSupportedConfigValues: vi.fn(),
    getStoredZoomFactor: vi.fn(),
    // Identity, which is what the real one does when nothing was dropped — and
    // `getDroppedSettingsEntries` above is stubbed to exactly that. Stubbing it
    // to `{}` instead would make the sanitized-values assertions below pass
    // vacuously. #806
    preserveRejectedSettingsEntries: vi.fn((safe) => safe),
    // The remaining two are not reached by any test here, and are listed for the
    // reason given in configSaveSettings.test.ts: `ipc/config.ts` imports them,
    // so the day a test does reach one, an omission is a TypeError rather than a
    // readable assertion failure (CodeRabbit on #842).
    getStoredBoolean: vi.fn(() => false),
    getStoredStringRecord: vi.fn(() => ({})),
    requireSafeZoomFactor: vi.fn(),
    sanitizeImportedConfig: vi.fn((c) => {
      if (!c || typeof c !== 'object' || Object.keys(c).length === 0) return { imported: true }
      return c
    }),
    sanitizeSettingsPatch: vi.fn((patch) => patch),
    store: { store: {}, get: vi.fn(), set: vi.fn(), clear: vi.fn() }
  }
  vi.doMock('/src/main/store.ts', () => storeModuleMock)
  vi.doMock('../../src/main/store', () => storeModuleMock)
  vi.doMock('../../src/main/store.ts', () => storeModuleMock)
  const windowModuleMock = {
    applyRuntimeConfigSettings: vi.fn(),
    getMainWindow: vi.fn(),
    sendToRenderer: vi.fn()
  }
  vi.doMock('/src/main/window.ts', () => windowModuleMock)
  vi.doMock('../../src/main/window', () => windowModuleMock)
  vi.doMock('../../src/main/window.ts', () => windowModuleMock)
  vi.doMock('electron-updater', () => ({
    autoUpdater: {
      autoDownload: false,
      checkForUpdates: vi.fn(),
      downloadUpdate: vi.fn(),
      on: vi.fn(),
      quitAndInstall: vi.fn()
    }
  }))
  vi.doMock('fs', () => ({
    default: {
      promises: {
        stat: vi.fn(),
        readFile: vi.fn(),
        writeFile: vi.fn()
      }
    }
  }))

  const mod = await import('../../src/main/ipc/config')
  mod.registerConfigHandlers()
  return mod
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})

test('buildImportPreviewSummary exposes only sanitized executable paths and custom args', async () => {
  const { buildImportPreviewSummary } = await loadConfigModule()
  const summary = buildImportPreviewSummary(
    {
      gamePaths: { ac: 'C:/Games/AssettoCorsa.exe', unknown: 'C:/Games/Unknown.exe' },
      appPaths: { simhub: 'C:/Tools/SimHub.exe', customapp2: 'C:/Tools/Overlay.exe' },
      appArgs: { customapp2: '--overlay', simhub: '--not-importable' },
      profiles: {
        ac: {
          profiles: [
            {
              name: 'Default',
              trackedProcessPaths: ['C:/Tools/SimHub.exe', 'C:/Tools/readme.txt']
            }
          ]
        }
      }
    },
    {
      gamePaths: { ac: 'C:/Games/AssettoCorsa.exe' },
      appPaths: { simhub: 'C:/Tools/SimHub.exe', customapp2: 'C:/Tools/Overlay.exe' },
      appArgs: { customapp2: '--overlay' },
      profiles: {
        ac: {
          profiles: [{ name: 'Default', trackedProcessPaths: ['C:/Tools/SimHub.exe'] }]
        }
      }
    }
  )

  expect(summary.changedKeys).toEqual(['appArgs', 'appPaths', 'gamePaths', 'profiles'])
  expect(summary.gamePaths).toEqual([{ key: 'ac', path: 'C:/Games/AssettoCorsa.exe' }])
  expect(summary.appPaths).toEqual([
    { key: 'simhub', path: 'C:/Tools/SimHub.exe' },
    { key: 'customapp2', path: 'C:/Tools/Overlay.exe' }
  ])
  expect(summary.customAppArgs).toEqual([{ key: 'customapp2', args: '--overlay' }])
  expect(summary.trackedProcessPaths).toEqual([{ key: 'ac/Default', path: 'C:/Tools/SimHub.exe' }])
  expect(summary.droppedCount).toBe(3)
  expect(summary.warnings).toHaveLength(1)
})

test('preview-import-config returns a token and stores pending import', async () => {
  await loadConfigModule()
  const { dialog } = await import('electron')
  const fs = (await import('fs')).default

  vi.mocked(dialog.showOpenDialog).mockResolvedValue({
    canceled: false,
    filePaths: ['test-config.json']
  })
  vi.mocked(fs.promises.stat).mockResolvedValue(mockStats(500))
  vi.mocked(fs.promises.readFile).mockResolvedValue(JSON.stringify({ gamePaths: { ac: 'path' } }))

  const result = await invokeConfigHandler('preview-import-config')

  expect(result.success).toBe(true)
  expect(result.token).toBeDefined()
  expect(result.filePath).toBe('test-config.json')
  expect(result.summary?.gamePaths).toEqual([{ key: 'ac', path: 'path' }])
})

test('apply-import-config requires a valid token', async () => {
  await loadConfigModule()
  const result = await invokeConfigHandler('apply-import-config', {}, 'invalid-token')
  expect(result.success).toBe(false)
  expect(result.error).toContain('expired or is no longer valid')
})

test('apply-import-config clears pending import after use (single-use token)', async () => {
  await loadConfigModule()
  const { dialog } = await import('electron')
  const fs = (await import('fs')).default

  vi.mocked(dialog.showOpenDialog).mockResolvedValue({
    canceled: false,
    filePaths: ['test-config.json']
  })
  vi.mocked(fs.promises.stat).mockResolvedValue(mockStats(500))
  vi.mocked(fs.promises.readFile).mockResolvedValue(JSON.stringify({ gamePaths: { ac: 'path' } }))

  const previewResult = await invokeConfigHandler('preview-import-config')
  const token = previewResult.token

  const applyResult1 = await invokeConfigHandler('apply-import-config', {}, token)
  expect(applyResult1.success).toBe(true)

  const applyResult2 = await invokeConfigHandler('apply-import-config', {}, token)
  expect(applyResult2.success).toBe(false)
  expect(applyResult2.error).toContain('expired or is no longer valid')
})

test('cancel-import-config clears pending import', async () => {
  await loadConfigModule()
  const { dialog } = await import('electron')
  const fs = (await import('fs')).default

  vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: ['f.json'] })
  vi.mocked(fs.promises.stat).mockResolvedValue(mockStats(100))
  vi.mocked(fs.promises.readFile).mockResolvedValue('{}')

  const { token } = await invokeConfigHandler('preview-import-config')
  await invokeConfigHandler('cancel-import-config', {}, token)

  const applyResult = await invokeConfigHandler('apply-import-config', {}, token)
  expect(applyResult.success).toBe(false)
})

/**
 * Backs the mocked store with one object, so a folder remembered by one
 * handler is what the next one reads (#907), and treats `folders` as the only
 * directories that exist.
 */
async function withRememberingStore(folders: string[]) {
  const storeModule = await import('../../src/main/store')
  const fs = (await import('fs')).default
  const data: Record<string, unknown> = {}
  vi.mocked(storeModule.store.get).mockImplementation(((key: string) => data[key]) as never)
  vi.mocked(storeModule.store.set).mockImplementation(((key: string, value: unknown) => {
    data[key] = value
  }) as never)
  vi.mocked(storeModule.getStoredStringRecord).mockImplementation(
    (key: string) => (data[key] ?? {}) as Record<string, string>
  )
  vi.mocked(fs.promises.stat).mockImplementation((async (target: string) =>
    folders.includes(target)
      ? { isDirectory: () => true }
      : { size: 100, isDirectory: () => false }) as never)
  return data
}

// Electron 43 and later open a dialog with no defaultPath in Downloads (#907).
test('preview-import-config reopens the folder the last import came from (#907)', async () => {
  await loadConfigModule()
  const data = await withRememberingStore(['D:\\Backups'])
  const { dialog } = await import('electron')
  const fs = (await import('fs')).default
  const showOpenDialog = vi.mocked(dialog.showOpenDialog)
  showOpenDialog.mockResolvedValue({
    canceled: false,
    filePaths: ['D:\\Backups\\simlauncher-config.json']
  })
  vi.mocked(fs.promises.readFile).mockResolvedValue('{}')

  await invokeConfigHandler('preview-import-config')
  expect(showOpenDialog.mock.calls[0][0]).not.toHaveProperty('defaultPath')
  expect(data.dialogFolders).toEqual({ config: 'D:\\Backups' })

  await invokeConfigHandler('preview-import-config')
  expect(showOpenDialog.mock.calls[1][0]).toMatchObject({ defaultPath: 'D:\\Backups' })
})

test('export-config keeps its bare file name, and the next import opens where it went (#907)', async () => {
  await loadConfigModule()
  await withRememberingStore(['E:\\Exports'])
  const { dialog } = await import('electron')
  vi.mocked(dialog.showSaveDialog).mockResolvedValue({
    canceled: false,
    filePath: 'E:\\Exports\\simlauncher-config.json'
  })
  vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: true, filePaths: [] })

  await invokeConfigHandler('export-config')
  // A relative defaultPath gets neither Electron's Downloads default nor a
  // forced folder, so Windows still chooses where an export opens, as on 42.
  expect(vi.mocked(dialog.showSaveDialog).mock.calls[0][0]).toMatchObject({
    defaultPath: 'simlauncher-config.json'
  })

  await invokeConfigHandler('preview-import-config')
  expect(vi.mocked(dialog.showOpenDialog).mock.calls[0][0]).toMatchObject({
    defaultPath: 'E:\\Exports'
  })
})

test('save-profiles stores only sanitized known profile sets', async () => {
  await loadConfigModule()
  const storeModule = await import('../../src/main/store')
  const profilesModule = await import('../../src/main/profiles')
  const rawProfileSet = {
    activeProfileId: 'default',
    profiles: [
      {
        id: 'default',
        name: 'Default',
        trackedProcessPaths: ['C:/Tools/SimHub.exe', 'C:/Tools/readme.txt']
      }
    ]
  }
  const sanitizedProfileSet = {
    activeProfileId: 'default',
    profiles: [
      {
        id: 'default',
        name: 'Default',
        trackedProcessPaths: ['C:/Tools/SimHub.exe']
      }
    ]
  }

  vi.mocked(storeModule.store.get).mockReturnValue(1)
  vi.mocked(profilesModule.isStoredProfileSet).mockImplementation(
    (value) =>
      !!value &&
      typeof value === 'object' &&
      typeof (value as Record<string, unknown>).activeProfileId === 'string' &&
      Array.isArray((value as Record<string, unknown>).profiles)
  )
  vi.mocked(storeModule.getSupportedConfigValues).mockImplementation((config) => {
    const profiles = (config as { profiles?: Record<string, unknown> }).profiles ?? {}
    return profiles.ac ? { profiles: { ac: sanitizedProfileSet } } : {}
  })

  await invokeConfigHandler(
    'save-profiles',
    {},
    {
      ac: rawProfileSet,
      unknown: rawProfileSet,
      acc: { profiles: 'invalid' },
      constructor: rawProfileSet
    }
  )

  expect(storeModule.store.set).toHaveBeenCalledWith('profiles', { ac: sanitizedProfileSet })
  expect(storeModule.getSupportedConfigValues).toHaveBeenCalledWith({
    customSlots: 1,
    profiles: { ac: rawProfileSet }
  })
})

test('save-settings stores sanitized patch values only', async () => {
  await loadConfigModule()
  const storeModule = await import('../../src/main/store')

  vi.mocked(storeModule.sanitizeSettingsPatch).mockReturnValue({
    appPaths: { simhub: 'C:/Tools/SimHub.exe' },
    appArgs: { customapp1: '--safe' }
  })

  await invokeConfigHandler('save-settings', {}, { appPaths: { simhub: 'C:/Tools/SimHub.exe' } })

  expect(storeModule.sanitizeSettingsPatch).toHaveBeenCalledWith({
    appPaths: { simhub: 'C:/Tools/SimHub.exe' }
  })
  expect(storeModule.store.set).toHaveBeenCalledWith('appPaths', {
    simhub: 'C:/Tools/SimHub.exe'
  })
  expect(storeModule.store.set).toHaveBeenCalledWith('appArgs', { customapp1: '--safe' })
})

// The `set-login-item` channel and its runtime type guard were deleted with the
// eager apply (#676): the login item is now written from the store during
// `save-settings`, where getStoredBoolean already guarantees a boolean, so there
// is no untrusted renderer value left to reject. Coverage for the new call site
// lives in configSaveSettings.test.ts.

test('save-profile widens customSlots when profile references a slot beyond the stored count', async () => {
  await loadConfigModule()
  const storeModule = await import('../../src/main/store')
  const profilesModule = await import('../../src/main/profiles')
  const rawProfileSet = {
    activeProfileId: 'default',
    profiles: [
      {
        id: 'default',
        name: 'Default',
        utilities: [
          { id: 'simhub', enabled: true },
          { id: 'customapp2', enabled: true }
        ]
      }
    ]
  }

  vi.mocked(storeModule.store.get).mockImplementation((key: string) =>
    key === 'customSlots' ? 1 : undefined
  )
  vi.mocked(profilesModule.isStoredProfileSet).mockImplementation(
    (value) =>
      !!value &&
      typeof value === 'object' &&
      typeof (value as Record<string, unknown>).activeProfileId === 'string' &&
      Array.isArray((value as Record<string, unknown>).profiles)
  )
  vi.mocked(storeModule.getSupportedConfigValues).mockImplementation((config) => ({
    profiles: (config as { profiles?: Record<string, unknown> }).profiles ?? {}
  }))

  await invokeConfigHandler('save-profile', {}, 'ac', rawProfileSet)

  expect(storeModule.getSupportedConfigValues).toHaveBeenCalledWith({
    customSlots: 2,
    profiles: { ac: rawProfileSet }
  })
})

test('save-profile caps widened customSlots at MAX_CUSTOM_SLOTS', async () => {
  await loadConfigModule()
  const storeModule = await import('../../src/main/store')
  const profilesModule = await import('../../src/main/profiles')
  const rawProfileSet = {
    activeProfileId: 'default',
    profiles: [
      {
        id: 'default',
        name: 'Default',
        utilities: [{ id: 'customapp99', enabled: true }]
      }
    ]
  }

  vi.mocked(storeModule.store.get).mockImplementation((key: string) =>
    key === 'customSlots' ? 1 : undefined
  )
  vi.mocked(profilesModule.isStoredProfileSet).mockImplementation(
    (value) =>
      !!value &&
      typeof value === 'object' &&
      typeof (value as Record<string, unknown>).activeProfileId === 'string' &&
      Array.isArray((value as Record<string, unknown>).profiles)
  )
  vi.mocked(storeModule.getSupportedConfigValues).mockImplementation((config) => ({
    profiles: (config as { profiles?: Record<string, unknown> }).profiles ?? {}
  }))

  await invokeConfigHandler('save-profile', {}, 'ac', rawProfileSet)

  expect(storeModule.getSupportedConfigValues).toHaveBeenCalledWith({
    customSlots: 20,
    profiles: { ac: rawProfileSet }
  })
})

test('new preview replacement: subsequent previews invalidate previous tokens', async () => {
  await loadConfigModule()
  const { dialog } = await import('electron')
  const fs = (await import('fs')).default

  vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: ['f.json'] })
  vi.mocked(fs.promises.stat).mockResolvedValue(mockStats(100))
  vi.mocked(fs.promises.readFile).mockResolvedValue('{}')

  const res1 = await invokeConfigHandler('preview-import-config')
  const res2 = await invokeConfigHandler('preview-import-config')

  expect(res1.token).not.toBe(res2.token)

  const apply1 = await invokeConfigHandler('apply-import-config', {}, res1.token)
  expect(apply1.success).toBe(false)

  const apply2 = await invokeConfigHandler('apply-import-config', {}, res2.token)
  expect(apply2.success).toBe(true)
})
