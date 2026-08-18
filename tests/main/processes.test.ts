import type { WebContents } from 'electron'
import { beforeEach, expect, test, vi } from 'vitest'
import path from 'path'

type StoreData = Record<string, unknown>
type MockWebContents = {
  isDestroyed: () => boolean
  send: ReturnType<typeof vi.fn>
  once: ReturnType<typeof vi.fn>
}

const storeData: StoreData = {}
const existingPaths = new Set<string>()
const processNames = new Set<string>()
const processExistsNames = new Set<string>()
const accessDeniedPids = new Set<string>()
const accessDeniedImageNames = new Set<string>()
const inaccessibleExecutablePathProcesses = new Set<string>()
const nullExecutablePathPids = new Set<string>()
// #659: PIDs whose process actually honours a graceful (non-`/F`) close
// request. Everything else ignores it and is still there for the force kill,
// which is the realistic default (console apps, apps with no message loop).
const gracefulClosePids = new Set<string>()
const staleTaskkillPids = new Set<string>()
// "Process exited cleanly BEFORE the kill ran" — when a name is in this set,
// the path-scoped WMI lookup removes it from `processNames` so the post-kill
// tasklist recheck reports the image as absent. Models the genuine pre-kill
// exit case for elevated/inaccessible processes (#352, #378, #350).
const processNamesGoneAfterWmiLookup = new Set<string>()
// "WMI PIDs are gone AFTER the kill, but the image MAY still be in tasklist"
// — when a name is in this set, the SECOND+ path-scoped WMI lookup for that
// name returns 0 PIDs while leaving `processNames` intact. Used to isolate
// the `staleTask !== true` predicate at kill.ts:362 (#345): the third
// predicate `processNamesAfterKill.has(processName)` must stay true so the
// staleTask branch is the only thing keeping isElevatedInconclusive false.
const processNamesGoneAfterKill = new Set<string>()
// Executable paths whose WMI/PowerShell lookup fails outright. Distinct from
// "found nothing": the lookup errored, so it learned nothing either way.
const wmiLookupErrorPaths = new Set<string>()
// Executable paths that report no PIDs on the FIRST (pre-kill) lookup but do on
// the post-kill recheck: the process started or respawned in between.
const pathsAppearingAfterKill = new Set<string>()
// Per-PATH lookup counter. wmiLookupCounts is keyed by process name, which two
// same-named paths share, so it cannot express "first lookup for this path".
const wmiPathLookupCounts = new Map<string, number>()
// Paths whose lookup succeeds pre-kill and then FAILS on the post-kill recheck.
const wmiPostKillLookupErrorPaths = new Set<string>()
// Image names that stay in the tasklist even after a SUCCESSFUL /IM kill: the
// kill took down the instances it could, and a protected one survived.
const imageNamesSurvivingImageKill = new Set<string>()
// "taskkill /PID reports access-denied, but the image is gone from tasklist
// afterwards" — used to model #390 where the launched exe's actual running
// process has a different name, so the wrapper's PID kill fails but the app
// effectively exits anyway (and the verification must treat that as success).
const pidsAccessDeniedButImageGone = new Set<string>()
// Mutable flag that flips the mocked readRunningProcessNames into the "tasklist
// command failed" branch (succeeded: false, empty Set). Used to verify that
// kill verification doesn't treat an empty Set as evidence-of-exit when the
// read itself was invalid (see #399).
let tasklistReadShouldFail = false
// Flips the mocked store read into a throwing mode — see storeModuleMock.
let storeReadShouldThrow = false
// When set, the NEXT readRunningProcessNames call resolves only after this
// promise does — models a slow tasklist scan so a test can prove ordering
// against it (#670). Consumed once, then cleared.
let tasklistReadBlocker: Promise<void> | null = null
// When set, the NEXT WMI path lookup resolves only after `promise` does. Models
// a slow Get-CimInstance so a test can land an event inside the graceful
// phase's await window (#659, #823). Consumed once, then cleared.
let wmiLookupBlocker: Promise<void> | null = null
// When set, the `atCall`-th isConsoleExecutable call (1-based) resolves only
// after `promise` does — models a slow PE-subsystem probe so the abort-point
// sweep can land a kill inside spawnDetachedApp's pre-spawn window for a
// specific app in the sequence (#670). Consumed once, then cleared.
let consoleProbeBlocker: { atCall: number; promise: Promise<void> } | null = null
let consoleProbeCallCount = 0
// Arms a transient tasklist failure on the POST-kill recheck only, without
// breaking the pre-kill scan that decides which processes to attempt to kill.
//
// This used to be positional ("succeed for the first N reads, then fail"),
// which silently mis-targeted itself: the kill path and its neighbours have
// five readRunningProcessNames call sites, production dedupes via cache and
// in-flight sharing while this mock counts every raw call, so one extra read
// landing before the pre-kill scan shifted the numbering by one and made the
// PRE-kill scan fail instead. killLaunchedApps then took its "nothing to
// close" early return and the test failed on an unrelated assertion (#751).
//
// Keying off the taskkill that the test is actually about makes the injection
// hit the post-kill recheck by construction, whatever the call ordering is.
//
// Deliberately STICKY rather than one-shot, and this matters: a one-shot flag
// is consumed by whichever read arrives first, so a stray read landing between
// the taskkill and finalizeKillAttempts' verification read would let the
// verification succeed. The test would then pass whether or not production
// still gates on `tasklistReadSucceeded`, i.e. it would silently stop covering
// #399 — the same "unawaited work reorders the reads" class this change exists
// to be immune to. Staying armed models the honest scenario anyway: tasklist is
// broken from the kill onward, however many reads that turns out to be.
const failTasklistAfterAccessDeniedPids = new Set<string>()
let tasklistReadFailArmed = false
const wmiLookupCounts = new Map<string, number>()
const execFileCalls: { command: string; args: string[]; options: Record<string, unknown> }[] = []
const spawnCalls: { appPath: string; args: string[]; options: Record<string, unknown> }[] = []
const spawnErrors = new Map<string, NodeJS.ErrnoException>()
// Makes `spawn()` THROW synchronously rather than emit an 'error' event.
// `spawnDetachedApp` handles the two separately: the event lands in
// `child.once('error')`, the throw in the surrounding try/catch, and each has
// its own `isElevatedLaunchError` branch calling `launchElevated`. Only the
// event path had a fixture, so the whole catch branch was uncovered - dropping
// an argument from its call left all 166 tests green (#591).
const spawnThrows = new Map<string, NodeJS.ErrnoException>()
// #675: when true, the elevated (-EncodedCommand) PowerShell call never invokes
// its callback, modelling a UAC consent prompt the user never answers.
let elevatedLaunchHangs = false
// #675: the held callback of a hung elevated launch, so a test can fire it LATE
// (after the grace timer already resolved) and assert the late settle is inert.
let heldElevatedCallback: ((error: NodeJS.ErrnoException | null) => void) | null = null
// Every held callback of the current test, in creation order. `heldElevatedCallback`
// is only the latest, which is not enough when one sequence has TWO live handoffs
// for the same exe (two slots can share a path, #357).
const heldElevatedCallbacks: ((error: NodeJS.ErrnoException | null) => void)[] = []
// #779: every elevated PowerShell host SimLauncher killed, in order. Proves a
// Close Apps actually reached a handoff whose grace window had already expired.
const elevatedHostKills: string[] = []
const invalidateProcessNameCacheMock = vi.fn()
// Paths the mocked PE-subsystem sniffer reports as console-subsystem exes —
// those must spawn WITHOUT detached so they get a console (#486).
const consoleExePaths = new Set<string>()
// Spies on the fs calls errorLog.ts's writeAppErrorLog makes (#638). statSync
// always reports "no existing file" — rotation itself is covered by
// errorLog.test.ts, so these tests only need to see the append call land.
const appErrorLogFsMock = {
  statSync: vi.fn(() => {
    throw Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' })
  }),
  renameSync: vi.fn(),
  appendFileSync: vi.fn()
}

type ProcessRegistryEntry = {
  pid: string
  processName: string
  executablePath: string
}

// Path-keyed registry that mirrors what WMI/Get-CimInstance would return for a
// given SIMLAUNCHER_TARGET_PROCESS_PATH. The key is the normalized absolute
// path so the mock can answer queries the same way production code does.
const processRegistry = new Map<string, ProcessRegistryEntry>()

function normalizeRegistryKey(filePath: string) {
  return path.resolve(filePath).toLowerCase()
}

function registerProcess(executablePath: string, processName: string, pid: string) {
  processRegistry.set(normalizeRegistryKey(executablePath), {
    pid,
    processName: processName.toLowerCase(),
    executablePath
  })
}

function findRegistryEntryByPid(pid: string): ProcessRegistryEntry | undefined {
  for (const entry of processRegistry.values()) {
    if (entry.pid === pid) {
      return entry
    }
  }
  return undefined
}

function markExistingPath(filePath: string) {
  existingPaths.add(filePath)
  existingPaths.add(path.resolve(filePath))
}

function makeAccessDeniedError() {
  const error = new Error('Access is denied.') as NodeJS.ErrnoException

  error.code = 'EACCES'
  return error
}

async function loadProcessModules() {
  vi.resetModules()

  vi.doMock('electron-store', () => ({
    default: class MockStore {
      store = storeData

      get(key: string) {
        return storeData[key]
      }

      set(key: string, value: unknown) {
        storeData[key] = value
      }

      clear() {
        Object.keys(storeData).forEach((key) => delete storeData[key])
      }
    }
  }))

  vi.doMock('fs', () => ({
    default: {
      existsSync: (filePath: string) => existingPaths.has(filePath),
      statSync: appErrorLogFsMock.statSync,
      renameSync: appErrorLogFsMock.renameSync,
      appendFileSync: appErrorLogFsMock.appendFileSync
    }
  }))

  vi.doMock('child_process', () => ({
    execFile: vi.fn((command, args, options, callback) => {
      execFileCalls.push({ command, args, options })
      if (command === 'tasklist') {
        callback(
          null,
          Array.from(processNames)
            .map((processName) => `"${processName}","1234","Console","1","1,024 K"`)
            .join('\n'),
          ''
        )
        return
      }
      if (command === 'powershell.exe') {
        if (!args.includes('-Command')) {
          // #675: model an unanswered UAC prompt — the elevated launch host
          // stays pending (callback never fires), so launchElevated must fall
          // back to its bounded grace timer to keep the chain moving.
          if (elevatedLaunchHangs && args.includes('-EncodedCommand')) {
            let settled = false
            const held = (error) => {
              if (settled) {
                return
              }
              settled = true
              callback(error, '', '')
            }
            heldElevatedCallback = held
            heldElevatedCallbacks.push(held)
            // Unlike the other branches this call has NOT invoked its callback,
            // so launchElevated's abort handler can still reach the child. Model
            // the real shape: killing the PowerShell host makes execFile's
            // callback fire with an error.
            //
            // Fire it ASYNCHRONOUSLY. kill() only signals the host; the callback
            // lands on process exit, which is never synchronous in production.
            // This mock used to call held() inline, which made the launch loop
            // observe the cancellation the instant it resumed and hid a real
            // ordering bug (#779 Codex P2) behind a passing test.
            return {
              kill: () => {
                elevatedHostKills.push(
                  args[args.indexOf('-EncodedCommand') + 1] ? 'elevated-host' : 'unknown'
                )
                setTimeout(() => held(makeAccessDeniedError()), 0)
              }
            }
          }
          callback(null, '', '')
          return
        }

        const script = args[args.indexOf('-Command') + 1]
        // findProcessIdsByExecutablePath now passes the name via env var (#531);
        // fall back to the legacy in-script form for any other powershell call.
        const processName = (
          (options.env?.SIMLAUNCHER_TARGET_PROCESS_NAME as string | undefined) ??
          script.match(/\$name = '([^']+)'/)?.[1]
        )?.toLowerCase()

        const targetPathEnv = options.env?.SIMLAUNCHER_TARGET_PROCESS_PATH
        if (typeof targetPathEnv !== 'string' || targetPathEnv.length === 0) {
          const exists = processName ? processExistsNames.has(processName) : false
          callback(null, exists ? JSON.stringify(1234) : '', '')
          return
        }

        // Replicate the WMI lookup: only return PIDs for the registered entry
        // whose executable path matches SIMLAUNCHER_TARGET_PROCESS_PATH AND
        // whose process name matches the queried $name. This is what makes
        // findProcessIdsByExecutablePath path-scoped in production.
        if (
          wmiPostKillLookupErrorPaths.has(normalizeRegistryKey(targetPathEnv)) &&
          (wmiPathLookupCounts.get(normalizeRegistryKey(targetPathEnv)) ?? 0) >= 1
        ) {
          wmiPathLookupCounts.set(
            normalizeRegistryKey(targetPathEnv),
            (wmiPathLookupCounts.get(normalizeRegistryKey(targetPathEnv)) ?? 0) + 1
          )
          callback(
            new Error('The RPC server is unavailable.'),
            '',
            'The RPC server is unavailable.'
          )
          return
        }

        if (wmiLookupErrorPaths.has(normalizeRegistryKey(targetPathEnv))) {
          callback(
            new Error('The RPC server is unavailable.'),
            '',
            'The RPC server is unavailable.'
          )
          return
        }

        const entry = processRegistry.get(normalizeRegistryKey(targetPathEnv))
        const lookupCount = processName ? (wmiLookupCounts.get(processName) ?? 0) + 1 : 0
        if (processName) {
          wmiLookupCounts.set(processName, lookupCount)
        }
        // `processNamesGoneAfterKill` suppresses PIDs on the POST-kill lookup
        // (second invocation onward) only, leaving `processNames` intact so
        // the post-kill tasklist recheck still reports the image as present.
        const suppressPidsForPostKill =
          !!processName && lookupCount > 1 && processNamesGoneAfterKill.has(processName)
        const targetPathKey = normalizeRegistryKey(targetPathEnv)
        const pathLookupCount = (wmiPathLookupCounts.get(targetPathKey) ?? 0) + 1
        wmiPathLookupCounts.set(targetPathKey, pathLookupCount)
        const suppressPidsForPreKill =
          pathLookupCount <= 1 && pathsAppearingAfterKill.has(targetPathKey)
        const pids: string[] = []
        if (
          entry &&
          (!processName || entry.processName === processName) &&
          processNames.has(entry.processName) &&
          !inaccessibleExecutablePathProcesses.has(entry.processName) &&
          !suppressPidsForPostKill &&
          !suppressPidsForPreKill
        ) {
          pids.push(entry.pid)
        }
        // Drop processNames entries that opted into "image is gone" after a
        // WMI lookup. This lets tests model the case where the WMI lookup
        // returned 0 PIDs because the elevated process genuinely exited
        // BEFORE the kill ran, so the subsequent tasklist recheck must
        // report the image as absent.
        if (processName && processNamesGoneAfterWmiLookup.has(processName)) {
          processNames.delete(processName)
        }
        const emitLookup = () =>
          callback(null, pids.length ? JSON.stringify(pids.map(Number)) : '', '')
        // One-shot, same shape as tasklistReadBlocker: only the lookup it was
        // armed for is delayed, so every other call keeps its exact timing.
        if (wmiLookupBlocker) {
          const blocker = wmiLookupBlocker
          wmiLookupBlocker = null
          void blocker.then(emitLookup)
          return
        }
        emitLookup()
        return
      }
      // A `/PID` taskkill WITHOUT `/F` is the graceful request (#659): it posts
      // WM_CLOSE rather than terminating, so it only removes a process that
      // chose to honour it. Modelling this separately is what makes "the app
      // ignored us and had to be force-killed" expressible at all.
      if (command === 'taskkill' && args.includes('/PID') && !args.includes('/F')) {
        const pid = args[args.indexOf('/PID') + 1]
        if (gracefulClosePids.has(pid)) {
          const entry = findRegistryEntryByPid(pid)
          if (entry) {
            processNames.delete(entry.processName)
          }
          nullExecutablePathPids.delete(pid)
        }
        callback(null, '', '')
        return
      }
      if (command === 'taskkill' && args.includes('/PID')) {
        const pid = args[args.indexOf('/PID') + 1]
        if (staleTaskkillPids.has(pid)) {
          callback(
            new Error('There is no running instance of the task.'),
            '',
            `ERROR: The process with PID ${pid} (child process of PID 50324) could not be terminated.\nReason: There is no running instance of the task.`
          )
          return
        }
        if (accessDeniedPids.has(pid)) {
          // Arm the tasklist failure from the kill itself, so it lands on the
          // post-kill recheck no matter how many reads preceded this (#751).
          if (failTasklistAfterAccessDeniedPids.has(pid)) {
            tasklistReadFailArmed = true
          }
          if (pidsAccessDeniedButImageGone.has(pid)) {
            const entry = findRegistryEntryByPid(pid)
            if (entry) {
              processNames.delete(entry.processName)
            }
          }
          callback(new Error('Access is denied.'), '', 'Access is denied.')
          return
        }
        const entry = findRegistryEntryByPid(pid)
        if (entry) {
          processNames.delete(entry.processName)
        }
        nullExecutablePathPids.delete(pid)
      }
      if (command === 'taskkill' && args.includes('/IM')) {
        const imageName = args[args.indexOf('/IM') + 1].toLowerCase()
        if (accessDeniedImageNames.has(imageName)) {
          callback(new Error('Access is denied.'), '', 'Access is denied.')
          return
        }
        if (!imageNamesSurvivingImageKill.has(imageName)) {
          processNames.delete(imageName)
        }
      }
      callback(null, '', '')
    }),
    spawn: vi.fn((appPath: string, args: string[] = [], options: Record<string, unknown> = {}) => {
      spawnCalls.push({ appPath, args, options })
      if (spawnThrows.has(appPath)) {
        throw spawnThrows.get(appPath)!
      }
      const handlers = new Map<string, (...args: unknown[]) => void>()
      const child = {
        pid: 1234,
        // A live ChildProcess reports null on both until it exits. Present so a
        // test can model "the app exited during the grace window" (#659), and
        // so the exit check reads real values rather than undefined.
        exitCode: null as number | null,
        signalCode: null as string | null,
        once: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
          handlers.set(event, handler)
          if (event === 'error' && spawnErrors.has(appPath)) {
            queueMicrotask(() => handler(spawnErrors.get(appPath)!))
          }
          if (event === 'spawn' && !spawnErrors.has(appPath)) {
            queueMicrotask(handler)
          }
          return child
        }),
        unref: vi.fn(),
        kill: vi.fn()
      }

      processNames.add(appPath.split(/[\\/]/).pop()!.toLowerCase())
      return child
    })
  }))

  const subsystemMock = {
    isConsoleExecutable: vi.fn((exePath: string) => {
      consoleProbeCallCount += 1
      const result = consoleExePaths.has(exePath)
      // One-shot blocker, same shape as tasklistReadBlocker above: only the
      // call it was armed for is delayed; every other call keeps its exact
      // microtask timing (other tests depend on it).
      if (consoleProbeBlocker && consoleProbeCallCount === consoleProbeBlocker.atCall) {
        const blocker = consoleProbeBlocker.promise
        consoleProbeBlocker = null
        return blocker.then(() => result)
      }
      return Promise.resolve(result)
    })
  }
  vi.doMock('./subsystem', () => subsystemMock)
  vi.doMock('/src/main/processes/subsystem.ts', () => subsystemMock)
  vi.doMock('../../src/main/processes/subsystem', () => subsystemMock)
  vi.doMock('../../src/main/processes/subsystem.ts', () => subsystemMock)
  vi.doMock('../../src/main/processes/subsystem.js', () => subsystemMock)

  const tasklistMock = {
    invalidateProcessNameCache: invalidateProcessNameCacheMock,
    readRunningProcessNames: vi.fn(() => {
      // Sticky once armed (see the declaration): not consumed here, so a stray
      // read cannot steal the failure from the verification read.
      const shouldFailNow = tasklistReadShouldFail || tasklistReadFailArmed
      // Production's readRunningProcessNames swallows tasklist execution
      // errors and resolves with an empty Set + succeeded: false. Modelling
      // the empty-Set here is what lets the regression test distinguish
      // "image is gone" from "we don't know" (see #399).
      const result = shouldFailNow
        ? { processNames: new Set<string>(), succeeded: false }
        : { processNames: new Set(processNames), succeeded: true }
      // A one-shot blocker models a slow tasklist scan (#670). Consumed here
      // so only the call it was armed for is delayed; the unarmed path keeps
      // its exact microtask timing (other tests depend on it).
      if (tasklistReadBlocker) {
        const blocker = tasklistReadBlocker
        tasklistReadBlocker = null
        return blocker.then(() => result)
      }
      return Promise.resolve(result)
    })
  }
  vi.doMock('./tasklist', () => tasklistMock)
  vi.doMock('/src/main/processes/tasklist.ts', () => tasklistMock)
  vi.doMock('../../src/main/processes/tasklist', () => tasklistMock)
  vi.doMock('../../src/main/processes/tasklist.ts', () => tasklistMock)
  vi.doMock('../../src/main/processes/tasklist.js', () => tasklistMock)

  const storeModuleMock = {
    getStoredStringRecord: (key: string) => {
      // Models a corrupted/unreadable store so a test can prove a throw during
      // launch prep releases the launch guard instead of wedging it (#670).
      if (storeReadShouldThrow) {
        throw new Error('store corrupted')
      }
      const value = storeData[key]

      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {}
      }

      return Object.fromEntries(
        Object.entries(value).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string'
        )
      )
    },
    // #659: the graceful-close toggle is read straight from the store by
    // killLaunchedApps. Mirrors the real signature (opt-in, so anything that is
    // not an explicit true is false) rather than hardcoding false, so a test can
    // switch it on by writing `storeData.gracefulCloseEnabled = true`.
    getStoredBoolean: (key: string, fallback = false) => {
      const value = storeData[key]
      return typeof value === 'boolean' ? value : fallback
    },
    store: {
      store: storeData,
      get: (key: string) => storeData[key],
      set: (key: string, value: unknown) => {
        storeData[key] = value
      },
      clear: () => {
        Object.keys(storeData).forEach((key) => delete storeData[key])
      }
    }
  }
  vi.doMock('../store', () => storeModuleMock)
  vi.doMock('/src/main/store.ts', () => storeModuleMock)
  vi.doMock('../../src/main/store', () => storeModuleMock)
  vi.doMock('../../src/main/store.ts', () => storeModuleMock)
  vi.doMock('../../src/main/store.js', () => storeModuleMock)

  const profilesMock = {
    getActiveStoredProfile: vi.fn((p: { activeProfileId: string; profiles: { id: string }[] }) =>
      p.profiles.find((i) => i.id === p.activeProfileId)
    ),
    // Resolves through the same storeData the rest of this harness writes, so a
    // test can turn tracking off for one game by editing its profile fixture
    // (#591). Flat profiles and profile sets both appear in this file.
    getActiveProfileForGame: vi.fn((gameKey: string) => {
      const profiles = storeData.profiles
      if (!profiles || typeof profiles !== 'object' || Array.isArray(profiles)) return undefined
      const entry = (profiles as Record<string, unknown>)[gameKey]
      if (!entry || typeof entry !== 'object') return undefined
      const set = entry as { activeProfileId?: string; profiles?: { id: string }[] }
      return Array.isArray(set.profiles)
        ? set.profiles.find((profile) => profile.id === set.activeProfileId) || set.profiles[0]
        : entry
    }),
    // The real predicate, not a stub: these tests decide tracking through their
    // profile fixtures, so stubbing it would answer the question for them.
    isProcessTrackingEnabled: (profile: { trackingEnabled?: boolean } | undefined) =>
      profile?.trackingEnabled !== false,
    // Resolves a NAMED profile, which is what a profile switch launches: the
    // store still calls the outgoing one active at that moment.
    resolveNamedProfile: vi.fn((entry: unknown, profileId: string) => {
      const set = entry as { profiles?: { id: string }[] } | undefined
      return Array.isArray(set?.profiles)
        ? set.profiles.find((profile) => profile.id === profileId) || set.profiles[0]
        : entry
    }),
    getStoredProfiles: vi.fn(() => {
      const value = storeData.profiles

      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {}
      }

      return value as Record<string, unknown>
    }),
    isUtilityEnabled: vi.fn((profile: Record<string, unknown> | undefined, utilityKey: string) =>
      Array.isArray(profile?.utilities)
        ? profile.utilities.some(
            (utility) =>
              !!utility &&
              typeof utility === 'object' &&
              'id' in utility &&
              'enabled' in utility &&
              utility.id === utilityKey &&
              utility.enabled === true
          )
        : profile?.[utilityKey] === true
    ),
    getProfileTrackablePaths: vi.fn(
      (
        gameKey: string,
        profile: { trackedProcessPaths?: string[] } | undefined,
        appPaths: Record<string, string> | undefined,
        gamePaths: Record<string, string> | undefined
      ) => [
        ...(gamePaths?.[gameKey] ? [gamePaths[gameKey]] : []),
        ...Object.values(appPaths || {}),
        ...(profile?.trackedProcessPaths || [])
      ]
    )
  }
  vi.doMock('../profiles', () => profilesMock)
  vi.doMock('/src/main/profiles.ts', () => profilesMock)
  vi.doMock('../../src/main/profiles', () => profilesMock)
  vi.doMock('../../src/main/profiles.ts', () => profilesMock)
  vi.doMock('../../src/main/profiles.js', () => profilesMock)

  const spawnModule = await import('../../src/main/processes/spawn')
  const killModule = await import('../../src/main/processes/kill')
  const stateModule = await import('../../src/main/processes/state')

  return {
    launchProfileApps: spawnModule.launchProfileApps,
    spawnDetachedApp: spawnModule.spawnDetachedApp,
    killLaunchedApps: killModule.killLaunchedApps,
    hasClosableLaunchedApps: killModule.hasClosableLaunchedApps,
    killProfileApps: killModule.killProfileApps,
    finalizeKillAttempts: killModule.finalizeKillAttempts,
    pruneUnclosedProcesses: killModule.pruneUnclosedProcesses,
    dismissAppIcon: stateModule.dismissAppIcon,
    registerActiveLaunch: stateModule.registerActiveLaunch,
    unregisterActiveLaunch: stateModule.unregisterActiveLaunch,
    abortActiveLaunches: stateModule.abortActiveLaunches,
    processNameMismatchWarnings: stateModule.processNameMismatchWarnings,
    suppressedProcessNameMismatchWarnings: stateModule.suppressedProcessNameMismatchWarnings,
    runningProcesses: stateModule.runningProcesses,
    unclosedProcesses: stateModule.unclosedProcesses,
    getRunningApps: (await import('../../src/main/processes/running')).getRunningApps,
    subscribeRunningApps: (await import('../../src/main/processes/running')).subscribeRunningApps,
    publishRunningApps: (await import('../../src/main/processes/running')).publishRunningApps
  }
}

function loadProcessModulesWithStore(data: StoreData) {
  Object.assign(storeData, data)
  return loadProcessModules()
}

function createMockWebContents(): MockWebContents {
  return {
    isDestroyed: () => false,
    send: vi.fn(),
    once: vi.fn()
  }
}

function asWebContents(webContents: MockWebContents) {
  return webContents as unknown as WebContents
}

// Flushes the microtask queue via a macrotask boundary (setImmediate always
// runs after every microtask already queued). Used to let launchProfileApps'
// loop advance past a spawned app and reach its (real, unmocked) inter-app
// `wait()` call — at which point its setTimeout/abort-listener is already
// registered — without needing fake timers (#670).
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

const sender = {
  isDestroyed: () => false,
  send: vi.fn()
} as unknown as WebContents & { send: ReturnType<typeof vi.fn> }

beforeEach(async () => {
  const {
    processNameMismatchWarnings,
    runningProcesses,
    suppressedProcessNameMismatchWarnings,
    unclosedProcesses
  } = await loadProcessModules()

  existingPaths.clear()
  processNames.clear()
  processExistsNames.clear()
  accessDeniedPids.clear()
  accessDeniedImageNames.clear()
  inaccessibleExecutablePathProcesses.clear()
  nullExecutablePathPids.clear()
  gracefulClosePids.clear()
  staleTaskkillPids.clear()
  processNamesGoneAfterWmiLookup.clear()
  processNamesGoneAfterKill.clear()
  wmiLookupErrorPaths.clear()
  pathsAppearingAfterKill.clear()
  wmiPathLookupCounts.clear()
  wmiPostKillLookupErrorPaths.clear()
  imageNamesSurvivingImageKill.clear()
  pidsAccessDeniedButImageGone.clear()
  tasklistReadShouldFail = false
  storeReadShouldThrow = false
  tasklistReadBlocker = null
  wmiLookupBlocker = null
  consoleProbeBlocker = null
  consoleProbeCallCount = 0
  failTasklistAfterAccessDeniedPids.clear()
  tasklistReadFailArmed = false
  wmiLookupCounts.clear()
  processRegistry.clear()
  execFileCalls.length = 0
  spawnCalls.length = 0
  spawnErrors.clear()
  spawnThrows.clear()
  elevatedLaunchHangs = false
  heldElevatedCallback = null
  heldElevatedCallbacks.length = 0
  elevatedHostKills.length = 0
  consoleExePaths.clear()
  appErrorLogFsMock.statSync.mockClear()
  appErrorLogFsMock.renameSync.mockClear()
  appErrorLogFsMock.appendFileSync.mockClear()
  appErrorLogFsMock.appendFileSync.mockImplementation(() => undefined)
  sender.send.mockClear()
  invalidateProcessNameCacheMock.mockClear()
  processNameMismatchWarnings.clear()
  runningProcesses.clear()
  suppressedProcessNameMismatchWarnings.clear()
  unclosedProcesses.clear()
  Object.keys(storeData).forEach((key) => delete storeData[key])
  storeData.launchDelayMs = 0
})

test('getRunningApps surfaces a warning when a launched wrapper exits before its configured process is found', async () => {
  const childHandlers = new Map<string, (...args: unknown[]) => void>()
  const child = {
    pid: 1234,
    once: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      childHandlers.set(event, handler)
      return child
    }),
    unref: vi.fn(),
    kill: vi.fn()
  }

  markExistingPath('C:/Program Files/Cheat Engine/Cheat Engine.exe')
  const { launchProfileApps, getRunningApps } = await loadProcessModules()
  vi.mocked(await import('child_process')).spawn.mockReturnValueOnce(child as never)

  const launchPromise = launchProfileApps(sender, 'ac', [
    'C:/Program Files/Cheat Engine/Cheat Engine.exe'
  ])
  childHandlers.get('spawn')?.()
  await launchPromise

  processNames.delete('cheat engine.exe')
  processNames.add('cheatengine-x86_64-sse4-avx2.exe')
  childHandlers.get('exit')?.()

  await expect(getRunningApps()).resolves.toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        path: 'C:/Program Files/Cheat Engine/Cheat Engine.exe',
        name: 'Cheat Engine.exe',
        gameKey: 'ac',
        warning: expect.stringContaining('SimLauncher can no longer detect when you close it')
      })
    ])
  )
})

