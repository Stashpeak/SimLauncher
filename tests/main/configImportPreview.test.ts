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
  vi.doMock('../../src/main/profiles', () => ({ isStoredProfileSet: vi.fn() }))
  const storeModuleMock = {
    CONFIG_FILE_NAME: 'simlauncher-config.json',
    MAX_CONFIG_IMPORT_BYTES: 1_000_000,
    MAX_CUSTOM_SLOTS: 20,
    getSupportedConfigValues: vi.fn(),
    getStoredZoomFactor: vi.fn(),
    requireSafeZoomFactor: vi.fn(),
    sanitizeImportedConfig: vi.fn((c) => {
      if (!c || typeof c !== 'object' || Object.keys(c).length === 0) return { imported: true }
      return c
    }),
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
