import path from 'path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

// #204 auto-close. Every test drives `observeProcessScan` directly with a raw
// tasklist result, which is the whole point of the design: the detector never
// sees the derived RunningApp[] list, because a failed read empties that list
// without meaning anything stopped.

const readRunningProcessNamesMock = vi.fn()
const invalidateProcessNameCacheMock = vi.fn()
const killLaunchedAppsMock = vi.fn(async () => ({ success: true, closedCount: 1, failures: [] }))

const ARMED = { closeAppsOnGameExit: true }

// Game keys with a launch sequence in flight, mirroring activeLaunchControllers.
const launchingGames = new Set<string>()
// The real set lives in state.ts so registerActiveLaunch can clear it.
const seenRunning = new Map<string, number>()
const launchGenerations = new Map<string, number>()
// perf_hooks is NOT driven by vitest fake timers, so the monotonic clock is
// mocked and advanced through one helper alongside the timers. Two clocks moved
// separately would drift, and a drifting clock makes these tests lie.
let monotonicNow = 0

async function advance(ms: number): Promise<void> {
  monotonicNow += ms
  await vi.advanceTimersByTimeAsync(ms)
}

// Mirrors registerActiveLaunch: registering a launch bumps the generation and
// drops the previous session's evidence, both synchronously.
function startLaunch(gameKey: string): void {
  launchingGames.add(gameKey)
  launchGenerations.set(gameKey, (launchGenerations.get(gameKey) ?? 0) + 1)
  seenRunning.delete(gameKey)
}

function endLaunch(gameKey: string): void {
  launchingGames.delete(gameKey)
}