test('getRunningApps adopts tracked child processes while a wrapper warning is active', async () => {
  const childHandlers = new Map<string, (...args: unknown[]) => void>()
  const child = {
    pid: 1234,
    once: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      childHandlers.set(event, handler)
      return child
    }),
    unref: vi.fn(),
    kill: vi.fn()
  }

  markExistingPath('C:/Program Files/Cheat Engine/Cheat Engine.exe')
  const { launchProfileApps, getRunningApps } = await loadProcessModulesWithStore({
    profiles: {
      ac: {
        activeProfileId: 'default',
        profiles: [
          {
            id: 'default',
            name: 'Default',
            trackedProcessPaths: ['C:/Program Files/Cheat Engine/cheatengine-x86_64-sse4-avx2.exe']
          }
        ]
      }
    },
    gamePaths: { ac: 'C:/Games/AssettoCorsa.exe' },
    appPaths: { customapp1: 'C:/Program Files/Cheat Engine/Cheat Engine.exe' }
  })
  vi.mocked(await import('child_process')).spawn.mockReturnValueOnce(child as never)

  const launchPromise = launchProfileApps(sender, 'ac', [
    'C:/Program Files/Cheat Engine/Cheat Engine.exe'
  ])
  childHandlers.get('spawn')?.()
  await launchPromise

  processNames.delete('cheat engine.exe')
  processNames.add('cheatengine-x86_64-sse4-avx2.exe')
  childHandlers.get('exit')?.()

  await expect(getRunningApps()).resolves.toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        path: 'C:/Program Files/Cheat Engine/cheatengine-x86_64-sse4-avx2.exe',
        name: 'cheatengine-x86_64-sse4-avx2.exe',
        gameKey: 'ac',
        tracked: true
      })
    ])
  )
})

test('getRunningApps keeps wrapper warnings until the configured process is resolved', async () => {
  const dateNow = vi.spyOn(Date, 'now')
  const childHandlers = new Map<string, (...args: unknown[]) => void>()
  const child = {
    pid: 1234,
    once: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      childHandlers.set(event, handler)
      return child
    }),
    unref: vi.fn(),
    kill: vi.fn()
  }

  dateNow.mockReturnValue(1000)
  markExistingPath('C:/Program Files/Cheat Engine/Cheat Engine.exe')
  const { launchProfileApps, getRunningApps } = await loadProcessModules()
  vi.mocked(await import('child_process')).spawn.mockReturnValueOnce(child as never)

  const launchPromise = launchProfileApps(sender, 'ac', [
    'C:/Program Files/Cheat Engine/Cheat Engine.exe'
  ])
  childHandlers.get('spawn')?.()
  await launchPromise

  processNames.delete('cheat engine.exe')
  processNames.add('cheatengine-x86_64-sse4-avx2.exe')
  childHandlers.get('exit')?.()

  expect(sender.send).toHaveBeenCalledWith(
    'process-name-mismatch-warning',
    expect.objectContaining({
      app: 'C:/Program Files/Cheat Engine/Cheat Engine.exe',
      warning: expect.stringContaining('SimLauncher can no longer detect when you close it')
    })
  )
  dateNow.mockReturnValue(30000)
  await expect(getRunningApps()).resolves.toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        path: 'C:/Program Files/Cheat Engine/Cheat Engine.exe',
        warning: expect.stringContaining('SimLauncher can no longer detect when you close it')
      })
    ])
  )

  processNames.add('cheat engine.exe')
  await expect(getRunningApps()).resolves.not.toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        path: 'C:/Program Files/Cheat Engine/Cheat Engine.exe',
        warning: expect.any(String)
      })
    ])
  )
  expect(
    sender.send.mock.calls.filter(([channel]) => channel === 'process-name-mismatch-warning')
  ).toHaveLength(1)
  dateNow.mockRestore()
})

test('process mismatch warnings persist until manually dismissed (#360)', async () => {
  const dateNow = vi.spyOn(Date, 'now')
  const childHandlers = new Map<string, (...args: unknown[]) => void>()
  const child = {
    pid: 1234,
    once: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      childHandlers.set(event, handler)
      return child
    }),
    unref: vi.fn(),
    kill: vi.fn()
  }

  dateNow.mockReturnValue(1000)
  markExistingPath('C:/Program Files/Cheat Engine/Cheat Engine.exe')
  const { dismissAppIcon, launchProfileApps, getRunningApps, processNameMismatchWarnings } =
    await loadProcessModules()
  vi.mocked(await import('child_process')).spawn.mockReturnValueOnce(child as never)

  const launchPromise = launchProfileApps(sender, 'ac', [
    'C:/Program Files/Cheat Engine/Cheat Engine.exe'
  ])
  childHandlers.get('spawn')?.()
  await launchPromise

  processNames.delete('cheat engine.exe')
  childHandlers.get('exit')?.()

  expect(processNameMismatchWarnings.size).toBe(1)
  const entry = processNameMismatchWarnings.values().next().value!
  expect(entry.expiresAt).toBeUndefined()

  dateNow.mockReturnValue(61000)
  processNames.add('cheatengine-x86_64-sse4-avx2.exe')
  await expect(getRunningApps()).resolves.toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        path: 'C:/Program Files/Cheat Engine/Cheat Engine.exe',
        warning: expect.any(String)
      })
    ])
  )
  expect(processNameMismatchWarnings.size).toBe(1)

  dismissAppIcon('C:/Program Files/Cheat Engine/Cheat Engine.exe', 'ac')
  processNames.delete('cheat engine.exe')
  await expect(getRunningApps()).resolves.not.toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        path: 'C:/Program Files/Cheat Engine/Cheat Engine.exe',
        warning: expect.any(String)
      })
    ])
  )
  expect(processNameMismatchWarnings.size).toBe(0)

  dateNow.mockRestore()
})

// Regression for PR B of #362: the wrapper-mismatch warning is written using
// the launched (mixed-case, forward-slash) path, and dismissAppIcon is later
// called with a differently-cased / different-separator string from the
// renderer. Both sites must canonicalise via normalizePathForComparison so the
// delete finds the entry — pre-migration this silently failed because writes
// used `appPath.toLowerCase()` while reads built a key the same way only when
// the casing happened to line up.
test('dismissAppIcon clears a wrapper warning regardless of casing or separators (#362)', async () => {
  const childHandlers = new Map<string, (...args: unknown[]) => void>()
  const child = {
    pid: 1234,
    once: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      childHandlers.set(event, handler)
      return child
    }),
    unref: vi.fn(),
    kill: vi.fn()
  }

  // Launched path uses forward slashes + mixed case.
  markExistingPath('C:/Program Files/Cheat Engine/Cheat Engine.exe')
  const { dismissAppIcon, launchProfileApps, processNameMismatchWarnings } =
    await loadProcessModules()
  vi.mocked(await import('child_process')).spawn.mockReturnValueOnce(child as never)

  const launchPromise = launchProfileApps(sender, 'ac', [
    'C:/Program Files/Cheat Engine/Cheat Engine.exe'
  ])
  childHandlers.get('spawn')?.()
  await launchPromise

  processNames.delete('cheat engine.exe')
  childHandlers.get('exit')?.()
  expect(processNameMismatchWarnings.size).toBe(1)

  // Dismiss with backslash separators and a different casing — the renderer
  // can hand us any form of the same path.
  dismissAppIcon('c:\\Program Files\\CHEAT ENGINE\\Cheat Engine.exe', 'ac')
  expect(processNameMismatchWarnings.size).toBe(0)
})

test('wrapper exit warning tells the user tracking is lost and how to fix it (#402)', async () => {
  const childHandlers = new Map<string, (...args: unknown[]) => void>()
  const child = {
    pid: 1234,
    once: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      childHandlers.set(event, handler)
      return child
    }),
    unref: vi.fn(),
    kill: vi.fn()
  }

  markExistingPath('C:/Tools/Perplexity.exe')
  const { launchProfileApps, processNameMismatchWarnings } = await loadProcessModules()
  vi.mocked(await import('child_process')).spawn.mockReturnValueOnce(child as never)

  const launchPromise = launchProfileApps(sender, 'ac', ['C:/Tools/Perplexity.exe'])
  childHandlers.get('spawn')?.()
  await launchPromise

  // Simulate the wrapper exiting immediately after spawning a differently-named
  // child process. The launched image disappears from tasklist while another
  // PID continues running under a different name.
  processNames.delete('perplexity.exe')
  processNames.add('perplexity-helper.exe')
  childHandlers.get('exit')?.()

  const mismatchCall = sender.send.mock.calls.find(
    ([channel]) => channel === 'process-name-mismatch-warning'
  )
  expect(mismatchCall).toBeDefined()
  const payload = mismatchCall?.[1] as { app: string; warning: string }
  expect(payload.app).toBe('C:/Tools/Perplexity.exe')
  // Wording must (a) name the exited wrapper, (b) state SimLauncher loses
  // tracking, (c) point the user at Task Manager + the profile editor control to fix.
  expect(payload.warning).toContain('Perplexity.exe')
  expect(payload.warning).toMatch(/no longer detect when you close it/i)
  expect(payload.warning).toMatch(/task manager/i)
  expect(payload.warning).toMatch(/Secondary executables to watch/i)

  // Persistent strip warning carries the same actionable copy so the user
  // doesn't only see it during the 5s toast window.
  const stripWarning = processNameMismatchWarnings.values().next().value
  expect(stripWarning?.warning).toBe(payload.warning)
})

test('killLaunchedApps does not create a wrapper warning for user-initiated closes', async () => {
  const childHandlers = new Map<string, (...args: unknown[]) => void>()
  const child = {
    pid: 1234,
    once: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      childHandlers.set(event, handler)
      return child
    }),
    unref: vi.fn(),
    kill: vi.fn()
  }

  markExistingPath('C:/Tools/Perplexity.exe')
  processNames.add('perplexity.exe')
  const { getRunningApps, killLaunchedApps, launchProfileApps } = await loadProcessModulesWithStore(
    {
      profiles: {
        ac: { activeProfileId: 'default', profiles: [{ id: 'default', name: 'Default' }] }
      },
      appPaths: { customapp1: 'C:/Tools/Perplexity.exe' }
    }
  )
  vi.mocked(await import('child_process')).spawn.mockReturnValueOnce(child as never)

  const launchPromise = launchProfileApps(sender, 'ac', ['C:/Tools/Perplexity.exe'])
  childHandlers.get('spawn')?.()
  await launchPromise

  const killPromise = killLaunchedApps('ac')
  processNames.delete('perplexity.exe')
  childHandlers.get('exit')?.()

  await expect(killPromise).resolves.toMatchObject({ success: true, failedCount: 0 })
  expect(sender.send).not.toHaveBeenCalledWith(
    'process-name-mismatch-warning',
    expect.objectContaining({ app: 'C:/Tools/Perplexity.exe' })
  )
  await expect(getRunningApps()).resolves.not.toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        path: 'C:/Tools/Perplexity.exe',
        warning: expect.any(String)
      })
    ])
  )
})

test('getRunningApps does not notify when a game executable exits within the post-launch window (#330)', async () => {
  const childHandlers = new Map<string, (...args: unknown[]) => void>()
  const child = {
    pid: 1234,
    once: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      childHandlers.set(event, handler)
      return child
    }),
    unref: vi.fn(),
    kill: vi.fn()
  }

  markExistingPath('C:/Games/BeamNG.drive.exe')
  const { launchProfileApps, processNameMismatchWarnings } = await loadProcessModulesWithStore({
    gamePaths: { beamng: 'c:/games/beamng.drive.exe' }
  })
  vi.mocked(await import('child_process')).spawn.mockReturnValueOnce(child as never)

  const launchPromise = launchProfileApps(sender, 'beamng', ['C:/Games/BeamNG.drive.exe'])
  childHandlers.get('spawn')?.()
  await launchPromise

  processNames.delete('beamng.drive.exe')
  childHandlers.get('exit')?.()

  // Silent mismatch entry IS created (preserves launchedGameKeys for tracked adoption)
  expect(processNameMismatchWarnings.size).toBe(1)
  const entry = processNameMismatchWarnings.values().next().value!
  // Game entries persist indefinitely — no TTL, cleaned up when tracked child exits
  expect(entry.expiresAt).toBeUndefined()
  // But no user-facing notification is sent for game executables
  expect(sender.send).not.toHaveBeenCalledWith(
    'process-name-mismatch-warning',
    expect.objectContaining({ app: 'C:/Games/BeamNG.drive.exe' })
  )
})

test('getRunningApps does not warn when a launched process exits after the post-launch window', async () => {
  const dateNow = vi.spyOn(Date, 'now')
  const childHandlers = new Map<string, (...args: unknown[]) => void>()
  const child = {
    pid: 1234,
    once: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      childHandlers.set(event, handler)
      return child
    }),
    unref: vi.fn(),
    kill: vi.fn()
  }

  dateNow.mockReturnValue(1000)
  markExistingPath('C:/Program Files/CrewChief/CrewChief.exe')
  const { launchProfileApps, getRunningApps } = await loadProcessModules()
  vi.mocked(await import('child_process')).spawn.mockReturnValueOnce(child as never)

  const launchPromise = launchProfileApps(sender, 'ac', [
    'C:/Program Files/CrewChief/CrewChief.exe'
  ])
  childHandlers.get('spawn')?.()
  await launchPromise

  dateNow.mockReturnValue(11001)
  processNames.delete('crewchief.exe')
  childHandlers.get('exit')?.()

  await expect(getRunningApps()).resolves.not.toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        path: 'C:/Program Files/CrewChief/CrewChief.exe',
        warning: expect.any(String)
      })
    ])
  )
  dateNow.mockRestore()
})

test('launchProfileApps rejects empty launches when every configured executable is invalid or missing', async () => {
  const { launchProfileApps } = await loadProcessModules()

  await expect(
    launchProfileApps(sender, 'ac', ['C:/Tools/not-an-exe.txt', 'C:/Tools/Missing.exe'])
  ).resolves.toMatchObject({
    success: false,
    error: 'No valid executable paths configured.',
    skipped: [
      { key: 'C:/Tools/not-an-exe.txt', path: 'C:/Tools/not-an-exe.txt', reason: 'invalid' },
      { key: 'C:/Tools/Missing.exe', path: 'C:/Tools/Missing.exe', reason: 'missing' }
    ]
  })
})

// #639: a moved/deleted game exe used to be filtered out silently, and the
// launch still reported plain success as long as one other app started. The
// caller must be able to tell "some apps launched, one was skipped" apart
// from a full success via the new `skipped` field.
test('launchProfileApps reports skipped entries when some profile apps launch and others have a missing or invalid path (#639)', async () => {
  markExistingPath('C:/Tools/SimHub.exe')
  const { launchProfileApps } = await loadProcessModules()

  await expect(
    launchProfileApps(sender, 'ac', [
      'C:/Tools/SimHub.exe',
      'C:/Games/AC/acs.exe',
      'C:/Tools/not-an-exe.txt'
    ])
  ).resolves.toMatchObject({
    success: true,
    launchedCount: 1,
    skipped: [
      { key: 'C:/Games/AC/acs.exe', path: 'C:/Games/AC/acs.exe', reason: 'missing' },
      { key: 'C:/Tools/not-an-exe.txt', path: 'C:/Tools/not-an-exe.txt', reason: 'invalid' }
    ]
  })
})

// The on-disk log line must match the attributed reason: a well-formed .exe
// that no longer exists is "missing", not "invalid" (#639).
test('a well-formed but missing exe is logged as missing, not invalid', async () => {
  markExistingPath('C:/Tools/SimHub.exe')
  const { launchProfileApps } = await loadProcessModules()

  await launchProfileApps(sender, 'ac', ['C:/Tools/SimHub.exe', 'C:/Games/AC/acs.exe'])

  const loggedLines = appErrorLogFsMock.appendFileSync.mock.calls.map((call) => String(call[1]))
  expect(
    loggedLines.some((line) => line.includes('Skipping missing executable: C:/Games/AC/acs.exe'))
  ).toBe(true)
  expect(loggedLines.some((line) => line.includes('Skipping invalid path'))).toBe(false)
})

test('launchProfileApps skips profile apps that are already running', async () => {
  const { launchProfileApps } = await loadProcessModules()

  markExistingPath('C:/Tools/SimHub.exe')
  processNames.add('simhub.exe')

  await expect(launchProfileApps(sender, 'ac', ['C:/Tools/SimHub.exe'])).resolves.toMatchObject({
    success: true,
    launchedCount: 0,
    skippedCount: 1,
    message: 'All profile applications are already running.'
  })
})

// #739: the renderer concatenates the skip warning onto `message`, so a summary
// claiming "All" while `skipped` is non-empty produces a toast that contradicts
// itself in consecutive sentences. Note the two senses of "skipped" in the
// payload: `skippedCount` is "already running", `skipped` is "missing/invalid".
test('nothing left to spawn does not claim ALL apps are running when one was skipped as missing', async () => {
  const { launchProfileApps } = await loadProcessModules()

  // SimHub exists and is already up; the game exe does not resolve at all.
  markExistingPath('C:/Tools/SimHub.exe')
  processNames.add('simhub.exe')

  const result = await launchProfileApps(sender, 'ac', [
    'C:/Tools/SimHub.exe',
    'C:/Games/AC/acs.exe'
  ])

  expect(result).toMatchObject({
    success: true,
    message: 'The remaining profile applications are already running.',
    launchedCount: 0,
    skippedCount: 1
  })
  // Assert the harness really reached this branch rather than bailing out at
  // the empty-validApps guard above it, which would also produce a plausible
  // message with no spawn.
  expect(result.skipped).toHaveLength(1)
  expect(result.skipped?.[0]).toMatchObject({ path: 'C:/Games/AC/acs.exe', reason: 'missing' })
  expect(spawnCalls).toHaveLength(0)
})

test('a launch that skipped a missing app does not report ALL applications launched', async () => {
  const { launchProfileApps } = await loadProcessModules()

  // SimHub exists and is NOT running, so it launches; the game exe is missing.
  markExistingPath('C:/Tools/SimHub.exe')

  const result = await launchProfileApps(sender, 'ac', [
    'C:/Tools/SimHub.exe',
    'C:/Games/AC/acs.exe'
  ])

  expect(result).toMatchObject({
    success: true,
    message: 'Started 1 app.',
    launchedCount: 1,
    skippedCount: 0
  })
  expect(result.skipped).toHaveLength(1)
  // Without this the test passes even if nothing spawned at all.
  expect(spawnCalls).toHaveLength(1)
  expect(spawnCalls[0]).toMatchObject({ appPath: 'C:/Tools/SimHub.exe' })
})

test('an already-running app is still counted when another app was skipped as missing', async () => {
  const { launchProfileApps } = await loadProcessModules()

  // One running, one launchable, one missing: `skippedCount` and `skipped` are
  // BOTH non-empty. Pins the arm order — testing `skipped.length` before
  // `skippedCount` drops the already-running count from the summary.
  markExistingPath('C:/Tools/SimHub.exe')
  markExistingPath('C:/Tools/CrewChief.exe')
  processNames.add('simhub.exe')

  const result = await launchProfileApps(sender, 'ac', [
    'C:/Tools/SimHub.exe',
    'C:/Tools/CrewChief.exe',
    'C:/Games/AC/acs.exe'
  ])

  expect(result).toMatchObject({
    success: true,
    message: 'Started 1 app; skipped 1 already running.',
    launchedCount: 1,
    skippedCount: 1
  })
  expect(result.skipped).toHaveLength(1)
  expect(spawnCalls).toHaveLength(1)
  expect(spawnCalls[0]).toMatchObject({ appPath: 'C:/Tools/CrewChief.exe' })
})

// Both review bots on PR #795 found the same hole in the ternary this replaced:
// with launchedCount at 0 it either emitted "Started 0 apps" or fell through to
// "All profile applications launched." while entries had been skipped as
// missing, which is the #739 contradiction the PR set out to remove.
const loadSummaryBuilder = async () =>
  (await import('../../src/main/processes/spawn')).buildLaunchSummaryMessage

test('summary: nothing started and something missing does not claim everything launched', async () => {
  expect((await loadSummaryBuilder())(0, 0, 1)).toBe('No apps were started.')
})

test('summary: nothing started never emits a zero count', async () => {
  const build = await loadSummaryBuilder()
  expect(build(0, 2, 0)).toBe('No apps were started; 2 were already running.')
  expect(build(0, 1, 1)).toBe('No apps were started; 1 was already running.')
})

test('summary: an already-running count survives a missing entry in the same launch', async () => {
  expect((await loadSummaryBuilder())(1, 1, 1)).toBe('Started 1 app; skipped 1 already running.')
})

test('summary: a missing entry alone drops the ALL claim but keeps the count', async () => {
  expect((await loadSummaryBuilder())(2, 0, 1)).toBe('Started 2 apps.')
})

test('summary: a clean launch is unchanged', async () => {
  expect((await loadSummaryBuilder())(3, 0, 0)).toBe('All profile applications launched.')
})

test('launchProfileApps parses custom app arguments with quoted paths and escaped quotes', async () => {
  markExistingPath('C:/Tools/Custom Tool.exe')
  const { launchProfileApps } = await loadProcessModulesWithStore({
    appPaths: { customapp1: 'C:/Tools/Custom Tool.exe' },
    appArgs: {
      customapp1: String.raw`--config "C:/Users/Driver/Sim Configs/main profile.json" --label "Crew \"Chief\""`
    }
  })

  await expect(
    launchProfileApps(sender, 'ac', ['C:/Tools/Custom Tool.exe'])
  ).resolves.toMatchObject({
    success: true,
    launchedCount: 1
  })

  expect(spawnCalls[0]).toMatchObject({
    appPath: 'C:/Tools/Custom Tool.exe',
    args: ['--config', 'C:/Users/Driver/Sim Configs/main profile.json', '--label', 'Crew "Chief"']
  })
  expect(invalidateProcessNameCacheMock).toHaveBeenCalled()
})

test('launchProfileApps treats PowerShell-sensitive custom argument characters as literal spawn args', async () => {
  markExistingPath('C:/Tools/Custom Tool.exe')
  const { launchProfileApps } = await loadProcessModulesWithStore({
    appPaths: { customapp1: 'C:/Tools/Custom Tool.exe' },
    appArgs: {
      customapp1:
        '--name "literal & value" --pattern "$(Get-Process); | %{rm} `whoami`" --flag "^caret"'
    }
  })

  await expect(
    launchProfileApps(sender, 'ac', ['C:/Tools/Custom Tool.exe'])
  ).resolves.toMatchObject({
    success: true,
    launchedCount: 1
  })

  expect(spawnCalls[0]).toMatchObject({
    appPath: 'C:/Tools/Custom Tool.exe',
    args: [
      '--name',
      'literal & value',
      '--pattern',
      '$(Get-Process); | %{rm} `whoami`',
      '--flag',
      '^caret'
    ]
  })
})

test('launchProfileApps uses encoded PowerShell command for elevated launches with literal custom args', async () => {
  markExistingPath('C:/Tools/Admin Tool.exe')
  spawnErrors.set('C:/Tools/Admin Tool.exe', makeAccessDeniedError())
  const { launchProfileApps } = await loadProcessModulesWithStore({
    appPaths: { customapp1: 'C:/Tools/Admin Tool.exe' },
    appArgs: {
      customapp1: `--path "C:/Users/Driver/Sim Configs" --literal "$(Start-Process calc); 'single' & value"`
    }
  })

  await expect(launchProfileApps(sender, 'ac', ['C:/Tools/Admin Tool.exe'])).resolves.toMatchObject(
    {
      success: true,
      launchedCount: 1,
      elevatedCount: 1
    }
  )

  const elevatedCall = execFileCalls.find((call) => call.command === 'powershell.exe')
  expect(elevatedCall).toMatchObject({
    args: ['-NoProfile', '-NonInteractive', '-EncodedCommand', expect.any(String)],
    options: { windowsHide: true }
  })
  expect(elevatedCall?.args.join(' ')).not.toContain('Start-Process -FilePath')

  const decodedCommand = Buffer.from(elevatedCall!.args[3], 'base64').toString('utf16le')
  expect(decodedCommand).toContain("$payload = ConvertFrom-Json @'")
  expect(decodedCommand).toContain(
    'Start-Process -FilePath $payload.filePath -ArgumentList $payload.args -WorkingDirectory $payload.workingDirectory -Verb RunAs'
  )
  expect(JSON.parse(decodedCommand.split("@'\n")[1].split("\n'@")[0])).toEqual({
    filePath: 'C:/Tools/Admin Tool.exe',
    args: [
      '--path',
      'C:/Users/Driver/Sim Configs',
      '--literal',
      "$(Start-Process calc); 'single' & value"
    ],
    workingDirectory: 'C:/Tools'
  })
})

test('launchProfileApps omits PowerShell ArgumentList for elevated launches without custom args', async () => {
  const { launchProfileApps } = await loadProcessModules()

  markExistingPath('C:/Tools/Admin Tool.exe')
  spawnErrors.set('C:/Tools/Admin Tool.exe', makeAccessDeniedError())

  await expect(launchProfileApps(sender, 'ac', ['C:/Tools/Admin Tool.exe'])).resolves.toMatchObject(
    {
      success: true,
      launchedCount: 1,
      elevatedCount: 1
    }
  )

  const elevatedCall = execFileCalls.find((call) => call.command === 'powershell.exe')
  expect(elevatedCall).toMatchObject({
    args: ['-NoProfile', '-NonInteractive', '-EncodedCommand', expect.any(String)],
    options: { windowsHide: true }
  })

  const decodedCommand = Buffer.from(elevatedCall!.args[3], 'base64').toString('utf16le')
  expect(decodedCommand).toContain(
    'Start-Process -FilePath $payload.filePath -WorkingDirectory $payload.workingDirectory -Verb RunAs'
  )
  expect(decodedCommand).not.toContain('-ArgumentList')
  expect(JSON.parse(decodedCommand.split("@'\n")[1].split("\n'@")[0])).toEqual({
    filePath: 'C:/Tools/Admin Tool.exe',
    args: [],
    workingDirectory: 'C:/Tools'
  })
})

test('launchProfileApps resolves args per utility key when two slots share the same exe (#357)', async () => {
  // Two custom-app slots configured with the same .exe but different args:
  // each slot must launch with the args assigned to its own key, not whichever
  // key the path-based reverse lookup happened to find first.
  markExistingPath('C:/Tools/Shared Utility.exe')
  const { launchProfileApps } = await loadProcessModulesWithStore({
    appPaths: {
      customapp1: 'C:/Tools/Shared Utility.exe',
      customapp2: 'C:/Tools/Shared Utility.exe'
    },
    appArgs: {
      customapp1: '--mode debug',
      customapp2: '--mode silent'
    }
  })

  await expect(
    launchProfileApps(sender, 'ac', [
      { key: 'customapp1', path: 'C:/Tools/Shared Utility.exe' },
      { key: 'customapp2', path: 'C:/Tools/Shared Utility.exe' }
    ])
  ).resolves.toMatchObject({
    success: true,
    launchedCount: 2
  })

  expect(spawnCalls).toHaveLength(2)
  expect(spawnCalls[0]).toMatchObject({
    appPath: 'C:/Tools/Shared Utility.exe',
    args: ['--mode', 'debug']
  })
  expect(spawnCalls[1]).toMatchObject({
    appPath: 'C:/Tools/Shared Utility.exe',
    args: ['--mode', 'silent']
  })
})

// Console-subsystem exes spawned with detached get DETACHED_PROCESS on
// Windows — no console is created and e.g. powershell.exe exits 0 without
// executing anything. They must spawn non-detached so a console is allocated;
// children outlive the parent on Windows either way (#486).
test('launchProfileApps spawns console-subsystem apps without detached (#486)', async () => {
  markExistingPath('C:/Tools/TelemetryCli.exe')
  consoleExePaths.add('C:/Tools/TelemetryCli.exe')
  const { launchProfileApps } = await loadProcessModules()

  await expect(
    launchProfileApps(sender, 'ac', ['C:/Tools/TelemetryCli.exe'])
  ).resolves.toMatchObject({
    success: true,
    launchedCount: 1
  })

  expect(spawnCalls[0]).toMatchObject({
    appPath: 'C:/Tools/TelemetryCli.exe',
    options: { detached: false, stdio: 'ignore' }
  })
})

test('launchProfileApps keeps GUI-subsystem apps detached (#486)', async () => {
  markExistingPath('C:/Tools/SimHub.exe')
  const { launchProfileApps } = await loadProcessModules()

  await expect(launchProfileApps(sender, 'ac', ['C:/Tools/SimHub.exe'])).resolves.toMatchObject({
    success: true,
    launchedCount: 1
  })

  expect(spawnCalls[0]).toMatchObject({
    appPath: 'C:/Tools/SimHub.exe',
    options: { detached: true, stdio: 'ignore' }
  })
})

// Apps like iOverlay resolve asset paths relative to their CWD; inheriting
// SimLauncher's CWD makes every WIC sprite load fail (hr=0x80070003) and the
// failed render loop leaks memory until OOM. The launcher must always start
// an app in its own folder, the same way Explorer/Steam/DisplayMagician do.
test('launchProfileApps starts each app with its own folder as the working directory (#483)', async () => {
  markExistingPath('C:/Tools/SimHub.exe')
  const { launchProfileApps } = await loadProcessModules()

  await expect(launchProfileApps(sender, 'ac', ['C:/Tools/SimHub.exe'])).resolves.toMatchObject({
    success: true,
    launchedCount: 1
  })

  expect(spawnCalls[0]).toMatchObject({
    appPath: 'C:/Tools/SimHub.exe',
    options: { cwd: 'C:/Tools', detached: true, stdio: 'ignore' }
  })
})

test('elevated launches pass the app folder as -WorkingDirectory (#483)', async () => {
  markExistingPath('C:/Tools/Admin Tool.exe')
  spawnErrors.set('C:/Tools/Admin Tool.exe', makeAccessDeniedError())
  const { launchProfileApps } = await loadProcessModules()

  await expect(launchProfileApps(sender, 'ac', ['C:/Tools/Admin Tool.exe'])).resolves.toMatchObject(
    {
      success: true,
      launchedCount: 1,
      elevatedCount: 1
    }
  )

  const elevatedCall = execFileCalls.find((call) => call.command === 'powershell.exe')
  const decodedCommand = Buffer.from(elevatedCall!.args[3], 'base64').toString('utf16le')
  expect(decodedCommand).toContain('-WorkingDirectory $payload.workingDirectory')
  expect(JSON.parse(decodedCommand.split("@'\n")[1].split("\n'@")[0])).toMatchObject({
    filePath: 'C:/Tools/Admin Tool.exe',
    workingDirectory: 'C:/Tools'
  })
})

test('launchProfileApps continues the chain when an elevated UAC prompt goes unanswered (#675)', async () => {
  vi.useFakeTimers()
  try {
    markExistingPath('C:/Tools/Admin Tool.exe')
    markExistingPath('C:/Games/Race.exe')
    // The admin companion needs elevation and its UAC prompt is never answered.
    spawnErrors.set('C:/Tools/Admin Tool.exe', makeAccessDeniedError())
    elevatedLaunchHangs = true

    // launchDelayMs defaults to 0 in beforeEach, so the elevated handoff grace
    // window is the only timer in play.
    const { launchProfileApps } = await loadProcessModulesWithStore({
      appPaths: { admin: 'C:/Tools/Admin Tool.exe' },
      gamePaths: { ac: 'C:/Games/Race.exe' }
    })
    const { ELEVATED_HANDOFF_MAX_WAIT_MS } = await import('../../src/main/processes/spawn')

    // Admin tool is ordered before the game. Before #675 the awaited elevation
    // parked the whole sequence (and the single-flight guard) until the ~120s
    // UAC timeout, so the game (ordered last) never launched.
    const resultPromise = launchProfileApps(sender, 'ac', [
      'C:/Tools/Admin Tool.exe',
      'C:/Games/Race.exe'
    ])

    // Fast-forward past the grace window: the stalled handoff resolves
    // optimistically and the loop moves on to the game.
    await vi.advanceTimersByTimeAsync(ELEVATED_HANDOFF_MAX_WAIT_MS)

    const result = await resultPromise
    expect(result.success).toBe(true)
    expect(result.elevatedCount).toBe(1)
    expect(result.launchedCount).toBe(2)
    // The game (ordered after the stalled elevated companion) still spawned.
    expect(spawnCalls.some((call) => call.appPath === 'C:/Games/Race.exe')).toBe(true)
  } finally {
    vi.useRealTimers()
  }
})

