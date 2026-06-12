import { beforeEach, expect, test, vi } from 'vitest'

type MockIpcHandler = (...args: unknown[]) => Promise<unknown>

const launchProfileApps = vi.fn()
const killProfileApps = vi.fn()
const readRunningProcessNames = vi.fn()
const buildActiveProfileLaunchEntries = vi.fn()
const buildNamedProfileLaunchEntries = vi.fn()

const GAME_ENTRY = { key: 'iracing', path: 'C:/Games/iRacingUI.exe' }
const SIMHUB_ENTRY = { key: 'simhub', path: 'C:/Tools/SimHub.exe' }
const CREWCHIEF_ENTRY = { key: 'crewchief', path: 'C:/Tools/CrewChief.exe' }

function exeNameOf(appPath: string) {
  return appPath.split(/[\\/]/).pop()!.toLowerCase()
}

async function loadLaunchHandlers() {
  const { clearIpcHandlers } = await import('electron')
  ;(clearIpcHandlers as () => void)()

  const processesMock = {
    launchProfileApps,
    killProfileApps,
    killLaunchedApps: vi.fn(),
    readRunningProcessNames,
    isRunningExePath: (processNames: Set<string>, appPath: string) =>
      processNames.has(exeNameOf(appPath)),
    getRunningApps: vi.fn(async () => []),
    subscribeRunningApps: vi.fn(),
    unsubscribeRunningApps: vi.fn()
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

  expect(launchProfileApps).toHaveBeenCalledWith(sender, 'iracing', [GAME_ENTRY, CREWCHIEF_ENTRY])
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
  expect(killProfileApps).toHaveBeenCalledWith('iracing', [utilA.path])
  expect(launchProfileApps).toHaveBeenCalledWith(sender, 'iracing', [utilB])
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
