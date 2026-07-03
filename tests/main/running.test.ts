import type { ChildProcess } from 'child_process'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const readRunningProcessNamesMock = vi.fn()
const pruneUnclosedProcessesMock = vi.fn()

async function loadRunningModule(opts?: {
  profiles?: Record<string, unknown>
  gamePaths?: Record<string, string>
  appPaths?: Record<string, string>
  trackablePaths?: string[]
}) {
  // utils.isValidExePath checks fs.existsSync; pretend every .exe exists so
  // adoption (which validates the configured game path) works host-independently.
  vi.doMock('fs', () => ({
    default: {
      existsSync: (filePath: unknown) => typeof filePath === 'string' && /\.exe$/i.test(filePath)
    }
  }))

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
    getStoredProfiles: vi.fn(() => opts?.profiles ?? {}),
    getActiveStoredProfile: vi.fn(() => undefined),
    getProfileTrackablePaths: vi.fn(() => opts?.trackablePaths ?? [])
  }
  vi.doMock('../profiles', () => profilesMock)
  vi.doMock('/src/main/profiles.ts', () => profilesMock)
  vi.doMock('../../src/main/profiles', () => profilesMock)
  vi.doMock('../../src/main/profiles.ts', () => profilesMock)

  const storeMock = {
    getStoredStringRecord: vi.fn((key: string) =>
      key === 'gamePaths' ? (opts?.gamePaths ?? {}) : (opts?.appPaths ?? {})
    )
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

afterEach(() => {
  vi.useRealTimers()
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

// --- Adaptive poll cadence (#672) ---
//
// These must stay in sync with the constants in running.ts.
const FAST_SCAN_MS = 2000
const SLOW_SCAN_MS = 12000

// A fixed, large clock so `Date.now() - lastActivityAt` starts well outside the
// 30s post-activity window (lastActivityAt defaults to 0) — otherwise a faked
// clock starting near 0 would read as "just had activity" and force FAST.
const CLOCK_START_MS = 2_000_000_000_000

function createMockWebContents() {
  return {
    once: vi.fn(),
    isDestroyed: vi.fn(() => false),
    send: vi.fn()
  }
}

async function startMonitorHidden(
  runningModule: Awaited<ReturnType<typeof loadRunningModule>>['runningModule']
) {
  vi.useFakeTimers()
  vi.setSystemTime(CLOCK_START_MS)
  readRunningProcessNamesMock.mockResolvedValue({ processNames: new Set(), succeeded: true })
  // Window hidden in the tray + zero tracked processes = the backoff condition.
  runningModule.setRunningAppsWindowVisible(false)
  const webContents = createMockWebContents()
  await runningModule.subscribeRunningApps(webContents as never)
  return webContents
}

test('hidden + empty backs off to the slow scan interval (#672)', async () => {
  const { runningModule } = await loadRunningModule()
  await startMonitorHidden(runningModule)

  // No scan fires on the FAST cadence — the poll has backed off.
  const readsAfterSubscribe = readRunningProcessNamesMock.mock.calls.length
  await vi.advanceTimersByTimeAsync(FAST_SCAN_MS)
  expect(readRunningProcessNamesMock.mock.calls.length).toBe(readsAfterSubscribe)

  // It still fires once the SLOW interval elapses (polling is never stopped).
  await vi.advanceTimersByTimeAsync(SLOW_SCAN_MS - FAST_SCAN_MS)
  expect(readRunningProcessNamesMock.mock.calls.length).toBeGreaterThan(readsAfterSubscribe)
})

test('polling keeps firing on the slow cadence — it is never stopped (#672)', async () => {
  const { runningModule } = await loadRunningModule()
  await startMonitorHidden(runningModule)

  let reads = readRunningProcessNamesMock.mock.calls.length
  await vi.advanceTimersByTimeAsync(SLOW_SCAN_MS)
  expect(readRunningProcessNamesMock.mock.calls.length).toBeGreaterThan(reads)

  // A second slow interval also fires — the self-rescheduling timer persists.
  reads = readRunningProcessNamesMock.mock.calls.length
  await vi.advanceTimersByTimeAsync(SLOW_SCAN_MS)
  expect(readRunningProcessNamesMock.mock.calls.length).toBeGreaterThan(reads)
})

test('a launch/activity resets the cadence back to fast (#672)', async () => {
  const { runningModule } = await loadRunningModule()
  await startMonitorHidden(runningModule)

  // Baseline: on the slow cadence nothing fires within a FAST interval.
  let reads = readRunningProcessNamesMock.mock.calls.length
  await vi.advanceTimersByTimeAsync(FAST_SCAN_MS)
  expect(readRunningProcessNamesMock.mock.calls.length).toBe(reads)

  // A non-scan publish (launch/exit/kill) is activity → pull back to FAST.
  await runningModule.publishRunningApps('launch')
  reads = readRunningProcessNamesMock.mock.calls.length
  await vi.advanceTimersByTimeAsync(FAST_SCAN_MS)
  expect(readRunningProcessNamesMock.mock.calls.length).toBeGreaterThan(reads)
})

test('the window becoming visible resets the cadence back to fast (#672)', async () => {
  const { runningModule } = await loadRunningModule()
  await startMonitorHidden(runningModule)

  // Baseline: hidden + empty stays slow (no FAST-interval tick).
  let reads = readRunningProcessNamesMock.mock.calls.length
  await vi.advanceTimersByTimeAsync(FAST_SCAN_MS)
  expect(readRunningProcessNamesMock.mock.calls.length).toBe(reads)

  // Showing the window pulls the poll back to FAST.
  runningModule.setRunningAppsWindowVisible(true)
  reads = readRunningProcessNamesMock.mock.calls.length
  await vi.advanceTimersByTimeAsync(FAST_SCAN_MS)
  expect(readRunningProcessNamesMock.mock.calls.length).toBeGreaterThan(reads)
})

test('tracked processes keep the poll fast even while hidden and idle (#672)', async () => {
  const { runningModule, stateModule } = await loadRunningModule()
  await startMonitorHidden(runningModule)

  // A tracked launched process is part of the backoff condition (state must be
  // empty to go slow). Keep it alive across the scan by having the tasklist read
  // still report its exe, so the prune does not clear it.
  readRunningProcessNamesMock.mockResolvedValue({
    processNames: new Set(['simhub.exe']),
    succeeded: true
  })
  stateModule.runningProcesses.set('launched', {
    process: {} as ChildProcess,
    path: 'C:/Tools/SimHub.exe',
    name: 'SimHub.exe',
    gameKey: 'iracing',
    isGame: false
  })

  // Drain the pending SLOW interval so the cadence is recomputed with the
  // tracked process present — no launch activity, still hidden.
  await vi.advanceTimersByTimeAsync(SLOW_SCAN_MS)

  // The recomputed cadence is FAST: a scan now fires within a FAST interval.
  const reads = readRunningProcessNamesMock.mock.calls.length
  await vi.advanceTimersByTimeAsync(FAST_SCAN_MS)
  expect(readRunningProcessNamesMock.mock.calls.length).toBeGreaterThan(reads)
})

// --- Taskbar-minimize backoff gap + related residuals (#708) ---

test('the bootstrap read seeds the cadence count, so an already-running adopted app schedules fast on the very first tick (#708)', async () => {
  // Previously subscribeRunningApps started the monitor BEFORE its own
  // bootstrap getRunningApps() read updated lastPublishedRunningAppsCount, so
  // the FIRST scheduled scan used a stale (often 0) count and scheduled SLOW
  // for one tick even though an adopted game was already running at
  // subscribe time. Unlike the "keeps the poll fast" test below (which drains
  // a full SLOW interval before asserting), this checks the very first
  // scheduled tick, which is exactly where the stale-count bug lived.
  const { runningModule } = await loadRunningModule({
    profiles: { iracing: {} },
    gamePaths: { iracing: 'C:/Games/iRacingSim64DX11.exe' },
    trackablePaths: ['C:/Games/iRacingSim64DX11.exe']
  })
  vi.useFakeTimers()
  vi.setSystemTime(CLOCK_START_MS)
  readRunningProcessNamesMock.mockResolvedValue({
    processNames: new Set(['iracingsim64dx11.exe']),
    succeeded: true
  })
  runningModule.setRunningAppsWindowVisible(false)
  const webContents = createMockWebContents()
  await runningModule.subscribeRunningApps(webContents as never)

  // No draining: the first scheduled scan alone must already be FAST.
  const readsAfterSubscribe = readRunningProcessNamesMock.mock.calls.length
  await vi.advanceTimersByTimeAsync(FAST_SCAN_MS)
  expect(readRunningProcessNamesMock.mock.calls.length).toBeGreaterThan(readsAfterSubscribe)
})

test('a forward wall-clock jump does not prematurely end the post-activity fast window (#708)', async () => {
  // The post-activity FAST window is keyed off a monotonic clock
  // (performance.now()) rather than Date.now(), specifically so a wall-clock
  // correction (NTP sync, VM host suspend/resume) cannot collapse it early.
  // Force a large forward Date jump right after activity and verify the poll
  // still runs FAST across two more ticks afterward — a Date.now()-keyed
  // window would see the jump as "30s+ have passed" on the very next
  // reschedule and fall back to SLOW.
  const { runningModule } = await loadRunningModule()
  await startMonitorHidden(runningModule)

  await runningModule.publishRunningApps('launch')

  // NTP-style forward correction: hours ahead of where the activity was stamped.
  vi.setSystemTime(CLOCK_START_MS + 60 * 60 * 1000)

  // Tick 1: already scheduled FAST before the jump, fires regardless.
  let reads = readRunningProcessNamesMock.mock.calls.length
  await vi.advanceTimersByTimeAsync(FAST_SCAN_MS)
  expect(readRunningProcessNamesMock.mock.calls.length).toBeGreaterThan(reads)

  // Tick 2: this is the reschedule that would observe the jumped wall clock.
  // On the monotonic clock, only ~2 FAST intervals of real time have passed,
  // so it stays FAST.
  reads = readRunningProcessNamesMock.mock.calls.length
  await vi.advanceTimersByTimeAsync(FAST_SCAN_MS)
  expect(readRunningProcessNamesMock.mock.calls.length).toBeGreaterThan(reads)
})

test('an externally-adopted app keeps the poll fast even with empty maps (#672)', async () => {
  // A configured game started OUTSIDE SimLauncher is adopted and surfaced via
  // the scan, but never populates runningProcesses/unclosedProcesses. Keying the
  // cadence only on those maps would let an adopted external session poll at the
  // SLOW 12s cadence for its whole duration (Codex review) — the published count
  // must hold it FAST.
  const { runningModule } = await loadRunningModule({
    profiles: { iracing: {} },
    gamePaths: { iracing: 'C:/Games/iRacingSim64DX11.exe' },
    trackablePaths: ['C:/Games/iRacingSim64DX11.exe']
  })
  vi.useFakeTimers()
  vi.setSystemTime(CLOCK_START_MS)
  // The game's exe is running externally (adopted); the launcher-owned maps stay empty.
  readRunningProcessNamesMock.mockResolvedValue({
    processNames: new Set(['iracingsim64dx11.exe']),
    succeeded: true
  })
  runningModule.setRunningAppsWindowVisible(false)
  const webContents = createMockWebContents()
  await runningModule.subscribeRunningApps(webContents as never)

  // Drain the initial SLOW interval so a scan runs and publishes the adopted app
  // (published count > 0) and the cadence recomputes.
  await vi.advanceTimersByTimeAsync(SLOW_SCAN_MS)

  // Despite hidden + empty maps, the published count now holds it FAST: a scan
  // fires within a FAST interval (on the old maps-only condition it stayed SLOW).
  const reads = readRunningProcessNamesMock.mock.calls.length
  await vi.advanceTimersByTimeAsync(FAST_SCAN_MS)
  expect(readRunningProcessNamesMock.mock.calls.length).toBeGreaterThan(reads)
})