test('a late UAC denial after the grace timer settles inertly, it does not throw or re-report (#675)', async () => {
  vi.useFakeTimers()
  try {
    markExistingPath('C:/Tools/Admin Tool.exe')
    markExistingPath('C:/Games/Race.exe')
    spawnErrors.set('C:/Tools/Admin Tool.exe', makeAccessDeniedError())
    elevatedLaunchHangs = true

    const { launchProfileApps } = await loadProcessModulesWithStore({
      appPaths: { admin: 'C:/Tools/Admin Tool.exe' },
      gamePaths: { ac: 'C:/Games/Race.exe' }
    })
    const { ELEVATED_HANDOFF_MAX_WAIT_MS } = await import('../../src/main/processes/spawn')

    const resultPromise = launchProfileApps(sender, 'ac', [
      'C:/Tools/Admin Tool.exe',
      'C:/Games/Race.exe'
    ])
    await vi.advanceTimersByTimeAsync(ELEVATED_HANDOFF_MAX_WAIT_MS)
    const result = await resultPromise

    // The PowerShell host is deliberately left alive past the grace window, so
    // its callback can still fire afterwards — here with the shape of a user
    // who finally DENIED the prompt. resolve() is idempotent, so this must be a
    // no-op: no throw, no second settle, no mutation of the returned summary.
    expect(heldElevatedCallback).not.toBeNull()
    expect(() => heldElevatedCallback?.(makeAccessDeniedError())).not.toThrow()
    await vi.advanceTimersByTimeAsync(0)

    // KNOWN GAP, tracked in #778: the denial lands here AFTER launchProfileApps
    // has already returned, so `lateElevatedOutcomes` cannot correct a summary
    // that is already out. (When the denial arrives while the loop is still
    // running it IS corrected — see the abort test below.) Pinned deliberately
    // so the fix for #778 has to update it on purpose rather than silently
    // changing what users are told.
    expect(result.success).toBe(true)
    expect(result.launchedCount).toBe(2)
    expect(result.elevatedCount).toBe(1)
    // The success branch carries no failedCount at all, so a late denial that
    // misses the window has nowhere to surface even in principle.
    expect(result.failedCount).toBeUndefined()

    // It is discarded from the USER-FACING report only. The callback still runs
    // its whole error branch before the no-op resolve, so the denial is on disk
    // in main-error.log and diagnosable (#638). Pinned so a fix for #778 cannot
    // regress the diagnostics while improving the reporting.
    const launchLogLines = appErrorLogFsMock.appendFileSync.mock.calls.map((call) =>
      String(call[1])
    )
    expect(
      launchLogLines.some(
        (line) => line.includes('Admin Tool.exe') && line.includes('as administrator')
      )
    ).toBe(true)
  } finally {
    vi.useRealTimers()
  }
})

// Codex P2 on PR #779. The #675 grace timer reports `elevated` optimistically,
// so a Close Apps landing AFTER it fires used to be told "one app started with
// administrator permission and cannot be closed from here" — about a handoff
// SimLauncher had just successfully killed. It named a survivor that did not
// exist and implied the close had failed.
test('a handoff cancelled after the grace timer is not reported as a surviving elevated app (#675)', async () => {
  vi.useFakeTimers()
  try {
    markExistingPath('C:/Tools/Admin Tool.exe')
    markExistingPath('C:/Tools/App2.exe')
    spawnErrors.set('C:/Tools/Admin Tool.exe', makeAccessDeniedError())
    elevatedLaunchHangs = true
    // A real inter-app delay keeps the loop alive after the grace timer, which
    // is the window Codex identified.
    storeData.launchDelayMs = 5000

    const { launchProfileApps, killLaunchedApps } = await loadProcessModulesWithStore({
      appPaths: { admin: 'C:/Tools/Admin Tool.exe', customapp2: 'C:/Tools/App2.exe' }
    })
    const { ELEVATED_HANDOFF_MAX_WAIT_MS } = await import('../../src/main/processes/spawn')

    const launchPromise = launchProfileApps(sender, 'ac', [
      'C:/Tools/Admin Tool.exe',
      'C:/Tools/App2.exe'
    ])

    // Grace window expires with the prompt unanswered: the loop moves on and is
    // now sitting in the inter-app delay.
    await vi.advanceTimersByTimeAsync(ELEVATED_HANDOFF_MAX_WAIT_MS)

    // Close Apps lands. Its abort kills the still-pending PowerShell host (the
    // mocked child models that by firing the callback with an error), which
    // reports the cancellation — too late for the promise, but in time for the
    // summary.
    const killPromise = killLaunchedApps('ac')
    await vi.advanceTimersByTimeAsync(0)
    await killPromise

    const result = await launchPromise

    expect(result.cancelled).toBe(true)
    // Nothing elevated survived, so nothing may be named as unclosable.
    expect(result.elevatedCount).toBe(0)
    expect(result.message).not.toContain('administrator permission')
    // And a handoff that started nothing is not a launched app.
    expect(result.launchedCount).toBe(0)
  } finally {
    vi.useRealTimers()
  }
})

// CodeRabbit Major on PR #779. Clearing lateElevatedOutcomes per run is not
// enough on its own: a host left alive by an EARLIER timed-out handoff keeps
// waiting on its prompt and can fire its callback during a LATER sequence, i.e.
// after that clear. Keyed by appPath alone, a denial of the old prompt would
// classify the new handoff for the same exe as gone.
test("a superseded run's late handoff cannot colour the next sequence (#675)", async () => {
  vi.useFakeTimers()
  try {
    markExistingPath('C:/Tools/Admin Tool.exe')
    markExistingPath('C:/Tools/App2.exe')
    spawnErrors.set('C:/Tools/Admin Tool.exe', makeAccessDeniedError())
    elevatedLaunchHangs = true
    // Keep run 2's loop alive after its own grace timer, so the stale callback
    // has a summary left to corrupt. With a 0 delay the loop would already have
    // finished and the test would pass for the wrong reason.
    storeData.launchDelayMs = 5000

    const { launchProfileApps, runningProcesses } = await loadProcessModulesWithStore({
      appPaths: { admin: 'C:/Tools/Admin Tool.exe', customapp2: 'C:/Tools/App2.exe' }
    })
    const { ELEVATED_HANDOFF_MAX_WAIT_MS } = await import('../../src/main/processes/spawn')

    // Run 1: prompt goes unanswered, the grace timer fires, the sequence ends
    // with the PowerShell host still alive.
    const firstPromise = launchProfileApps(sender, 'ac', [
      'C:/Tools/Admin Tool.exe',
      'C:/Tools/App2.exe'
    ])
    // Grace window, then run 1's own inter-app delay, so the sequence finishes.
    await vi.advanceTimersByTimeAsync(ELEVATED_HANDOFF_MAX_WAIT_MS + 5000)
    await firstPromise
    const firstRunCallback = heldElevatedCallback
    expect(firstRunCallback).not.toBeNull()

    // Clear the post-launch cooldown so run 2 is admitted, and forget what run
    // 1 spawned so run 2 does not skip everything as already running.
    await vi.advanceTimersByTimeAsync(11000)
    processNames.clear()
    runningProcesses.clear()

    // Run 2: the SAME exe, again unanswered, again resolved optimistically.
    const secondPromise = launchProfileApps(sender, 'ac', [
      'C:/Tools/Admin Tool.exe',
      'C:/Tools/App2.exe'
    ])
    await vi.advanceTimersByTimeAsync(ELEVATED_HANDOFF_MAX_WAIT_MS)

    // Run 1's abandoned prompt is finally DENIED, mid-run-2. It must not be
    // attributed to run 2's still-pending handoff for the same exe.
    firstRunCallback?.(makeAccessDeniedError())
    await vi.advanceTimersByTimeAsync(0)

    // Now let run 2's inter-app delay elapse so its summary is computed AFTER
    // the stale write would have landed.
    await vi.advanceTimersByTimeAsync(5000)
    const result = await secondPromise

    // Run 2's handoff is still unknown, not gone: it stays counted.
    expect(result.success).toBe(true)
    expect(result.elevatedCount).toBe(1)
    expect(result.launchedCount).toBe(2)
  } finally {
    vi.useRealTimers()
  }
})

// CodeRabbit Major on PR #779, the within-run half. Two profile slots may point
// at the SAME exe (per-slot args, #357), so one sequence can hold two live
// elevated handoffs for one path. Keyed by appPath, the second callback would
// overwrite the first and its outcome would be applied to BOTH results.
test('two handoffs for the same exe in one run do not share a late outcome (#675)', async () => {
  vi.useFakeTimers()
  try {
    markExistingPath('C:/Tools/Admin Tool.exe')
    markExistingPath('C:/Tools/App3.exe')
    spawnErrors.set('C:/Tools/Admin Tool.exe', makeAccessDeniedError())
    elevatedLaunchHangs = true
    storeData.launchDelayMs = 5000

    const { launchProfileApps } = await loadProcessModulesWithStore({
      appPaths: {
        customapp1: 'C:/Tools/Admin Tool.exe',
        customapp2: 'C:/Tools/Admin Tool.exe',
        customapp3: 'C:/Tools/App3.exe'
      }
    })
    const { ELEVATED_HANDOFF_MAX_WAIT_MS } = await import('../../src/main/processes/spawn')

    // A third, ordinary app last, purely so the loop is still running when the
    // late denial lands. Without it the summary is already computed and the test
    // would pass no matter how the map is keyed.
    const launchPromise = launchProfileApps(sender, 'ac', [
      { key: 'customapp1', path: 'C:/Tools/Admin Tool.exe' },
      { key: 'customapp2', path: 'C:/Tools/Admin Tool.exe' },
      { key: 'customapp3', path: 'C:/Tools/App3.exe' }
    ])

    // Slot 1's prompt goes unanswered, its grace timer fires, the loop waits out
    // the inter-app delay and slot 2 starts its own handoff.
    await vi.advanceTimersByTimeAsync(ELEVATED_HANDOFF_MAX_WAIT_MS + 5000)
    // Slot 2's grace timer. The loop is now in the delay before slot 3.
    await vi.advanceTimersByTimeAsync(ELEVATED_HANDOFF_MAX_WAIT_MS)
    expect(heldElevatedCallbacks).toHaveLength(2)

    // ONLY slot 1 is denied. Slot 2's prompt is still on screen.
    heldElevatedCallbacks[0](makeAccessDeniedError())
    await vi.advanceTimersByTimeAsync(0)

    // Let slot 3 spawn so the sequence ends and the summary is computed.
    await vi.advanceTimersByTimeAsync(5000)
    const result = await launchPromise

    // Slot 1 is gone, slot 2 is still unknown and must stay counted. Keyed by
    // appPath both would resolve to gone and these would be 0 and 1.
    expect(result.elevatedCount).toBe(1)
    expect(result.launchedCount).toBe(2)
  } finally {
    vi.useRealTimers()
  }
})

// Codex P1 on PR #779. Once the grace window expires the sequence moves on and
// its AbortController is unregistered when it ends, but the PowerShell host is
// deliberately left alive. Without a registry the kill path can no longer reach
// it, so approving the still-visible prompt would start the app AFTER the user
// asked to close everything.
test('Close Apps after the sequence ended still kills a pending elevated handoff (#675)', async () => {
  vi.useFakeTimers()
  try {
    markExistingPath('C:/Tools/Admin Tool.exe')
    markExistingPath('C:/Games/Race.exe')
    spawnErrors.set('C:/Tools/Admin Tool.exe', makeAccessDeniedError())
    elevatedLaunchHangs = true

    const { launchProfileApps, killLaunchedApps } = await loadProcessModulesWithStore({
      appPaths: { admin: 'C:/Tools/Admin Tool.exe' },
      gamePaths: { ac: 'C:/Games/Race.exe' }
    })
    const { ELEVATED_HANDOFF_MAX_WAIT_MS } = await import('../../src/main/processes/spawn')

    const launchPromise = launchProfileApps(sender, 'ac', [
      'C:/Tools/Admin Tool.exe',
      'C:/Games/Race.exe'
    ])
    await vi.advanceTimersByTimeAsync(ELEVATED_HANDOFF_MAX_WAIT_MS)
    await launchPromise

    // Sequence over, controller gone, prompt still on screen and nothing has
    // been killed yet.
    expect(elevatedHostKills).toHaveLength(0)

    const killPromise = killLaunchedApps('ac')
    await vi.advanceTimersByTimeAsync(0)
    await killPromise

    // The kill reached the orphaned host, so a late approval cannot start it.
    expect(elevatedHostKills).toHaveLength(1)
  } finally {
    vi.useRealTimers()
  }
})

// --- #809: a cancelled handoff strands its consent prompt on screen ---
//
// Killing the PowerShell host stops the app from starting but does NOT remove
// the Windows consent prompt (verified on a real machine: it stayed up, and
// answering Yes started nothing). Both cancellation paths have to say so, or the
// only readings left to the user are "elevation is broken" or "SimLauncher
// failed to start it", neither of which is true.

// The main process reports a COUNT. The sentence itself is composed in the
// renderer and asserted in tests/renderer/gameRowStrandedConsentPrompt.test.tsx,
// which is where it can be proven to actually reach the user.

test('a Close Apps that cancels a pending handoff mid-sequence explains the stranded prompt (#809)', async () => {
  vi.useFakeTimers()
  try {
    markExistingPath('C:/Tools/Admin Tool.exe')
    markExistingPath('C:/Tools/App2.exe')
    spawnErrors.set('C:/Tools/Admin Tool.exe', makeAccessDeniedError())
    elevatedLaunchHangs = true
    storeData.launchDelayMs = 5000

    const { launchProfileApps, killLaunchedApps } = await loadProcessModulesWithStore({
      appPaths: { admin: 'C:/Tools/Admin Tool.exe', customapp2: 'C:/Tools/App2.exe' }
    })
    const { ELEVATED_HANDOFF_MAX_WAIT_MS } = await import('../../src/main/processes/spawn')

    const launchPromise = launchProfileApps(sender, 'ac', [
      'C:/Tools/Admin Tool.exe',
      'C:/Tools/App2.exe'
    ])
    await vi.advanceTimersByTimeAsync(ELEVATED_HANDOFF_MAX_WAIT_MS)

    const killPromise = killLaunchedApps('ac')
    await vi.advanceTimersByTimeAsync(0)
    const killResult = await killPromise

    const result = await launchPromise

    expect(result.cancelled).toBe(true)
    // Said exactly ONCE. Mid-sequence the user gets both messages, and an
    // earlier version of this fix counted the same handoff at both callers, so
    // the sentence appeared twice for a single prompt.
    expect(killResult.strandedConsentPrompts).toBe(1)
    // Reported once: the launch summary must not carry it as well.
    expect(result.strandedConsentPrompts).toBeUndefined()
    // The #779 guarantee must survive: we killed it, so it must not be
    // described as something that started or that we failed to close.
    expect(result.message).not.toContain('administrator permission')
  } finally {
    vi.useRealTimers()
  }
})

// The window this fix originally missed. Before the grace timer fires the
// handoff is not in the pending registry yet (it is only registered when the
// timer expires), so counting cancellations at the kill entry points saw
// nothing here — even though the abort had killed the host and the prompt was
// left on screen exactly as in the documented case. A user who clicks Close
// Apps promptly, within 10s, lands here rather than in the case the issue
// describes.
test('a Close Apps BEFORE the grace window expires still explains the stranded prompt (#809)', async () => {
  vi.useFakeTimers()
  try {
    markExistingPath('C:/Tools/Admin Tool.exe')
    markExistingPath('C:/Tools/App2.exe')
    spawnErrors.set('C:/Tools/Admin Tool.exe', makeAccessDeniedError())
    elevatedLaunchHangs = true
    storeData.launchDelayMs = 5000

    const { launchProfileApps, killLaunchedApps } = await loadProcessModulesWithStore({
      appPaths: { admin: 'C:/Tools/Admin Tool.exe', customapp2: 'C:/Tools/App2.exe' }
    })

    const launchPromise = launchProfileApps(sender, 'ac', [
      'C:/Tools/Admin Tool.exe',
      'C:/Tools/App2.exe'
    ])
    // Well inside the grace window: the prompt is up, the sequence is parked on
    // it, and nothing has been registered as pending yet.
    await vi.advanceTimersByTimeAsync(10)

    const killResult = await killLaunchedApps('ac')
    await vi.advanceTimersByTimeAsync(0)
    await launchPromise

    // The host really was killed, which is what strands the prompt.
    expect(elevatedHostKills).toHaveLength(1)
    expect(killResult.strandedConsentPrompts).toBe(1)
  } finally {
    vi.useRealTimers()
  }
})

test('a Close Apps that cancels a pending handoff after the sequence ended explains it too (#809)', async () => {
  vi.useFakeTimers()
  try {
    markExistingPath('C:/Tools/Admin Tool.exe')
    markExistingPath('C:/Games/Race.exe')
    spawnErrors.set('C:/Tools/Admin Tool.exe', makeAccessDeniedError())
    elevatedLaunchHangs = true

    const { launchProfileApps, killLaunchedApps } = await loadProcessModulesWithStore({
      appPaths: { admin: 'C:/Tools/Admin Tool.exe' },
      gamePaths: { ac: 'C:/Games/Race.exe' }
    })
    const { ELEVATED_HANDOFF_MAX_WAIT_MS } = await import('../../src/main/processes/spawn')

    const launchPromise = launchProfileApps(sender, 'ac', [
      'C:/Tools/Admin Tool.exe',
      'C:/Games/Race.exe'
    ])
    await vi.advanceTimersByTimeAsync(ELEVATED_HANDOFF_MAX_WAIT_MS)
    await launchPromise

    // The sequence is over, so its summary is already delivered. The kill result
    // is the only message left that can explain the prompt.
    const killPromise = killLaunchedApps('ac')
    await vi.advanceTimersByTimeAsync(0)
    const result = await killPromise

    expect(elevatedHostKills).toHaveLength(1)
    expect(result.strandedConsentPrompts).toBe(1)
  } finally {
    vi.useRealTimers()
  }
})

test('two cancelled handoffs are described in the plural (#809)', async () => {
  vi.useFakeTimers()
  try {
    markExistingPath('C:/Tools/Admin Tool.exe')
    markExistingPath('C:/Tools/Admin Two.exe')
    markExistingPath('C:/Games/Race.exe')
    spawnErrors.set('C:/Tools/Admin Tool.exe', makeAccessDeniedError())
    spawnErrors.set('C:/Tools/Admin Two.exe', makeAccessDeniedError())
    elevatedLaunchHangs = true

    const { launchProfileApps, killLaunchedApps } = await loadProcessModulesWithStore({
      appPaths: { admin: 'C:/Tools/Admin Tool.exe', customapp2: 'C:/Tools/Admin Two.exe' },
      gamePaths: { ac: 'C:/Games/Race.exe' }
    })
    const { ELEVATED_HANDOFF_MAX_WAIT_MS } = await import('../../src/main/processes/spawn')

    const launchPromise = launchProfileApps(sender, 'ac', [
      'C:/Tools/Admin Tool.exe',
      'C:/Tools/Admin Two.exe',
      'C:/Games/Race.exe'
    ])
    await vi.advanceTimersByTimeAsync(ELEVATED_HANDOFF_MAX_WAIT_MS * 2)
    await launchPromise

    const killPromise = killLaunchedApps('ac')
    await vi.advanceTimersByTimeAsync(0)
    const result = await killPromise

    expect(elevatedHostKills).toHaveLength(2)
    expect(result.strandedConsentPrompts).toBe(2)
  } finally {
    vi.useRealTimers()
  }
})

test('a later Close Apps does not repeat the prompt warning for an old cancellation (#809)', async () => {
  vi.useFakeTimers()
  try {
    markExistingPath('C:/Tools/Admin Tool.exe')
    markExistingPath('C:/Games/Race.exe')
    spawnErrors.set('C:/Tools/Admin Tool.exe', makeAccessDeniedError())
    elevatedLaunchHangs = true

    const { launchProfileApps, killLaunchedApps } = await loadProcessModulesWithStore({
      appPaths: { admin: 'C:/Tools/Admin Tool.exe' },
      gamePaths: { ac: 'C:/Games/Race.exe' }
    })
    const { ELEVATED_HANDOFF_MAX_WAIT_MS } = await import('../../src/main/processes/spawn')

    const launchPromise = launchProfileApps(sender, 'ac', [
      'C:/Tools/Admin Tool.exe',
      'C:/Games/Race.exe'
    ])
    await vi.advanceTimersByTimeAsync(ELEVATED_HANDOFF_MAX_WAIT_MS)
    await launchPromise

    const firstKill = await killLaunchedApps('ac')
    await vi.advanceTimersByTimeAsync(0)
    expect(firstKill.strandedConsentPrompts).toBe(1)

    // Same session, nothing pending any more. The count is consumed by the
    // message that reported it, so a later kill must not resurrect it and warn
    // about a dialog that is not there.
    const secondKill = await killLaunchedApps('ac')
    await vi.advanceTimersByTimeAsync(0)
    expect(secondKill.strandedConsentPrompts).toBeUndefined()
  } finally {
    vi.useRealTimers()
  }
})

test('an ordinary Close Apps with no pending handoff says nothing about a prompt (#809)', async () => {
  markExistingPath('C:/Tools/App2.exe')
  processNames.add('app2.exe')
  registerProcess('C:/Tools/App2.exe', 'app2.exe', '4321')

  const { killLaunchedApps } = await loadProcessModulesWithStore({
    appPaths: { customapp2: 'C:/Tools/App2.exe' }
  })

  const result = await killLaunchedApps('ac')

  // The unchanged case must read exactly as it did before this issue.
  expect(result.strandedConsentPrompts).toBeUndefined()
})

// ---------------------------------------------------------------------------
// #659 graceful close. Every test here drives killLaunchedApps, the path both
// explicit Close Apps affordances (tray item and row button) go through.
// ---------------------------------------------------------------------------

// A polite request is a `/PID` taskkill WITHOUT `/F`: that posts WM_CLOSE
// instead of terminating. The force kill keeps its `/F`, so the two are told
// apart by the flag alone.
function gracefulRequests() {
  return execFileCalls.filter(
    (call) => call.command === 'taskkill' && call.args.includes('/PID') && !call.args.includes('/F')
  )
}

function forceKills() {
  return execFileCalls.filter(
    (call) => call.command === 'taskkill' && call.args.includes('/PID') && call.args.includes('/F')
  )
}

test('graceful close is off by default, so the close path is unchanged (#659)', async () => {
  markExistingPath('C:/Tools/App2.exe')
  processNames.add('app2.exe')
  registerProcess('C:/Tools/App2.exe', 'app2.exe', '4321')

  const { killLaunchedApps } = await loadProcessModulesWithStore({
    profiles: {
      ac: {
        activeProfileId: 'default',
        profiles: [{ id: 'default', name: 'Default', customapp2: true }]
      }
    },
    appPaths: { customapp2: 'C:/Tools/App2.exe' }
  })

  const result = await killLaunchedApps('ac')

  // Not merely "no delay": nothing is even asked. The default close stays the
  // single force kill it has always been.
  expect(gracefulRequests()).toHaveLength(0)
  expect(forceKills()).toHaveLength(1)
  expect(result.closedCount).toBe(1)
})

test('with the toggle on, a target is asked to close before anything is forced (#659)', async () => {
  vi.useFakeTimers()
  try {
    markExistingPath('C:/Tools/App2.exe')
    processNames.add('app2.exe')
    registerProcess('C:/Tools/App2.exe', 'app2.exe', '4321')

    const { killLaunchedApps } = await loadProcessModulesWithStore({
      gracefulCloseEnabled: true,
      profiles: {
        ac: {
          activeProfileId: 'default',
          profiles: [{ id: 'default', name: 'Default', customapp2: true }]
        }
      },
      appPaths: { customapp2: 'C:/Tools/App2.exe' }
    })
    const { GRACEFUL_CLOSE_WINDOW_MS } = await import('../../src/main/processes/win32KillUtils')

    const killPromise = killLaunchedApps('ac')
    await vi.advanceTimersByTimeAsync(GRACEFUL_CLOSE_WINDOW_MS)
    await killPromise

    // Asked by PID, not by image name: an `/IM` request would reach every
    // same-named process, including one the user started themselves.
    expect(gracefulRequests()).toEqual([
      expect.objectContaining({ command: 'taskkill', args: ['/PID', '4321', '/T'] })
    ])
    // And the ordering is the entire feature.
    const askedAt = execFileCalls.indexOf(gracefulRequests()[0])
    const forcedAt = execFileCalls.indexOf(forceKills()[0])
    expect(askedAt).toBeLessThan(forcedAt)
  } finally {
    vi.useRealTimers()
  }
})

test('an app that honours the request is reported closed, not failed (#659)', async () => {
  vi.useFakeTimers()
  try {
    markExistingPath('C:/Tools/App2.exe')
    processNames.add('app2.exe')
    registerProcess('C:/Tools/App2.exe', 'app2.exe', '4321')
    // This one saves its state and exits on its own.
    gracefulClosePids.add('4321')

    const { killLaunchedApps } = await loadProcessModulesWithStore({
      gracefulCloseEnabled: true,
      profiles: {
        ac: {
          activeProfileId: 'default',
          profiles: [{ id: 'default', name: 'Default', customapp2: true }]
        }
      },
      appPaths: { customapp2: 'C:/Tools/App2.exe' }
    })
    const { GRACEFUL_CLOSE_WINDOW_MS } = await import('../../src/main/processes/win32KillUtils')

    const killPromise = killLaunchedApps('ac')
    await vi.advanceTimersByTimeAsync(GRACEFUL_CLOSE_WINDOW_MS)
    const result = await killPromise

    // It left during the grace window, so the force kill finds nothing. That
    // has to read as "closed", never as a failure the user must act on.
    expect(result.success).toBe(true)
    expect(result.closedCount).toBe(1)
    expect(result.failures).toEqual([])
  } finally {
    vi.useRealTimers()
  }
})

test('an app that ignores the request is still force-killed (#659)', async () => {
  vi.useFakeTimers()
  try {
    markExistingPath('C:/Tools/App2.exe')
    processNames.add('app2.exe')
    registerProcess('C:/Tools/App2.exe', 'app2.exe', '4321')
    // Deliberately not in gracefulClosePids: a console app, or one that simply
    // ignores WM_CLOSE.

    const { killLaunchedApps } = await loadProcessModulesWithStore({
      gracefulCloseEnabled: true,
      profiles: {
        ac: {
          activeProfileId: 'default',
          profiles: [{ id: 'default', name: 'Default', customapp2: true }]
        }
      },
      appPaths: { customapp2: 'C:/Tools/App2.exe' }
    })
    const { GRACEFUL_CLOSE_WINDOW_MS } = await import('../../src/main/processes/win32KillUtils')

    const killPromise = killLaunchedApps('ac')
    await vi.advanceTimersByTimeAsync(GRACEFUL_CLOSE_WINDOW_MS)
    const result = await killPromise

    expect(forceKills()).toEqual([expect.objectContaining({ args: ['/PID', '4321', '/T', '/F'] })])
    expect(result.closedCount).toBe(1)
  } finally {
    vi.useRealTimers()
  }
})

test('the grace window is one shared wait, not one per app (#659)', async () => {
  vi.useFakeTimers()
  try {
    markExistingPath('C:/Tools/App2.exe')
    markExistingPath('C:/Tools/App3.exe')
    processNames.add('app2.exe')
    processNames.add('app3.exe')
    registerProcess('C:/Tools/App2.exe', 'app2.exe', '4321')
    registerProcess('C:/Tools/App3.exe', 'app3.exe', '5555')

    const { killLaunchedApps } = await loadProcessModulesWithStore({
      gracefulCloseEnabled: true,
      profiles: {
        ac: {
          activeProfileId: 'default',
          profiles: [{ id: 'default', name: 'Default', customapp2: true, customapp3: true }]
        }
      },
      appPaths: { customapp2: 'C:/Tools/App2.exe', customapp3: 'C:/Tools/App3.exe' }
    })
    const { GRACEFUL_CLOSE_WINDOW_MS } = await import('../../src/main/processes/win32KillUtils')

    let settled = false
    const killPromise = killLaunchedApps('ac').then((value) => {
      settled = true
      return value
    })

    // Two apps, both ignoring the request. Advancing ONE window must be
    // enough: a per-app wait would need two, and the issue requires the total
    // to stay bounded however many apps ignore it.
    await vi.advanceTimersByTimeAsync(GRACEFUL_CLOSE_WINDOW_MS)
    await killPromise

    expect(settled).toBe(true)
    expect(gracefulRequests()).toHaveLength(2)
  } finally {
    vi.useRealTimers()
  }
})

test('nothing running means no grace window at all (#659)', async () => {
  vi.useFakeTimers()
  try {
    markExistingPath('C:/Tools/App2.exe')

    const { killLaunchedApps } = await loadProcessModulesWithStore({
      gracefulCloseEnabled: true,
      profiles: {
        ac: {
          activeProfileId: 'default',
          profiles: [{ id: 'default', name: 'Default', customapp2: true }]
        }
      },
      appPaths: { customapp2: 'C:/Tools/App2.exe' }
    })

    let settled = false
    const killPromise = killLaunchedApps('ac').then((value) => {
      settled = true
      return value
    })

    // The assertion that matters is the clock NOT moving. Advancing by zero
    // only drains microtasks, so settling here proves the close returned
    // without entering the window at all. An earlier version used real timers
    // and would have passed just as happily while waiting the full three
    // seconds, pinning nothing (CodeRabbit on #823).
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(true)

    const result = await killPromise
    expect(gracefulRequests()).toHaveLength(0)
    expect(result.closedCount).toBe(0)
  } finally {
    vi.useRealTimers()
  }
})

// Codex P1 on #823. The graceful phase awaits a WMI lookup per path target,
// each bounded by WMI_LOOKUP_TIMEOUT_MS, so it can sit there for seconds. A
// tracked child that exits during that wait releases its PID, and Windows may
// hand the number to something else before the polite request goes out. Holding
// the ChildProcess handle instead of the raw number is what makes the exit
// visible; capturing `child.pid` up front cannot notice.
test('a child that exits while the lookup is in flight is dropped from the request (#659)', async () => {
  vi.useFakeTimers()
  try {
    markExistingPath('C:/Tools/Perplexity.exe')
    markExistingPath('C:/Tools/App2.exe')
    processNames.add('perplexity.exe')
    processNames.add('app2.exe')
    registerProcess('C:/Tools/App2.exe', 'app2.exe', '5555')

    const { killLaunchedApps, runningProcesses } = await loadProcessModulesWithStore({
      gracefulCloseEnabled: true,
      profiles: {
        ac: {
          activeProfileId: 'default',
          profiles: [{ id: 'default', name: 'Default', customapp2: true }]
        }
      },
      appPaths: { customapp2: 'C:/Tools/App2.exe' }
    })

    // A tracked child, alive at the moment the close starts.
    const trackedChild = { pid: 1234, exitCode: null as number | null, signalCode: null }
    runningProcesses.set(String.raw`c:\tools\perplexity.exe`, {
      process: trackedChild as never,
      path: 'C:/Tools/Perplexity.exe',
      name: 'Perplexity.exe',
      gameKey: 'ac',
      isGame: false
    })

    const { GRACEFUL_CLOSE_WINDOW_MS } = await import('../../src/main/processes/win32KillUtils')

    // Park the App2 path lookup, so the graceful phase is stuck awaiting it.
    let releaseLookup: () => void = () => {}
    wmiLookupBlocker = new Promise<void>((resolve) => {
      releaseLookup = resolve
    })

    const killPromise = killLaunchedApps('ac')
    await vi.advanceTimersByTimeAsync(0)

    // The tracked child dies on its own while the lookup is still parked, which
    // releases PID 1234 for Windows to hand to somebody else.
    trackedChild.exitCode = 0
    releaseLookup()

    await vi.advanceTimersByTimeAsync(GRACEFUL_CLOSE_WINDOW_MS)
    await killPromise

    const askedPids = gracefulRequests().map((call) => call.args[call.args.indexOf('/PID') + 1])
    // The companion that is still running is asked; the released number is not.
    expect(askedPids).toContain('5555')
    expect(askedPids).not.toContain('1234')
  } finally {
    vi.useRealTimers()
  }
})

