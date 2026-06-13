import type { ChildProcess } from 'child_process'
import { beforeEach, expect, test, vi } from 'vitest'

const readRunningProcessNamesMock = vi.fn()
const pruneUnclosedProcessesMock = vi.fn()

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
    getStoredStringRecord: vi.fn(() => ({}))
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
