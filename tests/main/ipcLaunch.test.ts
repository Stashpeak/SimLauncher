import { beforeEach, expect, test, vi } from 'vitest'

type MockIpcHandler = (...args: unknown[]) => Promise<unknown>

const launchProfileApps = vi.fn()
const killProfileApps = vi.fn()
const readRunningProcessNames = vi.fn()
const buildActiveProfileLaunchEntries = vi.fn()
const buildNamedProfileLaunchEntries = vi.fn()
// Backed by the REAL src/main/processes/state.ts implementation (assigned in
// loadLaunchHandlers below) rather than a bare vi.fn() stub — these tests are
// about the IPC handlers' registration/cancellation WIRING (#716: the two
// pre-launch windows where a Close Apps click used to find nothing to abort),
// so they need the actual AbortController bookkeeping, not a mock of it.
const registerActiveLaunch = vi.fn()
const unregisterActiveLaunch = vi.fn()

const GAME_ENTRY = { key: 'iracing', path: 'C:/Games/iRacingUI.exe' }
const SIMHUB_ENTRY = { key: 'simhub', path: 'C:/Tools/SimHub.exe' }
const CREWCHIEF_ENTRY = { key: 'crewchief', path: 'C:/Tools/CrewChief.exe' }

function exeNameOf(appPath: string) {
  return appPath.split(/[\\/]/).pop()!.toLowerCase()
}

// Flushes the microtask queue via a macrotask boundary (setImmediate always
// runs after every microtask already queued). Used to let an IPC handler
// advance past a real `await` (e.g. readRunningProcessNames' default resolved
// mock) up to its next call, so a test can land an abort exactly inside a
// specific pre-launch window (#716).
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

async function loadLaunchHandlers() {
  const { clearIpcHandlers } = await import('electron')
  ;(clearIpcHandlers as () => void)()

  const stateModule = await import('../../src/main/processes/state')
  registerActiveLaunch.mockImplementation(stateModule.registerActiveLaunch)
  unregisterActiveLaunch.mockImplementation(stateModule.unregisterActiveLaunch)

  const processesMock = {
    launchProfileApps,
    killProfileApps,
    killLaunchedApps: vi.fn(),
    readRunningProcessNames,
    isRunningExePath: (processNames: Set<string>, appPath: string) =>
      processNames.has(exeNameOf(appPath)),
    getRunningApps: vi.fn(async () => []),
    subscribeRunningApps: vi.fn(),
    unsubscribeRunningApps: vi.fn(),
    registerActiveLaunch,
    unregisterActiveLaunch
  }
  vi.doMock('../processes', () => processesMock)
  vi.doMock('/src/main/processes.ts', () => processesMock)
  vi.doMock('../../src/main/processes', () => processesMock)
  vi.doMock('../../src/main/processes.ts', () => processesMock)

  const profilesMock = { buildActiveProfileLaunchEntries, buildNamedProfileLaunchEntries }
  vi.doMock('../profiles', () => profilesMock)
  vi.doMock('/src/main/profiles.ts', () => profilesMock)
  vi.doMock('../../src/main/profiles', () => profilesMock)
  vi.doMock('../../src/main/profiles.ts', () => profilesMock)

  const storeMock = {
    KNOWN_GAME_KEYS: new Set(['iracing']),
    getStoredStringRecord: vi.fn((key: string) =>
      key === 'gamePaths' ? { iracing: GAME_ENTRY.path } : {}
    )
  }
  vi.doMock('../store', () => storeMock)
  vi.doMock('/src/main/store.ts', () => storeMock)
  vi.doMock('../../src/main/store', () => storeMock)
  vi.doMock('../../src/main/store.ts', () => storeMock)

  const launchModule = await import('../../src/main/ipc/launch')
  launchModule.registerLaunchHandlers()
  const { __ipcHandlers } = await import('electron')
  return __ipcHandlers as Record<string, MockIpcHandler>
}

const sender = { id: 1 }
const event = { sender }

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  readRunningProcessNames.mockResolvedValue({ processNames: new Set(), succeeded: true })
  launchProfileApps.mockResolvedValue({ success: true, launchedCount: 1, skippedCount: 0 })
  killProfileApps.mockResolvedValue({
    success: true,
    closedCount: 1,
    failedCount: 0,
    failures: []
  })
})