// The same Codex P1, for the half a handle cannot cover. A discovered PID is
// just a number, so the defence is not to hold it: collecting every lookup
// before asking anyone left the first answer sitting unused for as long as the
// slowest lookup took, up to WMI_LOOKUP_TIMEOUT_MS, and that companion could
// exit and hand its number to a stranger inside that gap.
test('a discovered PID is asked as soon as its own lookup answers (#659)', async () => {
  vi.useFakeTimers()
  try {
    markExistingPath('C:/Tools/App2.exe')
    markExistingPath('C:/Tools/App3.exe')
    processNames.add('app2.exe')
    processNames.add('app3.exe')
    registerProcess('C:/Tools/App2.exe', 'app2.exe', '4321')
    registerProcess('C:/Tools/App3.exe', 'app3.exe', '5555')

    const { killLaunchedApps } = await loadProcessModulesWithStore({
      gracefulCloseEnabled: true,
      profiles: {
        ac: {
          activeProfileId: 'default',
          profiles: [{ id: 'default', name: 'Default', customapp2: true, customapp3: true }]
        }
      },
      appPaths: { customapp2: 'C:/Tools/App2.exe', customapp3: 'C:/Tools/App3.exe' }
    })
    const { GRACEFUL_CLOSE_WINDOW_MS } = await import('../../src/main/processes/win32KillUtils')

    // One-shot, so it parks whichever lookup goes out first and leaves the
    // other one answering at its normal speed.
    let releaseLookup: () => void = () => {}
    wmiLookupBlocker = new Promise<void>((resolve) => {
      releaseLookup = resolve
    })

    const killPromise = killLaunchedApps('ac')
    await vi.advanceTimersByTimeAsync(0)

    // Exactly one: the target that already answered has been asked, while the
    // parked lookup has not delayed it. Batching every result first would make
    // this zero.
    expect(gracefulRequests()).toHaveLength(1)

    releaseLookup()
    await vi.advanceTimersByTimeAsync(GRACEFUL_CLOSE_WINDOW_MS)
    await killPromise

    const askedPids = gracefulRequests()
      .map((call) => call.args[call.args.indexOf('/PID') + 1])
      .sort()
    expect(askedPids).toEqual(['4321', '5555'])
  } finally {
    vi.useRealTimers()
  }
})

// The grace window is a window in which a well-behaved app is expected to exit,
// which is exactly when a PID stops being a safe thing to signal: Node releases
// the handle on exit and Windows may hand that number to something else, and
// `/T` would take that stranger's whole tree. Tested directly against
// win32KillUtils, which is the seam #773 extracted for precisely this.
test('a child that already exited is never signalled again (#659)', async () => {
  await loadProcessModules()
  const { killProcessTree } = await import('../../src/main/processes/win32KillUtils')

  const exitedChild = {
    pid: 4321,
    exitCode: 0,
    signalCode: null,
    kill: vi.fn()
  } as unknown as Parameters<typeof killProcessTree>[0]

  const result = await killProcessTree(exitedChild, 'C:/Tools/App2.exe', 'ac')

  // No taskkill at all, not even a failed one: the PID is never put on the wire.
  expect(execFileCalls.filter((call) => call.command === 'taskkill')).toHaveLength(0)
  // Reported exactly as taskkill would have reported finding nothing, so the
  // accounting downstream needs no special case.
  expect(result).toMatchObject({ success: true, notFound: true, processName: 'app2.exe' })
  expect(result.targetConfirmed).toBeUndefined()
})

test('a bare-name target is never asked politely, to keep the phase path-scoped (#659)', async () => {
  vi.useFakeTimers()
  try {
    // The garage61 companion agent is a hardcoded bare process name with no
    // configured path, so it can only be reached by `/IM`. Asking by name
    // would broaden the request to every same-named process, breaking the
    // guarantee the force-kill path already refuses to break.
    processNames.add('garage61 telemetry agent.exe')
    markExistingPath('C:/Tools/Garage61.exe')

    const { killLaunchedApps } = await loadProcessModulesWithStore({
      gracefulCloseEnabled: true,
      profiles: {
        ac: {
          activeProfileId: 'default',
          profiles: [{ id: 'default', name: 'Default', garage61: true }]
        }
      },
      appPaths: { garage61: 'C:/Tools/Garage61.exe' }
    })
    const { GRACEFUL_CLOSE_WINDOW_MS } = await import('../../src/main/processes/win32KillUtils')

    const killPromise = killLaunchedApps('ac')
    await vi.advanceTimersByTimeAsync(GRACEFUL_CLOSE_WINDOW_MS)
    await killPromise

    expect(gracefulRequests()).toHaveLength(0)
  } finally {
    vi.useRealTimers()
  }
})

// The scope decision, pinned. A profile switch already contains close-then-
// relaunch pairs (a slot-key move of the same exe, see ipc/launch.ts), so a
// grace window there is latency spent on an app that is about to be started
// again moments later. If someone later routes the switch through the graceful
// phase, this is the test that should stop them and send them to #659 first.
test('a profile switch never runs the graceful phase, toggle or not (#659)', async () => {
  markExistingPath('C:/Tools/App2.exe')
  processNames.add('app2.exe')
  registerProcess('C:/Tools/App2.exe', 'app2.exe', '4321')

  const { killProfileApps } = await loadProcessModulesWithStore({
    gracefulCloseEnabled: true,
    appPaths: { customapp2: 'C:/Tools/App2.exe' }
  })

  const result = await killProfileApps('ac', ['C:/Tools/App2.exe'])

  expect(gracefulRequests()).toHaveLength(0)
  expect(result.closedCount).toBe(1)
})

// The other kill entry point, and the one a profile switch actually goes
// through. It carries the same drain + attach prologue as killLaunchedApps, so
// without this every #809 test would prove the feature on the path the user
// reaches by clicking Close Apps and none of it on the path they reach by
// switching profile.
test('a profile switch that cancels a pending handoff explains the stranded prompt (#809)', async () => {
  vi.useFakeTimers()
  try {
    markExistingPath('C:/Tools/Admin Tool.exe')
    markExistingPath('C:/Tools/App2.exe')
    spawnErrors.set('C:/Tools/Admin Tool.exe', makeAccessDeniedError())
    elevatedLaunchHangs = true

    const { launchProfileApps, killProfileApps } = await loadProcessModulesWithStore({
      appPaths: { admin: 'C:/Tools/Admin Tool.exe', customapp2: 'C:/Tools/App2.exe' }
    })
    const { ELEVATED_HANDOFF_MAX_WAIT_MS } = await import('../../src/main/processes/spawn')

    const launchPromise = launchProfileApps(sender, 'ac', ['C:/Tools/Admin Tool.exe'])
    await vi.advanceTimersByTimeAsync(ELEVATED_HANDOFF_MAX_WAIT_MS)
    await launchPromise

    // The switch stops the outgoing profile's apps, not the elevated one whose
    // prompt is still up. The handoff is cancelled by gameKey either way, so
    // the count must survive a kill that targets something else entirely.
    const result = await killProfileApps('ac', ['C:/Tools/App2.exe'])
    await vi.advanceTimersByTimeAsync(0)

    expect(elevatedHostKills).toHaveLength(1)
    expect(result.strandedConsentPrompts).toBe(1)
  } finally {
    vi.useRealTimers()
  }
})

test('an ordinary profile switch with no pending handoff says nothing about a prompt (#809)', async () => {
  markExistingPath('C:/Tools/App2.exe')
  processNames.add('app2.exe')
  registerProcess('C:/Tools/App2.exe', 'app2.exe', '4321')

  const { killProfileApps } = await loadProcessModulesWithStore({
    appPaths: { customapp2: 'C:/Tools/App2.exe' }
  })

  const result = await killProfileApps('ac', ['C:/Tools/App2.exe'])

  expect(result.strandedConsentPrompts).toBeUndefined()
})

// Codex P2 on PR #779. A denial arriving while the loop is still running was
// only subtracted from the counts, so the sequence still returned success:true
// with "All profile applications launched." and no failedCount.
test('a UAC denial after the grace window is reported as a failure (#675)', async () => {
  vi.useFakeTimers()
  try {
    markExistingPath('C:/Tools/Admin Tool.exe')
    markExistingPath('C:/Tools/App3.exe')
    spawnErrors.set('C:/Tools/Admin Tool.exe', makeAccessDeniedError())
    elevatedLaunchHangs = true
    // Keeps the loop alive after the grace timer, so the denial lands before the
    // summary is computed.
    storeData.launchDelayMs = 5000

    const { launchProfileApps } = await loadProcessModulesWithStore({
      appPaths: { admin: 'C:/Tools/Admin Tool.exe', customapp3: 'C:/Tools/App3.exe' }
    })
    const { ELEVATED_HANDOFF_MAX_WAIT_MS } = await import('../../src/main/processes/spawn')

    const launchPromise = launchProfileApps(sender, 'ac', [
      { key: 'admin', path: 'C:/Tools/Admin Tool.exe' },
      { key: 'customapp3', path: 'C:/Tools/App3.exe' }
    ])
    await vi.advanceTimersByTimeAsync(ELEVATED_HANDOFF_MAX_WAIT_MS)

    // The user finally answers "No", while the loop is in its inter-app delay.
    heldElevatedCallbacks[0](makeAccessDeniedError())
    await vi.advanceTimersByTimeAsync(5000)

    const result = await launchPromise

    expect(result.success).toBe(false)
    expect(result.failedCount).toBe(1)
    expect(result.error).toContain('Admin Tool.exe')
    // It is not standing as an elevated app either.
    expect(result.elevatedCount).toBe(0)
  } finally {
    vi.useRealTimers()
  }
})

test('launchProfileApps reports synchronous spawn failures without tracking the failed process', async () => {
  const { launchProfileApps, runningProcesses } = await loadProcessModules()

  markExistingPath('C:/Tools/Broken.exe')
  vi.mocked(await import('child_process')).spawn.mockImplementationOnce(() => {
    throw new Error('spawn exploded')
  })

  await expect(launchProfileApps(sender, 'ac', ['C:/Tools/Broken.exe'])).resolves.toMatchObject({
    success: false,
    error: 'Failed to launch Broken.exe: spawn exploded',
    launchedCount: 0,
    failedCount: 1
  })
  expect(runningProcesses.has('c:\\tools\\broken.exe')).toBe(false)
})

test('launchProfileApps emits late launch errors to the renderer after initial spawn success', async () => {
  const lateError = new Error('lost after spawn') as NodeJS.ErrnoException
  const childHandlers = new Map<string, (...args: unknown[]) => void>()
  const child = {
    once: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      childHandlers.set(event, handler)
      return child
    }),
    unref: vi.fn()
  }

  markExistingPath('C:/Tools/LateError.exe')
  const { launchProfileApps } = await loadProcessModules()
  vi.mocked(await import('child_process')).spawn.mockReturnValueOnce(child as never)

  const launchPromise = launchProfileApps(sender, 'ac', ['C:/Tools/LateError.exe'])
  childHandlers.get('spawn')?.()
  await expect(launchPromise).resolves.toMatchObject({ success: true, launchedCount: 1 })

  childHandlers.get('error')?.(lateError)

  expect(sender.send).toHaveBeenCalledWith('app-launch-error', {
    app: 'C:/Tools/LateError.exe',
    error: 'lost after spawn'
  })
})

test('killLaunchedApps returns a no-op kill result when no companion apps are running', async () => {
  const { killLaunchedApps } = await loadProcessModules()

  await expect(killLaunchedApps('ac')).resolves.toEqual({
    success: true,
    message: 'No running companion apps to close.',
    closedCount: 0,
    failedCount: 0,
    failures: []
  })
})

test('killLaunchedApps explains no-op closes when only wrapper mismatch warnings remain', async () => {
  const { killLaunchedApps, processNameMismatchWarnings } = await loadProcessModules()

  processNameMismatchWarnings.set('c:/tools/cheat engine.exe', {
    path: 'C:/Tools/Cheat Engine.exe',
    name: 'Cheat Engine.exe',
    gameKey: 'ac',
    warning:
      'Cheat Engine.exe exited shortly after launch. If it starts another process with a different name, add that executable under tracked processes to prevent duplicate launches.'
  })

  await expect(killLaunchedApps('ac')).resolves.toMatchObject({
    success: true,
    message: expect.stringContaining('different process name'),
    closedCount: 0,
    failedCount: 0,
    failures: []
  })
})

test('killLaunchedApps keeps generic no-op message for unrelated game wrapper warnings', async () => {
  const { killLaunchedApps, processNameMismatchWarnings } = await loadProcessModules()

  processNameMismatchWarnings.set('c:/tools/cheat engine.exe', {
    path: 'C:/Tools/Cheat Engine.exe',
    name: 'Cheat Engine.exe',
    gameKey: 'ac',
    warning:
      'Cheat Engine.exe exited shortly after launch. If it starts another process with a different name, add that executable under tracked processes to prevent duplicate launches.'
  })

  await expect(killLaunchedApps('iracing')).resolves.toEqual({
    success: true,
    message: 'No running companion apps to close.',
    closedCount: 0,
    failedCount: 0,
    failures: []
  })
})

// hasClosableLaunchedApps has no production caller today (see its JSDoc) and
// must mirror killLaunchedApps' own target selection.
test('hasClosableLaunchedApps is false when nothing is running', async () => {
  const { hasClosableLaunchedApps } = await loadProcessModules()
  await expect(hasClosableLaunchedApps()).resolves.toBe(false)
})

test('hasClosableLaunchedApps is true for a running non-game companion', async () => {
  const { hasClosableLaunchedApps, runningProcesses } = await loadProcessModules()
  runningProcesses.set('c:\\tools\\simhub.exe', {
    process: { pid: 1234 } as never,
    path: 'C:/Tools/SimHub.exe',
    name: 'SimHub.exe',
    gameKey: 'ac',
    isGame: false
  })
  processNames.add('simhub.exe')

  await expect(hasClosableLaunchedApps()).resolves.toBe(true)
})

test('hasClosableLaunchedApps ignores the game itself', async () => {
  const { hasClosableLaunchedApps, runningProcesses } = await loadProcessModules()
  runningProcesses.set('c:\\games\\acs.exe', {
    process: { pid: 1234 } as never,
    path: 'C:/Games/acs.exe',
    name: 'acs.exe',
    gameKey: 'ac',
    isGame: true
  })
  processNames.add('acs.exe')

  await expect(hasClosableLaunchedApps()).resolves.toBe(false)
})

// Codex P2 on #536: a configured companion can be running while its game is NOT
// launched/adopted. killLaunchedApps still closes it (via companion targets), so
// the tray must be enabled — even though getRunningApps would not surface it.
test('hasClosableLaunchedApps is true for a configured companion with no game launched (#519)', async () => {
  const { hasClosableLaunchedApps, runningProcesses } = await loadProcessModulesWithStore({
    profiles: {
      ac: { activeProfileId: 'default', profiles: [{ id: 'default', name: 'Default' }] }
    },
    appPaths: { simhub: 'C:/Tools/SimHub.exe' }
  })
  processNames.add('simhub.exe')

  // Nothing SimLauncher-launched is tracked; the companion is reachable only via
  // the configured-companion-targets branch.
  expect(runningProcesses.size).toBe(0)
  await expect(hasClosableLaunchedApps()).resolves.toBe(true)
})

// Codex P2 on #536: the no-arg close scans all profiles. A game exe configured
// as a companion under a DIFFERENT profile must never become a kill target — the
// confirmation promises the game is untouched.
test('the global close never targets a game exe configured as a companion elsewhere (#519)', async () => {
  const { hasClosableLaunchedApps, killLaunchedApps, runningProcesses } =
    await loadProcessModulesWithStore({
      gamePaths: { ac: 'C:/Games/acs.exe' },
      // acs.exe (a game) is also configured as a tracked app, surfaced under a
      // different profile that has no game of its own.
      appPaths: { acsAsTool: 'C:/Games/acs.exe' },
      profiles: {
        iracing: { activeProfileId: 'default', profiles: [{ id: 'default', name: 'Default' }] }
      }
    })
  // The game exe must be a valid path for it to be recognised and excluded.
  markExistingPath('C:/Games/acs.exe')
  runningProcesses.set('c:\\games\\acs.exe', {
    process: { pid: 1 } as never,
    path: 'C:/Games/acs.exe',
    name: 'acs.exe',
    gameKey: 'ac',
    isGame: true
  })
  processNames.add('acs.exe')

  // The only running process is the game → nothing closable, and a global close
  // must be a no-op rather than killing the game via the other profile's target.
  await expect(hasClosableLaunchedApps()).resolves.toBe(false)
  await expect(killLaunchedApps()).resolves.toMatchObject({
    success: true,
    closedCount: 0,
    failedCount: 0
  })
})

// Codex P2 on #536: the game exclusion must match by full path, not basename. A
// companion whose basename collides with a DIFFERENT game's exe (different path)
// must still be closable — otherwise the per-game close drops legitimate apps.
test('a companion sharing a basename with another game is still closable (#519)', async () => {
  const { hasClosableLaunchedApps } = await loadProcessModulesWithStore({
    gamePaths: { ac: 'C:/Games/acs.exe', other: 'C:/OtherGame/app.exe' },
    // The selected profile's companion is named app.exe but lives elsewhere than
    // the "other" game's app.exe.
    appPaths: { tool: 'C:/Tools/app.exe' },
    profiles: {
      ac: { activeProfileId: 'default', profiles: [{ id: 'default', name: 'Default' }] }
    }
  })
  markExistingPath('C:/Games/acs.exe')
  markExistingPath('C:/OtherGame/app.exe')
  processNames.add('app.exe')

  // app.exe is a real companion for profile ac (its path is not a game path), so
  // the per-game close must reach it despite the basename collision.
  await expect(hasClosableLaunchedApps('ac')).resolves.toBe(true)
})

// Codex P2 on #536 (Option B): a game exe launched under a NON-owning profile is
// recorded isGame=false in runningProcesses, so the all-profiles close would kill
// it via the runningProcesses branch despite the "game not affected" promise. The
// configured-game-path guard must protect it regardless of the cached isGame flag.
test('the global close never kills a game launched under another profile (#519)', async () => {
  const { hasClosableLaunchedApps, killLaunchedApps, runningProcesses } =
    await loadProcessModulesWithStore({
      gamePaths: { ac: 'C:/Games/acs.exe' }
    })
  markExistingPath('C:/Games/acs.exe')
  // Same exe, but recorded for a different profile and (wrongly) flagged non-game.
  runningProcesses.set('c:\\games\\acs.exe', {
    process: { pid: 1 } as never,
    path: 'C:/Games/acs.exe',
    name: 'acs.exe',
    gameKey: 'other',
    isGame: false
  })
  processNames.add('acs.exe')

  await expect(hasClosableLaunchedApps()).resolves.toBe(false)
  await expect(killLaunchedApps()).resolves.toMatchObject({
    success: true,
    closedCount: 0,
    failedCount: 0
  })
  // The game process was skipped, not killed or pruned.
  expect(runningProcesses.has('c:\\games\\acs.exe')).toBe(true)
})

test('killProfileApps rejects paths that are not configured app paths', async () => {
  const { killProfileApps } = await loadProcessModules()

  markExistingPath('C:/Tools/Unknown.exe')
  storeData.appPaths = { simhub: 'C:/Tools/SimHub.exe' }

  await expect(killProfileApps('ac', ['C:/Tools/Unknown.exe'])).resolves.toEqual({
    success: false,
    error: 'Kill request includes an app path that is not configured.',
    closedCount: 0,
    failedCount: 0,
    failures: []
  })
})

test('killProfileApps targets configured untracked Windows apps by resolved PID instead of image name', async () => {
  markExistingPath('C:/Tools/SimHub.exe')
  processNames.add('simhub.exe')
  registerProcess('C:/Tools/SimHub.exe', 'simhub.exe', '4321')
  const { killProfileApps } = await loadProcessModulesWithStore({
    appPaths: { simhub: 'C:/Tools/SimHub.exe' }
  })

  await expect(killProfileApps('ac', ['C:/Tools/SimHub.exe'])).resolves.toMatchObject({
    success: true,
    closedCount: 1,
    failedCount: 0
  })

  expect(execFileCalls).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        command: 'powershell.exe',
        args: expect.arrayContaining([expect.stringContaining('Get-CimInstance Win32_Process')])
      }),
      expect.objectContaining({
        command: 'taskkill',
        args: ['/PID', '4321', '/T', '/F']
      })
    ])
  )
  expect(execFileCalls).not.toEqual(
    expect.arrayContaining([
      expect.objectContaining({ command: 'taskkill', args: ['/IM', 'simhub.exe', '/T', '/F'] })
    ])
  )
  expect(invalidateProcessNameCacheMock).toHaveBeenCalled()
})

test('PID lookup injects the name via env and matches it in PowerShell, not WQL (#531)', async () => {
  // An exe whose name contains a single quote (e.g. Dave'sApp.exe) must not break
  // the lookup. The name is passed via env (never interpolated) and matched with
  // -ieq in Where-Object, so no WQL string-literal quote escaping is involved.
  const quotedPath = "C:/Tools/Dave'sApp.exe"
  markExistingPath(quotedPath)
  processNames.add("dave'sapp.exe")
  registerProcess(quotedPath, "dave'sapp.exe", '4321')
  const { killProfileApps } = await loadProcessModulesWithStore({
    appPaths: { simhub: quotedPath }
  })

  await killProfileApps('ac', [quotedPath])

  const psCall = execFileCalls.find(
    (call) =>
      call.command === 'powershell.exe' &&
      call.args.some((arg) => arg.includes('Get-CimInstance Win32_Process'))
  )
  expect(psCall).toBeDefined()
  const script = psCall!.args[psCall!.args.length - 1] as string

  // Name comes from the environment, not interpolated into the script string.
  expect(script).toContain('$name = $env:SIMLAUNCHER_TARGET_PROCESS_NAME')
  expect((psCall!.options.env as Record<string, string>).SIMLAUNCHER_TARGET_PROCESS_NAME).toContain(
    "'"
  )
  // Name is matched in PowerShell (-ieq), not in a WQL string literal, so no
  // quote escaping is needed and the WQL Name filter is gone.
  expect(script).toContain('$_.Name -ieq $name')
  expect(script).not.toContain('-Filter')
  // The raw quoted name must never appear in the script (it travels via env).
  expect(script).not.toContain("Dave'sApp.exe")
})

test('killProfileApps only kills the PID matching the requested executable path (#341)', async () => {
  // Two distinct installs share the same image name (simhub.exe). Killing
  // the configured app path must target the PID whose ExecutablePath matches
  // that path, not just any simhub.exe process. Before the path-scoped mock
  // refactor, a regression that killed the wrong PID would have passed
  // undetected because the mock returned the same hardcoded PID either way.
  markExistingPath('C:/Tools/SimHub.exe')
  markExistingPath('D:/Other/SimHub.exe')
  processNames.add('simhub.exe')
  registerProcess('C:/Tools/SimHub.exe', 'simhub.exe', '4321')
  registerProcess('D:/Other/SimHub.exe', 'simhub.exe', '9999')
  const { killProfileApps } = await loadProcessModulesWithStore({
    appPaths: { simhub: 'C:/Tools/SimHub.exe', other: 'D:/Other/SimHub.exe' }
  })

  await expect(killProfileApps('ac', ['C:/Tools/SimHub.exe'])).resolves.toMatchObject({
    success: true,
    closedCount: 1,
    failedCount: 0
  })

  expect(execFileCalls).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        command: 'taskkill',
        args: ['/PID', '4321', '/T', '/F']
      })
    ])
  )
  expect(execFileCalls).not.toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        command: 'taskkill',
        args: ['/PID', '9999', '/T', '/F']
      })
    ])
  )
})

test('killProfileApps excludes processes with null executable paths when resolving PIDs', async () => {
  markExistingPath('C:/Tools/SimHub.exe')
  processNames.add('simhub.exe')
  nullExecutablePathPids.add('9876')
  registerProcess('C:/Tools/SimHub.exe', 'simhub.exe', '4321')
  const { killProfileApps } = await loadProcessModulesWithStore({
    appPaths: { simhub: 'C:/Tools/SimHub.exe' }
  })

  await expect(killProfileApps('ac', ['C:/Tools/SimHub.exe'])).resolves.toMatchObject({
    success: true,
    closedCount: 1,
    failedCount: 0
  })

  expect(execFileCalls).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        command: 'powershell.exe',
        args: expect.arrayContaining([expect.stringContaining('$_.ExecutablePath -and')])
      }),
      expect.objectContaining({
        command: 'taskkill',
        args: ['/PID', '4321', '/T', '/F']
      })
    ])
  )
  expect(execFileCalls).not.toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        command: 'taskkill',
        args: ['/PID', '9876', '/T', '/F']
      })
    ])
  )
})

test('killProfileApps publishes promptly when untracked app remains elevated after kill failure', async () => {
  const webContents = createMockWebContents()

  markExistingPath('C:/Games/AssettoCorsa.exe')
  markExistingPath('C:/Tools/SimHub.exe')
  processNames.add('assettocorsa.exe')
  processNames.add('simhub.exe')
  accessDeniedPids.add('4321')
  registerProcess('C:/Tools/SimHub.exe', 'simhub.exe', '4321')
  const { killProfileApps, subscribeRunningApps } = await loadProcessModulesWithStore({
    profiles: {
      ac: { activeProfileId: 'default', profiles: [{ id: 'default', name: 'Default' }] }
    },
    gamePaths: { ac: 'C:/Games/AssettoCorsa.exe' },
    appPaths: { simhub: 'C:/Tools/SimHub.exe' }
  })

  await subscribeRunningApps(asWebContents(webContents))
  webContents.send.mockClear()

  await expect(killProfileApps('ac', ['C:/Tools/SimHub.exe'])).resolves.toMatchObject({
    success: false,
    closedCount: 0,
    failedCount: 1,
    failures: [expect.objectContaining({ appPath: 'C:/Tools/SimHub.exe', reason: 'access_denied' })]
  })

  expect(webContents.send).toHaveBeenCalledWith(
    'running-apps-changed',
    expect.objectContaining({
      reason: 'kill',
      apps: expect.arrayContaining([
        expect.objectContaining({
          path: 'C:/Tools/SimHub.exe',
          gameKey: 'ac',
          tracked: true,
          elevated: true
        })
      ])
    })
  )
})

test('killLaunchedApps keeps elevated access-denied app unclosed when path recheck is inconclusive', async () => {
  const { killLaunchedApps, getRunningApps, runningProcesses, unclosedProcesses } =
    await loadProcessModules()

  storeData.profiles = {
    ac: { activeProfileId: 'default', profiles: [{ id: 'default', name: 'Default' }] }
  }
  storeData.appPaths = { simhub: 'C:/Tools/SimHub.exe' }
  markExistingPath('C:/Tools/SimHub.exe')
  processNames.add('simhub.exe')
  accessDeniedPids.add('1234')
  inaccessibleExecutablePathProcesses.add('simhub.exe')
  runningProcesses.set('c:\\tools\\simhub.exe', {
    process: { pid: 1234 } as never,
    path: 'C:/Tools/SimHub.exe',
    name: 'SimHub.exe',
    gameKey: 'ac',
    isGame: false
  })

  await expect(killLaunchedApps('ac')).resolves.toMatchObject({
    success: false,
    closedCount: 0,
    failedCount: 1,
    failures: [expect.objectContaining({ appPath: 'C:/Tools/SimHub.exe', reason: 'access_denied' })]
  })

  expect(unclosedProcesses.get('ac:c:\\tools\\simhub.exe')).toMatchObject({
    path: 'C:/Tools/SimHub.exe',
    gameKey: 'ac',
    reason: 'access_denied',
    elevated: true,
    error: expect.stringContaining('Access is denied')
  })
  await expect(getRunningApps()).resolves.toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        path: 'C:/Tools/SimHub.exe',
        gameKey: 'ac',
        tracked: true,
        elevated: true,
        warning: expect.stringContaining('Access is denied')
      })
    ])
  )
})

// #638: a kill failure must be written to main-error.log, not just
// console.error, so "Open logs folder" has something for it.
test('killLaunchedApps writes an access-denied kill failure to the on-disk log', async () => {
  const { killLaunchedApps, runningProcesses } = await loadProcessModules()

  storeData.profiles = {
    ac: { activeProfileId: 'default', profiles: [{ id: 'default', name: 'Default' }] }
  }
  storeData.appPaths = { simhub: 'C:/Tools/SimHub.exe' }
  markExistingPath('C:/Tools/SimHub.exe')
  processNames.add('simhub.exe')
  accessDeniedPids.add('1234')
  inaccessibleExecutablePathProcesses.add('simhub.exe')
  runningProcesses.set('c:\\tools\\simhub.exe', {
    process: { pid: 1234 } as never,
    path: 'C:/Tools/SimHub.exe',
    name: 'SimHub.exe',
    gameKey: 'ac',
    isGame: false
  })

  await killLaunchedApps('ac')

  expect(appErrorLogFsMock.appendFileSync).toHaveBeenCalledWith(
    expect.stringContaining('main-error.log'),
    expect.stringContaining('kill')
  )
  const [, loggedLine] = appErrorLogFsMock.appendFileSync.mock.calls[0]
  expect(loggedLine).toContain('C:/Tools/SimHub.exe')
  expect(loggedLine).toContain('Access is denied')
})

test('killLaunchedApps marks not-found full-path app as elevated when image still exists', async () => {
  const { killLaunchedApps, runningProcesses, unclosedProcesses } =
    await loadProcessModulesWithStore({
      profiles: {
        ac: { activeProfileId: 'default', profiles: [{ id: 'default', name: 'Default' }] }
      },
      appPaths: { simhub: 'C:/Tools/SimHub.exe' }
    })

  markExistingPath('C:/Tools/SimHub.exe')
  processNames.add('simhub.exe')
  processExistsNames.add('simhub.exe')
  inaccessibleExecutablePathProcesses.add('simhub.exe')

  await expect(killLaunchedApps('ac')).resolves.toMatchObject({
    success: false,
    closedCount: 0,
    failedCount: 1,
    failures: [expect.objectContaining({ appPath: 'C:/Tools/SimHub.exe', reason: 'access_denied' })]
  })

  expect(unclosedProcesses.get('ac:c:\\tools\\simhub.exe')).toMatchObject({
    path: 'C:/Tools/SimHub.exe',
    reason: 'access_denied',
    elevated: true
  })
  expect(runningProcesses.has('c:\\tools\\simhub.exe')).toBe(false)
})

