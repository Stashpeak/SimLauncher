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
// When set, the `atCall`-th isConsoleExecutable call (1-based) resolves only
// after `promise` does — models a slow PE-subsystem probe so the abort-point
// sweep can land a kill inside spawnDetachedApp's pre-spawn window for a
// specific app in the sequence (#670). Consumed once, then cleared.
let consoleProbeBlocker: { atCall: number; promise: Promise<void> } | null = null
let consoleProbeCallCount = 0
// When >0, the mocked readRunningProcessNames returns a successful response
// for the first N calls, then starts failing. Lets a single test simulate a
// transient tasklist failure on the post-kill recheck only — without breaking
// the pre-kill scan that decides which processes to attempt to kill.
let tasklistReadFailAfterCalls = 0
let tasklistReadCallCount = 0
const wmiLookupCounts = new Map<string, number>()
const execFileCalls: { command: string; args: string[]; options: Record<string, unknown> }[] = []
const spawnCalls: { appPath: string; args: string[]; options: Record<string, unknown> }[] = []
const spawnErrors = new Map<string, NodeJS.ErrnoException>()
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
        const pids: string[] = []
        if (
          entry &&
          (!processName || entry.processName === processName) &&
          processNames.has(entry.processName) &&
          !inaccessibleExecutablePathProcesses.has(entry.processName) &&
          !suppressPidsForPostKill
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
        callback(null, pids.length ? JSON.stringify(pids.map(Number)) : '', '')
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
        processNames.delete(imageName)
      }
      callback(null, '', '')
    }),
    spawn: vi.fn((appPath: string, args: string[] = [], options: Record<string, unknown> = {}) => {
      spawnCalls.push({ appPath, args, options })
      const handlers = new Map<string, (...args: unknown[]) => void>()
      const child = {
        pid: 1234,
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
      tasklistReadCallCount += 1
      const shouldFailNow =
        tasklistReadShouldFail ||
        (tasklistReadFailAfterCalls > 0 && tasklistReadCallCount > tasklistReadFailAfterCalls)
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
  staleTaskkillPids.clear()
  processNamesGoneAfterWmiLookup.clear()
  processNamesGoneAfterKill.clear()
  pidsAccessDeniedButImageGone.clear()
  tasklistReadShouldFail = false
  storeReadShouldThrow = false
  tasklistReadBlocker = null
  consoleProbeBlocker = null
  consoleProbeCallCount = 0
  tasklistReadFailAfterCalls = 0
  tasklistReadCallCount = 0
  wmiLookupCounts.clear()
  processRegistry.clear()
  execFileCalls.length = 0
  spawnCalls.length = 0
  spawnErrors.clear()
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

// hasClosableLaunchedApps drives the tray "Close Apps" enabled state (#519) and
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

// Abort-point sweep (#670): the "nothing spawns after a kill's abort" invariant
// is enforced by a separate check at EVERY await in the launch path — each
// suspension point is its own race window, and all five #714 review findings
// were instances of this one class landing at different points. The sweep
// drives the full launch sequence through each suspension point in turn, lands
// the abort while the launch is provably parked there, and asserts nothing
// further spawned. Adding a new await to the launch path? Add a row here.
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
  tasklistReadFailAfterCalls = 1

  const result = await killLaunchedApps('ac')

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