test('launch-profile rejects unknown or malformed game keys without launching', async () => {
  const handlers = await loadLaunchHandlers()

  await expect(handlers['launch-profile'](event, 'doom')).resolves.toEqual({
    success: false,
    error: 'Unknown game key'
  })
  await expect(handlers['launch-profile'](event, 42)).resolves.toEqual({
    success: false,
    error: 'Invalid argument'
  })
  expect(launchProfileApps).not.toHaveBeenCalled()
})

test('launch-profile reports an empty profile instead of delegating', async () => {
  const handlers = await loadLaunchHandlers()
  buildActiveProfileLaunchEntries.mockReturnValue([])

  await expect(handlers['launch-profile'](event, 'iracing')).resolves.toEqual({
    success: false,
    error: 'No executable paths configured for this profile.'
  })
  expect(launchProfileApps).not.toHaveBeenCalled()
})

test('launch-profile delegates the built entries with the renderer sender', async () => {
  const handlers = await loadLaunchHandlers()
  buildActiveProfileLaunchEntries.mockReturnValue([GAME_ENTRY, SIMHUB_ENTRY])

  await handlers['launch-profile'](event, 'iracing')

  expect(launchProfileApps).toHaveBeenCalledWith(sender, 'iracing', [GAME_ENTRY, SIMHUB_ENTRY])
})

// Double-launch prevention: relaunch must only start the entries whose exe is
// NOT already running, otherwise a second SimHub/game instance spawns.
test('relaunch-missing-profile launches only entries that are not running', async () => {
  const handlers = await loadLaunchHandlers()
  buildActiveProfileLaunchEntries.mockReturnValue([GAME_ENTRY, SIMHUB_ENTRY, CREWCHIEF_ENTRY])
  readRunningProcessNames.mockResolvedValue({
    processNames: new Set(['simhub.exe']),
    succeeded: true
  })

  await handlers['relaunch-missing-profile'](event, 'iracing')

  // #716: registered BEFORE the tasklist scan above, and threaded through so
  // launchProfileApps shares it instead of minting its own fresh (never
  // aborted) controller.
  expect(registerActiveLaunch).toHaveBeenCalledWith('iracing')
  const controller = registerActiveLaunch.mock.results[0]!.value as AbortController
  expect(launchProfileApps).toHaveBeenCalledWith(sender, 'iracing', [GAME_ENTRY, CREWCHIEF_ENTRY], {
    controller
  })
})

test('relaunch-missing-profile is a no-op when everything is already running', async () => {
  const handlers = await loadLaunchHandlers()
  buildActiveProfileLaunchEntries.mockReturnValue([GAME_ENTRY, SIMHUB_ENTRY])
  readRunningProcessNames.mockResolvedValue({
    processNames: new Set(['iracingui.exe', 'simhub.exe']),
    succeeded: true
  })

  await expect(handlers['relaunch-missing-profile'](event, 'iracing')).resolves.toEqual({
    success: true,
    message: 'All profile apps are already running.',
    launchedCount: 0,
    skippedCount: 0
  })
  expect(launchProfileApps).not.toHaveBeenCalled()
  // #716: this early return (nothing to relaunch) never reaches
  // launchProfileApps, which is the only other place that unregisters the
  // controller — the handler itself must release it here, or a Close Apps
  // click after this call keeps "finding" a controller for an already-ended
  // relaunch attempt.
  expect(registerActiveLaunch).toHaveBeenCalledWith('iracing')
  const controller = registerActiveLaunch.mock.results[0]!.value as AbortController
  expect(unregisterActiveLaunch).toHaveBeenCalledWith('iracing', controller)
})

