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
    appNames: Record<string, string>
    appArgs: Record<string, string>
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

// #859: Windows 11's own "Copy as path" wraps the value in double quotes, so the
// shortest route from an exe in Explorer to a configured app was also the one
// route that failed. The closing quote defeated the `.exe` test, and the user
// was told `not-an-exe` while looking at a path plainly ending in `.exe`.
test('a path pasted from Windows "Copy as path" is accepted, unquoted (#859)', async () => {
  await loadConfigModule()

  const result = await invokeSaveSettings({
    appPaths: { simhub: '"D:/Apps/SimHub/SimHub.exe"' },
    customSlots: 1
  })

  expect(result.dropped).toEqual([])
  // Stored WITHOUT the quotes. Accepting the value but persisting it verbatim
  // would only move the failure to spawn time, further from its cause.
  expect(result.settings.appPaths).toEqual({ simhub: 'D:/Apps/SimHub/SimHub.exe' })
})

test('the same holds for a game path (#859)', async () => {
  await loadConfigModule()

  const result = await invokeSaveSettings({
    gamePaths: { iracing: '"A:/Games/iRacing/ui/iRacingUI.exe"' },
    customSlots: 1
  })

  expect(result.dropped).toEqual([])
  expect(result.settings.gamePaths).toEqual({ iracing: 'A:/Games/iRacing/ui/iRacingUI.exe' })
})

// Only a MATCHED outer pair is a quoting artifact. Anything else means the value
// is not a path Windows could open, and half-stripping it would store something
// that fails later and further from the cause.
test.each([
  ['leading quote only', '"D:/Apps/SimHub/SimHub.exe'],
  ['trailing quote only', 'D:/Apps/SimHub/SimHub.exe"'],
  ['single quotes', "'D:/Apps/SimHub/SimHub.exe'"],
  ['embedded quote', 'D:/Apps/Sim"Hub/SimHub.exe']
])('an unmatched or embedded quote is still rejected: %s (#859)', async (_label, badPath) => {
  await loadConfigModule()

  const result = await invokeSaveSettings({ appPaths: { simhub: badPath }, customSlots: 1 })

  expect(result.dropped).toEqual([{ field: 'appPaths', key: 'simhub', reason: 'not-an-exe' }])
  expect(result.settings.appPaths).toEqual({})
})

// The length cap has to run on the form that gets STORED. Validating the raw
// string and persisting the stripped one is how a cap gets beaten by two
// characters, and the reason must stay 'too-long' rather than drifting to
// 'not-an-exe' now that a stray quote is a rejection too.
test('the length cap is measured after the quotes come off (#859)', async () => {
  await loadConfigModule()

  const overlong = `C:/${'x'.repeat(301)}.exe`

  const result = await invokeSaveSettings({
    gamePaths: { iracing: `"${overlong}"` },
    customSlots: 1
  })

  expect(result.dropped).toEqual([{ field: 'gamePaths', key: 'iracing', reason: 'too-long' }])
  expect(result.settings.gamePaths).toEqual({})
})

// The same bug from the other side: a path that fits only once the quotes are
// off must not be rejected for their two characters.
test('a path that fits only when unquoted is accepted (#859)', async () => {
  await loadConfigModule()

  const exact = `C:/${'x'.repeat(300 - 'C:/.exe'.length)}.exe`
  expect(exact.length).toBe(300)

  const result = await invokeSaveSettings({
    gamePaths: { iracing: `"${exact}"` },
    customSlots: 1
  })

  expect(result.dropped).toEqual([])
  expect(result.settings.gamePaths).toEqual({ iracing: exact })
})

/**
 * #806: each dictionary is written WHOLESALE, and the sanitizers omit a rejected
 * key rather than passing the old value through, so a rejected entry used to be
 * erased from disk while the renderer reported "Not saved" — which reads as
 * "your previous value survived". These pin the two halves that have to stay
 * true together: a rejected value keeps the stored one, a cleared value does
 * not come back.
 *
 * Every case saves TWICE on purpose. The first save is what establishes the
 * on-disk value; asserting against a store that was empty to begin with is how
 * the bug survived #669's coverage, since an erase and a no-op are the same
 * empty record.
 */
test('a rejected appNames entry leaves the previously persisted name on disk (#806)', async () => {
  await loadConfigModule()

  await invokeSaveSettings({ appNames: { simhub: 'Dash' }, customSlots: 1 })

  const result = await invokeSaveSettings({
    appNames: { simhub: 'x'.repeat(101) },
    customSlots: 1
  })

  // Still reported: the merge must keep the entry, not swallow the warning.
  expect(result.dropped).toEqual([{ field: 'appNames', key: 'simhub', reason: 'too-long' }])
  expect(result.settings.appNames).toEqual({ simhub: 'Dash' })
})

