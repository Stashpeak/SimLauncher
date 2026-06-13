import type { ChildProcess } from 'child_process'
import { beforeEach, expect, test, vi } from 'vitest'

const readRunningProcessNamesMock = vi.fn()
const pruneUnclosedProcessesMock = vi.fn()
// running.ts caches this for the synchronous tray predicate; the real selection
// logic lives in kill.ts and is covered in processes.test.ts.
const hasClosableLaunchedAppsMock = vi.fn()
// Per-test stored config (e.g. gamePaths) read via getStoredStringRecord(key).
const storedStringRecords: Record<string, Record<string, string>> = {}

async function loadRunningModule() {
  const tasklistMock = {
    readRunningProcessNames: readRunningProcessNamesMock,
    invalidateProcessNameCache: vi.fn()
  }
  vi.doMock('./tasklist', () => tasklistMock)
  vi.doMock('/src/main/processes/tasklist.ts', () => tasklistMock)
  vi.doMock('../../src/main/processes/tasklist', () => tasklistMock)
  vi.doMock('../../src/main/processes/tasklist.ts', () => tasklistMock)

  const killMock = {
    pruneUnclosedProcesses: pruneUnclosedProcessesMock,
    hasClosableLaunchedApps: hasClosableLaunchedAppsMock,
    killLaunchedApps: vi.fn(),
    killProfileApps: vi.fn()
  }
  vi.doMock('./kill', () => killMock)
  vi.doMock('/src/main/processes/kill.ts', () => killMock)
  vi.doMock('../../src/main/processes/kill', () => killMock)
  vi.doMock('../../src/main/processes/kill.ts', () => killMock)

  const profilesMock = {
    getStoredProfiles: vi.fn(() => ({})),
    getActiveStoredProfile: vi.fn(() => undefined),
    getProfileTrackablePaths: vi.fn(() => [])
  }
  vi.doMock('../profiles', () => profilesMock)
  vi.doMock('/src/main/profiles.ts', () => profilesMock)
  vi.doMock('../../src/main/profiles', () => profilesMock)
  vi.doMock('../../src/main/profiles.ts', () => profilesMock)

  const storeMock = {
    getStoredStringRecord: vi.fn((key: string) => storedStringRecords[key] ?? {})
  }
  vi.doMock('../store', () => storeMock)
  vi.doMock('/src/main/store.ts', () => storeMock)
  vi.doMock('../../src/main/store', () => storeMock)
  vi.doMock('../../src/main/store.ts', () => storeMock)

  const runningModule = await import('../../src/main/processes/running')
  const stateModule = await import('../../src/main/processes/state')
  return { runningModule, stateModule }
}

function seedState(stateModule: Awaited<ReturnType<typeof loadRunningModule>>['stateModule']) {
  stateModule.runningProcesses.set('launched', {
    process: {} as ChildProcess,
    path: 'C:/Tools/SimHub.exe',
    name: 'SimHub.exe',
    gameKey: 'iracing',
    isGame: false
  })
  stateModule.unclosedProcesses.set('iracing:c:\\tools\\crewchief.exe', {
    path: 'C:/Tools/CrewChief.exe',
    name: 'CrewChief.exe',
    gameKey: 'iracing',
    error: 'still running',
    reason: 'still_running'
  })
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  hasClosableLaunchedAppsMock.mockResolvedValue(false)
  for (const key of Object.keys(storedStringRecords)) {
    delete storedStringRecords[key]
  }
})

// A failed tasklist read returns an empty Set carrying no signal value.
// Treating it as "everything exited" would wipe running/unclosed state and
// silently drop kill/relaunch controls mid-session (#399).
test('a failed tasklist read does not prune running or unclosed state (#399)', async () => {
  const { runningModule, stateModule } = await loadRunningModule()
  seedState(stateModule)
  readRunningProcessNamesMock.mockResolvedValue({ processNames: new Set(), succeeded: false })

  const apps = await runningModule.getRunningApps()

  expect(stateModule.runningProcesses.size).toBe(1)
  expect(stateModule.unclosedProcesses.size).toBe(1)
  expect(pruneUnclosedProcessesMock).not.toHaveBeenCalled()
  // Launched apps stay surfaced even when the scan is blind.
  expect(apps.map((app) => app.path)).toContain('C:/Tools/SimHub.exe')
})

test('a successful tasklist read prunes processes that are gone', async () => {
  const { runningModule, stateModule } = await loadRunningModule()
  seedState(stateModule)
  readRunningProcessNamesMock.mockResolvedValue({ processNames: new Set(), succeeded: true })

  const apps = await runningModule.getRunningApps()

  expect(stateModule.runningProcesses.size).toBe(0)
  expect(pruneUnclosedProcessesMock).toHaveBeenCalledWith(new Set())
  expect(apps).toEqual([])
})

test('a successful tasklist read keeps entries whose exe is still running', async () => {
  const { runningModule, stateModule } = await loadRunningModule()
  seedState(stateModule)
  readRunningProcessNamesMock.mockResolvedValue({
    processNames: new Set(['simhub.exe', 'crewchief.exe']),
    succeeded: true
  })

  const apps = await runningModule.getRunningApps()

  expect(stateModule.runningProcesses.size).toBe(1)
  expect(apps.map((app) => app.path).sort()).toEqual([
    'C:/Tools/CrewChief.exe',
    'C:/Tools/SimHub.exe'
  ])
})