async function loadAutoCloseModule(opts?: {
  profiles?: Record<string, unknown>
  gamePaths?: Record<string, string>
}) {
  // utils.isValidExePath checks fs.existsSync; pretend every .exe exists so the
  // armed check does not depend on the host filesystem.
  //
  // Except exactly what a bare image name resolves to: isValidExePath resolves
  // its input first, so `name.exe` arrives here as `<cwd>/name.exe`, and a mock
  // that said yes would let the #929 tests pass an existence check a bare name
  // can never pass for real. Judged as "resolving the basename alone lands on
  // the same path", not as "anything under the CWD": on a POSIX host
  // `path.resolve('C:/Games/acs.exe')` is under the CWD too, and the wider rule
  // rejected AC_GAME_PATHS there (CodeRabbit on #931).
  vi.doMock('perf_hooks', () => ({ performance: { now: () => monotonicNow } }))

  vi.doMock('fs', () => ({
    default: {
      existsSync: (filePath: unknown) =>
        typeof filePath === 'string' &&
        /\.exe$/i.test(filePath) &&
        path.resolve(path.basename(filePath)) !== filePath
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
    getClosableLaunchedAppGameKeys: vi.fn(() => new Set<string>()),
    pruneUnclosedProcesses: vi.fn()
  }
  vi.doMock('./kill', () => killMock)
  vi.doMock('/src/main/processes/kill.ts', () => killMock)
  vi.doMock('../../src/main/processes/kill', () => killMock)
  vi.doMock('../../src/main/processes/kill.ts', () => killMock)

  // Only initAutoClose touches running.ts, and these tests call the observer
  // directly, so the registration seam is stubbed rather than exercised here.
  const runningMock = { registerProcessScanObserver: vi.fn() }
  vi.doMock('./running', () => runningMock)
  vi.doMock('/src/main/processes/running.ts', () => runningMock)
  vi.doMock('../../src/main/processes/running', () => runningMock)
  vi.doMock('../../src/main/processes/running.ts', () => runningMock)

  const stateMock = {
    // Read live rather than captured, so a test can start a launch part-way
    // through a scenario the way the real registry would.
    isLaunchActiveForGame: (gameKey: string) => launchingGames.has(gameKey),
    getLaunchGeneration: (gameKey: string) => launchGenerations.get(gameKey) ?? 0,
    gamesSeenRunning: seenRunning
  }
  vi.doMock('./state', () => stateMock)
  vi.doMock('/src/main/processes/state.ts', () => stateMock)
  vi.doMock('../../src/main/processes/state', () => stateMock)
  vi.doMock('../../src/main/processes/state.ts', () => stateMock)

  const profilesMock = {
    getStoredProfiles: vi.fn(() => opts?.profiles ?? {}),
    // Tests pass a flat profile per game key; profile-set resolution is
    // profiles.ts' concern and has its own suite.
    getActiveStoredProfile: vi.fn((entry: unknown) => entry),
    getActiveProfileForGame: vi.fn((gameKey: string) => (opts?.profiles ?? {})[gameKey] as unknown),
    // The real predicate, not a stub: these tests drive `trackingEnabled`
    // through their fixtures, so stubbing it would decide the answer here
    // instead of exercising it.
    isProcessTrackingEnabled: (profile: { trackingEnabled?: boolean } | undefined) =>
      profile?.trackingEnabled !== false
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
  launchingGames.clear()
  seenRunning.clear()
  launchGenerations.clear()
  monotonicNow = 0
  readRunningProcessNamesMock.mockReset()
  invalidateProcessNameCacheMock.mockReset()
  killLaunchedAppsMock.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
  vi.resetModules()
  vi.doUnmock('fs')
  vi.doUnmock('perf_hooks')
})

test('a profile that never opted in is not closed, however the game exits (#204)', async () => {
  const { observeProcessScan, AUTO_CLOSE_GRACE_MS, MIN_SESSION_MS } = await loadAutoCloseModule({
    profiles: { ac: {} },
    gamePaths: AC_GAME_PATHS
  })
  // Required, not decoration: without it the final read resolves undefined and
  // the close throws on destructuring, so the assertion below would hold for a
  // reason that has nothing to do with the toggle being off.
  readRunningProcessNamesMock.mockResolvedValue(GONE)

  observeProcessScan(RUNNING)
  await advance(MIN_SESSION_MS)
  observeProcessScan(GONE)
  await advance(AUTO_CLOSE_GRACE_MS * 2)

  expect(killLaunchedAppsMock).not.toHaveBeenCalled()
})

test('an armed game closes its companions once the grace window elapses (#204)', async () => {
  const { observeProcessScan, AUTO_CLOSE_GRACE_MS, MIN_SESSION_MS } = await loadAutoCloseModule({
    profiles: AC_PROFILES,
    gamePaths: AC_GAME_PATHS
  })
  readRunningProcessNamesMock.mockResolvedValue(GONE)

  observeProcessScan(RUNNING)
  await advance(MIN_SESSION_MS)
  observeProcessScan(GONE)

  // One millisecond short of the window: still nothing, the whole point being
  // that companions get time to finish their end-of-session work.
  await advance(AUTO_CLOSE_GRACE_MS - 1)
  expect(killLaunchedAppsMock).not.toHaveBeenCalled()

  await advance(1)
  expect(killLaunchedAppsMock).toHaveBeenCalledWith('ac')
  // The confirming read must not be served from the 500ms cache, or the check
  // adjacent to the kill is not actually fresh.
  expect(invalidateProcessNameCacheMock).toHaveBeenCalled()
})

// The landmine. On a failed read processNames is empty, so anything treating it
// as an observation reads one failed tasklist as every game exiting at once.
test('a failed tasklist read is not an exit (#204)', async () => {
  const { observeProcessScan, AUTO_CLOSE_GRACE_MS, MIN_SESSION_MS } = await loadAutoCloseModule({
    profiles: AC_PROFILES,
    gamePaths: AC_GAME_PATHS
  })
  readRunningProcessNamesMock.mockResolvedValue(GONE)

  observeProcessScan(RUNNING)
  await advance(MIN_SESSION_MS)
  observeProcessScan(READ_FAILED)
  await advance(AUTO_CLOSE_GRACE_MS * 2)

  expect(killLaunchedAppsMock).not.toHaveBeenCalled()
})

test('a game that is back before the window elapses is not closed (#204)', async () => {
  const { observeProcessScan, AUTO_CLOSE_GRACE_MS, MIN_SESSION_MS } = await loadAutoCloseModule({
    profiles: AC_PROFILES,
    gamePaths: AC_GAME_PATHS
  })
  readRunningProcessNamesMock.mockResolvedValue(GONE)

  observeProcessScan(RUNNING)
  await advance(MIN_SESSION_MS)
  observeProcessScan(GONE)
  await advance(AUTO_CLOSE_GRACE_MS / 2)
  observeProcessScan(RUNNING)
  await advance(MIN_SESSION_MS)
  await advance(AUTO_CLOSE_GRACE_MS * 2)

  expect(killLaunchedAppsMock).not.toHaveBeenCalled()
})

// Distinct from the test above: here no scan ever saw it come back, so only the
// final read can catch it. This is what makes the recheck load-bearing rather
// than decorative.
test('a game found running by the final recheck is not closed (#204)', async () => {
  const { observeProcessScan, AUTO_CLOSE_GRACE_MS, MIN_SESSION_MS } = await loadAutoCloseModule({
    profiles: AC_PROFILES,
    gamePaths: AC_GAME_PATHS
  })
  readRunningProcessNamesMock.mockResolvedValue(RUNNING)

  observeProcessScan(RUNNING)
  await advance(MIN_SESSION_MS)
  observeProcessScan(GONE)
  await advance(AUTO_CLOSE_GRACE_MS)

  expect(killLaunchedAppsMock).not.toHaveBeenCalled()
})

test('a failed read at the end of the window aborts the close (#204)', async () => {
  const { observeProcessScan, AUTO_CLOSE_GRACE_MS, MIN_SESSION_MS } = await loadAutoCloseModule({
    profiles: AC_PROFILES,
    gamePaths: AC_GAME_PATHS
  })
  readRunningProcessNamesMock.mockResolvedValue(READ_FAILED)

  observeProcessScan(RUNNING)
  await advance(MIN_SESSION_MS)
  observeProcessScan(GONE)
  await advance(AUTO_CLOSE_GRACE_MS)

  expect(killLaunchedAppsMock).not.toHaveBeenCalled()
})

// A skip, not an opt-out (CodeRabbit on #826). Arming consumes the evidence
// that the game was running, so unless the aborted close puts it back, one
// badly-timed tasklist failure disables auto-close for the rest of the session.
test('a close aborted by a failed read can still arm again afterwards (#204)', async () => {
  const { observeProcessScan, AUTO_CLOSE_GRACE_MS, MIN_SESSION_MS } = await loadAutoCloseModule({
    profiles: AC_PROFILES,
    gamePaths: AC_GAME_PATHS
  })
  readRunningProcessNamesMock.mockResolvedValue(READ_FAILED)

  observeProcessScan(RUNNING)
  await advance(MIN_SESSION_MS)
  observeProcessScan(GONE)
  await advance(AUTO_CLOSE_GRACE_MS)
  expect(killLaunchedAppsMock).not.toHaveBeenCalled()

  // tasklist recovers, and the game is still gone.
  readRunningProcessNamesMock.mockResolvedValue(GONE)
  observeProcessScan(GONE)
  await advance(AUTO_CLOSE_GRACE_MS)

  expect(killLaunchedAppsMock).toHaveBeenCalledWith('ac')
})

// The permission check has to be as adjacent to the kill as the presence check
// is. These two pin the far side of that I/O boundary (CodeRabbit on #826).
test('disarming while the final read is in flight aborts the close (#204)', async () => {
  const profiles: Record<string, Record<string, unknown>> = { ac: { ...ARMED } }
  const { observeProcessScan, AUTO_CLOSE_GRACE_MS, MIN_SESSION_MS } = await loadAutoCloseModule({
    profiles,
    gamePaths: AC_GAME_PATHS
  })
  readRunningProcessNamesMock.mockImplementation(async () => {
    profiles.ac.closeAppsOnGameExit = false
    return GONE
  })

  observeProcessScan(RUNNING)
  await advance(MIN_SESSION_MS)
  observeProcessScan(GONE)
  await advance(AUTO_CLOSE_GRACE_MS)

  expect(killLaunchedAppsMock).not.toHaveBeenCalled()
})

test('repointing the game path while the final read is in flight aborts the close (#204)', async () => {
  const gamePaths: Record<string, string> = { ...AC_GAME_PATHS }
  const { observeProcessScan, AUTO_CLOSE_GRACE_MS, MIN_SESSION_MS } = await loadAutoCloseModule({
    profiles: AC_PROFILES,
    gamePaths
  })
  readRunningProcessNamesMock.mockImplementation(async () => {
    // The window is long enough for a user to edit the profile in it, and the
    // absence we are about to act on was measured against the OLD exe.
    gamePaths.ac = 'C:/Games/other.exe'
    return GONE
  })

  observeProcessScan(RUNNING)
  await advance(MIN_SESSION_MS)
  observeProcessScan(GONE)
  await advance(AUTO_CLOSE_GRACE_MS)

  expect(killLaunchedAppsMock).not.toHaveBeenCalled()
})

// An in-flight launch looks exactly like an exit: with the game set to start
// after its utilities, and up to 30s of launch delay between entries, its exe
// is legitimately absent for longer than the whole grace window. Firing there
// would abort the launch in killLaunchedApps' prologue and close the companions
// it had just started (Codex on #826).
test('a launch starting inside the window cancels the pending close (#204)', async () => {
  const { observeProcessScan, AUTO_CLOSE_GRACE_MS, MIN_SESSION_MS } = await loadAutoCloseModule({
    profiles: AC_PROFILES,
    gamePaths: AC_GAME_PATHS
  })
  readRunningProcessNamesMock.mockResolvedValue(GONE)

  observeProcessScan(RUNNING)
  await advance(MIN_SESSION_MS)
  observeProcessScan(GONE)

  // The user has had enough of waiting and starts the profile again. The game
  // itself has not appeared yet, so the scan still sees nothing.
  startLaunch('ac')
  await advance(AUTO_CLOSE_GRACE_MS / 3)
  observeProcessScan(GONE)
  await advance(AUTO_CLOSE_GRACE_MS * 2)

  expect(killLaunchedAppsMock).not.toHaveBeenCalled()
})

// The case only the observer's guard can catch: the launch is over by the time
// the timer fires, so the check next to the kill sees no active launch, and the
// game never appeared so the presence check sees nothing either. Without the
// cancel, a launch that failed to start its game takes out the utilities the
// user just watched start.
test('a launch that ends without the game appearing still cancels the close (#204)', async () => {
  const { observeProcessScan, AUTO_CLOSE_GRACE_MS, MIN_SESSION_MS } = await loadAutoCloseModule({
    profiles: AC_PROFILES,
    gamePaths: AC_GAME_PATHS
  })
  readRunningProcessNamesMock.mockResolvedValue(GONE)

  observeProcessScan(RUNNING)
  await advance(MIN_SESSION_MS)
  observeProcessScan(GONE)

  startLaunch('ac')
  await advance(1000)
  observeProcessScan(GONE)
  // The sequence gives up (a broken game path, an aborted launch) long before
  // the window would have elapsed.
  endLaunch('ac')
  await advance(AUTO_CLOSE_GRACE_MS * 2)

  expect(killLaunchedAppsMock).not.toHaveBeenCalled()
})

// The gap the cancel alone could not close: the launch begins before any
// absence scan has consumed the previous session's evidence, so cancelling the
// timer leaves that evidence armed for later. A profile whose game does not
// launch (launchAutomatically off, or a failed spawn) then never overwrites it,
// and the first post-launch scan closes what the launch just started.
test('a launch supersedes the previous session rather than deferring it (#204)', async () => {
  const { observeProcessScan, AUTO_CLOSE_GRACE_MS, MIN_SESSION_MS } = await loadAutoCloseModule({
    profiles: AC_PROFILES,
    gamePaths: AC_GAME_PATHS
  })
  readRunningProcessNamesMock.mockResolvedValue(GONE)

  // Seen running, then the launch starts before any scan observes the exit.
  observeProcessScan(RUNNING)
  await advance(MIN_SESSION_MS)
  startLaunch('ac')
  observeProcessScan(GONE)

  // The sequence starts the utilities but never the game, and finishes.
  endLaunch('ac')
  observeProcessScan(GONE)
  await advance(AUTO_CLOSE_GRACE_MS * 2)

  expect(killLaunchedAppsMock).not.toHaveBeenCalled()
})

// The ordering the observer's own guard cannot cover (Codex on #826).
// `publishRunningApps('launch')` is fire-and-forget, observers only run after
// that publish's tasklist await, and a companion-only or failed sequence can
// finish and unregister before the read resolves. So NO scan lands while the
// launch is active, and the guard that depends on one never fires. Clearing at
// registration is what makes this safe.
test('a launch no scan ever observes still supersedes the session (#204)', async () => {
  const { observeProcessScan, AUTO_CLOSE_GRACE_MS } = await loadAutoCloseModule({
    profiles: AC_PROFILES,
    gamePaths: AC_GAME_PATHS
  })
  readRunningProcessNamesMock.mockResolvedValue(GONE)

  observeProcessScan(RUNNING)
  // A utilities-only profile: registers, starts its companions, unregisters,
  // all inside one tasklist read.
  startLaunch('ac')
  endLaunch('ac')

  observeProcessScan(GONE)
  await advance(AUTO_CLOSE_GRACE_MS * 2)

  expect(killLaunchedAppsMock).not.toHaveBeenCalled()
})

// The #674 collision class. Watching is by name, so one process satisfies both
// profiles: both record evidence, its exit arms two timers, and a profile the
// user never played has its companions closed. getExternallyAdoptableGameKeys
// already refuses to adopt on this same ambiguity.
test('two configured games sharing an exe name never arm (#204)', async () => {
  const { observeProcessScan, AUTO_CLOSE_GRACE_MS, MIN_SESSION_MS } = await loadAutoCloseModule({
    profiles: { ac: { ...ARMED }, ams2: { ...ARMED } },
    gamePaths: { ac: 'C:/Games/acs.exe', ams2: 'D:/OtherInstall/acs.exe' }
  })
  readRunningProcessNamesMock.mockResolvedValue(GONE)

  observeProcessScan(RUNNING)
  await advance(MIN_SESSION_MS)
  observeProcessScan(GONE)
  await advance(AUTO_CLOSE_GRACE_MS * 2)

  expect(killLaunchedAppsMock).not.toHaveBeenCalled()
})

// The mirror image of the arming-side hole, on the firing side (CodeRabbit on
// #826). "Is a launch active" is sampled at one instant, so a companion-only
// sequence that registers AND unregisters inside the confirming read is
// invisible to it: absent before, absent after, yet it started the very
// companions this close is about to kill. Only a counter survives that.
test('a launch that begins and ends inside the confirming read aborts the close (#204)', async () => {
  const { observeProcessScan, AUTO_CLOSE_GRACE_MS, MIN_SESSION_MS } = await loadAutoCloseModule({
    profiles: AC_PROFILES,
    gamePaths: AC_GAME_PATHS
  })
  readRunningProcessNamesMock.mockImplementation(async () => {
    startLaunch('ac')
    endLaunch('ac')
    return GONE
  })

  observeProcessScan(RUNNING)
  await advance(MIN_SESSION_MS)
  observeProcessScan(GONE)
  await advance(AUTO_CLOSE_GRACE_MS)

  expect(killLaunchedAppsMock).not.toHaveBeenCalled()
})

test('a failed read does not resurrect evidence a launch has superseded (#204)', async () => {
  const { observeProcessScan, AUTO_CLOSE_GRACE_MS, MIN_SESSION_MS } = await loadAutoCloseModule({
    profiles: AC_PROFILES,
    gamePaths: AC_GAME_PATHS
  })
  readRunningProcessNamesMock.mockImplementation(async () => {
    startLaunch('ac')
    endLaunch('ac')
    return READ_FAILED
  })

  observeProcessScan(RUNNING)
  await advance(MIN_SESSION_MS)
  observeProcessScan(GONE)
  await advance(AUTO_CLOSE_GRACE_MS)
  expect(killLaunchedAppsMock).not.toHaveBeenCalled()

  // The failed-read path puts the seen-marker back so a transient failure is a
  // skip rather than an opt-out, but the launch cleared it on purpose. Putting
  // it back regardless would hand the previous session's evidence to this scan.
  readRunningProcessNamesMock.mockResolvedValue(GONE)
  observeProcessScan(GONE)
  await advance(AUTO_CLOSE_GRACE_MS * 2)

  expect(killLaunchedAppsMock).not.toHaveBeenCalled()
})

// The residual half of the ownership check (Codex on #826): comparing each
// watched set against the other profiles' PRIMARY exes left secondary-to-
// secondary collisions open, and a secondary is matched by name exactly like a
// primary.
test('two profiles sharing a secondary exe name never arm (#204)', async () => {
  const { observeProcessScan, AUTO_CLOSE_GRACE_MS, MIN_SESSION_MS } = await loadAutoCloseModule({
    profiles: {
      ac: { ...ARMED, trackedProcessPaths: ['C:/Shared/session.exe'] },
      ams2: { ...ARMED, trackedProcessPaths: ['D:/Other/session.exe'] }
    },
    // Distinct primaries, so the earlier primary-only check passes both.
    gamePaths: { ac: 'C:/Games/acs.exe', ams2: 'D:/Games/AMS2.exe' }
  })
  readRunningProcessNamesMock.mockResolvedValue(GONE)

  observeProcessScan({ processNames: new Set(['session.exe']), succeeded: true })
  await advance(MIN_SESSION_MS)
  observeProcessScan(GONE)
  await advance(AUTO_CLOSE_GRACE_MS * 2)

  expect(killLaunchedAppsMock).not.toHaveBeenCalled()
})

test('a launch starting during the final read aborts the close (#204)', async () => {
  const { observeProcessScan, AUTO_CLOSE_GRACE_MS, MIN_SESSION_MS } = await loadAutoCloseModule({
    profiles: AC_PROFILES,
    gamePaths: AC_GAME_PATHS
  })
  // No scan gets a chance to notice: the launch begins while the confirming
  // read is in flight, which is why that check sits last.
  readRunningProcessNamesMock.mockImplementation(async () => {
    startLaunch('ac')
    return GONE
  })

  observeProcessScan(RUNNING)
  await advance(MIN_SESSION_MS)
  observeProcessScan(GONE)
  await advance(AUTO_CLOSE_GRACE_MS)

  expect(killLaunchedAppsMock).not.toHaveBeenCalled()
})

// Two profiles for the same game necessarily share the game exe, so the
// watched-name comparison cannot see a switch between them. Without the profile
// id the timer would close the incoming profile's companions on the strength of
// the outgoing profile's exit (Codex on #826).
test('switching the active profile inside the window aborts the close (#204)', async () => {
  const profiles: Record<string, Record<string, unknown>> = {
    ac: { ...ARMED, id: 'practice' }
  }
  const { observeProcessScan, AUTO_CLOSE_GRACE_MS, MIN_SESSION_MS } = await loadAutoCloseModule({
    profiles,
    gamePaths: AC_GAME_PATHS
  })
  readRunningProcessNamesMock.mockResolvedValue(GONE)

  observeProcessScan(RUNNING)
  await advance(MIN_SESSION_MS)
  observeProcessScan(GONE)

  // Same game, same exe, different profile now active.
  profiles.ac.id = 'race'
  await advance(AUTO_CLOSE_GRACE_MS)

  expect(killLaunchedAppsMock).not.toHaveBeenCalled()
})

// The launcher-stub repair path, and the reason the refusal below is
// conditional (Codex on #826). Refusing forever would mean Steam/EA-launched
// games can never use this feature, while the warning we show tells the user
// exactly how to give us a signal that is not lying.
const STUB_SECONDARY = 'C:/Games/acs_real.exe'
const STUB_PROFILES = { ac: { ...ARMED, trackedProcessPaths: [STUB_SECONDARY] } }
const REAL_RUNNING = { processNames: new Set(['acs_real.exe']), succeeded: true }

test('a stub-launched game arms once a secondary executable is configured (#204)', async () => {
  const { observeProcessScan, AUTO_CLOSE_GRACE_MS, MIN_SESSION_MS } = await loadAutoCloseModule({
    profiles: STUB_PROFILES,
    gamePaths: AC_GAME_PATHS
  })
  readRunningProcessNamesMock.mockResolvedValue(GONE)

  // The stub exe is long gone; the real game is what is running.
  observeProcessScan(REAL_RUNNING)
  await advance(MIN_SESSION_MS)
  observeProcessScan(GONE)
  await advance(AUTO_CLOSE_GRACE_MS)

  expect(killLaunchedAppsMock).toHaveBeenCalledWith('ac')
})

test('a secondary executable still running keeps the session open (#204)', async () => {
  const { observeProcessScan, AUTO_CLOSE_GRACE_MS, MIN_SESSION_MS } = await loadAutoCloseModule({
    profiles: STUB_PROFILES,
    gamePaths: AC_GAME_PATHS
  })
  readRunningProcessNamesMock.mockResolvedValue(GONE)

  // The stub exits, which is normal for a stub, while the game plays on.
  observeProcessScan({ processNames: new Set(['acs.exe', 'acs_real.exe']), succeeded: true })
  await advance(MIN_SESSION_MS)
  observeProcessScan(REAL_RUNNING)
  await advance(AUTO_CLOSE_GRACE_MS * 2)

  expect(killLaunchedAppsMock).not.toHaveBeenCalled()
})

// #929: the same repair path, with what the warning literally asks for: the
// image name off Task Manager, no directory. That is never a file on disk, so
// it has to be kept on shape rather than existence, or the instruction the app
// gives is one it then ignores.
const STUB_NAME_PROFILES = { ac: { ...ARMED, trackedProcessPaths: ['acs_real.exe'] } }

test('a stub-launched game arms on a bare secondary exe name (#929)', async () => {
  const { observeProcessScan, AUTO_CLOSE_GRACE_MS, MIN_SESSION_MS } = await loadAutoCloseModule({
    profiles: STUB_NAME_PROFILES,
    gamePaths: AC_GAME_PATHS
  })
  readRunningProcessNamesMock.mockResolvedValue(GONE)

  observeProcessScan(REAL_RUNNING)
  await advance(MIN_SESSION_MS)
  observeProcessScan(GONE)
  await advance(AUTO_CLOSE_GRACE_MS)

  expect(killLaunchedAppsMock).toHaveBeenCalledWith('ac')
})

test('a bare secondary exe name still running keeps the session open (#929)', async () => {
  const { observeProcessScan, AUTO_CLOSE_GRACE_MS, MIN_SESSION_MS } = await loadAutoCloseModule({
    profiles: STUB_NAME_PROFILES,
    gamePaths: AC_GAME_PATHS
  })
  readRunningProcessNamesMock.mockResolvedValue(GONE)

  observeProcessScan({ processNames: new Set(['acs.exe', 'acs_real.exe']), succeeded: true })
  await advance(MIN_SESSION_MS)
  observeProcessScan(REAL_RUNNING)
  await advance(AUTO_CLOSE_GRACE_MS * 2)

  expect(killLaunchedAppsMock).not.toHaveBeenCalled()
})

test('a secondary found running by the final recheck aborts the close (#204)', async () => {
  const { observeProcessScan, AUTO_CLOSE_GRACE_MS, MIN_SESSION_MS } = await loadAutoCloseModule({
    profiles: STUB_PROFILES,
    gamePaths: AC_GAME_PATHS
  })
  readRunningProcessNamesMock.mockResolvedValue(REAL_RUNNING)

  observeProcessScan(REAL_RUNNING)
  await advance(MIN_SESSION_MS)
  observeProcessScan(GONE)
  await advance(AUTO_CLOSE_GRACE_MS)

  expect(killLaunchedAppsMock).not.toHaveBeenCalled()
})

// The launcher-stub rule, and the reason it replaced the mismatch-warning
// refusal rather than joining it (Codex on #826). A stub shows up under the
// configured game name, hands off to a differently-named child and exits within
// seconds. That disappearance is the session STARTING.
test('a game that only flickers is not treated as a session (#204)', async () => {
  const { observeProcessScan, AUTO_CLOSE_GRACE_MS, MIN_SESSION_MS } = await loadAutoCloseModule({
    profiles: AC_PROFILES,
    gamePaths: AC_GAME_PATHS
  })
  readRunningProcessNamesMock.mockResolvedValue(GONE)

  observeProcessScan(RUNNING)
  // One millisecond short of counting as a session.
  await advance(MIN_SESSION_MS - 1)
  observeProcessScan(GONE)
  await advance(AUTO_CLOSE_GRACE_MS * 2)

  expect(killLaunchedAppsMock).not.toHaveBeenCalled()
})

// The case the old refusal could never cover. `processNameMismatchWarnings` is
// written in one place, spawn.ts' child exit handler, so a game started from
// Steam never had one and its stub read as a whole session. Nothing in this
// test tells auto-close who started the game, which is the point.
test('a stub started outside SimLauncher is not treated as a session (#204)', async () => {
  const { observeProcessScan, AUTO_CLOSE_GRACE_MS } = await loadAutoCloseModule({
    profiles: AC_PROFILES,
    gamePaths: AC_GAME_PATHS
  })
  readRunningProcessNamesMock.mockResolvedValue(GONE)

  // Caught by two scans, four seconds apart, then gone while the real game runs
  // on under a name we are not watching.
  observeProcessScan(RUNNING)
  await advance(2000)
  observeProcessScan(RUNNING)
  await advance(2000)
  observeProcessScan(GONE)
  await advance(AUTO_CLOSE_GRACE_MS * 2)

  expect(killLaunchedAppsMock).not.toHaveBeenCalled()
})

// The streak is what is measured, not the gap since the last scan: a game seen
// in scan after scan has been up the whole time.
test('a long session measured across many scans still closes (#204)', async () => {
  const { observeProcessScan, AUTO_CLOSE_GRACE_MS, MIN_SESSION_MS } = await loadAutoCloseModule({
    profiles: AC_PROFILES,
    gamePaths: AC_GAME_PATHS
  })
  readRunningProcessNamesMock.mockResolvedValue(GONE)

  for (let elapsed = 0; elapsed <= MIN_SESSION_MS; elapsed += 2000) {
    observeProcessScan(RUNNING)
    await advance(2000)
  }
  observeProcessScan(GONE)
  await advance(AUTO_CLOSE_GRACE_MS)

  expect(killLaunchedAppsMock).toHaveBeenCalledWith('ac')
})

test('a profile with tracking turned off never arms (#204)', async () => {
  const { observeProcessScan, AUTO_CLOSE_GRACE_MS, MIN_SESSION_MS } = await loadAutoCloseModule({
    profiles: { ac: { ...ARMED, trackingEnabled: false } },
    gamePaths: AC_GAME_PATHS
  })
  readRunningProcessNamesMock.mockResolvedValue(GONE)

  observeProcessScan(RUNNING)
  await advance(MIN_SESSION_MS)
  observeProcessScan(GONE)
  await advance(AUTO_CLOSE_GRACE_MS * 2)

  expect(killLaunchedAppsMock).not.toHaveBeenCalled()
})

test('turning the toggle off inside the window cancels the pending close (#204)', async () => {
  const profiles: Record<string, Record<string, unknown>> = { ac: { ...ARMED } }
  const { observeProcessScan, AUTO_CLOSE_GRACE_MS, MIN_SESSION_MS } = await loadAutoCloseModule({
    profiles,
    gamePaths: AC_GAME_PATHS
  })
  readRunningProcessNamesMock.mockResolvedValue(GONE)

  observeProcessScan(RUNNING)
  await advance(MIN_SESSION_MS)
  observeProcessScan(GONE)
  await advance(AUTO_CLOSE_GRACE_MS / 2)

  // The user disarms it while the window is open. The next scan must take the
  // timer down rather than let a close the user just turned off go ahead.
  profiles.ac.closeAppsOnGameExit = false
  observeProcessScan(GONE)
  await advance(AUTO_CLOSE_GRACE_MS * 2)

  expect(killLaunchedAppsMock).not.toHaveBeenCalled()
})

// A game that was never seen running cannot have exited. Without this the first
// scan of a session (or the first after the observer is re-registered) looks
// exactly like an exit.
// The same re-check, driven by the OTHER switch. The test above pins it for
// `closeAppsOnGameExit`; this one pins it for `trackingEnabled`, which reaches
// the same guard by a different field and is the switch #591 is about. Without
// it, `pendingAutoCloses` would be the one registry in this subsystem that
// survives the tracking toggle and then KILLS apps, rather than merely
// surfacing them.
test('turning tracking off inside the window cancels the pending close (#591)', async () => {
  const profiles: Record<string, Record<string, unknown>> = { ac: { ...ARMED } }
  const { observeProcessScan, AUTO_CLOSE_GRACE_MS, MIN_SESSION_MS } = await loadAutoCloseModule({
    profiles,
    gamePaths: AC_GAME_PATHS
  })
  readRunningProcessNamesMock.mockResolvedValue(GONE)

  // Armed while tracked, so the timer really is pending before the toggle.
  observeProcessScan(RUNNING)
  await advance(MIN_SESSION_MS)
  observeProcessScan(GONE)
  await advance(AUTO_CLOSE_GRACE_MS / 2)

  profiles.ac.trackingEnabled = false
  observeProcessScan(GONE)
  await advance(AUTO_CLOSE_GRACE_MS * 2)

  expect(killLaunchedAppsMock).not.toHaveBeenCalled()
})

test('a game absent from the very first scan is not treated as an exit (#204)', async () => {
  const { observeProcessScan, AUTO_CLOSE_GRACE_MS } = await loadAutoCloseModule({
    profiles: AC_PROFILES,
    gamePaths: AC_GAME_PATHS
  })
  readRunningProcessNamesMock.mockResolvedValue(GONE)

  observeProcessScan(GONE)
  await advance(AUTO_CLOSE_GRACE_MS * 2)

  expect(killLaunchedAppsMock).not.toHaveBeenCalled()
})

test('the window is armed once, not restarted by every scan that still finds it gone (#204)', async () => {
  const { observeProcessScan, AUTO_CLOSE_GRACE_MS, MIN_SESSION_MS } = await loadAutoCloseModule({
    profiles: AC_PROFILES,
    gamePaths: AC_GAME_PATHS
  })
  readRunningProcessNamesMock.mockResolvedValue(GONE)

  observeProcessScan(RUNNING)
  await advance(MIN_SESSION_MS)
  observeProcessScan(GONE)
  // Scans keep arriving every 2s while the window is open. If each one re-armed
  // the timer the close would be pushed out forever and never fire.
  for (let elapsed = 0; elapsed < AUTO_CLOSE_GRACE_MS; elapsed += 2000) {
    await advance(2000)
    observeProcessScan(GONE)
  }

  expect(killLaunchedAppsMock).toHaveBeenCalledTimes(1)
})