// #716 regression: Close Apps landing during the pre-scan tasklist read (the
// `await readRunningProcessNames()` above the launchProfileApps call) used to
// have nothing registered yet to abort — the sequence would then launch with
// a fresh, un-aborted controller right after the user asked to close
// everything. registerActiveLaunch must run BEFORE that scan so the abort
// lands on a real registration.
test('relaunch-missing-profile honors a Close Apps click landing during its pre-scan', async () => {
  const handlers = await loadLaunchHandlers()
  const { abortActiveLaunches } = await import('../../src/main/processes/state')
  buildActiveProfileLaunchEntries.mockReturnValue([GAME_ENTRY, SIMHUB_ENTRY])

  let resolveScan!: (value: { processNames: Set<string>; succeeded: boolean }) => void
  readRunningProcessNames.mockReturnValue(
    new Promise((resolve) => {
      resolveScan = resolve
    })
  )
  // Models launchProfileApps' real documented contract (already covered end
  // to end in tests/main/processes.test.ts): it must not spawn anything once
  // the shared controller is aborted, and must report `cancelled: true`.
  launchProfileApps.mockImplementation(async (_s, _k, entries, options) => {
    if (options?.controller?.signal.aborted) {
      return { success: false, cancelled: true, launchedCount: 0 }
    }
    return { success: true, launchedCount: entries.length, skippedCount: 0 }
  })

  const resultPromise = handlers['relaunch-missing-profile'](event, 'iracing')

  // registerActiveLaunch runs synchronously before the pre-scan await, so by
  // this point (still in the same tick) there is already something for a
  // real Close Apps click to abort.
  abortActiveLaunches('iracing')
  resolveScan({ processNames: new Set(), succeeded: true })

  await expect(resultPromise).resolves.toMatchObject({ success: false, cancelled: true })
})

// #716 regression: the IPC handler's own controller bookkeeping must not race
// ahead of launchProfileApps actually finishing. `return launchProfileApps(...)`
// (no `await`) would run the handler's finally as soon as the promise is
// obtained — unregistering the controller from the registry WHILE the launch
// loop is still using it, making a Close Apps click during the loop a no-op
// again for the remainder of the sequence.
test('relaunch-missing-profile keeps its controller registered until launchProfileApps actually finishes', async () => {
  const handlers = await loadLaunchHandlers()
  buildActiveProfileLaunchEntries.mockReturnValue([GAME_ENTRY, SIMHUB_ENTRY])
  readRunningProcessNames.mockResolvedValue({ processNames: new Set(), succeeded: true })

  let resolveLaunch!: (value: unknown) => void
  launchProfileApps.mockReturnValue(
    new Promise((resolve) => {
      resolveLaunch = resolve
    })
  )

  const resultPromise = handlers['relaunch-missing-profile'](event, 'iracing')
  await flushMicrotasks()

  expect(launchProfileApps).toHaveBeenCalled()
  expect(unregisterActiveLaunch).not.toHaveBeenCalled()

  resolveLaunch({ success: true, launchedCount: 2, skippedCount: 0 })
  await resultPromise

  expect(unregisterActiveLaunch).toHaveBeenCalled()
})

// THE profile-switch invariant: switching profiles mid-session must never
// stop (or relaunch) the running sim itself — only the companion apps differ.
test('switch-profile-apps never kills or relaunches the game executable', async () => {
  const handlers = await loadLaunchHandlers()
  const utilA = { key: 'customapp1', path: 'C:/Tools/UtilA.exe' }
  const utilB = { key: 'customapp2', path: 'C:/Tools/UtilB.exe' }
  buildNamedProfileLaunchEntries.mockImplementation((_gameKey: string, profileId: string) =>
    profileId === 'p-from' ? [GAME_ENTRY, utilA] : [GAME_ENTRY, utilB]
  )
  readRunningProcessNames.mockResolvedValue({
    processNames: new Set(['iracingui.exe', 'utila.exe']),
    succeeded: true
  })

  const result = (await handlers['switch-profile-apps'](event, 'iracing', 'p-from', 'p-to')) as {
    success: boolean
  }

  expect(result.success).toBe(true)
  // #716: the switch registers its OWN controller before doing any of its
  // async pre-launch work, and must pass it as `except` to its own
  // killProfileApps call — otherwise that call's abortActiveLaunches(gameKey)
  // would self-abort the switch it is in the middle of performing (the
  // "self-abort trap" from the issue's fix sketch). The SAME controller is
  // then threaded into launchProfileApps for the incoming profile.
  expect(registerActiveLaunch).toHaveBeenCalledWith('iracing')
  const controller = registerActiveLaunch.mock.results[0]!.value as AbortController
  expect(controller.signal.aborted).toBe(false)
  expect(killProfileApps).toHaveBeenCalledWith('iracing', [utilA.path], { except: controller })
  expect(launchProfileApps).toHaveBeenCalledWith(sender, 'iracing', [utilB], { controller })
  expect(unregisterActiveLaunch).toHaveBeenCalledWith('iracing', controller)
})