test('killLaunchedApps treats not-found full-path app as closed when image no longer exists', async () => {
  const { killLaunchedApps, unclosedProcesses } = await loadProcessModulesWithStore({
    profiles: {
      ac: { activeProfileId: 'default', profiles: [{ id: 'default', name: 'Default' }] }
    },
    appPaths: { simhub: 'C:/Tools/SimHub.exe' }
  })

  // The image is briefly visible to tasklist when the kill is dispatched but
  // disappears by the time the post-kill recheck runs - this is the "process
  // exited cleanly between the initial scan and the recheck" case where the
  // path-keyed WMI lookup correctly reports 0 PIDs both times.
  markExistingPath('C:/Tools/SimHub.exe')
  processNames.add('simhub.exe')
  inaccessibleExecutablePathProcesses.add('simhub.exe')
  processNamesGoneAfterWmiLookup.add('simhub.exe')

  await expect(killLaunchedApps('ac')).resolves.toMatchObject({
    success: true,
    closedCount: 1,
    failedCount: 0,
    failures: []
  })

  expect(unclosedProcesses.has('ac:c:\\tools\\simhub.exe')).toBe(false)
})

test('killLaunchedApps treats stale taskkill PID responses as closed', async () => {
  const { killLaunchedApps, unclosedProcesses } = await loadProcessModulesWithStore({
    profiles: {
      ac: { activeProfileId: 'default', profiles: [{ id: 'default', name: 'Default' }] }
    },
    appPaths: { simhub: 'C:/Tools/SimHub.exe' }
  })

  // Register a process so the initial WMI lookup returns PID 4321 and
  // killProcessByImageName issues a real taskkill /PID. The taskkill returns
  // the "no running instance" error indicating the PID was stale, and the
  // post-kill recheck must find no surviving PIDs to treat this as closed.
  markExistingPath('C:/Tools/SimHub.exe')
  processNames.add('simhub.exe')
  registerProcess('C:/Tools/SimHub.exe', 'simhub.exe', '4321')
  staleTaskkillPids.add('4321')
  processNamesGoneAfterWmiLookup.add('simhub.exe')

  const result = await killLaunchedApps('ac')

  expect(result).toMatchObject({
    success: true,
    closedCount: 1,
    failedCount: 0,
    failures: []
  })
  expect(result.error).toBeUndefined()
  expect(unclosedProcesses.has('ac:c:\\tools\\simhub.exe')).toBe(false)
  expect(execFileCalls).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ command: 'taskkill', args: ['/PID', '4321', '/T', '/F'] })
    ])
  )
})

test('killLaunchedApps keeps stale taskkill attempts failed when a replacement process is live', async () => {
  const { killLaunchedApps, unclosedProcesses } = await loadProcessModulesWithStore({
    profiles: {
      ac: { activeProfileId: 'default', profiles: [{ id: 'default', name: 'Default' }] }
    },
    appPaths: { simhub: 'C:/Tools/SimHub.exe' }
  })

  markExistingPath('C:/Tools/SimHub.exe')
  processNames.add('simhub.exe')
  staleTaskkillPids.add('4321')
  registerProcess('C:/Tools/SimHub.exe', 'simhub.exe', '4321')

  const result = await killLaunchedApps('ac')

  expect(result).toMatchObject({
    success: false,
    closedCount: 0,
    failedCount: 1,
    failures: [expect.objectContaining({ appPath: 'C:/Tools/SimHub.exe', reason: 'still_running' })]
  })
  expect(unclosedProcesses.get('ac:c:\\tools\\simhub.exe')).toMatchObject({
    path: 'C:/Tools/SimHub.exe',
    reason: 'still_running'
  })
})

test('killLaunchedApps uses image-name fallback for utility companion apps', async () => {
  const { killLaunchedApps } = await loadProcessModulesWithStore({
    profiles: {
      ac: {
        activeProfileId: 'default',
        profiles: [{ id: 'default', name: 'Default', garage61: true }]
      }
    }
  })
  processNames.add('garage61 telemetry agent.exe')

  await expect(killLaunchedApps('ac')).resolves.toMatchObject({
    success: true,
    closedCount: 1,
    failedCount: 0
  })

  expect(execFileCalls).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        command: 'taskkill',
        args: ['/IM', 'garage61 telemetry agent.exe', '/T', '/F']
      })
    ])
  )
  expect(execFileCalls).not.toEqual(
    expect.arrayContaining([expect.objectContaining({ command: 'powershell.exe' })])
  )
})

test('killLaunchedApps registers elevated utility companion when image-name fallback is denied', async () => {
  const { killLaunchedApps, unclosedProcesses } = await loadProcessModulesWithStore({
    profiles: {
      ac: {
        activeProfileId: 'default',
        profiles: [{ id: 'default', name: 'Default', garage61: true }]
      }
    }
  })
  processNames.add('garage61 telemetry agent.exe')
  accessDeniedImageNames.add('garage61 telemetry agent.exe')

  await expect(killLaunchedApps('ac')).resolves.toMatchObject({
    success: false,
    closedCount: 0,
    failedCount: 1,
    failures: [
      expect.objectContaining({ appPath: 'Garage61 telemetry agent.exe', reason: 'access_denied' })
    ]
  })

  expect(unclosedProcesses.get('ac:garage61 telemetry agent.exe')).toMatchObject({
    path: 'Garage61 telemetry agent.exe',
    reason: 'access_denied',
    elevated: true
  })
})

// #772. The all-profiles close (no gameKey) walks every profile, and the
// companion target map used to be keyed by exe BASENAME, so a utility shared
// across profiles was overwritten and the last profile enumerated won. A failed
// close was then filed under a game the user had not been playing, which made
// that game surface as having leftover apps. It is the documented reason the
// tray Close Apps item was pulled before 1.0.0, and the blocker on #519.
test('an all-profiles close does not attribute a shared utility to an arbitrary game (#772)', async () => {
  const { killLaunchedApps, unclosedProcesses } = await loadProcessModulesWithStore({
    profiles: {
      ac: {
        activeProfileId: 'default',
        profiles: [{ id: 'default', name: 'Default', garage61: true }]
      },
      iracing: {
        activeProfileId: 'default',
        profiles: [{ id: 'default', name: 'Default', garage61: true }]
      }
    }
  })
  processNames.add('garage61 telemetry agent.exe')
  accessDeniedImageNames.add('garage61 telemetry agent.exe')

  // No gameKey: the tray/global close.
  const result = await killLaunchedApps()

  // The user is still told, because `failures` is built from the attempts and
  // never consults gameKey. Only the attribution is withheld.
  expect(result).toMatchObject({
    success: false,
    failedCount: 1,
    failures: [
      expect.objectContaining({ appPath: 'Garage61 telemetry agent.exe', reason: 'access_denied' })
    ]
  })

  // Neither game may claim it. Before the fix exactly one of these held, chosen
  // by store insertion order.
  expect(unclosedProcesses.has('ac:garage61 telemetry agent.exe')).toBe(false)
  expect(unclosedProcesses.has('iracing:garage61 telemetry agent.exe')).toBe(false)
  expect(unclosedProcesses.get('unknown:garage61 telemetry agent.exe')).toMatchObject({
    gameKey: '',
    reason: 'access_denied'
  })

  // One kill, not one per owning profile: the image-name kill already covers
  // every profile that enabled it.
  expect(
    execFileCalls.filter(
      (call) => call.command === 'taskkill' && call.args.includes('garage61 telemetry agent.exe')
    )
  ).toHaveLength(1)
})

test('an all-profiles close still attributes a utility only one profile enables (#772)', async () => {
  // The complement of the test above, and the reason the fix cannot simply drop
  // attribution: with a single owner there is nothing ambiguous to withhold.
  const { killLaunchedApps, unclosedProcesses } = await loadProcessModulesWithStore({
    profiles: {
      ac: {
        activeProfileId: 'default',
        profiles: [{ id: 'default', name: 'Default', garage61: true }]
      },
      iracing: {
        activeProfileId: 'default',
        profiles: [{ id: 'default', name: 'Default' }]
      }
    }
  })
  processNames.add('garage61 telemetry agent.exe')
  accessDeniedImageNames.add('garage61 telemetry agent.exe')

  await killLaunchedApps()

  expect(unclosedProcesses.get('ac:garage61 telemetry agent.exe')).toMatchObject({
    gameKey: 'ac',
    reason: 'access_denied'
  })
  expect(unclosedProcesses.has('unknown:garage61 telemetry agent.exe')).toBe(false)
})

test('a per-game close of a shared utility is unchanged (#772)', async () => {
  // Per-row Close Apps passes a gameKey, which filters the profile loop to one
  // entry, so the map could never collide and this path stayed shipped. Pinned
  // so the fix cannot regress it into the unattributed case.
  const { killLaunchedApps, unclosedProcesses } = await loadProcessModulesWithStore({
    profiles: {
      ac: {
        activeProfileId: 'default',
        profiles: [{ id: 'default', name: 'Default', garage61: true }]
      },
      iracing: {
        activeProfileId: 'default',
        profiles: [{ id: 'default', name: 'Default', garage61: true }]
      }
    }
  })
  processNames.add('garage61 telemetry agent.exe')
  accessDeniedImageNames.add('garage61 telemetry agent.exe')

  await killLaunchedApps('ac')

  expect(unclosedProcesses.get('ac:garage61 telemetry agent.exe')).toMatchObject({
    gameKey: 'ac',
    reason: 'access_denied'
  })
})

test('two profiles pointing at same-named exes in different folders close both (#772)', async () => {
  // The second half of the basename-keying defect, and a silently MISSED kill
  // rather than a misattributed one: `C:/Tools/Overlay.exe` and
  // `C:/UserApps/Overlay.exe` are two different processes, but one Map key held
  // them both, so the all-profiles close only ever closed the survivor.
  const acOverlay = 'C:/Tools/Overlay.exe'
  const iracingOverlay = 'C:/UserApps/Overlay.exe'
  markExistingPath(acOverlay)
  markExistingPath(iracingOverlay)
  processNames.add('overlay.exe')
  registerProcess(acOverlay, 'overlay.exe', '1111')
  registerProcess(iracingOverlay, 'overlay.exe', '2222')

  const { killLaunchedApps } = await loadProcessModulesWithStore({
    profiles: {
      ac: {
        activeProfileId: 'default',
        profiles: [{ id: 'default', name: 'Default', trackedProcessPaths: [acOverlay] }]
      },
      iracing: {
        activeProfileId: 'default',
        profiles: [{ id: 'default', name: 'Default', trackedProcessPaths: [iracingOverlay] }]
      }
    }
  })

  await killLaunchedApps()

  const killedPids = execFileCalls
    .filter((call) => call.command === 'taskkill' && call.args[0] === '/PID')
    .map((call) => call.args[1])
  expect(killedPids).toEqual(expect.arrayContaining(['1111', '2222']))
})

// Codex P1 on PR #818, and a hazard this PR created. Scheduling is gated on the
// tasklist, which knows image NAMES only, so once two profiles can hold two
// same-named paths both get scheduled even when only one of them is running.
// The absent one's WMI lookup returns 0 PIDs, and the image is in the tasklist
// because of the OTHER profile's instance.
test('a same-named path that is not running is not reported as a leftover (#772)', async () => {
  const acOverlay = 'C:/Tools/Overlay.exe'
  const iracingOverlay = 'C:/UserApps/Overlay.exe'
  markExistingPath(acOverlay)
  markExistingPath(iracingOverlay)
  processNames.add('overlay.exe')
  // Only ac's instance exists. iracing's path is configured but nothing runs there.
  registerProcess(acOverlay, 'overlay.exe', '1111')
  // ac's kill fails, so the image stays in the tasklist afterwards. That is what
  // used to make iracing's empty lookup look like an invisible elevated process.
  accessDeniedPids.add('1111')

  const { killLaunchedApps, unclosedProcesses } = await loadProcessModulesWithStore({
    profiles: {
      ac: {
        activeProfileId: 'default',
        profiles: [{ id: 'default', name: 'Default', trackedProcessPaths: [acOverlay] }]
      },
      iracing: {
        activeProfileId: 'default',
        profiles: [{ id: 'default', name: 'Default', trackedProcessPaths: [iracingOverlay] }]
      }
    }
  })

  const result = await killLaunchedApps()

  // ac's real instance is the only failure. iracing never had anything here, so
  // it must not be told it has an app it cannot close: that is #772's symptom,
  // a phantom leftover on a game the user was not playing.
  expect(result.failedCount).toBe(1)
  expect(unclosedProcesses.get('ac:c:\\tools\\overlay.exe')).toMatchObject({ gameKey: 'ac' })
  expect(unclosedProcesses.has('iracing:c:\\userapps\\overlay.exe')).toBe(false)
})

// CodeRabbit on PR #818, against the fix for the Codex P1 above. The sibling
// rule originally read "confirmed" as `notFound !== true`, but the lookup-error
// branch of killProcessByImageName returns neither flag, so a lookup that
// learned nothing was vouching for a sibling it never looked at. That suppressed
// a real elevated inference and dropped a genuine leftover.
test('a sibling whose lookup ERRORED does not vouch for a same-named path (#772)', async () => {
  const acOverlay = 'C:/Tools/Overlay.exe'
  const iracingOverlay = 'C:/UserApps/Overlay.exe'
  markExistingPath(acOverlay)
  markExistingPath(iracingOverlay)
  processNames.add('overlay.exe')
  // ac's lookup blows up, so it confirms nothing about anything.
  wmiLookupErrorPaths.add(normalizeRegistryKey(acOverlay))
  // iracing's finds no PIDs while the image is in the tasklist, which is exactly
  // what an elevated process with a null ExecutablePath looks like (#390).
  inaccessibleExecutablePathProcesses.add('overlay.exe')
  registerProcess(iracingOverlay, 'overlay.exe', '3333')

  const { killLaunchedApps, unclosedProcesses } = await loadProcessModulesWithStore({
    profiles: {
      ac: {
        activeProfileId: 'default',
        profiles: [{ id: 'default', name: 'Default', trackedProcessPaths: [acOverlay] }]
      },
      iracing: {
        activeProfileId: 'default',
        profiles: [{ id: 'default', name: 'Default', trackedProcessPaths: [iracingOverlay] }]
      }
    }
  })

  await killLaunchedApps()

  // The elevated inference must survive: nothing established that the image in
  // the tasklist belongs to anything other than iracing's own invisible process.
  expect(unclosedProcesses.get('iracing:c:\\userapps\\overlay.exe')).toMatchObject({
    gameKey: 'iracing',
    reason: 'access_denied',
    elevated: true
  })
})

// Codex P2 on PR #818. A bare-name /IM confirmation says only that SOME process
// with that name exists, which may be the very process the other profile tracks
// by path, so it cannot establish that the path was empty. Only a path-scoped
// sibling at a different path can.
test('a curated /IM confirmation does not vouch for a tracked path (#772)', async () => {
  const iracingOverlay = 'C:/UserApps/Garage61 telemetry agent.exe'
  markExistingPath(iracingOverlay)
  processNames.add('garage61 telemetry agent.exe')
  // ac's curated /IM is denied: something by that name exists and is protected.
  accessDeniedImageNames.add('garage61 telemetry agent.exe')
  // iracing's tracked copy looks elevated-invisible, which is the same process.
  inaccessibleExecutablePathProcesses.add('garage61 telemetry agent.exe')
  registerProcess(iracingOverlay, 'garage61 telemetry agent.exe', '4444')

  const { killLaunchedApps, unclosedProcesses } = await loadProcessModulesWithStore({
    profiles: {
      ac: {
        activeProfileId: 'default',
        profiles: [{ id: 'default', name: 'Default', garage61: true }]
      },
      iracing: {
        activeProfileId: 'default',
        profiles: [{ id: 'default', name: 'Default', trackedProcessPaths: [iracingOverlay] }]
      }
    }
  })

  await killLaunchedApps()

  // iracing must keep its leftover. Suppressing it would attribute the failure
  // to ac alone, which is the misattribution this whole PR exists to remove.
  expect(unclosedProcesses.get('iracing:c:\\userapps\\garage61 telemetry agent.exe')).toMatchObject(
    {
      gameKey: 'iracing',
      reason: 'access_denied'
    }
  )
})

// Codex P2 on PR #818. An attempt absent at lookup time but running by the
// post-kill recheck used to be both "failed" and "empty", and closedCount
// subtracts each once, so one attempt was deducted twice and the count could go
// negative once every attempt failed.
test('a same-named path that respawns before the recheck is only counted once (#772)', async () => {
  const acOverlay = 'C:/Tools/Overlay.exe'
  const iracingOverlay = 'C:/UserApps/Overlay.exe'
  markExistingPath(acOverlay)
  markExistingPath(iracingOverlay)
  processNames.add('overlay.exe')
  registerProcess(acOverlay, 'overlay.exe', '1111')
  registerProcess(iracingOverlay, 'overlay.exe', '2222')
  // ac is a real, confirmed sibling that fails to close.
  accessDeniedPids.add('1111')
  // iracing reports nothing pre-kill and is back by the recheck.
  pathsAppearingAfterKill.add(normalizeRegistryKey(iracingOverlay))

  const { killLaunchedApps } = await loadProcessModulesWithStore({
    profiles: {
      ac: {
        activeProfileId: 'default',
        profiles: [{ id: 'default', name: 'Default', trackedProcessPaths: [acOverlay] }]
      },
      iracing: {
        activeProfileId: 'default',
        profiles: [{ id: 'default', name: 'Default', trackedProcessPaths: [iracingOverlay] }]
      }
    }
  })

  const result = await killLaunchedApps()

  // Two attempts, both still running afterwards. Nothing closed, and nothing
  // deducted twice.
  expect(result.closedCount).toBe(0)
  expect(result.failedCount).toBe(2)
})

// CodeRabbit on PR #818, and the same mistake as its earlier finding one lookup
// later: findProcessIdsByExecutablePath returns zero PIDs both when nothing is
// there and when the lookup itself failed, so the count alone cannot tell those
// apart. Reading a failed POST-kill lookup as "empty" would suppress a real
// elevated leftover and subtract it from closedCount.
test('a FAILED post-kill lookup does not make a path count as empty (#772)', async () => {
  const acOverlay = 'C:/Tools/Overlay.exe'
  const iracingOverlay = 'C:/UserApps/Overlay.exe'
  markExistingPath(acOverlay)
  markExistingPath(iracingOverlay)
  processNames.add('overlay.exe')
  // ac is a genuinely confirmed sibling at a different path, and fails to close
  // so the image stays in the tasklist.
  registerProcess(acOverlay, 'overlay.exe', '1111')
  accessDeniedPids.add('1111')
  // iracing finds nothing pre-kill, then its recheck blows up.
  wmiPostKillLookupErrorPaths.add(normalizeRegistryKey(iracingOverlay))

  const { killLaunchedApps, unclosedProcesses } = await loadProcessModulesWithStore({
    profiles: {
      ac: {
        activeProfileId: 'default',
        profiles: [{ id: 'default', name: 'Default', trackedProcessPaths: [acOverlay] }]
      },
      iracing: {
        activeProfileId: 'default',
        profiles: [{ id: 'default', name: 'Default', trackedProcessPaths: [iracingOverlay] }]
      }
    }
  })

  await killLaunchedApps()

  // Nothing established that iracing's path was empty, so the elevated
  // inference stands and its leftover is reported.
  expect(unclosedProcesses.get('iracing:c:\\userapps\\overlay.exe')).toMatchObject({
    gameKey: 'iracing',
    reason: 'access_denied'
  })
})

// Codex P2 on PR #818. When one profile curated-enables a utility and another
// tracks a same-named path, both targets are deliberately kept so neither loses
// coverage. If only the tracked instance is running, the /IM kill takes it down
// and the path attempt then finds nothing, so one process was reported as two.
test('an /IM kill that covered the only instance is not counted twice (#772)', async () => {
  const iracingPath = 'C:/UserApps/Garage61 telemetry agent.exe'
  markExistingPath(iracingPath)
  processNames.add('garage61 telemetry agent.exe')
  registerProcess(iracingPath, 'garage61 telemetry agent.exe', '8888')

  const { killLaunchedApps } = await loadProcessModulesWithStore({
    profiles: {
      ac: {
        activeProfileId: 'default',
        profiles: [{ id: 'default', name: 'Default', garage61: true }]
      },
      iracing: {
        activeProfileId: 'default',
        profiles: [{ id: 'default', name: 'Default', trackedProcessPaths: [iracingPath] }]
      }
    }
  })

  const result = await killLaunchedApps()

  // Both targets are still attempted, which is the point of keeping them.
  const killCalls = execFileCalls.filter((call) => call.command === 'taskkill')
  expect(killCalls.map((call) => call.args)).toEqual(
    expect.arrayContaining([['/IM', 'garage61 telemetry agent.exe', '/T', '/F']])
  )
  // But there was only ever one process.
  expect(result.closedCount).toBe(1)
  expect(result.failedCount).toBe(0)
})

// Companion to the /IM subsumption above, and the guard that keeps it from
// swallowing the earlier P2. A successful /IM is enough to say a same-named path
// attempt CLOSED NOTHING, but not that the path was EMPTY: here the /IM took
// down what it could while an elevated instance at iracing's path survived, so
// the leftover is real and must still be reported.
test('a successful /IM does not prove a same-named path was empty (#772)', async () => {
  const iracingPath = 'C:/UserApps/Garage61 telemetry agent.exe'
  markExistingPath(iracingPath)
  processNames.add('garage61 telemetry agent.exe')
  // /IM succeeds, but the image survives because one instance is protected.
  imageNamesSurvivingImageKill.add('garage61 telemetry agent.exe')
  // That survivor is iracing's, invisible to WMI the way elevated ones are.
  inaccessibleExecutablePathProcesses.add('garage61 telemetry agent.exe')
  registerProcess(iracingPath, 'garage61 telemetry agent.exe', '6666')

  const { killLaunchedApps, unclosedProcesses } = await loadProcessModulesWithStore({
    profiles: {
      ac: {
        activeProfileId: 'default',
        profiles: [{ id: 'default', name: 'Default', garage61: true }]
      },
      iracing: {
        activeProfileId: 'default',
        profiles: [{ id: 'default', name: 'Default', trackedProcessPaths: [iracingPath] }]
      }
    }
  })

  await killLaunchedApps()

  expect(unclosedProcesses.get('iracing:c:\\userapps\\garage61 telemetry agent.exe')).toMatchObject(
    { gameKey: 'iracing', reason: 'access_denied' }
  )
})

test('a same-named path that is not running is not counted as closed (#772)', async () => {
  // The other half of the same finding. With ac's instance actually closing,
  // the image leaves the tasklist, which finalize reads as success for EVERY
  // attempt including iracing's empty one, so one app reported as two.
  const acOverlay = 'C:/Tools/Overlay.exe'
  const iracingOverlay = 'C:/UserApps/Overlay.exe'
  markExistingPath(acOverlay)
  markExistingPath(iracingOverlay)
  processNames.add('overlay.exe')
  processNamesGoneAfterKill.add('overlay.exe')
  registerProcess(acOverlay, 'overlay.exe', '1111')

  const { killLaunchedApps } = await loadProcessModulesWithStore({
    profiles: {
      ac: {
        activeProfileId: 'default',
        profiles: [{ id: 'default', name: 'Default', trackedProcessPaths: [acOverlay] }]
      },
      iracing: {
        activeProfileId: 'default',
        profiles: [{ id: 'default', name: 'Default', trackedProcessPaths: [iracingOverlay] }]
      }
    }
  })

  await expect(killLaunchedApps()).resolves.toMatchObject({
    success: true,
    closedCount: 1
  })
})

test('a curated utility with a configured path is closed once, by path (#772)', async () => {
  // Regression guard on the fix itself rather than on the original bug. The old
  // basename keying collapsed the curated-name target and the configured-path
  // target onto one Map key, so only the path-scoped kill ever ran. Keying by
  // identity separates them, and without a deliberate collapse this would issue
  // BOTH an /IM and a path-scoped kill for one app, closing it twice and
  // counting it twice.
  const garage61Path = 'C:/Tools/Garage61 telemetry agent.exe'
  markExistingPath(garage61Path)
  processNames.add('garage61 telemetry agent.exe')
  registerProcess(garage61Path, 'garage61 telemetry agent.exe', '9090')

  const { killLaunchedApps } = await loadProcessModulesWithStore({
    appPaths: { garage61: garage61Path },
    profiles: {
      ac: {
        activeProfileId: 'default',
        profiles: [{ id: 'default', name: 'Default', garage61: true }]
      }
    }
  })

  await expect(killLaunchedApps()).resolves.toMatchObject({
    success: true,
    closedCount: 1,
    failedCount: 0
  })

  const killCalls = execFileCalls.filter((call) => call.command === 'taskkill')
  expect(killCalls).toHaveLength(1)
  // Path-scoped, so it cannot take down a same-named process from elsewhere.
  expect(killCalls[0].args).toEqual(['/PID', '9090', '/T', '/F'])
})

test('a coincidental basename does not collapse another profile away (#772)', async () => {
  // Raised by both review bots on PR #818 against the collapse above. Profile
  // `ac` enables the curated utility and configures no path for it; profile
  // `iracing` happens to track a freeform path whose basename is the same.
  // Those are two configurations, not one duplicate. Collapsing on the name
  // alone deleted `ac`'s target, which left the surviving path target looking
  // uniquely owned by `iracing` -- #772 reintroduced through its own fix -- and
  // silently dropped the /IM coverage `ac` had asked for.
  const iracingPath = 'C:/Other/Garage61 telemetry agent.exe'
  markExistingPath(iracingPath)
  processNames.add('garage61 telemetry agent.exe')
  registerProcess(iracingPath, 'garage61 telemetry agent.exe', '7777')

  const { killLaunchedApps, unclosedProcesses } = await loadProcessModulesWithStore({
    profiles: {
      ac: {
        activeProfileId: 'default',
        profiles: [{ id: 'default', name: 'Default', garage61: true }]
      },
      iracing: {
        activeProfileId: 'default',
        profiles: [{ id: 'default', name: 'Default', trackedProcessPaths: [iracingPath] }]
      }
    }
  })
  // Both must fail, or whichever succeeds first takes the image out of the
  // tasklist and the other is finalized as a success with nothing to attribute.
  accessDeniedImageNames.add('garage61 telemetry agent.exe')
  accessDeniedPids.add('7777')

  await killLaunchedApps()

  // Both survive: ac's curated /IM and iracing's path-scoped kill.
  const killCalls = execFileCalls.filter((call) => call.command === 'taskkill')
  expect(killCalls.map((call) => call.args)).toEqual(
    expect.arrayContaining([
      ['/IM', 'garage61 telemetry agent.exe', '/T', '/F'],
      ['/PID', '7777', '/T', '/F']
    ])
  )

  // And each is attributed to the profile that actually configured it, since
  // each has exactly one owner. Neither may be filed under the other's game,
  // and neither may end up unattributed.
  expect(unclosedProcesses.get('ac:garage61 telemetry agent.exe')).toMatchObject({
    gameKey: 'ac'
  })
  expect(unclosedProcesses.get('iracing:c:\\other\\garage61 telemetry agent.exe')).toMatchObject({
    gameKey: 'iracing'
  })
  expect(unclosedProcesses.has('iracing:garage61 telemetry agent.exe')).toBe(false)
  expect(unclosedProcesses.has('unknown:garage61 telemetry agent.exe')).toBe(false)
})

test('a path target covering only one of two owners does not collapse the name target (#772)', async () => {
  // Found by mutation, not by review: with the collapse condition weakened from
  // `every` to `some` the whole suite stayed green, which meant nothing pinned
  // the difference. This is the case that does.
  //
  // `ac` enables the curated utility AND tracks its executable; `iracing`
  // enables the same utility with no path of its own. The path target therefore
  // covers `ac` but not `iracing`, so it is not a duplicate of the name target
  // and cannot replace it: collapsing would leave `iracing` with no coverage at
  // all, since a path-scoped kill only ever touches that one file.
  const acPath = 'C:/Tools/Garage61 telemetry agent.exe'
  markExistingPath(acPath)
  processNames.add('garage61 telemetry agent.exe')
  registerProcess(acPath, 'garage61 telemetry agent.exe', '5555')

  const { killLaunchedApps, unclosedProcesses } = await loadProcessModulesWithStore({
    profiles: {
      ac: {
        activeProfileId: 'default',
        profiles: [
          { id: 'default', name: 'Default', garage61: true, trackedProcessPaths: [acPath] }
        ]
      },
      iracing: {
        activeProfileId: 'default',
        profiles: [{ id: 'default', name: 'Default', garage61: true }]
      }
    }
  })
  accessDeniedImageNames.add('garage61 telemetry agent.exe')
  accessDeniedPids.add('5555')

  await killLaunchedApps()

  const killCalls = execFileCalls.filter((call) => call.command === 'taskkill')
  expect(killCalls.map((call) => call.args)).toEqual(
    expect.arrayContaining([
      ['/IM', 'garage61 telemetry agent.exe', '/T', '/F'],
      ['/PID', '5555', '/T', '/F']
    ])
  )

  // The name target is owned by both profiles, so it stays unattributed. The
  // path target is owned by `ac` alone, so it is attributed.
  expect(unclosedProcesses.get('unknown:garage61 telemetry agent.exe')).toMatchObject({
    gameKey: ''
  })
  expect(unclosedProcesses.get('ac:c:\\tools\\garage61 telemetry agent.exe')).toMatchObject({
    gameKey: 'ac'
  })
})

test('pruneUnclosedProcesses removes stale entries and keeps running entries', async () => {
  const { pruneUnclosedProcesses, unclosedProcesses } = await loadProcessModules()
  unclosedProcesses.set('ac:c:\\tools\\stale.exe', {
    path: 'C:/Tools/Stale.exe',
    name: 'Stale.exe',
    gameKey: 'ac',
    error: 'still running',
    reason: 'still_running',
    elevated: false
  })
  unclosedProcesses.set('ac:c:\\tools\\simhub.exe', {
    path: 'C:/Tools/SimHub.exe',
    name: 'SimHub.exe',
    gameKey: 'ac',
    error: 'access denied',
    reason: 'access_denied',
    elevated: true
  })

  pruneUnclosedProcesses(new Set(['simhub.exe']))

  expect(unclosedProcesses.has('ac:c:\\tools\\stale.exe')).toBe(false)
  expect(unclosedProcesses.get('ac:c:\\tools\\simhub.exe')).toMatchObject({
    path: 'C:/Tools/SimHub.exe',
    elevated: true
  })
})

test('killProfileApps skips game executable paths without issuing kill commands', async () => {
  markExistingPath('C:/Games/AssettoCorsa.exe')
  const { killProfileApps } = await loadProcessModulesWithStore({
    gamePaths: { ac: 'C:/Games/AssettoCorsa.exe' },
    appPaths: { acgame: 'C:/Games/AssettoCorsa.exe' }
  })
  processNames.add('assettocorsa.exe')

  await expect(killProfileApps('ac', ['C:/Games/AssettoCorsa.exe'])).resolves.toMatchObject({
    success: true,
    closedCount: 0,
    failedCount: 0
  })
  expect(execFileCalls).not.toEqual(
    expect.arrayContaining([
      expect.objectContaining({ command: 'taskkill' }),
      expect.objectContaining({ command: 'powershell.exe' })
    ])
  )
})

