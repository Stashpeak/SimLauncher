import { beforeEach, expect, test, vi } from 'vitest'

/**
 * The resolver behind the "Game not found" badge (#794).
 *
 * Runs the REAL `isValidExePath` against a mocked filesystem rather than
 * stubbing the predicate, because two of the three answers here are about what
 * that predicate does with edge inputs (a blank entry, a path with no file
 * behind it) and a stub would just be asserting the fixture.
 */

type MockIpcHandler = (...args: unknown[]) => unknown

// Whatever the fixture calls missing. `isValidExePath` runs `path.resolve`
// before `existsSync`, so entries are compared with slashes and case folded.
const missingPaths = new Set<string>()
const normalize = (value: string) => value.toLowerCase().replace(/\//g, '\\')

async function invokeGetMissingGamePaths(): Promise<string[]> {
  const { __ipcHandlers } = await import('electron')
  return (await (__ipcHandlers as Record<string, MockIpcHandler>)['get-missing-game-paths'](
    {}
  )) as string[]
}

async function loadConfigModule(gamePaths: Record<string, unknown>) {
  const { clearIpcHandlers } = await import('electron')
  ;(clearIpcHandlers as () => void)()

  vi.doMock('fs', () => ({
    default: {
      existsSync: (filePath: unknown) =>
        typeof filePath === 'string' &&
        /\.exe$/i.test(filePath) &&
        !missingPaths.has(normalize(filePath)),
      // Present but unused: the handler under test never reaches the config-file
      // paths, and a missing member would fail as a TypeError rather than an
      // assertion the day one of them does.
      readFileSync: vi.fn(),
      writeFileSync: vi.fn(),
      statSync: vi.fn(),
      existsSyncRaw: vi.fn()
    }
  }))

  vi.doMock('electron-store', () => ({
    default: class MockStore {
      store: Record<string, unknown> = { gamePaths }

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
  vi.doMock('../../src/main/profiles', () => ({
    isStoredProfileSet: () => false,
    getProfileSwitchLeavingKeys: vi.fn(() => []),
    getProfileLaunchEntryId: (entry: { key: string; path: string }) =>
      `${entry.key} ${entry.path.toLowerCase()}`
  }))
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
  missingPaths.clear()
})

test('a configured game whose exe is gone is reported missing (#794)', async () => {
  missingPaths.add(normalize('C:/Games/iRacing/ui/iRacingUI.exe'))
  await loadConfigModule({
    iracing: 'C:/Games/iRacing/ui/iRacingUI.exe',
    beamng: 'C:/Games/BeamNG/BeamNG.drive.exe'
  })

  expect(await invokeGetMissingGamePaths()).toEqual(['iracing'])
})

test('every game resolving reports nothing missing (#794)', async () => {
  await loadConfigModule({
    iracing: 'C:/Games/iRacing/ui/iRacingUI.exe',
    beamng: 'C:/Games/BeamNG/BeamNG.drive.exe'
  })

  expect(await invokeGetMissingGamePaths()).toEqual([])
})

// A game the user never configured must not be called missing. Its row is not
// rendered at all, and the badge would send someone hunting for a file that was
// never there. Blank and whitespace are the same non-answer as absent: the
// Settings input clears to an empty string rather than deleting the key.
test('a blank or whitespace game path is not missing, it is unset (#794)', async () => {
  await loadConfigModule({ iracing: '', beamng: '   ', acc: undefined })

  expect(await invokeGetMissingGamePaths()).toEqual([])
})

// The badge must not answer on data it cannot read. A non-string entry is a
// corrupt or hand-edited config, and `getStoredStringRecord` drops it before the
// resolver sees it, so the row stays quiet rather than warning about a value
// nobody can interpret.
test('a non-string game path entry is dropped rather than reported (#794)', async () => {
  await loadConfigModule({ iracing: 42, beamng: null })

  expect(await invokeGetMissingGamePaths()).toEqual([])
})