// #716 regression: Close Apps landing during the switch's OWN kill phase
// (killProfileApps stopping the outgoing profile's apps, which the issue
// calls out as potentially taking seconds via WMI lookups) used to have no
// effect on the switch already in flight — profile B would still launch
// right after. The switch's controller must still be shared with
// launchProfileApps so that check catches it.
test('switch-profile-apps honors a Close Apps click landing during its own kill phase', async () => {
  const handlers = await loadLaunchHandlers()
  const { abortActiveLaunches } = await import('../../src/main/processes/state')
  const utilA = { key: 'customapp1', path: 'C:/Tools/UtilA.exe' }
  const utilB = { key: 'customapp2', path: 'C:/Tools/UtilB.exe' }
  buildNamedProfileLaunchEntries.mockImplementation((_gameKey: string, profileId: string) =>
    profileId === 'p-from' ? [GAME_ENTRY, utilA] : [GAME_ENTRY, utilB]
  )
  readRunningProcessNames.mockResolvedValue({
    processNames: new Set(['iracingui.exe', 'utila.exe']),
    succeeded: true
  })

  let resolveKill!: (value: {
    success: boolean
    closedCount: number
    failedCount: number
    failures: unknown[]
  }) => void
  killProfileApps.mockReturnValue(
    new Promise((resolve) => {
      resolveKill = resolve
    })
  )
  launchProfileApps.mockImplementation(async (_s, _k, entries, options) => {
    if (options?.controller?.signal.aborted) {
      return { success: false, cancelled: true, launchedCount: 0 }
    }
    return { success: true, launchedCount: entries.length, skippedCount: 0 }
  })

  const resultPromise = handlers['switch-profile-apps'](event, 'iracing', 'p-from', 'p-to')

  // Let the handler reach and call killProfileApps (the "kill phase") before
  // landing the abort — a real Close Apps click while that call is still
  // pending must still stop profile B from launching once it resolves.
  await flushMicrotasks()
  abortActiveLaunches('iracing')
  resolveKill({ success: true, closedCount: 1, failedCount: 0, failures: [] })

  await expect(resultPromise).resolves.toMatchObject({ success: false, cancelled: true })
  expect(launchProfileApps).not.toHaveBeenCalledWith(sender, 'iracing', [utilB], {
    controller: expect.objectContaining({ signal: expect.objectContaining({ aborted: false }) })
  })
})

// #716: the entries-to-start === 0 branch returns before ever calling
// launchProfileApps (nothing new needs to start), so — like the analogous
// relaunch-missing-profile no-op path — the handler itself must release the
// controller it registered up front.
test('switch-profile-apps unregisters its controller when nothing new needs to start', async () => {
  const handlers = await loadLaunchHandlers()
  buildNamedProfileLaunchEntries.mockImplementation((_gameKey: string, profileId: string) =>
    profileId === 'p-from' ? [GAME_ENTRY] : [GAME_ENTRY]
  )
  readRunningProcessNames.mockResolvedValue({
    processNames: new Set(['iracingui.exe']),
    succeeded: true
  })

  await handlers['switch-profile-apps'](event, 'iracing', 'p-from', 'p-to')

  expect(launchProfileApps).not.toHaveBeenCalled()
  expect(registerActiveLaunch).toHaveBeenCalledWith('iracing')
  const controller = registerActiveLaunch.mock.results[0]!.value as AbortController
  expect(unregisterActiveLaunch).toHaveBeenCalledWith('iracing', controller)
})

test('get-profile-switch-diff counts stops/starts without the game executable', async () => {
  const handlers = await loadLaunchHandlers()
  const utilA = { key: 'customapp1', path: 'C:/Tools/UtilA.exe' }
  const utilB = { key: 'customapp2', path: 'C:/Tools/UtilB.exe' }
  buildNamedProfileLaunchEntries.mockImplementation((_gameKey: string, profileId: string) =>
    profileId === 'p-from' ? [GAME_ENTRY, utilA] : [GAME_ENTRY, utilB]
  )
  readRunningProcessNames.mockResolvedValue({
    processNames: new Set(['iracingui.exe', 'utila.exe']),
    succeeded: true
  })

  await expect(
    handlers['get-profile-switch-diff'](event, 'iracing', 'p-from', 'p-to')
  ).resolves.toEqual({ toStopCount: 1, toStartCount: 1 })
})
