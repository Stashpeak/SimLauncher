import { expect, test, vi, beforeEach } from 'vitest'

/**
 * #782: a profile switch has to cancel a pending elevated (UAC) handoff left
 * behind by the outgoing profile.
 *
 * The reason this lives on `save-profile` and not on `switch-profile-apps` is
 * that the renderer frequently never calls the latter. It gates the whole IPC on
 * a diff built from a tasklist snapshot, and a pending handoff has never
 * started, so it contributes zero to both halves of that diff and the renderer
 * falls through to this save instead.
 *
 * The REAL `../../src/main/profiles` is used deliberately. The leaving-path
 * calculation is the entire fix, so a mocked version would prove nothing beyond
 * "the handler calls a function".
 */

type MockIpcHandler = (...args: unknown[]) => unknown

const cancelPendingElevatedHandoffs = vi.fn()

interface StoredState {
  profiles?: Record<string, unknown>
  appPaths?: Record<string, string>
  gamePaths?: Record<string, string>
  customSlots?: number
}

let storedState: StoredState = {}

async function loadConfigModule(initial: StoredState) {
  const { clearIpcHandlers } = await import('electron')
  ;(clearIpcHandlers as () => void)()
  storedState = { customSlots: 1, ...initial }

  vi.doMock('electron-store', () => ({
    default: class MockStore {
      get store() {
        return storedState as Record<string, unknown>
      }

      get(key: string) {
        return (storedState as Record<string, unknown>)[key]
      }

      set(key: string, value: unknown) {
        ;(storedState as Record<string, unknown>)[key] = value
      }

      clear() {
        storedState = {}
      }
    }
  }))
  vi.doMock('../../src/main/migrator', () => ({ migrateProfilesToNamedSets: vi.fn() }))
  vi.doMock('../../src/main/processes', () => ({
    publishRunningApps: vi.fn(async () => {}),
    cancelPendingElevatedHandoffs
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

async function saveProfile(gameKey: string, profileSet: unknown): Promise<void> {
  const { __ipcHandlers } = await import('electron')
  await (__ipcHandlers as Record<string, MockIpcHandler>)['save-profile']({}, gameKey, profileSet)
}

const utility = (id: string) => ({ id, enabled: true })

function profileSet(activeProfileId: string, profiles: Record<string, string[]>) {
  return {
    activeProfileId,
    profiles: Object.entries(profiles).map(([id, utilityIds]) => ({
      id,
      name: id,
      utilities: utilityIds.map(utility)
    }))
  }
}

// Real slot keys. `getEnabledUtilityEntries` drops anything that is not a
// built-in utility or a configured custom slot, so an invented key would make
// every profile below resolve to zero entries and every assertion here vacuous.
const APP_PATHS = {
  customapp1: 'C:/Tools/Admin Tool.exe',
  simhub: 'C:/Tools/SimHub.exe',
  crewchief: 'C:/Tools/Other.exe'
}

beforeEach(() => {
  vi.resetModules()
  cancelPendingElevatedHandoffs.mockClear()
})

// The acceptance criterion from the issue, on the path the renderer actually
// takes. Profile "quiet" holds the app with the unanswered prompt and profile
// "loud" does not, so the switch leaves it behind.
test('a switch cancels a handoff for an app only the outgoing profile enabled (#782)', async () => {
  await loadConfigModule({
    appPaths: APP_PATHS,
    profiles: { ac: profileSet('quiet', { quiet: ['customapp1'], loud: ['simhub'] }) }
  })

  await saveProfile('ac', profileSet('loud', { quiet: ['customapp1'], loud: ['simhub'] }))

  expect(cancelPendingElevatedHandoffs).toHaveBeenCalledTimes(1)
  expect(cancelPendingElevatedHandoffs).toHaveBeenCalledWith('ac', ['C:/Tools/Admin Tool.exe'])
})

// The over-cancel half. An app both profiles enable is not leaving, so its
// prompt is still worth answering and must survive the switch.
test('a switch leaves a handoff alone when the incoming profile enables it too (#782)', async () => {
  await loadConfigModule({
    appPaths: APP_PATHS,
    profiles: { ac: profileSet('quiet', { quiet: ['customapp1'], loud: ['customapp1', 'simhub'] }) }
  })

  await saveProfile(
    'ac',
    profileSet('loud', { quiet: ['customapp1'], loud: ['customapp1', 'simhub'] })
  )

  expect(cancelPendingElevatedHandoffs).not.toHaveBeenCalled()
})

// Editing the profile you are already on is not a switch, whatever moved inside
// it. Without the `activeProfileId` guard, disabling an app in the profile editor
// would kill a consent prompt the user is mid-way through answering.
test('editing the active profile cancels nothing, even when it drops an app (#782)', async () => {
  await loadConfigModule({
    appPaths: APP_PATHS,
    profiles: { ac: profileSet('quiet', { quiet: ['customapp1', 'simhub'], loud: ['simhub'] }) }
  })

  await saveProfile('ac', profileSet('quiet', { quiet: ['simhub'], loud: ['simhub'] }))

  expect(cancelPendingElevatedHandoffs).not.toHaveBeenCalled()
})

// The game is excluded the same way the switch diff excludes it: a switch never
// stops the game, so it must never cancel the game's own handoff either. Getting
// this wrong means a companion-only operation silently cancels a game launch the
// user is still being prompted for, and the game is not in the incoming
// profile's start list to recover it.
test('a switch never cancels the handoff for the game itself (#782)', async () => {
  // The incoming profile must NOT launch the game, or the game appears on both
  // sides of the diff and subtracts itself. That made this test pass with the
  // exclusion deleted, i.e. prove nothing.
  const sets = (activeProfileId: string) => ({
    activeProfileId,
    profiles: [
      { id: 'quiet', name: 'quiet', utilities: [] },
      { id: 'loud', name: 'loud', launchAutomatically: false, utilities: [utility('simhub')] }
    ]
  })

  await loadConfigModule({
    appPaths: APP_PATHS,
    gamePaths: { ac: 'C:/Games/AssettoCorsa.exe' },
    profiles: { ac: sets('quiet') }
  })

  await saveProfile('ac', sets('loud'))

  // The outgoing profile launches the game and nothing else, so once the game is
  // excluded there is nothing leaving at all.
  expect(cancelPendingElevatedHandoffs).not.toHaveBeenCalled()
})

// A save for a game that has never been switched (flat legacy profile, no
// `activeProfileId` on either side) must not throw or cancel.
test('a legacy flat profile save cancels nothing (#782)', async () => {
  await loadConfigModule({
    appPaths: APP_PATHS,
    profiles: { ac: { simhub: true } }
  })

  await saveProfile('ac', profileSet('loud', { loud: ['simhub'] }))

  expect(cancelPendingElevatedHandoffs).not.toHaveBeenCalled()
})
