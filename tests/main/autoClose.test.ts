import { afterEach, beforeEach, expect, test, vi } from 'vitest'

// #204 auto-close. Every test drives `observeProcessScan` directly with a raw
// tasklist result, which is the whole point of the design: the detector never
// sees the derived RunningApp[] list, because a failed read empties that list
// without meaning anything stopped.

const readRunningProcessNamesMock = vi.fn()
const invalidateProcessNameCacheMock = vi.fn()
const killLaunchedAppsMock = vi.fn(async () => ({ success: true, closedCount: 1, failures: [] }))

const ARMED = { closeAppsOnGameExit: true }

async function loadAutoCloseModule(opts?: {
  profiles?: Record<string, unknown>
  gamePaths?: Record<string, string>
  mismatchPaths?: string[]
}) {
  // utils.isValidExePath checks fs.existsSync; pretend every .exe exists so the
  // armed check does not depend on the host filesystem.
  vi.doMock('fs', () => ({
    default: {
      existsSync: (filePath: unknown) => typeof filePath === 'string' && /\.exe$/i.test(filePath)
    }
  }))

  const tasklistMock = {
    readRunningProcessNames: readRunningProcessNamesMock,
    invalidateProcessNameCache: invalidateProcessNameCacheMock
  }
  vi.doMock('./tasklist', () => tasklistMock)
  vi.doMock('/src/main/processes/tasklist.ts', () => tasklistMock)
  vi.doMock('../../src/main/processes/tasklist', () => tasklistMock)
  vi.doMock('../../src/main/processes/tasklist.ts', () => tasklistMock)

  const killMock = {
    killLaunchedApps: killLaunchedAppsMock,
    killProfileApps: vi.fn(),
    hasClosableLaunchedApps: vi.fn(),
    pruneUnclosedProcesses: vi.fn()
  }
  vi.doMock('./kill', () => killMock)
  vi.doMock('/src/main/processes/kill.ts', () => killMock)
  vi.doMock('../../src/main/processes/kill', () => killMock)
  vi.doMock('../../src/main/processes/kill.ts', () => killMock)

  // Only initAutoClose touches running.ts, and these tests call the observer
  // directly, so the registration seam is stubbed rather than exercised here.
  const runningMock = {
    registerProcessScanObserver: vi.fn(),
    unregisterProcessScanObserver: vi.fn()
  }
  vi.doMock('./running', () => runningMock)
  vi.doMock('/src/main/processes/running.ts', () => runningMock)
  vi.doMock('../../src/main/processes/running', () => runningMock)
  vi.doMock('../../src/main/processes/running.ts', () => runningMock)

  const stateMock = {
    processNameMismatchWarnings: new Map(
      (opts?.mismatchPaths ?? []).map((warnedPath) => [warnedPath.toLowerCase(), { warning: 'x' }])
    )
  }
  vi.doMock('./state', () => stateMock)
  vi.doMock('/src/main/processes/state.ts', () => stateMock)
  vi.doMock('../../src/main/processes/state', () => stateMock)
  vi.doMock('../../src/main/processes/state.ts', () => stateMock)

  const profilesMock = {
    getStoredProfiles: vi.fn(() => opts?.profiles ?? {}),
    // Tests pass a flat profile per game key; profile-set resolution is
    // profiles.ts' concern and has its own suite.
    getActiveStoredProfile: vi.fn((entry: unknown) => entry)
  }
  vi.doMock('../profiles', () => profilesMock)
  vi.doMock('/src/main/profiles.ts', () => profilesMock)
  vi.doMock('../../src/main/profiles', () => profilesMock)
  vi.doMock('../../src/main/profiles.ts', () => profilesMock)

  const storeMock = {
    getStoredStringRecord: vi.fn((key: string) =>
      key === 'gamePaths' ? (opts?.gamePaths ?? {}) : {}
    )
  }
  vi.doMock('../store', () => storeMock)
  vi.doMock('/src/main/store.ts', () => storeMock)
  vi.doMock('../../src/main/store', () => storeMock)
  vi.doMock('../../src/main/store.ts', () => storeMock)

  const errorLogMock = { writeAppErrorLog: vi.fn(), writeMainErrorLog: vi.fn() }
  vi.doMock('../errorLog', () => errorLogMock)
  vi.doMock('/src/main/errorLog.ts', () => errorLogMock)
  vi.doMock('../../src/main/errorLog', () => errorLogMock)
  vi.doMock('../../src/main/errorLog.ts', () => errorLogMock)

  return import('../../src/main/processes/autoClose')
}