// The tray "Close Apps" item is enabled off this synchronous check, which
// getRunningApps() refreshes from killLaunchedApps' own target selection
// (hasClosableLaunchedApps). The selection logic itself is covered in
// processes.test.ts; here we only verify the cache plumbing (#519).
test('hasClosableApps returns the kill-target check cached by getRunningApps (#519)', async () => {
  const { runningModule } = await loadRunningModule()
  readRunningProcessNamesMock.mockResolvedValue({ processNames: new Set(), succeeded: true })

  hasClosableLaunchedAppsMock.mockResolvedValue(false)
  await runningModule.getRunningApps()
  expect(runningModule.hasClosableApps()).toBe(false)

  hasClosableLaunchedAppsMock.mockResolvedValue(true)
  await runningModule.getRunningApps()
  expect(runningModule.hasClosableApps()).toBe(true)
})

// The tray refreshes its menu off a main-process listener (it has no WebContents
// of its own). The listener fires from the same emission as renderer subscribers
// and can be removed via the returned unsubscribe (#519).
test('main-process listeners receive running-apps changes and can unsubscribe (#519)', async () => {
  const { runningModule, stateModule } = await loadRunningModule()
  stateModule.runningProcesses.set('companion', {
    process: {} as ChildProcess,
    path: 'C:/Tools/SimHub.exe',
    name: 'SimHub.exe',
    gameKey: 'iracing',
    isGame: false
  })
  readRunningProcessNamesMock.mockResolvedValue({
    processNames: new Set(['simhub.exe']),
    succeeded: true
  })

  const webContents = { isDestroyed: () => false, send: vi.fn(), once: vi.fn() }
  await runningModule.subscribeRunningApps(webContents as never)

  // Register after subscribe so we observe only the change emission, not the
  // initial-snapshot notification (covered by its own test).
  const listener = vi.fn()
  const unsubscribe = runningModule.addRunningAppsChangeListener(listener)
  await runningModule.publishRunningApps('kill')

  expect(listener).toHaveBeenCalledTimes(1)
  expect(listener.mock.calls[0][0].reason).toBe('kill')

  unsubscribe()
  listener.mockClear()
  await runningModule.publishRunningApps('kill')
  expect(listener).not.toHaveBeenCalled()

  // Stop the 2s scan interval started by subscribeRunningApps.
  runningModule.unsubscribeRunningApps(webContents as never)
})

// Codex P2 on #536: createTray() builds the menu before the renderer subscribes,
// so a companion already running at startup must still enable the tray via the
// initial-snapshot notification (the scan dedup would otherwise never re-emit).
test('subscribing notifies main-process listeners with the initial snapshot (#519)', async () => {
  const { runningModule, stateModule } = await loadRunningModule()
  stateModule.runningProcesses.set('companion', {
    process: {} as ChildProcess,
    path: 'C:/Tools/SimHub.exe',
    name: 'SimHub.exe',
    gameKey: 'iracing',
    isGame: false
  })
  readRunningProcessNamesMock.mockResolvedValue({
    processNames: new Set(['simhub.exe']),
    succeeded: true
  })

  const listener = vi.fn()
  runningModule.addRunningAppsChangeListener(listener)

  const webContents = { isDestroyed: () => false, send: vi.fn(), once: vi.fn() }
  await runningModule.subscribeRunningApps(webContents as never)

  expect(listener).toHaveBeenCalledTimes(1)
  expect(listener.mock.calls[0][0].reason).toBe('initial')

  runningModule.unsubscribeRunningApps(webContents as never)
})

// Codex P2 on #536: a process-name mismatch warning (original exe already gone
// from the tasklist) is not something killLaunchedApps can close, so it must not
// enable the tray action.
test('hasClosableApps excludes process-name mismatch warnings (#519)', async () => {
  const { runningModule, stateModule } = await loadRunningModule()
  stateModule.processNameMismatchWarnings.set('iracing:c:\\tools\\wrapper.exe', {
    path: 'C:/Tools/Wrapper.exe',
    name: 'Wrapper.exe',
    gameKey: 'iracing',
    warning: 'a renamed child process is still running'
  })
  // The original Wrapper.exe is NOT in the tasklist (that is what makes it a
  // mismatch warning); only an unrelated child survives.
  readRunningProcessNamesMock.mockResolvedValue({
    processNames: new Set(['someotherchild.exe']),
    succeeded: true
  })

  const apps = await runningModule.getRunningApps()

  expect(apps.some((app) => app.path === 'C:/Tools/Wrapper.exe')).toBe(true)
  expect(runningModule.hasClosableApps()).toBe(false)
})

// killLaunchedApps awaits publishRunningApps; a throwing menu-refresh listener
// must not turn a successful kill into a rejected publish (#519).
test('a throwing change listener does not break publishing or other listeners (#519)', async () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  const { runningModule, stateModule } = await loadRunningModule()
  stateModule.runningProcesses.set('companion', {
    process: {} as ChildProcess,
    path: 'C:/Tools/SimHub.exe',
    name: 'SimHub.exe',
    gameKey: 'iracing',
    isGame: false
  })
  readRunningProcessNamesMock.mockResolvedValue({
    processNames: new Set(['simhub.exe']),
    succeeded: true
  })

  const webContents = { isDestroyed: () => false, send: vi.fn(), once: vi.fn() }
  await runningModule.subscribeRunningApps(webContents as never)

  // Register after subscribe so the counts below reflect only the kill emission.
  const throwingListener = vi.fn(() => {
    throw new Error('listener boom')
  })
  const goodListener = vi.fn()
  runningModule.addRunningAppsChangeListener(throwingListener)
  runningModule.addRunningAppsChangeListener(goodListener)

  await expect(runningModule.publishRunningApps('kill')).resolves.not.toThrow()
  expect(throwingListener).toHaveBeenCalledTimes(1)
  expect(goodListener).toHaveBeenCalledTimes(1)

  runningModule.unsubscribeRunningApps(webContents as never)
  consoleError.mockRestore()
})
