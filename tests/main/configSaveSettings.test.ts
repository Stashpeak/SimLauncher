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
  settings: {
    appPaths: Record<string, string>
    gamePaths: Record<string, string>
    startWithWindows?: boolean
  }
  dropped: { field: string; key: string; reason: string }[]
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
  // The real discriminator rather than a stub: the profile handlers below bail
  // early when it says no, so a stub would make their tests pass vacuously.
  vi.doMock('../../src/main/profiles', () => ({
    isStoredProfileSet: (value: unknown) =>
      !!value &&
      typeof value === 'object' &&
      Array.isArray((value as { profiles?: unknown }).profiles),
    // Stubbed to "nothing is leaving": these tests are about the store write and
    // the republish, not about #782's cancellation. The real behaviour is pinned
    // in configProfileSwitchHandoff.test.ts against the real module.
    getProfileSwitchLeavingKeys: vi.fn(() => []),
    getProfileLaunchEntryId: (entry: { key: string; path: string }) =>
      `${entry.key} ${entry.path.toLowerCase()}`
  }))
  // All four exports `ipc/config.ts` imports, not just the two these tests
  // happen to reach. `getProfileSwitchLeavingKeys` is stubbed to `[]` here, so
  // the cancellation block never runs and the gap is currently invisible; the
  // day it does run, a missing export is a TypeError rather than a readable
  // assertion failure (CodeRabbit on #842).
  vi.doMock('../../src/main/processes', () => ({
    publishRunningApps: vi.fn(async () => {}),
    abortActiveLaunches: vi.fn(),
    cancelPendingElevatedHandoffs: vi.fn(),
    drainStrandedConsentPrompts: vi.fn(() => 0)
  }))
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

  expect(result.dropped).toEqual([{ field: 'appPaths', key: 'simhub', reason: 'not-an-exe' }])
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

  // Reason must be the length cap, NOT the extension — the path IS an .exe.
  expect(result.dropped).toEqual([{ field: 'gamePaths', key: 'iracing', reason: 'too-long' }])
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

/**
 * #676: the login item used to be written to the OS by the renderer the moment
 * the switch moved, so Discard left an HKCU Run entry contradicting both the UI
 * and the store until the next app start repaired it. It is applied on SAVE
 * now, which makes Discard correct by construction rather than by remembering
 * to compensate for it.
 */
test('save-settings applies the login item when startWithWindows changes (#676)', async () => {
  await loadConfigModule()
  const { app } = await import('electron')

  await invokeSaveSettings({ startWithWindows: true, customSlots: 1 })

  expect(app.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true })
})

// Deliberately a SECOND save rather than a second assertion on the first: any
// truthiness shortcut (applying `true` whenever the key is present) passes the
// test above and fails only here.
test('save-settings applies a later startWithWindows: false too (#676)', async () => {
  await loadConfigModule()
  const { app } = await import('electron')

  await invokeSaveSettings({ startWithWindows: true, customSlots: 1 })
  await invokeSaveSettings({ startWithWindows: false, customSlots: 1 })

  expect(app.setLoginItemSettings).toHaveBeenLastCalledWith({ openAtLogin: false })
})

// Hoisting the apply out of the changedKeys guard would re-write the registry
// on every unrelated save, which is how the eager-apply version behaved.
test('save-settings leaves the login item alone when startWithWindows is absent (#676)', async () => {
  await loadConfigModule()
  const { app } = await import('electron')

  await invokeSaveSettings({ appPaths: { simhub: 'C:/Tools/SimHub.exe' }, customSlots: 1 })

  expect(app.setLoginItemSettings).not.toHaveBeenCalled()
})

// A failing OS write must not fail the save (CodeRabbit on #831). The store is
// already written by this point and window.ts re-applies it on every window
// creation, so the registry converges on the next start. Rejecting instead
// would tell the user the save failed while it persisted, and leave the
// renderer dirty against a store that already agrees with it.
// The log is asserted, not just tolerated: swallowing is the whole point of the
// catch, so the log is the only trace a failed write leaves. Drop it and the
// failure becomes invisible with nothing to notice (CodeRabbit on #831).
test('save-settings survives a throwing login-item write, and says so (#676)', async () => {
  await loadConfigModule()
  const { app } = await import('electron')
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.mocked(app.setLoginItemSettings).mockImplementationOnce(() => {
    throw new Error('registry write refused')
  })

  const result = await invokeSaveSettings({ startWithWindows: true, customSlots: 1 })

  expect(result.settings.startWithWindows).toBe(true)
  expect(result.dropped).toEqual([])
  expect(consoleError).toHaveBeenCalledWith(
    'Failed to apply the login item setting:',
    expect.objectContaining({ message: 'registry write refused' })
  )
  consoleError.mockRestore()
})

/**
 * #591: a tracking toggle is a `profiles` write, and nothing else in the main
 * process notices one until the next tasklist scan, which is up to 12s away on
 * the SLOW cadence. Every path that writes `profiles` therefore republishes.
 *
 * Asserted rather than assumed: the call is fire-and-forget, so dropping it
 * changes nothing observable in the handler's return value.
 */
async function invokeProfileHandler(channel: string, ...args: unknown[]): Promise<void> {
  const { __ipcHandlers } = await import('electron')
  await (__ipcHandlers as Record<string, MockIpcHandler>)[channel]({}, ...args)
}

test('save-profile republishes the running apps (#591)', async () => {
  await loadConfigModule()
  const { publishRunningApps } = await import('../../src/main/processes')

  await invokeProfileHandler('save-profile', 'ac', {
    activeProfileId: 'default',
    profiles: [{ id: 'default', name: 'Default', trackingEnabled: false }]
  })

  expect(publishRunningApps).toHaveBeenCalledWith('config')
})

// The bulk write, which the Settings screen uses and which can change tracking
// for several games at once. Separate test: wiring only the single-profile
// handler passes the one above and fails this.
test('save-profiles republishes the running apps too (#591)', async () => {
  await loadConfigModule()
  const { publishRunningApps } = await import('../../src/main/processes')

  await invokeProfileHandler('save-profiles', {
    ac: { activeProfileId: 'default', profiles: [{ id: 'default', name: 'Default' }] }
  })

  expect(publishRunningApps).toHaveBeenCalledWith('config')
})

// A save that the sanitizer rejects writes nothing, so it must not claim the
// running list changed either.
test('a rejected profile save does not republish (#591)', async () => {
  await loadConfigModule()
  const { publishRunningApps } = await import('../../src/main/processes')

  await invokeProfileHandler('save-profile', '', { activeProfileId: 'default', profiles: [] })

  expect(publishRunningApps).not.toHaveBeenCalled()
})