// The default world: one armed game whose exe is running.
const AC_PROFILES = { ac: { ...ARMED } }
const AC_GAME_PATHS = { ac: 'C:/Games/acs.exe' }
const RUNNING = { processNames: new Set(['acs.exe']), succeeded: true }
const GONE = { processNames: new Set<string>(), succeeded: true }
const READ_FAILED = { processNames: new Set<string>(), succeeded: false }

beforeEach(() => {
  vi.useFakeTimers()
  readRunningProcessNamesMock.mockReset()
  invalidateProcessNameCacheMock.mockReset()
  killLaunchedAppsMock.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
  vi.resetModules()
  vi.doUnmock('fs')
})

test('a profile that never opted in is not closed, however the game exits (#204)', async () => {
  const { observeProcessScan, AUTO_CLOSE_GRACE_MS } = await loadAutoCloseModule({
    profiles: { ac: {} },
    gamePaths: AC_GAME_PATHS
  })
  // Required, not decoration: without it the final read resolves undefined and
  // the close throws on destructuring, so the assertion below would hold for a
  // reason that has nothing to do with the toggle being off.
  readRunningProcessNamesMock.mockResolvedValue(GONE)

  observeProcessScan(RUNNING)
  observeProcessScan(GONE)
  await vi.advanceTimersByTimeAsync(AUTO_CLOSE_GRACE_MS * 2)

  expect(killLaunchedAppsMock).not.toHaveBeenCalled()
})

test('an armed game closes its companions once the grace window elapses (#204)', async () => {
  const { observeProcessScan, AUTO_CLOSE_GRACE_MS } = await loadAutoCloseModule({
    profiles: AC_PROFILES,
    gamePaths: AC_GAME_PATHS
  })
  readRunningProcessNamesMock.mockResolvedValue(GONE)

  observeProcessScan(RUNNING)
  observeProcessScan(GONE)

  // One millisecond short of the window: still nothing, the whole point being
  // that companions get time to finish their end-of-session work.
  await vi.advanceTimersByTimeAsync(AUTO_CLOSE_GRACE_MS - 1)
  expect(killLaunchedAppsMock).not.toHaveBeenCalled()

  await vi.advanceTimersByTimeAsync(1)
  expect(killLaunchedAppsMock).toHaveBeenCalledWith('ac')
  // The confirming read must not be served from the 500ms cache, or the check
  // adjacent to the kill is not actually fresh.
  expect(invalidateProcessNameCacheMock).toHaveBeenCalled()
})

// The landmine. On a failed read processNames is empty, so anything treating it
// as an observation reads one failed tasklist as every game exiting at once.
test('a failed tasklist read is not an exit (#204)', async () => {
  const { observeProcessScan, AUTO_CLOSE_GRACE_MS } = await loadAutoCloseModule({
    profiles: AC_PROFILES,
    gamePaths: AC_GAME_PATHS
  })
  readRunningProcessNamesMock.mockResolvedValue(GONE)

  observeProcessScan(RUNNING)
  observeProcessScan(READ_FAILED)
  await vi.advanceTimersByTimeAsync(AUTO_CLOSE_GRACE_MS * 2)

  expect(killLaunchedAppsMock).not.toHaveBeenCalled()
})

test('a game that is back before the window elapses is not closed (#204)', async () => {
  const { observeProcessScan, AUTO_CLOSE_GRACE_MS } = await loadAutoCloseModule({
    profiles: AC_PROFILES,
    gamePaths: AC_GAME_PATHS
  })
  readRunningProcessNamesMock.mockResolvedValue(GONE)

  observeProcessScan(RUNNING)
  observeProcessScan(GONE)
  await vi.advanceTimersByTimeAsync(AUTO_CLOSE_GRACE_MS / 2)
  observeProcessScan(RUNNING)
  await vi.advanceTimersByTimeAsync(AUTO_CLOSE_GRACE_MS * 2)

  expect(killLaunchedAppsMock).not.toHaveBeenCalled()
})

// Distinct from the test above: here no scan ever saw it come back, so only the
// final read can catch it. This is what makes the recheck load-bearing rather
// than decorative.
test('a game found running by the final recheck is not closed (#204)', async () => {
  const { observeProcessScan, AUTO_CLOSE_GRACE_MS } = await loadAutoCloseModule({
    profiles: AC_PROFILES,
    gamePaths: AC_GAME_PATHS
  })
  readRunningProcessNamesMock.mockResolvedValue(RUNNING)

  observeProcessScan(RUNNING)
  observeProcessScan(GONE)
  await vi.advanceTimersByTimeAsync(AUTO_CLOSE_GRACE_MS)

  expect(killLaunchedAppsMock).not.toHaveBeenCalled()
})