test('killProfileApps clears previous unclosed and running state after successful kill', async () => {
  markExistingPath('C:/Tools/SimHub.exe')
  processNames.add('simhub.exe')
  registerProcess('C:/Tools/SimHub.exe', 'simhub.exe', '1234')
  const { killProfileApps, runningProcesses, unclosedProcesses } =
    await loadProcessModulesWithStore({
      appPaths: { simhub: 'C:/Tools/SimHub.exe' }
    })
  runningProcesses.set('c:\\tools\\simhub.exe', {
    process: { pid: 1234 } as never,
    path: 'C:/Tools/SimHub.exe',
    name: 'SimHub.exe',
    gameKey: 'ac',
    isGame: false
  })
  unclosedProcesses.set('ac:c:\\tools\\simhub.exe', {
    path: 'C:/Tools/SimHub.exe',
    name: 'SimHub.exe',
    gameKey: 'ac',
    error: 'access denied',
    reason: 'access_denied',
    elevated: true
  })

  await expect(killProfileApps('ac', ['C:/Tools/SimHub.exe'])).resolves.toMatchObject({
    success: true,
    closedCount: 1,
    failedCount: 0
  })

  expect(execFileCalls).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ command: 'taskkill', args: ['/PID', '1234', '/T', '/F'] })
    ])
  )
  expect(unclosedProcesses.has('ac:c:\\tools\\simhub.exe')).toBe(false)
  expect(runningProcesses.has('c:\\tools\\simhub.exe')).toBe(false)
})

test('killProfileApps suppresses wrapper warnings for SimLauncher-initiated profile switch closes', async () => {
  const childHandlers = new Map<string, (...args: unknown[]) => void>()
  const child = {
    pid: 1234,
    once: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      childHandlers.set(event, handler)
      return child
    }),
    unref: vi.fn(),
    kill: vi.fn()
  }

  markExistingPath('C:/Tools/Cheat Engine.exe')
  processNames.add('cheat engine.exe')
  const { getRunningApps, killProfileApps, launchProfileApps, processNameMismatchWarnings } =
    await loadProcessModulesWithStore({
      profiles: {
        ac: { activeProfileId: 'default', profiles: [{ id: 'default', name: 'Default' }] }
      },
      appPaths: { customapp1: 'C:/Tools/Cheat Engine.exe' }
    })
  vi.mocked(await import('child_process')).spawn.mockReturnValueOnce(child as never)

  const launchPromise = launchProfileApps(sender, 'ac', ['C:/Tools/Cheat Engine.exe'])
  childHandlers.get('spawn')?.()
  await launchPromise

  const killPromise = killProfileApps('ac', ['C:/Tools/Cheat Engine.exe'])
  processNames.delete('cheat engine.exe')
  childHandlers.get('exit')?.()

  await expect(killPromise).resolves.toMatchObject({ success: true, failedCount: 0 })
  expect(processNameMismatchWarnings.size).toBe(0)
  await expect(getRunningApps()).resolves.not.toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        path: 'C:/Tools/Cheat Engine.exe',
        warning: expect.any(String)
      })
    ])
  )
})

test('killLaunchedApps uses plural message for multiple successful companion kills', async () => {
  const { killLaunchedApps } = await loadProcessModulesWithStore({
    profiles: {
      ac: { activeProfileId: 'default', profiles: [{ id: 'default', name: 'Default' }] }
    },
    appPaths: { simhub: 'C:/Tools/SimHub.exe', overlay: 'C:/Tools/Overlay.exe' }
  })
  markExistingPath('C:/Tools/SimHub.exe')
  markExistingPath('C:/Tools/Overlay.exe')
  processNames.add('simhub.exe')
  processNames.add('overlay.exe')
  registerProcess('C:/Tools/SimHub.exe', 'simhub.exe', '4321')
  registerProcess('C:/Tools/Overlay.exe', 'overlay.exe', '5678')

  await expect(killLaunchedApps('ac')).resolves.toMatchObject({
    success: true,
    message: 'Closed 2 companion apps.',
    closedCount: 2,
    failedCount: 0
  })
})

test('subscribeRunningApps returns initial snapshot and tracks subscriber', async () => {
  const { subscribeRunningApps } = await loadProcessModules()
  const webContents = createMockWebContents()

  const snapshot = await subscribeRunningApps(asWebContents(webContents))
  expect(snapshot.reason).toBe('initial')
  expect(snapshot.apps).toEqual([])
  expect(webContents.once).toHaveBeenCalledWith('destroyed', expect.any(Function))
})

test('publishRunningApps emits changed event to subscribers when state changes', async () => {
  const webContents = createMockWebContents()

  markExistingPath('C:/Games/AssettoCorsa.exe')
  const { subscribeRunningApps, publishRunningApps } = await loadProcessModulesWithStore({
    profiles: {
      ac: { activeProfileId: 'default', profiles: [{ id: 'default', name: 'Default' }] }
    },
    gamePaths: { ac: 'C:/Games/AssettoCorsa.exe' }
  })
  await subscribeRunningApps(asWebContents(webContents))

  // Change state: add a process
  processNames.add('assettocorsa.exe')

  await publishRunningApps('scan')

  expect(webContents.send).toHaveBeenCalledWith(
    'running-apps-changed',
    expect.objectContaining({
      reason: 'scan',
      apps: expect.arrayContaining([
        expect.objectContaining({ name: 'AssettoCorsa.exe', gameKey: 'ac', tracked: true })
      ])
    })
  )
})

test('publishRunningApps deduplicates emissions if snapshot is identical', async () => {
  const { subscribeRunningApps, publishRunningApps } = await loadProcessModules()
  const webContents = createMockWebContents()

  await subscribeRunningApps(asWebContents(webContents))
  webContents.send.mockClear()

  // No state change
  await publishRunningApps('scan')

  expect(webContents.send).not.toHaveBeenCalled()
})

test('concurrent launchProfileApps rejects with the active-launch message (#342)', async () => {
  const childHandlers = new Map<string, (...args: unknown[]) => void>()
  const child = {
    pid: 1234,
    once: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      childHandlers.set(event, handler)
      return child
    }),
    unref: vi.fn(),
    kill: vi.fn()
  }

  markExistingPath('C:/Tools/SimHub.exe')
  const { launchProfileApps } = await loadProcessModules()
  vi.mocked(await import('child_process')).spawn.mockReturnValueOnce(child as never)

  // Start the first launch but do NOT fire 'spawn' yet so the launch sits in
  // its `activeLaunches.add(gameKey)` window. The second concurrent call must
  // be rejected with the active-launch message instead of beginning its own
  // launch pipeline.
  const firstLaunch = launchProfileApps(sender, 'ac', ['C:/Tools/SimHub.exe'])
  const secondResult = await launchProfileApps(sender, 'iracing', ['C:/Tools/SimHub.exe'])

  expect(secondResult).toEqual({
    success: false,
    error: 'Another profile is already launching.'
  })

  // Release the first launch so the test does not leak the active-launch flag.
  childHandlers.get('spawn')?.()
  await firstLaunch
})

// #716 review finding (inverse window): a plain launch-profile call landing
// while a relaunch/switch IPC handler is still in its pre-launch async window
// (its controller registered via registerActiveLaunch, but launchProfileApps
// not yet entered — so activeLaunches is still EMPTY) used to pass the
// activeLaunches gate and SELF-REGISTER for the same gameKey, evicting the
// handler's controller from the registry. Close Apps then aborted only the
// newer controller and the handler's sequence still proceeded. The gate must
// also count pre-registered controllers.
test('launchProfileApps is rejected while a foreign launch controller is pre-registered (#716)', async () => {
  markExistingPath('C:/Tools/SimHub.exe')
  const { launchProfileApps, registerActiveLaunch, unregisterActiveLaunch, abortActiveLaunches } =
    await loadProcessModules()

  // Models an IPC handler mid pre-launch window for the same game.
  const preRegistered = registerActiveLaunch('ac')

  try {
    await expect(launchProfileApps(sender, 'ac', ['C:/Tools/SimHub.exe'])).resolves.toEqual({
      success: false,
      error: 'Another profile is already launching.'
    })

    // Nothing spawned, and the handler's controller was NOT evicted — a
    // Close Apps click still reaches it.
    expect(spawnCalls).toHaveLength(0)
    abortActiveLaunches('ac')
    expect(preRegistered.signal.aborted).toBe(true)
  } finally {
    unregisterActiveLaunch('ac', preRegistered)
  }
})

// Positive control for the gate above: the controller threaded through
// options IS the pre-registered one, so it must not block its own launch —
// otherwise the relaunch/switch handlers could never launch at all.
test('launchProfileApps with its own pre-registered controller via options is not self-blocked (#716)', async () => {
  markExistingPath('C:/Tools/SimHub.exe')
  const { launchProfileApps, registerActiveLaunch } = await loadProcessModules()

  const controller = registerActiveLaunch('ac')

  await expect(
    launchProfileApps(sender, 'ac', ['C:/Tools/SimHub.exe'], { controller })
  ).resolves.toMatchObject({
    success: true,
    launchedCount: 1
  })
})

test('rapid re-launch within the cooldown window returns the settling message (#342)', async () => {
  const dateNow = vi.spyOn(Date, 'now')

  dateNow.mockReturnValue(10_000)
  markExistingPath('C:/Tools/SimHub.exe')
  const { launchProfileApps } = await loadProcessModules()

  // First launch succeeds; this sets launchBlockedUntil to now + 10000.
  await expect(launchProfileApps(sender, 'ac', ['C:/Tools/SimHub.exe'])).resolves.toMatchObject({
    success: true,
    launchedCount: 1
  })

  // Advance only 2 seconds - still inside the post-launch cooldown.
  dateNow.mockReturnValue(12_000)
  markExistingPath('C:/Tools/Overlay.exe')
  await expect(launchProfileApps(sender, 'ac', ['C:/Tools/Overlay.exe'])).resolves.toMatchObject({
    success: false,
    error: expect.stringMatching(/Launch is settling\. Try again in 8s\./)
  })

  dateNow.mockRestore()
})

test('launchBlockedUntil is not set when no apps were actually launched (#342)', async () => {
  const dateNow = vi.spyOn(Date, 'now')

  dateNow.mockReturnValue(50_000)
  markExistingPath('C:/Tools/SimHub.exe')
  processNames.add('simhub.exe')
  const { launchProfileApps } = await loadProcessModules()

  // SimHub is already running so launchProfileApps short-circuits with
  // skippedCount=1, launchedCount=0 and never enters the launch loop.
  await expect(launchProfileApps(sender, 'ac', ['C:/Tools/SimHub.exe'])).resolves.toMatchObject({
    success: true,
    launchedCount: 0,
    skippedCount: 1
  })

  // No cooldown should be active. If launchBlockedUntil had been set, the
  // next call would be rejected with the settling message; instead it
  // proceeds and reports "already running".
  dateNow.mockReturnValue(50_100)
  await expect(launchProfileApps(sender, 'ac', ['C:/Tools/SimHub.exe'])).resolves.toMatchObject({
    success: true,
    launchedCount: 0,
    skippedCount: 1
  })

  dateNow.mockRestore()
})

// #670: a kill mid-sequence used to only stop what was already running — the
// launch loop kept going and spawned the remaining profile apps regardless,
// ending in a success toast for apps the user had just asked to close.
test('killLaunchedApps mid-sequence cancels the launch loop before remaining apps spawn (#670)', async () => {
  markExistingPath('C:/Tools/App1.exe')
  markExistingPath('C:/Tools/App2.exe')
  markExistingPath('C:/Tools/App3.exe')
  storeData.launchDelayMs = 5000
  const { launchProfileApps, killLaunchedApps } = await loadProcessModules()

  const launchPromise = launchProfileApps(sender, 'ac', [
    'C:/Tools/App1.exe',
    'C:/Tools/App2.exe',
    'C:/Tools/App3.exe'
  ])

  // Let App1 spawn and the loop reach its (real, 5s) inter-app delay before
  // the kill lands, proving the abort interrupts THIS wait rather than
  // merely preventing a future one.
  await flushMicrotasks()

  const killResult = await killLaunchedApps('ac')
  const launchResult = await launchPromise

  expect(spawnCalls.map((call) => call.appPath)).toEqual(['C:/Tools/App1.exe'])
  expect(launchResult).toMatchObject({
    success: false,
    cancelled: true,
    launchedCount: 1
  })
  expect(killResult.success).toBe(true)
  expect(killResult.closedCount).toBe(1)
})

test('killProfileApps mid-sequence also cancels the launch loop before remaining apps spawn (#670)', async () => {
  markExistingPath('C:/Tools/App1.exe')
  markExistingPath('C:/Tools/App2.exe')
  storeData.launchDelayMs = 5000
  const { launchProfileApps, killProfileApps } = await loadProcessModulesWithStore({
    appPaths: { customapp1: 'C:/Tools/App1.exe', customapp2: 'C:/Tools/App2.exe' }
  })

  const launchPromise = launchProfileApps(sender, 'ac', ['C:/Tools/App1.exe', 'C:/Tools/App2.exe'])
  await flushMicrotasks()

  await killProfileApps('ac', ['C:/Tools/App1.exe'])
  const launchResult = await launchPromise

  expect(spawnCalls.map((call) => call.appPath)).toEqual(['C:/Tools/App1.exe'])
  expect(launchResult).toMatchObject({ success: false, cancelled: true, launchedCount: 1 })
})

test('two concurrent Close Apps clicks during the same sequence do not throw (idempotent abort, #670)', async () => {
  markExistingPath('C:/Tools/App1.exe')
  markExistingPath('C:/Tools/App2.exe')
  storeData.launchDelayMs = 5000
  const { launchProfileApps, killLaunchedApps } = await loadProcessModules()

  const launchPromise = launchProfileApps(sender, 'ac', ['C:/Tools/App1.exe', 'C:/Tools/App2.exe'])
  await flushMicrotasks()

  const [firstKill, secondKill] = await Promise.all([
    killLaunchedApps('ac'),
    killLaunchedApps('ac')
  ])
  const launchResult = await launchPromise

  expect(firstKill.success).toBe(true)
  expect(secondKill.success).toBe(true)
  expect(launchResult).toMatchObject({ success: false, cancelled: true, launchedCount: 1 })
  // App2 must never have spawned, regardless of the double kill.
  expect(spawnCalls.map((call) => call.appPath)).toEqual(['C:/Tools/App1.exe'])
})

test('Close Apps clicked again after the sequence already ended is a clean no-op (#670)', async () => {
  markExistingPath('C:/Tools/App1.exe')
  markExistingPath('C:/Tools/App2.exe')
  storeData.launchDelayMs = 5000
  const { launchProfileApps, killLaunchedApps } = await loadProcessModules()

  const launchPromise = launchProfileApps(sender, 'ac', ['C:/Tools/App1.exe', 'C:/Tools/App2.exe'])
  await flushMicrotasks()

  await expect(killLaunchedApps('ac')).resolves.toMatchObject({ success: true, closedCount: 1 })
  await expect(launchPromise).resolves.toMatchObject({ cancelled: true })

  // The in-flight sequence's controller was already unregistered when it
  // ended above — this must find nothing to abort and resolve cleanly, not
  // throw (#670).
  await expect(killLaunchedApps('ac')).resolves.toMatchObject({ success: true, closedCount: 0 })
})

test('a fresh launch for the same gameKey after a cancelled one proceeds normally (#670)', async () => {
  const dateNow = vi.spyOn(Date, 'now')
  dateNow.mockReturnValue(0)

  markExistingPath('C:/Tools/App1.exe')
  markExistingPath('C:/Tools/App2.exe')
  markExistingPath('C:/Tools/App3.exe')
  storeData.launchDelayMs = 5000
  const { launchProfileApps, killLaunchedApps } = await loadProcessModules()

  const firstLaunch = launchProfileApps(sender, 'ac', ['C:/Tools/App1.exe', 'C:/Tools/App2.exe'])
  await flushMicrotasks()
  await killLaunchedApps('ac')
  await expect(firstLaunch).resolves.toMatchObject({ cancelled: true, launchedCount: 1 })

  // Past the post-launch cooldown (#342), with a fresh controller for the
  // same gameKey — must launch normally, not inherit the previous
  // cancellation's aborted signal (#670).
  dateNow.mockReturnValue(20_000)
  storeData.launchDelayMs = 0
  const secondResult = await launchProfileApps(sender, 'ac', ['C:/Tools/App3.exe'])

  expect(secondResult.success).toBe(true)
  expect(secondResult.launchedCount).toBe(1)
  expect(secondResult.cancelled).toBeUndefined()
  expect(spawnCalls.map((call) => call.appPath)).toEqual(['C:/Tools/App1.exe', 'C:/Tools/App3.exe'])

  dateNow.mockRestore()
})

// killProfileApps must signal the in-flight launch BEFORE its own tasklist
// scan — that await can be slow, and a launch loop sitting in a short
// inter-app wait would otherwise spawn its next app past the kill's snapshot
// (#670 Codex P2). The blocked tasklist read below models the slow scan: the
// launch must still resolve cancelled while the kill is stuck in it.
test('killProfileApps aborts the launch before waiting on its tasklist scan (#670)', async () => {
  markExistingPath('C:/Tools/App1.exe')
  markExistingPath('C:/Tools/App2.exe')
  storeData.launchDelayMs = 5000
  const { launchProfileApps, killProfileApps } = await loadProcessModulesWithStore({
    appPaths: { customapp1: 'C:/Tools/App1.exe', customapp2: 'C:/Tools/App2.exe' }
  })

  const launchPromise = launchProfileApps(sender, 'ac', ['C:/Tools/App1.exe', 'C:/Tools/App2.exe'])
  await flushMicrotasks()

  // Arm AFTER the launch's own scan: only the kill's entry scan is delayed.
  let releaseTasklistRead: () => void = () => {}
  tasklistReadBlocker = new Promise((resolve) => (releaseTasklistRead = resolve))

  const killPromise = killProfileApps('ac', ['C:/Tools/App1.exe'])
  // The abort fired in killProfileApps' synchronous prefix, so the launch
  // resolves cancelled even though the kill is still stuck in its scan.
  await expect(launchPromise).resolves.toMatchObject({ cancelled: true, launchedCount: 1 })
  expect(spawnCalls.map((call) => call.appPath)).toEqual(['C:/Tools/App1.exe'])

  releaseTasklistRead()
  await killPromise
})

// The abort can land while spawnDetachedApp is still in its async pre-spawn
// probe (PE subsystem read). The kill's snapshot can't include a process that
// hasn't spawned yet — spawning after the abort would leave an app running
// that the user just closed (#670 Codex P1). The signal is re-checked right
// before spawn(), with no await in between.
test('spawnDetachedApp does not spawn when the abort landed during its pre-spawn probe (#670)', async () => {
  markExistingPath('C:/Tools/SimHub.exe')
  const { spawnDetachedApp } = await loadProcessModules()

  const controller = new AbortController()
  controller.abort()

  const result = await spawnDetachedApp(
    sender,
    'ac',
    { key: 'simhub', path: 'C:/Tools/SimHub.exe' },
    undefined,
    controller.signal
  )

  expect(result).toEqual({ status: 'cancelled', appPath: 'C:/Tools/SimHub.exe' })
  expect(spawnCalls).toEqual([])
})

// A kill landing during the pre-loop prep (the tasklist scan await) must be
// reported as cancelled by the early-return paths too — an "All profile
// applications are already running." success toast right after the user's
// Close Apps click would contradict what they just did (#670 review finding).
test('a kill landing during launch prep reports cancelled, not success (#670)', async () => {
  markExistingPath('C:/Tools/SimHub.exe')
  processNames.add('simhub.exe')
  const { launchProfileApps, killLaunchedApps } = await loadProcessModules()

  // launchProfileApps suspends on the tasklist read; the kill's abort fires
  // synchronously before that continuation runs.
  const launch = launchProfileApps(sender, 'ac', ['C:/Tools/SimHub.exe'])
  await killLaunchedApps('ac')

  await expect(launch).resolves.toMatchObject({ cancelled: true, success: false })
})

// The launch guard + abort registration are armed before any prep work (store
// read, tasklist scan, path checks). A throw during that prep must still
// release both via the finally — otherwise every future launch is permanently
// blocked behind the stale activeLaunches entry (#670 review finding).
test('a throw during launch prep releases the launch guard instead of wedging it (#670)', async () => {
  markExistingPath('C:/Tools/SimHub.exe')
  const { launchProfileApps } = await loadProcessModules()

  storeReadShouldThrow = true
  await expect(launchProfileApps(sender, 'ac', ['C:/Tools/SimHub.exe'])).rejects.toThrow(
    'store corrupted'
  )

  // The next launch must proceed normally — NOT "Another profile is already
  // launching." from a leaked guard entry.
  storeReadShouldThrow = false
  await expect(launchProfileApps(sender, 'ac', ['C:/Tools/SimHub.exe'])).resolves.toMatchObject({
    success: true,
    launchedCount: 1
  })
})

// Abort-point sweep (#670): the "nothing spawns after a kill's abort"
// invariant, exercised through the real launch sequence. Each row parks the
// launch at one suspension point, lands the abort while it is provably parked
// there, and asserts nothing further spawned.
//
// Since #715 the rows are no longer the enforcement. The invariant lives in
// spawnUnlessAborted, which re-reads the signal in the same synchronous block
// as spawn(), so a suspension point with no row of its own is covered anyway —
// which is the whole point, because the five #714 findings were all a
// suspension point nobody had thought to add a check for. What these rows still
// buy is end-to-end evidence that the primitive is actually reached through the
// launch path (remove its check and all of them fail), and that the launch
// REPORTS an abort at each point the way the user is told it does. So a new
// await does not need a row; a new user-visible cancellation path does.
// The structural half of the guarantee is in tests/main/guardedStart.test.ts.
// (The post-spawn EACCES elevation handoff is the one abortable point this
// table can't reach — it has its own test right below.)
const abortPointSweep: {
  point: string
  launchDelayMs: number
  arm: () => { release: () => void; consumed: () => boolean } | null
  spawnsBeforeAbort: number
  launchedCount: number
}[] = [
  {
    point: 'pre-loop tasklist scan',
    launchDelayMs: 0,
    arm: () => {
      let release: () => void = () => {}
      tasklistReadBlocker = new Promise((resolve) => (release = resolve))
      return { release, consumed: () => tasklistReadBlocker === null }
    },
    spawnsBeforeAbort: 0,
    launchedCount: 0
  },
  {
    point: "first app's pre-spawn console probe",
    launchDelayMs: 0,
    arm: () => {
      let release: () => void = () => {}
      consoleProbeBlocker = { atCall: 1, promise: new Promise((resolve) => (release = resolve)) }
      return { release, consumed: () => consoleProbeBlocker === null }
    },
    spawnsBeforeAbort: 0,
    launchedCount: 0
  },
  {
    point: "second app's pre-spawn console probe",
    launchDelayMs: 0,
    arm: () => {
      let release: () => void = () => {}
      consoleProbeBlocker = { atCall: 2, promise: new Promise((resolve) => (release = resolve)) }
      return { release, consumed: () => consoleProbeBlocker === null }
    },
    spawnsBeforeAbort: 1,
    launchedCount: 1
  },
  {
    point: 'inter-app delay wait',
    launchDelayMs: 5000,
    // The real (unmocked) wait() is abortable by design — the kill's abort
    // itself releases this point, so there is nothing to arm.
    arm: () => null,
    spawnsBeforeAbort: 1,
    launchedCount: 1
  }
]

test.each(abortPointSweep)(
  'no app spawns after an abort landing during the $point (#670)',
  async ({ launchDelayMs, arm, spawnsBeforeAbort, launchedCount }) => {
    markExistingPath('C:/Tools/App1.exe')
    markExistingPath('C:/Tools/App2.exe')
    storeData.launchDelayMs = launchDelayMs
    const { launchProfileApps, killLaunchedApps } = await loadProcessModules()

    const blocker = arm()
    const launchPromise = launchProfileApps(sender, 'ac', [
      'C:/Tools/App1.exe',
      'C:/Tools/App2.exe'
    ])
    await flushMicrotasks()

    // Prove the launch is parked at the swept point before aborting: the armed
    // blocker was consumed (so the point still exists in the launch path — a
    // refactor that removes it must fail here, not pass vacuously) and only
    // the spawns from BEFORE the point have landed.
    if (blocker) {
      expect(blocker.consumed()).toBe(true)
    }
    expect(spawnCalls.length).toBe(spawnsBeforeAbort)

    await killLaunchedApps('ac')
    blocker?.release()

    await expect(launchPromise).resolves.toMatchObject({
      success: false,
      cancelled: true,
      launchedCount
    })
    // The invariant under sweep: after the abort, not one more spawn.
    expect(spawnCalls.length).toBe(spawnsBeforeAbort)
  }
)

// The loop-top check is about promptness, not prevention (#715): the guarded
// start already makes it impossible for the app below to spawn. What it buys is
// that a cancelled launch does not first walk into spawnDetachedApp and pay an
// unbounded PE-subsystem probe for an app it will never start — while holding
// the process-wide launch guard that every window's Launch waits on (Codex P2
// on #828). Asserted on the probe count, because that is the cost, and because
// a check no test can distinguish from its own absence is decoration.
test('a cancelled launch does not probe the app it will never start (#715)', async () => {
  markExistingPath('C:/Tools/App1.exe')
  markExistingPath('C:/Tools/App2.exe')
  storeData.launchDelayMs = 5000
  const { launchProfileApps, killLaunchedApps } = await loadProcessModules()

  const launchPromise = launchProfileApps(sender, 'ac', ['C:/Tools/App1.exe', 'C:/Tools/App2.exe'])
  await flushMicrotasks()
  // App1 has spawned and the loop is parked on the inter-app wait, which the
  // abort below releases.
  expect(spawnCalls.length).toBe(1)
  expect(consoleProbeCallCount).toBe(1)

  await killLaunchedApps('ac')

  await expect(launchPromise).resolves.toMatchObject({ cancelled: true, launchedCount: 1 })
  expect(spawnCalls.length).toBe(1)
  // The point: App2 was never probed, not merely never spawned.
  expect(consoleProbeCallCount).toBe(1)
})

// The abort can also land AFTER spawn() was attempted: the child fails with
// EACCES (asynchronously, some time after spawn returns) and the error handler
// hands off to an elevated launch — which would pop a UAC prompt right after
// the user's Close Apps click and start an elevated app the kill's snapshot
// can never include (and that SimLauncher cannot close). The handoff must
// re-check the signal and report the attempt as cancelled instead (#670).
test('an EACCES elevation handoff arriving after the abort does not launch elevated (#670)', async () => {
  markExistingPath('C:/Tools/SimHub.exe')
  const childHandlers = new Map<string, (...args: unknown[]) => void>()
  const child = {
    pid: 1234,
    once: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      childHandlers.set(event, handler)
      return child
    }),
    unref: vi.fn(),
    kill: vi.fn()
  }
  const { spawnDetachedApp } = await loadProcessModules()
  vi.mocked(await import('child_process')).spawn.mockReturnValueOnce(child as never)

  const controller = new AbortController()
  const resultPromise = spawnDetachedApp(
    sender,
    'ac',
    { key: 'simhub', path: 'C:/Tools/SimHub.exe' },
    undefined,
    controller.signal
  )
  // Let the pre-spawn probe resolve and spawn() run — the child's handlers are
  // registered but no event has fired yet.
  await flushMicrotasks()

  // The abort lands in the window between spawn() and the error event.
  controller.abort()
  childHandlers.get('error')!(makeAccessDeniedError())

  await expect(resultPromise).resolves.toEqual({
    status: 'cancelled',
    appPath: 'C:/Tools/SimHub.exe'
  })
  // The elevated relaunch (powershell Start-Process -Verb RunAs) must never fire.
  expect(execFileCalls.filter((call) => call.command === 'powershell.exe')).toEqual([])
})

// Sets up spawnDetachedApp parked in a PENDING UAC handoff: the child fails
// with EACCES, launchElevated starts, and the powershell callback is held so
// the test controls when (and how) the handoff concludes (#670 Codex P2).
async function startPendingElevationHandoff() {
  markExistingPath('C:/Tools/SimHub.exe')
  const childHandlers = new Map<string, (...args: unknown[]) => void>()
  const child = {
    pid: 1234,
    once: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      childHandlers.set(event, handler)
      return child
    }),
    unref: vi.fn(),
    kill: vi.fn()
  }
  const { spawnDetachedApp } = await loadProcessModules()
  const childProcessModule = vi.mocked(await import('child_process'))
  childProcessModule.spawn.mockReturnValueOnce(child as never)

  let concludeHandoff: (error: Error | null) => void = () => {}
  const elevationHostKill = vi.fn()
  childProcessModule.execFile.mockImplementationOnce(((
    _command: string,
    _args: string[],
    _options: unknown,
    callback: (error: Error | null, stdout: string, stderr: string) => void
  ) => {
    concludeHandoff = (error) => callback(error, '', '')
    return { kill: elevationHostKill }
  }) as never)

  const controller = new AbortController()
  const resultPromise = spawnDetachedApp(
    sender,
    'ac',
    { key: 'simhub', path: 'C:/Tools/SimHub.exe' },
    undefined,
    controller.signal
  )
  await flushMicrotasks()
  // EACCES arrives with the signal still clean → the handoff starts and parks
  // on the held powershell callback.
  childHandlers.get('error')!(makeAccessDeniedError())
  await flushMicrotasks()

  return { resultPromise, controller, concludeHandoff, elevationHostKill }
}

// The abort can land while the UAC handoff itself is pending — the consent
// prompt sits on screen until the user answers, so this window is wide. The
// abort must kill the powershell host (best-effort stop + unblocks the launch
// sequence immediately) and the resulting execFile error must be reported as
// cancelled, not logged as a launch failure (#670 Codex P2).
test('an abort during the pending UAC handoff kills the host and reports cancelled (#670)', async () => {
  const { resultPromise, controller, concludeHandoff, elevationHostKill } =
    await startPendingElevationHandoff()

  controller.abort()
  expect(elevationHostKill).toHaveBeenCalledTimes(1)
  // The killed host surfaces as an execFile error.
  concludeHandoff(new Error('powershell host killed'))

  await expect(resultPromise).resolves.toEqual({
    status: 'cancelled',
    appPath: 'C:/Tools/SimHub.exe'
  })
  const launchLogLines = appErrorLogFsMock.appendFileSync.mock.calls.map((call) => String(call[1]))
  expect(launchLogLines.filter((line) => line.includes('administrator'))).toEqual([])
})

// If the user accepts the UAC prompt before the host kill takes effect, the
// elevated app IS running — the result must say so (status 'elevated'), not
// pretend the cancellation prevented it (#670 Codex P2).
test('a UAC handoff accepted despite the abort still reports elevated (#670)', async () => {
  const { resultPromise, controller, concludeHandoff } = await startPendingElevationHandoff()

  controller.abort()
  concludeHandoff(null)

  await expect(resultPromise).resolves.toMatchObject({
    status: 'elevated',
    appPath: 'C:/Tools/SimHub.exe'
  })
})

// Sequence-level honesty: elevated apps that completed their handoff survive
// the kill (SimLauncher cannot close them) — the cancellation toast must name
// them instead of implying everything was closed (#670 Codex P2).
test('the cancellation message names elevated apps the kill cannot close (#670)', async () => {
  markExistingPath('C:/Tools/App1.exe')
  markExistingPath('C:/Tools/App2.exe')
  storeData.launchDelayMs = 5000
  const { launchProfileApps, killLaunchedApps } = await loadProcessModules()
  // App1's spawn fails EACCES; the default execFile mock resolves the
  // powershell handoff immediately as success → status 'elevated'.
  spawnErrors.set('C:/Tools/App1.exe', makeAccessDeniedError())

  const launchPromise = launchProfileApps(sender, 'ac', ['C:/Tools/App1.exe', 'C:/Tools/App2.exe'])
  await flushMicrotasks()
  await killLaunchedApps('ac')

  await expect(launchPromise).resolves.toMatchObject({
    success: false,
    cancelled: true,
    elevatedCount: 1,
    message:
      'Launch cancelled — closed apps instead. One app started with administrator permission and cannot be closed from here.'
  })
})

