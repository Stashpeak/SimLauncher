import { beforeEach, expect, test, vi } from 'vitest'

type MockIpcHandler = (...args: unknown[]) => Promise<unknown>

const migrateProfilesToNamedSets = vi.fn()
const cancelPendingElevatedHandoffs = vi.fn()
const abortActiveLaunches = vi.fn()
// Defaults to 1 so the report path is exercised. The real counter is a
// module-level scalar the cancel callback increments; what matters here is that
// the import DRAINS it and pushes the count (#842).
const drainStrandedConsentPrompts = vi.fn(() => 1)
const sendToRenderer = vi.fn()

/** The stranded-prompt counts the import pushed to the renderer. */
function pushedStrandedCounts(): number[] {
  return sendToRenderer.mock.calls
    .filter(([channel]) => channel === 'stranded-consent-prompts')
    .map(([, count]) => count as number)
}
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
    sendToRenderer
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

  const profilesMock = {
    isStoredProfileSet: vi.fn(() => false),
    getProfileLaunchEntryId: vi.fn(),
    getProfileSwitchLeavingKeys: vi.fn(() => [])
  }
  vi.doMock('../profiles', () => profilesMock)
  vi.doMock('/src/main/profiles.ts', () => profilesMock)
  vi.doMock('../../src/main/profiles', () => profilesMock)
  vi.doMock('../../src/main/profiles.ts', () => profilesMock)

  const processesMock = {
    publishRunningApps: vi.fn(async () => {}),
    abortActiveLaunches,
    cancelPendingElevatedHandoffs,
    drainStrandedConsentPrompts
  }
  vi.doMock('../processes', () => processesMock)
  vi.doMock('/src/main/processes.ts', () => processesMock)
  vi.doMock('../../src/main/processes', () => processesMock)
  vi.doMock('../../src/main/processes.ts', () => processesMock)

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

// An import replaces the whole store, so a pending elevated handoff is left
// waiting on a profile that may no longer exist. Nothing else covers it:
// `save-profile` never runs on this path, and a pending handoff has never
// started, so no tasklist-diff-driven code can see it either (Codex P2 on #842).
test('applying an import cancels every pending elevated handoff (#842)', async () => {
  const { handlers } = await loadConfigHandlers({ customSlots: 5 })

  await expect(previewThenApply(handlers)).resolves.toMatchObject({ success: true })

  // Both mechanisms. A handoff younger than the grace window is not in the
  // registry yet, so the abort signal is the only thing that reaches it and
  // cancelling the registry alone left the whole pre-grace window uncovered
  // (CodeRabbit on #842). Unscoped, unlike the switch's per-game abort, because
  // an import replaces every game's config at once.
  expect(abortActiveLaunches).toHaveBeenCalledTimes(1)
  expect(abortActiveLaunches.mock.calls[0]).toEqual([])
  expect(cancelPendingElevatedHandoffs).toHaveBeenCalledTimes(1)
  // No game key and no predicate: unlike a profile switch there is no "profile
  // being left" to diff against, so this is deliberately unscoped.
  expect(cancelPendingElevatedHandoffs.mock.calls[0]).toEqual([])
  // Killing the host does not remove the consent dialog, so the count has to
  // reach the renderer or the user is never told the prompt is dead (#809).
  expect(pushedStrandedCounts()).toEqual([1])
})

// The rollback half. Cancelling before the apply is known to have succeeded
// would kill a prompt that is still valid for the config the rollback restores,
// which is a worse outcome than the bug above: the user loses a live prompt for
// a config they never stopped using.
test('a rolled-back import cancels nothing (#842)', async () => {
  const initial = { customSlots: 5, gamePaths: { iracing: 'C:/Games/Old.exe' } }
  const { handlers, mockStore } = await loadConfigHandlers(initial)
  migrateProfilesToNamedSets.mockImplementationOnce(() => {
    throw new Error('corrupted profile set')
  })

  await expect(previewThenApply(handlers)).resolves.toMatchObject({ success: false })

  expect(mockStore.data).toEqual(initial)
  expect(abortActiveLaunches).not.toHaveBeenCalled()
  expect(cancelPendingElevatedHandoffs).not.toHaveBeenCalled()
  expect(drainStrandedConsentPrompts).not.toHaveBeenCalled()
  expect(pushedStrandedCounts()).toEqual([])
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