// The write path is shared, so the fix has to be too. appNames is merely the
// easiest dictionary to hit, not the only one.
test('a rejected appPaths entry leaves the previously persisted path on disk (#806)', async () => {
  await loadConfigModule()

  await invokeSaveSettings({ appPaths: { simhub: 'C:/Tools/SimHub.exe' }, customSlots: 1 })

  const result = await invokeSaveSettings({
    appPaths: { simhub: 'C:/Tools/SimHub.bat' },
    customSlots: 1
  })

  expect(result.dropped).toEqual([{ field: 'appPaths', key: 'simhub', reason: 'not-an-exe' }])
  expect(result.settings.appPaths).toEqual({ simhub: 'C:/Tools/SimHub.exe' })
})

// The other half, and the one a careless merge breaks: an empty value is a
// deliberate clear, it is not in `dropped`, and it must stay gone.
test('a cleared appNames entry is still removed and not resurrected (#806)', async () => {
  await loadConfigModule()

  await invokeSaveSettings({ appNames: { simhub: 'Dash' }, customSlots: 1 })

  const result = await invokeSaveSettings({ appNames: { simhub: '' }, customSlots: 1 })

  expect(result.dropped).toEqual([])
  expect(result.settings.appNames).toEqual({})
})

// The sharpest case, because one patch carries both intents at once: merging by
// "whatever the sanitizer omitted" instead of "whatever was rejected" passes
// both tests above and fails here, resurrecting the cleared sibling.
test('a rejected entry and a cleared sibling in one patch keep their own outcomes (#806)', async () => {
  await loadConfigModule()

  await invokeSaveSettings({
    appNames: { simhub: 'Dash', crewchief: 'Crew' },
    customSlots: 1
  })

  const result = await invokeSaveSettings({
    appNames: { simhub: 'x'.repeat(101), crewchief: '' },
    customSlots: 1
  })

  expect(result.dropped).toEqual([{ field: 'appNames', key: 'simhub', reason: 'too-long' }])
  expect(result.settings.appNames).toEqual({ simhub: 'Dash' })
})

/**
 * The remaining two of the four fields, and they are not filler. The merge
 * iterates `dropped` generically, so the only thing keeping gamePaths and
 * appArgs correct is that nobody special-cases the field. These two make that
 * assumption fail loudly instead of silently, and they are the two that differ:
 * gamePaths is validated against KNOWN_GAME_KEYS rather than the utility keys,
 * and appArgs has its own, much larger length cap. Raised by the review bot on
 * this PR, which is right that appNames and appPaths alone cannot see either
 * difference.
 */
test('a rejected gamePaths entry leaves the previously persisted path on disk (#806)', async () => {
  await loadConfigModule()

  await invokeSaveSettings({
    gamePaths: { iracing: 'C:/Games/iRacing/iRacingUI.exe' },
    customSlots: 1
  })

  const result = await invokeSaveSettings({
    gamePaths: { iracing: 'C:/Games/iRacing/iRacingUI.bat' },
    customSlots: 1
  })

  expect(result.dropped).toEqual([{ field: 'gamePaths', key: 'iracing', reason: 'not-an-exe' }])
  expect(result.settings.gamePaths).toEqual({ iracing: 'C:/Games/iRacing/iRacingUI.exe' })
})

// appArgs rejects on length alone, and its cap is 500 rather than the 100 that
// appNames uses, so a merge that reached for the wrong cap would show up here
// and nowhere else.
test('a rejected appArgs entry leaves the previously persisted args on disk (#806)', async () => {
  await loadConfigModule()

  await invokeSaveSettings({ appArgs: { simhub: '--safe' }, customSlots: 1 })

  const result = await invokeSaveSettings({
    appArgs: { simhub: 'x'.repeat(501) },
    customSlots: 1
  })

  expect(result.dropped).toEqual([{ field: 'appArgs', key: 'simhub', reason: 'too-long' }])
  expect(result.settings.appArgs).toEqual({ simhub: '--safe' })
})

// A first save of a rejected value has nothing to preserve, and must not invent
// anything. This is the case #669 already covered, kept explicit so the merge
// cannot start writing an empty string or a stale key into a fresh store.
test('a rejected entry with no previous value still persists nothing (#806)', async () => {
  await loadConfigModule()

  const result = await invokeSaveSettings({
    appNames: { simhub: 'x'.repeat(101) },
    customSlots: 1
  })

  expect(result.dropped).toEqual([{ field: 'appNames', key: 'simhub', reason: 'too-long' }])
  expect(result.settings.appNames).toEqual({})
})