test('killLaunchedApps skips entries flagged as isGame (#343)', async () => {
  markExistingPath('C:/Games/AssettoCorsa.exe')
  markExistingPath('C:/Tools/SimHub.exe')
  processNames.add('assettocorsa.exe')
  processNames.add('simhub.exe')
  registerProcess('C:/Tools/SimHub.exe', 'simhub.exe', '4321')
  registerProcess('C:/Games/AssettoCorsa.exe', 'assettocorsa.exe', '9999')
  const { killLaunchedApps, runningProcesses } = await loadProcessModulesWithStore({
    profiles: {
      ac: { activeProfileId: 'default', profiles: [{ id: 'default', name: 'Default' }] }
    },
    gamePaths: { ac: 'C:/Games/AssettoCorsa.exe' },
    appPaths: { simhub: 'C:/Tools/SimHub.exe' }
  })

  runningProcesses.set('c:\\games\\assettocorsa.exe', {
    process: { pid: 9999 } as never,
    path: 'C:/Games/AssettoCorsa.exe',
    name: 'AssettoCorsa.exe',
    gameKey: 'ac',
    isGame: true
  })
  runningProcesses.set('c:\\tools\\simhub.exe', {
    process: { pid: 4321 } as never,
    path: 'C:/Tools/SimHub.exe',
    name: 'SimHub.exe',
    gameKey: 'ac',
    isGame: false
  })

  await expect(killLaunchedApps('ac')).resolves.toMatchObject({
    success: true,
    closedCount: 1,
    failedCount: 0
  })

  // The companion app was killed via /PID 4321, the game executable's PID 9999
  // must never appear in any taskkill call (whether /PID or /IM).
  expect(execFileCalls).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ command: 'taskkill', args: ['/PID', '4321', '/T', '/F'] })
    ])
  )
  expect(execFileCalls).not.toEqual(
    expect.arrayContaining([
      expect.objectContaining({ command: 'taskkill', args: ['/PID', '9999', '/T', '/F'] })
    ])
  )
  expect(execFileCalls).not.toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        command: 'taskkill',
        args: ['/IM', 'assettocorsa.exe', '/T', '/F']
      })
    ])
  )
})

test('killLaunchedApps closing game A keeps game B same-named companion tracked (#677)', async () => {
  // End-to-end sibling of the direct finalize #677 test, through the caller and
  // its gameKey filter: two games each launched a companion named telemetry.exe
  // from different paths. Closing game A's apps must kill only A's process and
  // leave game B's still-alive companion tracked (ChildProcess handle intact) —
  // the gameKey filter keeps B a non-target, and finalize must not prune it by
  // shared basename.
  markExistingPath('C:/GameA/telemetry.exe')
  markExistingPath('C:/GameB/telemetry.exe')
  processNames.add('telemetry.exe')
  registerProcess('C:/GameA/telemetry.exe', 'telemetry.exe', '1111')
  registerProcess('C:/GameB/telemetry.exe', 'telemetry.exe', '2222')

  const { killLaunchedApps, runningProcesses } = await loadProcessModulesWithStore({
    profiles: {
      ac: { activeProfileId: 'default', profiles: [{ id: 'default', name: 'Default' }] }
    },
    gamePaths: { ac: 'C:/Games/AssettoCorsa.exe' },
    appPaths: {}
  })

  runningProcesses.set('c:\\gamea\\telemetry.exe', {
    process: { pid: 1111 } as never,
    path: 'C:/GameA/telemetry.exe',
    name: 'telemetry.exe',
    gameKey: 'ac',
    isGame: false
  })
  runningProcesses.set('c:\\gameb\\telemetry.exe', {
    process: { pid: 2222 } as never,
    path: 'C:/GameB/telemetry.exe',
    name: 'telemetry.exe',
    gameKey: 'iracing',
    isGame: false
  })

  await expect(killLaunchedApps('ac')).resolves.toMatchObject({
    success: true,
    closedCount: 1,
    failedCount: 0
  })

  // A pruned; B (different game, different path) stays tracked.
  expect(runningProcesses.has('c:\\gamea\\telemetry.exe')).toBe(false)
  expect(runningProcesses.has('c:\\gameb\\telemetry.exe')).toBe(true)
  // B's PID must never be taskkilled: the gameKey filter kept it a non-target,
  // so B is spared as a target AND not clobbered by finalize's name arm.
  expect(execFileCalls).not.toEqual(
    expect.arrayContaining([
      expect.objectContaining({ command: 'taskkill', args: ['/PID', '2222', '/T', '/F'] })
    ])
  )
})

test('killLaunchedApps should kill tracked utility processes (#350)', async () => {
  const { killLaunchedApps } = await loadProcessModulesWithStore({
    profiles: {
      ac: {
        activeProfileId: 'default',
        profiles: [{ id: 'default', name: 'Default', garage61: true }]
      }
    }
  })
  processNames.add('garage61 telemetry agent.exe')

  // The utility companion is registered under garage61 with no full path, so
  // killProcessByImageName follows the /IM fallback and the tasklist mock
  // drops the image on success.
  await expect(killLaunchedApps('ac')).resolves.toMatchObject({
    success: true,
    closedCount: 1,
    failedCount: 0
  })

  expect(execFileCalls).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        command: 'taskkill',
        args: ['/IM', 'garage61 telemetry agent.exe', '/T', '/F']
      })
    ])
  )
})

test('killLaunchedApps should skip game processes during kill (#350)', async () => {
  markExistingPath('C:/Games/AssettoCorsa.exe')
  processNames.add('assettocorsa.exe')
  const { killLaunchedApps, runningProcesses } = await loadProcessModulesWithStore({
    profiles: {
      ac: { activeProfileId: 'default', profiles: [{ id: 'default', name: 'Default' }] }
    },
    gamePaths: { ac: 'C:/Games/AssettoCorsa.exe' }
  })
  runningProcesses.set('c:\\games\\assettocorsa.exe', {
    process: { pid: 9999 } as never,
    path: 'C:/Games/AssettoCorsa.exe',
    name: 'AssettoCorsa.exe',
    gameKey: 'ac',
    isGame: true
  })

  // The only running process is the game itself - because it's flagged
  // isGame: true, killLaunchedApps must produce a no-op result with no
  // taskkill calls and no game-exe /IM fallback.
  await expect(killLaunchedApps('ac')).resolves.toMatchObject({
    success: true,
    closedCount: 0,
    failedCount: 0
  })
  expect(execFileCalls).not.toEqual(
    expect.arrayContaining([
      expect.objectContaining({ command: 'taskkill', args: expect.arrayContaining(['/PID']) })
    ])
  )
  expect(execFileCalls).not.toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        command: 'taskkill',
        args: expect.arrayContaining(['/IM', 'assettocorsa.exe'])
      })
    ])
  )
})

test('launchProfileApps skips a tracked wrapper child on subsequent launch (#314, #345)', async () => {
  const dateNow = vi.spyOn(Date, 'now')
  const childHandlers = new Map<string, (...args: unknown[]) => void>()
  const child = {
    pid: 1234,
    once: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      childHandlers.set(event, handler)
      return child
    }),
    unref: vi.fn(),
    kill: vi.fn()
  }

  dateNow.mockReturnValue(1000)
  markExistingPath('C:/Program Files/Cheat Engine/Cheat Engine.exe')
  markExistingPath('C:/Program Files/Cheat Engine/cheatengine-x86_64-sse4-avx2.exe')
  const { launchProfileApps } = await loadProcessModulesWithStore({
    profiles: {
      ac: {
        activeProfileId: 'default',
        profiles: [
          {
            id: 'default',
            name: 'Default',
            trackedProcessPaths: ['C:/Program Files/Cheat Engine/cheatengine-x86_64-sse4-avx2.exe']
          }
        ]
      }
    },
    appPaths: { customapp1: 'C:/Program Files/Cheat Engine/Cheat Engine.exe' }
  })
  vi.mocked(await import('child_process')).spawn.mockReturnValueOnce(child as never)

  // First launch: the wrapper exits but spawns the tracked child process
  // configured under `trackedProcessPaths`. This is the #314 Cheat Engine
  // scenario: the configured exe name disappears from tasklist while a
  // differently-named child remains alive.
  const firstLaunch = launchProfileApps(sender, 'ac', [
    'C:/Program Files/Cheat Engine/Cheat Engine.exe'
  ])
  childHandlers.get('spawn')?.()
  await firstLaunch
  processNames.delete('cheat engine.exe')
  processNames.add('cheatengine-x86_64-sse4-avx2.exe')
  childHandlers.get('exit')?.()

  // Advance past the 10s post-launch cooldown window before the second call.
  dateNow.mockReturnValue(20_000)

  // Regression for #314: the tracked child path must be skipped by
  // `isRunningExePath` because its image name IS in processNames. The
  // wrapper exe's image name is gone from tasklist, so production may still
  // attempt to relaunch it; this test asserts the contract that matters -
  // the tracked child is NOT relaunched.
  const spawnCallCountBefore = spawnCalls.length
  const secondResult = await launchProfileApps(sender, 'ac', [
    'C:/Program Files/Cheat Engine/cheatengine-x86_64-sse4-avx2.exe'
  ])
  expect(secondResult).toMatchObject({
    success: true,
    launchedCount: 0,
    skippedCount: 1,
    message: 'All profile applications are already running.'
  })
  expect(spawnCalls.length).toBe(spawnCallCountBefore)

  dateNow.mockRestore()
})

test('finalize keeps stale-only attempts closed when image is gone (staleTask predicate, #326, #345)', async () => {
  // Isolates the `staleTask !== true` predicate at kill.ts:362. The other
  // two predicates of isElevatedInconclusive must stay TRUE so the staleTask
  // check is the only thing keeping it false:
  //   1. attempt.notFound === true                       <- stale taskkill error
  //   2. attempt.staleTask !== true                      <- THE PREDICATE under test
  //   3. processNamesAfterKill.has(attempt.processName)  <- image must still be in tasklist
  //
  // We use `processNamesGoneAfterKill` (NOT `processNamesGoneAfterWmiLookup`)
  // so the post-kill WMI lookup returns 0 PIDs while leaving `simhub.exe` in
  // `processNames`. That keeps predicate #3 true. If the production code
  // regressed `staleTask !== true` to `staleTask === true` or removed it,
  // isElevatedInconclusive would flip true and this test would fail because
  // the attempt would be registered as unclosed/elevated.
  const { killLaunchedApps, unclosedProcesses } = await loadProcessModulesWithStore({
    profiles: {
      ac: { activeProfileId: 'default', profiles: [{ id: 'default', name: 'Default' }] }
    },
    appPaths: { simhub: 'C:/Tools/SimHub.exe' }
  })
  markExistingPath('C:/Tools/SimHub.exe')
  processNames.add('simhub.exe')
  registerProcess('C:/Tools/SimHub.exe', 'simhub.exe', '4321')
  staleTaskkillPids.add('4321')
  processNamesGoneAfterKill.add('simhub.exe')

  await expect(killLaunchedApps('ac')).resolves.toMatchObject({
    success: true,
    closedCount: 1,
    failedCount: 0,
    failures: []
  })
  expect(unclosedProcesses.has('ac:c:\\tools\\simhub.exe')).toBe(false)
})

test('killLaunchedApps non-full-path utility companion with replacement is reported unclosed (#326, #345)', async () => {
  // When a utility companion is killed by image name (no full path) and a
  // replacement process with the same name appears in tasklist on the
  // recheck, finalizeKillAttempts must mark it as still_running. This
  // covers the image-name-only branch of the elevated/replacement check.
  const { killLaunchedApps, unclosedProcesses } = await loadProcessModulesWithStore({
    profiles: {
      ac: {
        activeProfileId: 'default',
        profiles: [{ id: 'default', name: 'Default', garage61: true }]
      }
    }
  })
  processNames.add('garage61 telemetry agent.exe')
  // The taskkill /IM mock deletes the image from processNames on success,
  // so to model "replacement is alive on recheck" we use accessDeniedImageNames
  // to make taskkill fail and leave the image in tasklist.
  accessDeniedImageNames.add('garage61 telemetry agent.exe')

  const result = await killLaunchedApps('ac')
  expect(result).toMatchObject({
    success: false,
    closedCount: 0,
    failedCount: 1,
    failures: [
      expect.objectContaining({
        appPath: 'Garage61 telemetry agent.exe',
        reason: 'access_denied'
      })
    ]
  })
  expect(unclosedProcesses.get('ac:garage61 telemetry agent.exe')).toMatchObject({
    reason: 'access_denied',
    elevated: true
  })
})

test('WMI returning 0 PIDs after taskkill is treated as closed (genuine exit) (#352)', async () => {
  // Negative test for the elevated-process recovery path: when the initial
  // WMI lookup yields 0 PIDs AND the post-kill recheck also yields 0 PIDs
  // AND the image is gone from tasklist, the kill must succeed - no
  // unclosed/elevated entry should be registered.
  markExistingPath('C:/Tools/SimHub.exe')
  processNames.add('simhub.exe')
  inaccessibleExecutablePathProcesses.add('simhub.exe')
  processNamesGoneAfterWmiLookup.add('simhub.exe')
  const { killLaunchedApps, unclosedProcesses } = await loadProcessModulesWithStore({
    profiles: {
      ac: { activeProfileId: 'default', profiles: [{ id: 'default', name: 'Default' }] }
    },
    appPaths: { simhub: 'C:/Tools/SimHub.exe' }
  })

  await expect(killLaunchedApps('ac')).resolves.toMatchObject({
    success: true,
    closedCount: 1,
    failedCount: 0,
    failures: []
  })
  expect(unclosedProcesses.has('ac:c:\\tools\\simhub.exe')).toBe(false)
  // Critically: no taskkill /PID call should have run for this companion -
  // the WMI lookup returned 0 PIDs so the elevated/exited branch was taken.
  expect(execFileCalls).not.toEqual(
    expect.arrayContaining([
      expect.objectContaining({ command: 'taskkill', args: expect.arrayContaining(['/PID']) })
    ])
  )
})

test('killProfileApps falls back to /IM for non-full-path utility companions (#352)', async () => {
  // When the configured app path is an image-name only (e.g. a utility
  // companion that has no installed location), killProfileApps cannot use
  // the WMI PID lookup and must fall back to taskkill /IM <image-name>.
  // Note: killProfileApps requires a full-path appPath in `appPaths`, so
  // this fallback path is exercised via killLaunchedApps + a utility
  // companion whose registered name is just the image.
  const { killLaunchedApps } = await loadProcessModulesWithStore({
    profiles: {
      ac: {
        activeProfileId: 'default',
        profiles: [{ id: 'default', name: 'Default', garage61: true }]
      }
    }
  })
  processNames.add('garage61 telemetry agent.exe')

  await expect(killLaunchedApps('ac')).resolves.toMatchObject({
    success: true,
    closedCount: 1,
    failedCount: 0
  })

  // No WMI lookup should occur for the image-name-only target.
  expect(execFileCalls).not.toEqual(
    expect.arrayContaining([expect.objectContaining({ command: 'powershell.exe' })])
  )
  expect(execFileCalls).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        command: 'taskkill',
        args: ['/IM', 'garage61 telemetry agent.exe', '/T', '/F']
      })
    ])
  )
})

test('pruneUnclosedProcesses removes entries whose image is no longer active (#352)', async () => {
  // Direct unit coverage for the cleanup invariant at kill.ts:331 - when
  // a tracked unclosed entry no longer appears in the running process
  // names, it should be removed so it does not surface in getRunningApps.
  const { pruneUnclosedProcesses, unclosedProcesses } = await loadProcessModules()

  unclosedProcesses.set('ac:c:\\tools\\active.exe', {
    path: 'C:/Tools/Active.exe',
    name: 'Active.exe',
    gameKey: 'ac',
    error: 'access denied',
    reason: 'access_denied',
    elevated: true
  })
  unclosedProcesses.set('ac:c:\\tools\\inactive.exe', {
    path: 'C:/Tools/Inactive.exe',
    name: 'Inactive.exe',
    gameKey: 'ac',
    error: 'still running',
    reason: 'still_running',
    elevated: false
  })
  unclosedProcesses.set('ac:c:\\tools\\also-inactive.exe', {
    path: 'C:/Tools/Also-Inactive.exe',
    name: 'Also-Inactive.exe',
    gameKey: 'ac',
    error: 'access denied',
    reason: 'access_denied',
    elevated: true
  })

  pruneUnclosedProcesses(new Set(['active.exe']))

  expect(unclosedProcesses.has('ac:c:\\tools\\active.exe')).toBe(true)
  expect(unclosedProcesses.has('ac:c:\\tools\\inactive.exe')).toBe(false)
  expect(unclosedProcesses.has('ac:c:\\tools\\also-inactive.exe')).toBe(false)
})

test('kill is reported successful when the launched exe is gone from tasklist even if taskkill complained (#390)', async () => {
  // Reproduces the Perplexity scenario from #390: the launched exe (a wrapper
  // / Electron stub) spawns the real app under a different process name and
  // exits. When the user closes the profile, taskkill against the tracked
  // PID may fail (access-denied / no-running-instance) because the wrapper
  // PID is already stale, BUT the launched image is gone from tasklist on
  // the post-kill recheck — the kill effectively succeeded. The finalize
  // logic must treat this as success and NOT emit a "couldn't be closed"
  // toast / unclosed entry.
  markExistingPath('C:/Users/test/AppData/Local/Programs/Perplexity/Perplexity.exe')
  processNames.add('perplexity.exe')
  registerProcess(
    'C:/Users/test/AppData/Local/Programs/Perplexity/Perplexity.exe',
    'perplexity.exe',
    '9876'
  )
  // taskkill /PID 9876 will report access-denied, but the image disappears
  // from tasklist anyway (the wrapper exited / the OS finished tearing down
  // the tree).
  accessDeniedPids.add('9876')
  pidsAccessDeniedButImageGone.add('9876')

  const { killLaunchedApps, unclosedProcesses } = await loadProcessModulesWithStore({
    profiles: {
      ac: { activeProfileId: 'default', profiles: [{ id: 'default', name: 'Default' }] }
    },
    appPaths: {
      perplexity: 'C:/Users/test/AppData/Local/Programs/Perplexity/Perplexity.exe'
    }
  })

  await expect(killLaunchedApps('ac')).resolves.toMatchObject({
    success: true,
    closedCount: 1,
    failedCount: 0,
    failures: []
  })
  expect(
    unclosedProcesses.has(
      'ac:c:\\users\\test\\appdata\\local\\programs\\perplexity\\perplexity.exe'
    )
  ).toBe(false)
})

test('kill is NOT reported successful when taskkill failed and the post-kill tasklist read itself failed (#399)', async () => {
  // Codex review noted that gating success on `!processNamesAfterKill.has(...)`
  // alone collapses two very different states into one when the post-kill
  // tasklist command itself fails: production's readRunningProcessNames
  // swallows the error and returns an empty Set, which would make the
  // imageGoneFromTasklist override misfire and turn a real taskkill failure
  // into a false success. The fix propagates a `succeeded` flag so the
  // override only applies when the read actually confirmed the image is gone.
  markExistingPath('C:/tools/access-denied-app.exe')
  processNames.add('access-denied-app.exe')
  registerProcess('C:/tools/access-denied-app.exe', 'access-denied-app.exe', '5555')
  // taskkill /PID 5555 reports access-denied AND leaves the image in
  // tasklist — i.e. nothing was actually terminated.
  accessDeniedPids.add('5555')

  const { killLaunchedApps, unclosedProcesses } = await loadProcessModulesWithStore({
    profiles: {
      ac: { activeProfileId: 'default', profiles: [{ id: 'default', name: 'Default' }] }
    },
    appPaths: {
      accessdenied: 'C:/tools/access-denied-app.exe'
    }
  })

  // Let the PRE-kill scan succeed so a kill attempt is actually dispatched,
  // then make the POST-kill recheck fail. With the buggy code, the empty Set
  // from the failed recheck satisfied `!processNamesAfterKill.has(...)` and
  // turned the access-denied failure into success: true / closedCount: 1.
  //
  // Armed off the taskkill for this PID rather than off a call index, so the
  // failure cannot drift onto the pre-kill scan when an unrelated read slips
  // in first (#751).
  failTasklistAfterAccessDeniedPids.add('5555')

  const result = await killLaunchedApps('ac')

  // Loud guard, and the reason this test is worth trusting: everything below
  // asserts how a kill FAILURE is reported, so it is only meaningful if a kill
  // was dispatched at all. Without this, a killLaunchedApps that bailed early
  // and never issued a taskkill fails on `result.success` with a message that
  // says nothing about the real cause (#751).
  expect(execFileCalls).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ command: 'taskkill', args: ['/PID', '5555', '/T', '/F'] })
    ])
  )

  expect(result.success).toBe(false)
  expect(result.failedCount).toBe(1)
  expect(result.closedCount).toBe(0)
  expect(result.failures).toHaveLength(1)
  expect(result.failures[0]).toMatchObject({
    appName: 'access-denied-app.exe',
    reason: 'access_denied'
  })
  // The unclosed-process entry must be registered so the UI surfaces the
  // failure rather than silently clearing it.
  expect(unclosedProcesses.has('ac:c:\\tools\\access-denied-app.exe')).toBe(true)
})

// --- Direct unit tests for spawnDetachedApp (#344) ---
//
// These bypass launchProfileApps so we can probe spawnDetachedApp's exit /
// error / mismatch-warning branches without setting up the full launch
// orchestration (validity gates, store reads, post-launch cooldown, etc.).

test('spawnDetachedApp resolves with launched on the happy path and registers the running process', async () => {
  markExistingPath('C:/Apps/Happy.exe')
  const { spawnDetachedApp, runningProcesses } = await loadProcessModules()

  const result = await spawnDetachedApp(
    sender,
    'ac',
    { key: 'customapp1', path: 'C:/Apps/Happy.exe' },
    undefined
  )

  expect(result).toEqual({ status: 'launched', appPath: 'C:/Apps/Happy.exe' })
  expect(spawnCalls).toHaveLength(1)
  expect(spawnCalls[0]).toMatchObject({
    appPath: 'C:/Apps/Happy.exe',
    options: { detached: true, stdio: 'ignore' }
  })
  // The runningProcesses registry must contain the spawned exe so subsequent
  // kill/track operations can find it.
  expect(runningProcesses.size).toBe(1)
})

test('spawnDetachedApp emits a process-name-mismatch warning when the wrapper exits inside the post-launch window', async () => {
  const childHandlers = new Map<string, (...args: unknown[]) => void>()
  const child = {
    pid: 1234,
    once: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      childHandlers.set(event, handler)
      return child
    }),
    unref: vi.fn(),
    kill: vi.fn()
  }

  markExistingPath('C:/Apps/Wrapper.exe')
  const { spawnDetachedApp, processNameMismatchWarnings } = await loadProcessModules()
  vi.mocked(await import('child_process')).spawn.mockReturnValueOnce(child as never)

  const launchPromise = spawnDetachedApp(
    sender,
    'ac',
    { key: 'customapp1', path: 'C:/Apps/Wrapper.exe' },
    undefined
  )
  childHandlers.get('spawn')?.()
  await launchPromise

  // Wrapper exits immediately (still within POST_LAUNCH_BLOCK_MS), the child
  // process re-spawns under a different name — exactly the scenario the
  // mismatch warning is designed to surface (#262, #390).
  childHandlers.get('exit')?.()

  expect(sender.send).toHaveBeenCalledWith(
    'process-name-mismatch-warning',
    expect.objectContaining({
      app: 'C:/Apps/Wrapper.exe',
      warning: expect.stringContaining('SimLauncher can no longer detect when you close it')
    })
  )
  expect(processNameMismatchWarnings.size).toBe(1)
})

test('spawnDetachedApp exit handler does not wipe a new entry installed under the same canonical key', async () => {
  // Two slots can share a canonical runningKey (#357: same exe path, different
  // appArgs). If the old child's 'exit' event arrives AFTER a fresh spawn has
  // re-`set` the entry under the same key (realistic during a profile switch
  // that kills the old child and immediately spawns the new one), the late
  // delete must be a no-op — otherwise the new running process disappears
  // from runningProcesses and the UI loses track of it.
  const oldHandlers = new Map<string, (...args: unknown[]) => void>()
  const oldChild = {
    pid: 1111,
    once: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      oldHandlers.set(event, handler)
      return oldChild
    }),
    unref: vi.fn(),
    kill: vi.fn()
  }
  const newHandlers = new Map<string, (...args: unknown[]) => void>()
  const newChild = {
    pid: 2222,
    once: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      newHandlers.set(event, handler)
      return newChild
    }),
    unref: vi.fn(),
    kill: vi.fn()
  }

  markExistingPath('C:/Apps/Shared.exe')
  const { spawnDetachedApp, runningProcesses } = await loadProcessModules()
  const spawnMock = vi.mocked(await import('child_process')).spawn
  spawnMock.mockReturnValueOnce(oldChild as never).mockReturnValueOnce(newChild as never)

  const oldLaunch = spawnDetachedApp(
    sender,
    'ac',
    { key: 'customapp1', path: 'C:/Apps/Shared.exe' },
    undefined
  )
  oldHandlers.get('spawn')?.()
  await oldLaunch

  // Simulate the kill that runs before the profile switches: it removes the
  // old entry the same way kill.ts:418 does. The 'exit' event has not fired
  // yet — that's the whole point of the race.
  const runningKey = 'c:\\apps\\shared.exe'
  expect(runningProcesses.has(runningKey)).toBe(true)
  runningProcesses.delete(runningKey)

  const newLaunch = spawnDetachedApp(
    sender,
    'ac',
    { key: 'customapp2', path: 'C:/Apps/Shared.exe' },
    undefined
  )
  newHandlers.get('spawn')?.()
  await newLaunch

  expect(runningProcesses.get(runningKey)?.process).toBe(newChild)

  // Late exit of the OLD child arrives. With the identity guard it must be a
  // no-op; without the guard it would wipe the new entry.
  oldHandlers.get('exit')?.()

  expect(runningProcesses.get(runningKey)?.process).toBe(newChild)
})

test('spawnDetachedApp returns elevated when the OS rejects the spawn with EACCES', async () => {
  markExistingPath('C:/Apps/Elevated.exe')
  spawnErrors.set('C:/Apps/Elevated.exe', makeAccessDeniedError())
  const { spawnDetachedApp } = await loadProcessModules()

  const result = await spawnDetachedApp(
    sender,
    'ac',
    { key: 'customapp1', path: 'C:/Apps/Elevated.exe' },
    undefined
  )

  // The EACCES error path must trigger the PowerShell Start-Process -Verb
  // RunAs fallback and resolve with an `elevated` status carrying the user
  // warning string. Without the export, this path is only reachable
  // indirectly via launchProfileApps.
  expect(result.status).toBe('elevated')
  if (result.status === 'elevated') {
    expect(result.appPath).toBe('C:/Apps/Elevated.exe')
    expect(result.warning).toContain('administrator permission')
  }
  expect(execFileCalls.some((call) => call.command === 'powershell.exe')).toBe(true)
})

// #638: a non-elevated launch failure must be written to main-error.log, not
// just console.error, so "Open logs folder" has something for it.
test('spawnDetachedApp writes a failed (non-elevated) launch error to the on-disk log', async () => {
  markExistingPath('C:/Apps/Broken.exe')
  spawnErrors.set(
    'C:/Apps/Broken.exe',
    Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })
  )
  const { spawnDetachedApp } = await loadProcessModules()

  const result = await spawnDetachedApp(
    sender,
    'ac',
    { key: 'customapp1', path: 'C:/Apps/Broken.exe' },
    undefined
  )

  expect(result).toEqual({ status: 'failed', appPath: 'C:/Apps/Broken.exe', error: 'spawn ENOENT' })
  expect(appErrorLogFsMock.appendFileSync).toHaveBeenCalledWith(
    expect.stringContaining('main-error.log'),
    expect.stringContaining('launch')
  )
  const [, loggedLine] = appErrorLogFsMock.appendFileSync.mock.calls[0]
  expect(loggedLine).toContain('C:/Apps/Broken.exe')
  expect(loggedLine).toContain('spawn ENOENT')
})

// Logging must never break the launch path even if the write itself fails
// (disk full, locked file, etc.) — errorLog.ts's appendToLog already swallows
// this, but the call site must not assume otherwise.
test('a failing on-disk log write does not affect the spawnDetachedApp result', async () => {
  markExistingPath('C:/Apps/Broken.exe')
  spawnErrors.set(
    'C:/Apps/Broken.exe',
    Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })
  )
  const { spawnDetachedApp } = await loadProcessModules()
  appErrorLogFsMock.appendFileSync.mockImplementation(() => {
    throw new Error('ENOSPC: no space left on device')
  })

  const result = await spawnDetachedApp(
    sender,
    'ac',
    { key: 'customapp1', path: 'C:/Apps/Broken.exe' },
    undefined
  )

  expect(result).toEqual({ status: 'failed', appPath: 'C:/Apps/Broken.exe', error: 'spawn ENOENT' })
})

// --- Direct unit tests for finalizeKillAttempts (#344) ---
//
// Drive the predicates (notFound, staleTask, image-gone-from-tasklist,
// elevated-inconclusive) without going through killLaunchedApps /
// killProfileApps so we can hand-craft KillAttemptResult inputs.

test('finalizeKillAttempts returns the empty-attempts message and reports zero counts when given no attempts', async () => {
  const { finalizeKillAttempts } = await loadProcessModules()

  const result = await finalizeKillAttempts([], 'ac')

  expect(result.success).toBe(true)
  expect(result.closedCount).toBe(0)
  expect(result.failedCount).toBe(0)
  expect(result.failures).toEqual([])
  expect(result.message).toBe('No running companion apps to close.')
})

test('finalizeKillAttempts treats a notFound attempt as closed and prunes the running-process entry', async () => {
  const { finalizeKillAttempts, runningProcesses, unclosedProcesses } = await loadProcessModules()

  // Pre-seed runningProcesses with a stale entry — finalize must remove it
  // when the kill attempt reports the image as already gone.
  runningProcesses.set('c:\\apps\\notfound.exe', {
    process: { pid: 9999 } as never,
    path: 'C:/Apps/NotFound.exe',
    name: 'NotFound.exe',
    gameKey: 'ac',
    isGame: false
  })

  // No entry in processNames -> the post-kill tasklist read reports the
  // image as absent, exercising the imageGoneFromTasklist branch.
  const result = await finalizeKillAttempts(
    [
      {
        processName: 'notfound.exe',
        appPath: 'C:/Apps/NotFound.exe',
        gameKey: 'ac',
        success: true,
        notFound: true
      }
    ],
    'ac'
  )

  expect(result.success).toBe(true)
  expect(result.closedCount).toBe(1)
  expect(result.failedCount).toBe(0)
  expect(result.failures).toEqual([])
  expect(runningProcesses.size).toBe(0)
  expect(unclosedProcesses.size).toBe(0)
})

