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
// Defaults to 1 so the handler's report path is exercised. The real counter is a
// module-level scalar incremented by the cancel callback; what matters here is
// that the handler DRAINS it and hands the count back (#782 Codex P2).
const drainStrandedConsentPrompts = vi.fn(() => 1)

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
    cancelPendingElevatedHandoffs,
    drainStrandedConsentPrompts
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

async function saveProfile(gameKey: string, profileSet: unknown): Promise<unknown> {
  const { __ipcHandlers } = await import('electron')
  return (__ipcHandlers as Record<string, MockIpcHandler>)['save-profile']({}, gameKey, profileSet)
}

const utility = (id: string) => ({ id, enabled: true })

/**
 * The predicate `save-profile` handed to `cancelPendingElevatedHandoffs`, applied
 * to a synthetic registry entry. Asserting on the predicate rather than on an
 * argument list is what lets these tests tell two slots apart when they share an
 * executable, which is the whole reason cancellation matches by slot
 * (CodeRabbit on #782).
 */
function cancelsHandoffFor(appKey: string, appPath: string): boolean {
  const matches = cancelPendingElevatedHandoffs.mock.calls[0]?.[1] as
    ((entry: { appKey?: string; appPath: string }) => boolean) | undefined
  expect(matches).toBeDefined()
  return matches!({ appKey, appPath })
}

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
  drainStrandedConsentPrompts.mockClear()
})

// The acceptance criterion from the issue, on the path the renderer actually
// takes. Profile "quiet" holds the app with the unanswered prompt and profile
// "loud" does not, so the switch leaves it behind.
test('a switch cancels a handoff for an app only the outgoing profile enabled (#782)', async () => {
  await loadConfigModule({
    appPaths: APP_PATHS,
    profiles: { ac: profileSet('quiet', { quiet: ['customapp1'], loud: ['simhub'] }) }
  })

  const result = await saveProfile(
    'ac',
    profileSet('loud', { quiet: ['customapp1'], loud: ['simhub'] })
  )

  expect(cancelPendingElevatedHandoffs).toHaveBeenCalledTimes(1)
  expect(cancelPendingElevatedHandoffs.mock.calls[0][0]).toBe('ac')
  expect(cancelsHandoffFor('customapp1', 'C:/Tools/Admin Tool.exe')).toBe(true)
  expect(cancelsHandoffFor('simhub', 'C:/Tools/SimHub.exe')).toBe(false)
  // Killing the host leaves the consent dialog on screen, so the count has to
  // come back out to the renderer or the user is never told it is dead (#809).
  expect(result).toEqual({ strandedConsentPrompts: 1 })
})

// The half that bites a different game entirely. The counter is one module-level
// scalar drained by whoever reports it, so a save that cancels something and
// does NOT drain leaves the count sitting there for the next kill to pick up and
// attribute to an operation that stranded nothing (Codex P2 on #782).
test('a switch that cancels drains the stranded count rather than leaving it (#782)', async () => {
  await loadConfigModule({
    appPaths: APP_PATHS,
    profiles: { ac: profileSet('quiet', { quiet: ['customapp1'], loud: ['simhub'] }) }
  })

  await saveProfile('ac', profileSet('loud', { quiet: ['customapp1'], loud: ['simhub'] }))

  expect(drainStrandedConsentPrompts).toHaveBeenCalledTimes(1)
})

// And the mirror: a save that cancels nothing must not drain either, or it would
// swallow a count belonging to an operation still waiting to report it.
test('a save that cancels nothing does not touch the stranded count (#782)', async () => {
  await loadConfigModule({
    appPaths: APP_PATHS,
    profiles: { ac: profileSet('quiet', { quiet: ['customapp1', 'simhub'], loud: ['simhub'] }) }
  })

  const result = await saveProfile(
    'ac',
    profileSet('quiet', { quiet: ['simhub'], loud: ['simhub'] })
  )

  expect(drainStrandedConsentPrompts).not.toHaveBeenCalled()
  expect(result).toBeUndefined()
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

// Two slots, one exe, different `appArgs` (#357). Comparing paths alone calls
// the outgoing slot retained because the incoming profile happens to run the
// same binary, so the old prompt survives and approving it launches that exe
// with the OUTGOING slot's arguments (Codex P1 on #782). Identity is the slot
// plus the path, and it has to be the same function the switch diff uses.
test('a slot move to the same exe still counts as leaving (#782)', async () => {
  const twoSlots = {
    customapp1: 'C:/Tools/Shared Utility.exe',
    customapp2: 'C:/Tools/Shared Utility.exe'
  }
  const sets = (activeProfileId: string) => ({
    activeProfileId,
    profiles: [
      { id: 'quiet', name: 'quiet', utilities: [utility('customapp1')] },
      { id: 'loud', name: 'loud', utilities: [utility('customapp2')] }
    ]
  })

  await loadConfigModule({ appPaths: twoSlots, customSlots: 2, profiles: { ac: sets('quiet') } })

  await saveProfile('ac', sets('loud'))

  // The leaving slot is cancelled...
  expect(cancelsHandoffFor('customapp1', 'C:/Tools/Shared Utility.exe')).toBe(true)
  // ...and the slot the incoming profile keeps is NOT, even though it is the
  // same binary. Matching on path alone cancels both, which loses a prompt the
  // user was about to approve for an app that is staying.
  expect(cancelsHandoffFor('customapp2', 'C:/Tools/Shared Utility.exe')).toBe(false)
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