test('a failed read at the end of the window aborts the close (#204)', async () => {
  const { observeProcessScan, AUTO_CLOSE_GRACE_MS } = await loadAutoCloseModule({
    profiles: AC_PROFILES,
    gamePaths: AC_GAME_PATHS
  })
  readRunningProcessNamesMock.mockResolvedValue(READ_FAILED)

  observeProcessScan(RUNNING)
  observeProcessScan(GONE)
  await vi.advanceTimersByTimeAsync(AUTO_CLOSE_GRACE_MS)

  expect(killLaunchedAppsMock).not.toHaveBeenCalled()
})

// The launcher-stub case. The exe exited right after launch and the real game
// runs under another name, so "the exe is gone" is already known to be a lie
// for this game and must not be acted on.
test('a game carrying a process-name mismatch warning never arms (#204)', async () => {
  const { observeProcessScan, AUTO_CLOSE_GRACE_MS } = await loadAutoCloseModule({
    profiles: AC_PROFILES,
    gamePaths: AC_GAME_PATHS,
    mismatchPaths: ['c:\\games\\acs.exe']
  })
  readRunningProcessNamesMock.mockResolvedValue(GONE)

  observeProcessScan(RUNNING)
  observeProcessScan(GONE)
  await vi.advanceTimersByTimeAsync(AUTO_CLOSE_GRACE_MS * 2)

  expect(killLaunchedAppsMock).not.toHaveBeenCalled()
})

test('a profile with tracking turned off never arms (#204)', async () => {
  const { observeProcessScan, AUTO_CLOSE_GRACE_MS } = await loadAutoCloseModule({
    profiles: { ac: { ...ARMED, trackingEnabled: false } },
    gamePaths: AC_GAME_PATHS
  })
  readRunningProcessNamesMock.mockResolvedValue(GONE)

  observeProcessScan(RUNNING)
  observeProcessScan(GONE)
  await vi.advanceTimersByTimeAsync(AUTO_CLOSE_GRACE_MS * 2)

  expect(killLaunchedAppsMock).not.toHaveBeenCalled()
})

test('turning the toggle off inside the window cancels the pending close (#204)', async () => {
  const profiles: Record<string, Record<string, unknown>> = { ac: { ...ARMED } }
  const { observeProcessScan, AUTO_CLOSE_GRACE_MS } = await loadAutoCloseModule({
    profiles,
    gamePaths: AC_GAME_PATHS
  })
  readRunningProcessNamesMock.mockResolvedValue(GONE)

  observeProcessScan(RUNNING)
  observeProcessScan(GONE)
  await vi.advanceTimersByTimeAsync(AUTO_CLOSE_GRACE_MS / 2)

  // The user disarms it while the window is open. The next scan must take the
  // timer down rather than let a close the user just turned off go ahead.
  profiles.ac.closeAppsOnGameExit = false
  observeProcessScan(GONE)
  await vi.advanceTimersByTimeAsync(AUTO_CLOSE_GRACE_MS * 2)

  expect(killLaunchedAppsMock).not.toHaveBeenCalled()
})

// A game that was never seen running cannot have exited. Without this the first
// scan of a session (or the first after the observer is re-registered) looks
// exactly like an exit.
test('a game absent from the very first scan is not treated as an exit (#204)', async () => {
  const { observeProcessScan, AUTO_CLOSE_GRACE_MS } = await loadAutoCloseModule({
    profiles: AC_PROFILES,
    gamePaths: AC_GAME_PATHS
  })
  readRunningProcessNamesMock.mockResolvedValue(GONE)

  observeProcessScan(GONE)
  await vi.advanceTimersByTimeAsync(AUTO_CLOSE_GRACE_MS * 2)

  expect(killLaunchedAppsMock).not.toHaveBeenCalled()
})

test('the window is armed once, not restarted by every scan that still finds it gone (#204)', async () => {
  const { observeProcessScan, AUTO_CLOSE_GRACE_MS } = await loadAutoCloseModule({
    profiles: AC_PROFILES,
    gamePaths: AC_GAME_PATHS
  })
  readRunningProcessNamesMock.mockResolvedValue(GONE)

  observeProcessScan(RUNNING)
  observeProcessScan(GONE)
  // Scans keep arriving every 2s while the window is open. If each one re-armed
  // the timer the close would be pushed out forever and never fire.
  for (let elapsed = 0; elapsed < AUTO_CLOSE_GRACE_MS; elapsed += 2000) {
    await vi.advanceTimersByTimeAsync(2000)
    observeProcessScan(GONE)
  }

  expect(killLaunchedAppsMock).toHaveBeenCalledTimes(1)
})