test('finalizeKillAttempts prunes only the attempt path, not a same-named companion of another game (#677)', async () => {
  const { finalizeKillAttempts, runningProcesses } = await loadProcessModules()

  // Two games each launched a companion named telemetry.exe from DIFFERENT
  // paths. Closing game A's apps must delete A's entry only; B's still-alive
  // companion must keep its runningProcesses entry (and its ChildProcess
  // handle). The old name-based cleanup arm deleted B too (name match), which
  // is the collateral tracking loss this fixes.
  // A's exe exists here (the common case: a real companion's exe is on disk),
  // which drives finalize's WMI still-running check. Cleanup scoping itself is
  // gated on path SHAPE (isPathScopedExe), not existence — the missing-exe
  // variant is covered by the next test.
  markExistingPath('C:/GameA/telemetry.exe')
  runningProcesses.set('c:\\gamea\\telemetry.exe', {
    process: { pid: 1111 } as never,
    path: 'C:/GameA/telemetry.exe',
    name: 'telemetry.exe',
    gameKey: 'ac',
    isGame: false
  })
  runningProcesses.set('c:\\gameb\\telemetry.exe', {
    process: { pid: 2222 } as never,
    path: 'C:/GameB/telemetry.exe',
    name: 'telemetry.exe',
    gameKey: 'iracing',
    isGame: false
  })

  // processNames empty -> the post-kill tasklist reports the image gone, so A's
  // full-path attempt finalizes as closed and the cleanup loop runs.
  const result = await finalizeKillAttempts(
    [
      {
        processName: 'telemetry.exe',
        appPath: 'C:/GameA/telemetry.exe',
        gameKey: 'ac',
        success: true,
        notFound: true
      }
    ],
    'ac'
  )

  expect(result.success).toBe(true)
  expect(result.closedCount).toBe(1)
  // A pruned by its normalized path; B (different path, different game) survives.
  expect(runningProcesses.has('c:\\gamea\\telemetry.exe')).toBe(false)
  expect(runningProcesses.has('c:\\gameb\\telemetry.exe')).toBe(true)
})

test('finalizeKillAttempts keeps cleanup path-scoped even when the attempt exe is missing (#677)', async () => {
  const { finalizeKillAttempts, runningProcesses } = await loadProcessModules()

  // Same collision as above, but game A's exe is NOT on disk at finalize time
  // (uninstalled mid-session, on a disconnected/removable drive, or transiently
  // locked). isFullExePath is therefore false — yet the attempt is still a FULL
  // PATH, so cleanup must stay scoped to A's own path and leave B's same-named
  // companion tracked. Gating the name fallback on isFullExePath (which stats
  // the file) instead of path shape would reintroduce the #677 collateral
  // deletion. A's path is deliberately left unmarked (existsSync -> false).
  runningProcesses.set('c:\\gamea\\telemetry.exe', {
    process: { pid: 1111 } as never,
    path: 'C:/GameA/telemetry.exe',
    name: 'telemetry.exe',
    gameKey: 'ac',
    isGame: false
  })
  runningProcesses.set('c:\\gameb\\telemetry.exe', {
    process: { pid: 2222 } as never,
    path: 'C:/GameB/telemetry.exe',
    name: 'telemetry.exe',
    gameKey: 'iracing',
    isGame: false
  })

  // processNames empty -> tasklist reports the image gone, so the attempt
  // finalizes as closed and the cleanup loop runs. The missing exe skips the
  // WMI branch, but stillRunning stays false because the image is gone.
  const result = await finalizeKillAttempts(
    [
      {
        processName: 'telemetry.exe',
        appPath: 'C:/GameA/telemetry.exe',
        gameKey: 'ac',
        success: true,
        notFound: true
      }
    ],
    'ac'
  )

  expect(result.success).toBe(true)
  expect(result.closedCount).toBe(1)
  // A pruned by its normalized path; B survives despite A's exe being absent.
  expect(runningProcesses.has('c:\\gamea\\telemetry.exe')).toBe(false)
  expect(runningProcesses.has('c:\\gameb\\telemetry.exe')).toBe(true)
})

test('finalizeKillAttempts still prunes a same-named entry for a bare-name attempt (#677 fallback preserved)', async () => {
  const { finalizeKillAttempts, runningProcesses } = await loadProcessModules()

  // Bare-name attempts (a UTILITY_COMPANION_PROCESS_NAMES kill issued via
  // taskkill /IM, no path to scope by) must keep pruning by exe name — that is
  // the fallback #677 deliberately preserved. The kill was name-scoped, so a
  // name-scoped prune stays consistent.
  runningProcesses.set('c:\\tools\\garage61.exe', {
    process: { pid: 3333 } as never,
    path: 'C:/Tools/garage61.exe',
    name: 'garage61.exe',
    gameKey: 'ac',
    isGame: false
  })

  // appPath is a BARE NAME -> isFullExePath is false -> the name fallback is the
  // only thing that can prune the entry (the path arm resolves the bare name to
  // a cwd-relative absolute path that never matches the entry key).
  const result = await finalizeKillAttempts(
    [
      {
        processName: 'garage61.exe',
        appPath: 'garage61.exe',
        gameKey: 'ac',
        success: true,
        notFound: true
      }
    ],
    'ac'
  )

  expect(result.success).toBe(true)
  expect(result.closedCount).toBe(1)
  expect(runningProcesses.has('c:\\tools\\garage61.exe')).toBe(false)
})

test('finalizeKillAttempts treats image-gone-from-tasklist as closed even when taskkill reported access-denied (#390)', async () => {
  const { finalizeKillAttempts, unclosedProcesses } = await loadProcessModules()

  // processNames is empty, so the post-kill tasklist read confirms the
  // image is gone. Production code must let the imageGoneFromTasklist
  // override turn this access-denied attempt into success — that's the
  // exact fix for #390 wrappers whose child process kills the wrapper PID.
  const result = await finalizeKillAttempts(
    [
      {
        processName: 'wrapper.exe',
        appPath: 'C:/Apps/Wrapper.exe',
        gameKey: 'ac',
        success: false,
        accessDenied: true,
        error: 'Access is denied.'
      }
    ],
    'ac'
  )

  expect(result.success).toBe(true)
  expect(result.closedCount).toBe(1)
  expect(result.failedCount).toBe(0)
  expect(unclosedProcesses.size).toBe(0)
})

test('finalizeKillAttempts flags an elevated-inconclusive attempt as still running and registers an unclosed-process entry', async () => {
  const { finalizeKillAttempts, unclosedProcesses } = await loadProcessModules()

  // For the elevated-inconclusive triple-predicate to fire we need:
  //   1. !imageGoneFromTasklist           -> processName stays in processNames
  //   2. attempt.notFound === true        -> taskkill reported not-found
  //   3. attempt.staleTask !== true       -> NOT a "no running instance"
  //   4. processNamesAfterKill.has(...)   -> same as #1
  markExistingPath('C:/Apps/Elevated.exe')
  processNames.add('elevated.exe')

  const result = await finalizeKillAttempts(
    [
      {
        processName: 'elevated.exe',
        appPath: 'C:/Apps/Elevated.exe',
        gameKey: 'ac',
        success: true,
        notFound: true,
        // staleTask intentionally absent -> staleTask !== true holds
        accessDenied: false
      }
    ],
    'ac'
  )

  expect(result.success).toBe(false)
  expect(result.closedCount).toBe(0)
  expect(result.failedCount).toBe(1)
  expect(result.failures).toHaveLength(1)
  // The triple-predicate flips accessDenied to true, so the failure must
  // surface as `access_denied` (matches what the UI shows for elevated
  // processes that SimLauncher can't terminate).
  expect(result.failures[0]).toMatchObject({
    appName: 'Elevated.exe',
    reason: 'access_denied'
  })
  expect(unclosedProcesses.size).toBe(1)
})

test('finalizeKillAttempts treats a notFound elevated-suspect attempt as still running when the post-kill tasklist read failed', async () => {
  // Companion regression to the access-denied + tasklist-failed test (#399):
  // when WMI returns 0 PIDs (notFound=true, success=true — the
  // findProcessIdsByExecutablePath elevated-invisible branch) AND the
  // post-kill tasklist read itself fails, the empty processNamesAfterKill
  // Set must NOT be read as evidence-of-exit. Without the gate, the
  // isElevatedInconclusive predicate short-circuits to false and the attempt
  // is silently cleared as success. Be conservative: treat as inconclusive.
  const { finalizeKillAttempts, unclosedProcesses } = await loadProcessModules()

  markExistingPath('C:/Apps/Elevated.exe')
  // Pre-kill tasklist scan succeeds; post-kill recheck fails. The attempt is
  // synthesised directly (notFound=true models WMI returning 0 PIDs for an
  // elevated process), so we only need the post-kill tasklist branch to fail.
  tasklistReadShouldFail = true

  const result = await finalizeKillAttempts(
    [
      {
        processName: 'elevated.exe',
        appPath: 'C:/Apps/Elevated.exe',
        gameKey: 'ac',
        success: true,
        notFound: true,
        accessDenied: false
      }
    ],
    'ac'
  )

  expect(result.success).toBe(false)
  expect(result.failedCount).toBe(1)
  expect(result.closedCount).toBe(0)
  expect(result.failures[0]).toMatchObject({
    appName: 'Elevated.exe',
    reason: 'access_denied'
  })
  expect(unclosedProcesses.size).toBe(1)
})

// --- Fire-and-forget when tracking is off (#591) ---
//
// The rule is applied at the SOURCE: an untracked profile's launched apps are
// never recorded in `runningProcesses`. An earlier attempt filtered them on the
// way out of getRunningApps instead and was reverted, because two things
// downstream read the unfiltered list and a display filter cannot reach either.
// The second test below is that reverted approach's worst case.

test('a tracking-off profile launches its apps and records nothing (#591)', async () => {
  markExistingPath('C:/Tools/SimHub.exe')
  const { launchProfileApps, getRunningApps, runningProcesses } = await loadProcessModulesWithStore(
    {
      profiles: {
        ac: {
          activeProfileId: 'default',
          profiles: [{ id: 'default', name: 'Default', trackingEnabled: false }]
        }
      },
      gamePaths: { ac: 'C:/Games/AssettoCorsa.exe' }
    }
  )

  await expect(launchProfileApps(sender, 'ac', ['C:/Tools/SimHub.exe'])).resolves.toMatchObject({
    success: true,
    launchedCount: 1
  })

  // It really launched: opting out of tracking is not opting out of launching.
  expect(spawnCalls.map((call) => call.appPath)).toContain('C:/Tools/SimHub.exe')
  // ...and left nothing behind to surface, count, kill or auto-close.
  expect(runningProcesses.size).toBe(0)
  await expect(getRunningApps()).resolves.toEqual([])
})

// The same fixture WITHOUT the flag, because that is what every existing
// profile looks like: nobody has `trackingEnabled` set.
//
// What this pins is that the launch path is WIRED to the rule and records when
// it says yes: with the tracking-off test above, a guard hardcoded either way
// fails one of the two. It cannot pin the rule ITSELF, because this suite mocks
// `../profiles` and the mock carries its own copy of the predicate, so the real
// one could be inverted with every test here still green. The default is pinned
// against the real function in profiles.test.ts, which is where it belongs.
test('a profile with no tracking flag is still tracked (#591)', async () => {
  markExistingPath('C:/Tools/SimHub.exe')
  const { launchProfileApps, runningProcesses } = await loadProcessModulesWithStore({
    profiles: {
      ac: {
        activeProfileId: 'default',
        profiles: [{ id: 'default', name: 'Default' }]
      }
    },
    gamePaths: { ac: 'C:/Games/AssettoCorsa.exe' }
  })

  await launchProfileApps(sender, 'ac', ['C:/Tools/SimHub.exe'])

  expect(runningProcesses.size).toBe(1)
})

// M2 from the reverted output-filter spike, and the reason the fix lives at the
// source. `launchedExeNames` is a GLOBAL basename dedup set built from the
// unfiltered list, so an untracked profile launching a shared exe used to
// suppress a tracked profile's own copy of it, and the final filter then
// removed the untracked copy: the companion surfaced nowhere. Shared companion
// exes are the normal case for anyone running more than one sim.
test('an untracked profile launching a shared exe does not hide it from a tracked one (#591)', async () => {
  markExistingPath('C:/Tools/SimHub.exe')
  // Both game exes exist AND both games are running below, so AC is adoptable
  // on every axis except the one under test. Without that the "nothing for AC"
  // assertion would hold for the wrong reason.
  markExistingPath('C:/Games/AssettoCorsa.exe')
  markExistingPath('C:/Games/iRacingUI.exe')
  const { launchProfileApps, getRunningApps } = await loadProcessModulesWithStore({
    profiles: {
      ac: {
        activeProfileId: 'default',
        profiles: [{ id: 'default', name: 'Default', trackingEnabled: false }]
      },
      iracing: {
        activeProfileId: 'default',
        profiles: [{ id: 'default', name: 'Default', trackedProcessPaths: ['C:/Tools/SimHub.exe'] }]
      }
    },
    gamePaths: { ac: 'C:/Games/AssettoCorsa.exe', iracing: 'C:/Games/iRacingUI.exe' },
    appPaths: { simhub: 'C:/Tools/SimHub.exe' }
  })

  // Both games are already running, so both profiles are adoptable and their
  // tracked paths would be surfaced from the tasklist.
  processNames.add('iracingui.exe')
  processNames.add('assettocorsa.exe')

  await launchProfileApps(sender, 'ac', ['C:/Tools/SimHub.exe'])

  // SimHub is now up because AC's profile started it. The tasklist snapshot is
  // cached for 500ms and the launch already primed it, so invalidate rather
  // than waiting the window out.
  processNames.add('simhub.exe')
  ;(await import('../../src/main/processes/tasklist')).invalidateProcessNameCache()

  const runningApps = await getRunningApps()

  expect(runningApps).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ path: 'C:/Tools/SimHub.exe', gameKey: 'iracing', tracked: true })
    ])
  )
  // And it is not attributed to the profile that opted out.
  expect(runningApps.filter((app) => app.gameKey === 'ac')).toEqual([])
})

// The mismatch warning exists to say "tracking was lost". It has nothing to
// tell a profile that asked not to be tracked, and it would be the one thing
// still lighting that game's card.
test('a tracking-off profile gets no process-name-mismatch warning (#591)', async () => {
  const childHandlers = new Map<string, (...args: unknown[]) => void>()
  const child = {
    pid: 1234,
    once: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      childHandlers.set(event, handler)
      return child
    }),
    unref: vi.fn(),
    kill: vi.fn()
  }

  markExistingPath('C:/Games/AssettoCorsa.exe')
  const { launchProfileApps, processNameMismatchWarnings } = await loadProcessModulesWithStore({
    profiles: {
      ac: {
        activeProfileId: 'default',
        profiles: [{ id: 'default', name: 'Default', trackingEnabled: false }]
      }
    },
    gamePaths: { ac: 'C:/Games/AssettoCorsa.exe' }
  })
  vi.mocked(await import('child_process')).spawn.mockReturnValueOnce(child as never)

  const launchPromise = launchProfileApps(sender, 'ac', ['C:/Games/AssettoCorsa.exe'])
  childHandlers.get('spawn')?.()
  await launchPromise

  // A fast exit inside the post-launch window: exactly what writes the warning
  // for a tracked profile.
  childHandlers.get('exit')?.()

  expect(processNameMismatchWarnings.size).toBe(0)
})

// A profile switch launches the incoming profile's apps BEFORE the renderer
// saves the new activeProfileId, so the store still calls the outgoing profile
// active while these apps start. Resolving tracking from the store there would
// apply the wrong profile's setting in both directions: switching to a
// fire-and-forget profile would still record its apps, and switching away from
// one would leave the incoming tracked profile with no running strip at all.
test('a switch to an untracked profile records nothing, before the switch is saved (#591)', async () => {
  markExistingPath('C:/Tools/SimHub.exe')
  const { launchProfileApps, runningProcesses } = await loadProcessModulesWithStore({
    // The store still says 'default' (tracked) is active, exactly as it would
    // be mid-switch.
    profiles: {
      ac: {
        activeProfileId: 'default',
        profiles: [
          { id: 'default', name: 'Default' },
          { id: 'quiet', name: 'Quiet', trackingEnabled: false }
        ]
      }
    },
    gamePaths: { ac: 'C:/Games/AssettoCorsa.exe' }
  })

  await launchProfileApps(sender, 'ac', ['C:/Tools/SimHub.exe'], { profileId: 'quiet' })

  expect(spawnCalls.map((call) => call.appPath)).toContain('C:/Tools/SimHub.exe')
  expect(runningProcesses.size).toBe(0)
})

// The same switch in the other direction, which is the worse failure: reading
// the store would take the outgoing untracked profile's setting and leave the
// incoming tracked profile with nothing in its strip.
test('a switch away from an untracked profile still records the incoming one (#591)', async () => {
  markExistingPath('C:/Tools/SimHub.exe')
  const { launchProfileApps, runningProcesses } = await loadProcessModulesWithStore({
    profiles: {
      ac: {
        activeProfileId: 'quiet',
        profiles: [
          { id: 'quiet', name: 'Quiet', trackingEnabled: false },
          { id: 'default', name: 'Default' }
        ]
      }
    },
    gamePaths: { ac: 'C:/Games/AssettoCorsa.exe' }
  })

  await launchProfileApps(sender, 'ac', ['C:/Tools/SimHub.exe'], { profileId: 'default' })

  expect(runningProcesses.size).toBe(1)
})

// #591 desired behavior 2, verbatim: "Tray 'Close Apps' must not offer that
// profile." Not recording the launch is not enough on its own, because
// `getProfileCompanionTargets` rebuilds targets from the STORED profile rather
// than from what was launched — so the global Close Apps found and killed the
// companion anyway, whether SimLauncher started it or the user did. Found by
// Codex on PR #834, not by the tests above, all of which assert on
// `runningProcesses` and are blind to the target map.
test('close apps does not kill a tracking-off profile companion (#591)', async () => {
  processNames.add('garage61 telemetry agent.exe')

  const { killLaunchedApps } = await loadProcessModulesWithStore({
    profiles: {
      ac: {
        activeProfileId: 'quiet',
        profiles: [{ id: 'quiet', name: 'Quiet', garage61: true, trackingEnabled: false }]
      }
    }
  })

  await killLaunchedApps()

  const killCalls = execFileCalls.filter((call) => call.command === 'taskkill')
  expect(killCalls).toHaveLength(0)
})

// The same rule from the other side, and the half the user actually sees: the
// action must not be OFFERED. Both read `getProfileCompanionTargets`, so one
// guard covers them, but a future refactor could easily give them separate
// paths again.
test('close apps is not offered for a tracking-off profile (#591)', async () => {
  processNames.add('garage61 telemetry agent.exe')

  const { hasClosableLaunchedApps } = await loadProcessModulesWithStore({
    profiles: {
      ac: {
        activeProfileId: 'quiet',
        profiles: [{ id: 'quiet', name: 'Quiet', garage61: true, trackingEnabled: false }]
      }
    }
  })

  await expect(hasClosableLaunchedApps('ac')).resolves.toBe(false)
})

// The same profile with tracking left ON, so the two tests above cannot pass by
// the target map being empty for some unrelated reason.
test('close apps still targets the same companion when tracking is on (#591)', async () => {
  processNames.add('garage61 telemetry agent.exe')

  const { killLaunchedApps, hasClosableLaunchedApps } = await loadProcessModulesWithStore({
    profiles: {
      ac: {
        activeProfileId: 'loud',
        profiles: [{ id: 'loud', name: 'Loud', garage61: true }]
      }
    }
  })

  await expect(hasClosableLaunchedApps('ac')).resolves.toBe(true)
  await killLaunchedApps()

  const killCalls = execFileCalls.filter((call) => call.command === 'taskkill')
  expect(killCalls.map((call) => call.args)).toContainEqual([
    '/IM',
    'garage61 telemetry agent.exe',
    '/T',
    '/F'
  ])
})

// Turning tracking OFF has to act on what is already recorded, not only on the
// next launch. `runningProcesses` is written at launch time and nothing removes
// an entry until its exe exits, so the strip, the dot and Close Apps used to
// keep offering the apps for the rest of the session — the saved setting simply
// did not apply to the state it was saved to change.
//
// `simhub.exe` is added to `processNames` for every read that matters, so the
// entry does NOT disappear via `pruneStoppedRunningProcesses`: it has to be this
// rule removing it, not the exe appearing to have exited. It is added AFTER the
// launch because an app already in the tasklist is skipped as already running.
test('turning tracking off forgets apps already recorded under it (#591)', async () => {
  markExistingPath('C:/Tools/SimHub.exe')
  const profile: { id: string; name: string; trackingEnabled?: boolean } = {
    id: 'default',
    name: 'Default'
  }
  const { launchProfileApps, getRunningApps, runningProcesses } = await loadProcessModulesWithStore(
    {
      profiles: { ac: { activeProfileId: 'default', profiles: [profile] } },
      gamePaths: { ac: 'C:/Games/AssettoCorsa.exe' }
    }
  )

  await launchProfileApps(sender, 'ac', ['C:/Tools/SimHub.exe'])
  expect(runningProcesses.size).toBe(1)
  processNames.add('simhub.exe')
  await expect(getRunningApps()).resolves.not.toEqual([])

  // What saving the profile with the toggle off does to the store.
  profile.trackingEnabled = false

  await expect(getRunningApps()).resolves.toEqual([])
  // Forgotten, not killed: nothing was asked to close.
  expect(runningProcesses.size).toBe(0)
  expect(execFileCalls.filter((call) => call.command === 'taskkill')).toHaveLength(0)
})

// The same defect as the two Close Apps findings above, one layer down, and the
// tests above are blind to it for the same reason: they assert on
// `runningProcesses`, and the pending-handoff registry is neither that map nor
// the companion-target map.
//
// `cancelPendingElevatedHandoffs` runs in BOTH kill entry points' prologues,
// before any profile filtering, so a global Close Apps would kill the
// PowerShell host of an app the user opted out of us managing. The late
// approval would then start nothing, and they would be told a consent prompt
// was stranded by a profile SimLauncher promised not to touch.
test('a tracking-off profile does not register its elevated handoff for Close Apps (#591)', async () => {
  vi.useFakeTimers()
  try {
    markExistingPath('C:/Tools/Admin Tool.exe')
    markExistingPath('C:/Games/Race.exe')
    spawnErrors.set('C:/Tools/Admin Tool.exe', makeAccessDeniedError())
    elevatedLaunchHangs = true

    const { launchProfileApps, killLaunchedApps } = await loadProcessModulesWithStore({
      appPaths: { admin: 'C:/Tools/Admin Tool.exe' },
      gamePaths: { ac: 'C:/Games/Race.exe' },
      profiles: {
        ac: {
          activeProfileId: 'quiet',
          profiles: [{ id: 'quiet', name: 'Quiet', trackingEnabled: false }]
        }
      }
    })
    const { ELEVATED_HANDOFF_MAX_WAIT_MS } = await import('../../src/main/processes/spawn')

    const launchPromise = launchProfileApps(sender, 'ac', [
      'C:/Tools/Admin Tool.exe',
      'C:/Games/Race.exe'
    ])
    await vi.advanceTimersByTimeAsync(ELEVATED_HANDOFF_MAX_WAIT_MS)
    await launchPromise

    // The global (tray) form, with no gameKey, which is the one that reaches
    // every profile regardless of which game the user was looking at.
    const killPromise = killLaunchedApps()
    await vi.advanceTimersByTimeAsync(0)
    const result = await killPromise

    // The host stays alive, so answering the prompt still starts the app.
    expect(elevatedHostKills).toHaveLength(0)
    // Absent rather than 0: `withStrandedConsentPrompts` only attaches the
    // field when the count is above zero, so this IS the "nothing stranded"
    // shape, and the paired test below shows the same fixture producing 1.
    expect(result.strandedConsentPrompts).toBeUndefined()
  } finally {
    vi.useRealTimers()
  }
})

// The same fixture with tracking left ON, so the test above cannot pass because
// the handoff never reached the grace window in the first place.
test('a tracked profile still registers its elevated handoff for Close Apps (#591)', async () => {
  vi.useFakeTimers()
  try {
    markExistingPath('C:/Tools/Admin Tool.exe')
    markExistingPath('C:/Games/Race.exe')
    spawnErrors.set('C:/Tools/Admin Tool.exe', makeAccessDeniedError())
    elevatedLaunchHangs = true

    const { launchProfileApps, killLaunchedApps } = await loadProcessModulesWithStore({
      appPaths: { admin: 'C:/Tools/Admin Tool.exe' },
      gamePaths: { ac: 'C:/Games/Race.exe' },
      profiles: {
        ac: {
          activeProfileId: 'loud',
          profiles: [{ id: 'loud', name: 'Loud' }]
        }
      }
    })
    const { ELEVATED_HANDOFF_MAX_WAIT_MS } = await import('../../src/main/processes/spawn')

    const launchPromise = launchProfileApps(sender, 'ac', [
      'C:/Tools/Admin Tool.exe',
      'C:/Games/Race.exe'
    ])
    await vi.advanceTimersByTimeAsync(ELEVATED_HANDOFF_MAX_WAIT_MS)
    await launchPromise

    const killPromise = killLaunchedApps()
    await vi.advanceTimersByTimeAsync(0)
    const result = await killPromise

    expect(elevatedHostKills).toHaveLength(1)
    expect(result.strandedConsentPrompts).toBe(1)
  } finally {
    vi.useRealTimers()
  }
})

// The same rule on the OTHER elevation branch. `spawnDetachedApp` reaches
// `launchElevated` from two places: the 'error' event (covered above) and the
// try/catch around a synchronous throw from spawn(). Both had to be given the
// tracking decision, and only the first had a fixture, so dropping the argument
// from this one left the whole suite green.
test('the same holds when spawn throws elevation synchronously (#591)', async () => {
  vi.useFakeTimers()
  try {
    markExistingPath('C:/Tools/Admin Tool.exe')
    markExistingPath('C:/Games/Race.exe')
    spawnThrows.set('C:/Tools/Admin Tool.exe', makeAccessDeniedError())
    elevatedLaunchHangs = true

    const { launchProfileApps, killLaunchedApps } = await loadProcessModulesWithStore({
      appPaths: { admin: 'C:/Tools/Admin Tool.exe' },
      gamePaths: { ac: 'C:/Games/Race.exe' },
      profiles: {
        ac: {
          activeProfileId: 'quiet',
          profiles: [{ id: 'quiet', name: 'Quiet', trackingEnabled: false }]
        }
      }
    })
    const { ELEVATED_HANDOFF_MAX_WAIT_MS } = await import('../../src/main/processes/spawn')

    const launchPromise = launchProfileApps(sender, 'ac', [
      'C:/Tools/Admin Tool.exe',
      'C:/Games/Race.exe'
    ])
    await vi.advanceTimersByTimeAsync(ELEVATED_HANDOFF_MAX_WAIT_MS)
    await launchPromise

    const killPromise = killLaunchedApps()
    await vi.advanceTimersByTimeAsync(0)
    const result = await killPromise

    expect(elevatedHostKills).toHaveLength(0)
    expect(result.strandedConsentPrompts).toBeUndefined()
  } finally {
    vi.useRealTimers()
  }
})

// And the positive control for that branch, which also pins that the throw
// fixture reaches the elevation path at all rather than failing the launch.
test('a tracked profile registers it on the synchronous-throw branch too (#591)', async () => {
  vi.useFakeTimers()
  try {
    markExistingPath('C:/Tools/Admin Tool.exe')
    markExistingPath('C:/Games/Race.exe')
    spawnThrows.set('C:/Tools/Admin Tool.exe', makeAccessDeniedError())
    elevatedLaunchHangs = true

    const { launchProfileApps, killLaunchedApps } = await loadProcessModulesWithStore({
      appPaths: { admin: 'C:/Tools/Admin Tool.exe' },
      gamePaths: { ac: 'C:/Games/Race.exe' },
      profiles: {
        ac: { activeProfileId: 'loud', profiles: [{ id: 'loud', name: 'Loud' }] }
      }
    })
    const { ELEVATED_HANDOFF_MAX_WAIT_MS } = await import('../../src/main/processes/spawn')

    const launchPromise = launchProfileApps(sender, 'ac', [
      'C:/Tools/Admin Tool.exe',
      'C:/Games/Race.exe'
    ])
    await vi.advanceTimersByTimeAsync(ELEVATED_HANDOFF_MAX_WAIT_MS)
    await launchPromise

    const killPromise = killLaunchedApps()
    await vi.advanceTimersByTimeAsync(0)
    const result = await killPromise

    expect(elevatedHostKills).toHaveLength(1)
    expect(result.strandedConsentPrompts).toBe(1)
  } finally {
    vi.useRealTimers()
  }
})

// The toggle has to reach a handoff that was registered BEFORE it was flipped.
// `launchElevated` refuses to register one for a profile that is untracked at
// launch, but a launch that started while tracked and timed out into the
// registry predates the toggle entirely, so only the reconcile pass can reach
// it (Codex on #834). Left behind, a later Close Apps still kills its host and
// strands the prompt of a profile that is now fire-and-forget.
test('turning tracking off forgets a handoff registered while it was on (#591)', async () => {
  vi.useFakeTimers()
  try {
    markExistingPath('C:/Tools/Admin Tool.exe')
    markExistingPath('C:/Games/Race.exe')
    spawnErrors.set('C:/Tools/Admin Tool.exe', makeAccessDeniedError())
    elevatedLaunchHangs = true

    const profile: { id: string; name: string; trackingEnabled?: boolean } = {
      id: 'default',
      name: 'Default'
    }
    const { launchProfileApps, killLaunchedApps, getRunningApps } =
      await loadProcessModulesWithStore({
        appPaths: { admin: 'C:/Tools/Admin Tool.exe' },
        gamePaths: { ac: 'C:/Games/Race.exe' },
        profiles: { ac: { activeProfileId: 'default', profiles: [profile] } }
      })
    const { ELEVATED_HANDOFF_MAX_WAIT_MS } = await import('../../src/main/processes/spawn')

    // Launched while TRACKED, so the handoff really is registered.
    const launchPromise = launchProfileApps(sender, 'ac', [
      'C:/Tools/Admin Tool.exe',
      'C:/Games/Race.exe'
    ])
    await vi.advanceTimersByTimeAsync(ELEVATED_HANDOFF_MAX_WAIT_MS)
    await launchPromise

    // What saving the profile with the toggle off does to the store, followed
    // by the publish that reconciles against it.
    profile.trackingEnabled = false
    await getRunningApps()

    const killPromise = killLaunchedApps()
    await vi.advanceTimersByTimeAsync(0)
    const result = await killPromise

    // Forgotten, not cancelled: the host is alive, so the prompt is still
    // answerable, and nothing is reported as stranded.
    expect(elevatedHostKills).toHaveLength(0)
    expect(result.strandedConsentPrompts).toBeUndefined()
  } finally {
    vi.useRealTimers()
  }
})

// The BOUNDARY of the Close Apps guard above, pinned so the residual is a
// recorded decision rather than something a later reader discovers.
//
// `addOwner` never overwrites, so a tracked profile contributes a shared
// companion on its own and the target survives the untracked profile being
// skipped. The process is therefore still killed, exactly as it was before this
// PR, because back then the untracked profile contributed the same target
// itself. The guard only ever changed the case where NO tracked profile
// configures the app.
//
// #839 holds the decision on whether that should change. If it does, this test
// is the one to update, deliberately.
test('a shared companion is still a target when a tracked profile configures it too (#591)', async () => {
  processNames.add('garage61 telemetry agent.exe')

  const { killLaunchedApps } = await loadProcessModulesWithStore({
    profiles: {
      ac: {
        activeProfileId: 'quiet',
        profiles: [{ id: 'quiet', name: 'Quiet', garage61: true, trackingEnabled: false }]
      },
      iracing: {
        activeProfileId: 'default',
        profiles: [{ id: 'default', name: 'Default', garage61: true }]
      }
    }
  })

  await killLaunchedApps()

  const killCalls = execFileCalls.filter((call) => call.command === 'taskkill')
  expect(killCalls.map((call) => call.args)).toContainEqual([
    '/IM',
    'garage61 telemetry agent.exe',
    '/T',
    '/F'
  ])
})
