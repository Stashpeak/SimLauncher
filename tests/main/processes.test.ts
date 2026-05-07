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
const execFileCalls: { command: string; args: string[]; options: Record<string, unknown> }[] = []
const spawnCalls: { appPath: string; args: string[]; options: Record<string, unknown> }[] = []
const spawnErrors = new Map<string, NodeJS.ErrnoException>()
const invalidateProcessNameCacheMock = vi.fn()
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
      existsSync: (filePath: string) => existingPaths.has(filePath)
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
        const processName = script.match(/\$name = '([^']+)'/)?.[1]?.toLowerCase()

        if (!options.env?.SIMLAUNCHER_TARGET_PROCESS_PATH) {
          const exists = processName ? processExistsNames.has(processName) : false
          callback(null, exists ? JSON.stringify(1234) : '', '')
          return
        }

        const pids = []
        if (
          processNames.has('simhub.exe') &&
          !inaccessibleExecutablePathProcesses.has('simhub.exe')
        ) {
          pids.push('4321')
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
          callback(new Error('Access is denied.'), '', 'Access is denied.')
          return
        }
        if (pid === '4321' || pid === '1234') {
          processNames.delete('simhub.exe')
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

  const tasklistMock = {
    invalidateProcessNameCache: invalidateProcessNameCacheMock,
    readRunningProcessNames: vi.fn(() => Promise.resolve(new Set(processNames)))
  }
  vi.doMock('./tasklist', () => tasklistMock)
  vi.doMock('/src/main/processes/tasklist.ts', () => tasklistMock)
  vi.doMock('../../src/main/processes/tasklist', () => tasklistMock)
  vi.doMock('../../src/main/processes/tasklist.ts', () => tasklistMock)
  vi.doMock('../../src/main/processes/tasklist.js', () => tasklistMock)

  const storeModuleMock = {
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
    killLaunchedApps: killModule.killLaunchedApps,
    killProfileApps: killModule.killProfileApps,
    pruneUnclosedProcesses: killModule.pruneUnclosedProcesses,
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
  execFileCalls.length = 0
  spawnCalls.length = 0
  spawnErrors.clear()
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
        warning: expect.stringContaining('starts another process with a different name')
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
    gamePaths: { ac: 'C:/Program Files/Cheat Engine/Cheat Engine.exe' }
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
      warning: expect.stringContaining('starts another process with a different name')
    })
  )
  dateNow.mockReturnValue(61000)
  await expect(getRunningApps()).resolves.toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        path: 'C:/Program Files/Cheat Engine/Cheat Engine.exe',
        warning: expect.stringContaining('starts another process with a different name')
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
    error: 'No valid executable paths configured.'
  })
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
    'Start-Process -FilePath $payload.filePath -ArgumentList $payload.args -Verb RunAs'
  )
  expect(JSON.parse(decodedCommand.split("@'\n")[1].split("\n'@")[0])).toEqual({
    filePath: 'C:/Tools/Admin Tool.exe',
    args: [
      '--path',
      'C:/Users/Driver/Sim Configs',
      '--literal',
      "$(Start-Process calc); 'single' & value"
    ]
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
  expect(decodedCommand).toContain('Start-Process -FilePath $payload.filePath -Verb RunAs')
  expect(decodedCommand).not.toContain('-ArgumentList')
  expect(JSON.parse(decodedCommand.split("@'\n")[1].split("\n'@")[0])).toEqual({
    filePath: 'C:/Tools/Admin Tool.exe',
    args: []
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
  expect(runningProcesses.has('C:/Tools/Broken.exe')).toBe(false)
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

test('killProfileApps excludes processes with null executable paths when resolving PIDs', async () => {
  markExistingPath('C:/Tools/SimHub.exe')
  processNames.add('simhub.exe')
  nullExecutablePathPids.add('9876')
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
  runningProcesses.set('C:/Tools/SimHub.exe', {
    process: { pid: 1234 } as never,
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

  expect(unclosedProcesses.get('ac:c:/tools/simhub.exe')).toMatchObject({
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

  expect(unclosedProcesses.get('ac:c:/tools/simhub.exe')).toMatchObject({
    path: 'C:/Tools/SimHub.exe',
    reason: 'access_denied',
    elevated: true
  })
  expect(runningProcesses.has('C:/Tools/SimHub.exe')).toBe(false)
})

test('killLaunchedApps treats not-found full-path app as closed when image no longer exists', async () => {
  const { killLaunchedApps, unclosedProcesses } = await loadProcessModulesWithStore({
    profiles: {
      ac: { activeProfileId: 'default', profiles: [{ id: 'default', name: 'Default' }] }
    },
    appPaths: { simhub: 'C:/Tools/SimHub.exe' }
  })

  markExistingPath('C:/Tools/SimHub.exe')
  processNames.add('simhub.exe')
  inaccessibleExecutablePathProcesses.add('simhub.exe')

  await expect(killLaunchedApps('ac')).resolves.toMatchObject({
    success: true,
    closedCount: 1,
    failedCount: 0,
    failures: []
  })

  expect(unclosedProcesses.has('ac:c:/tools/simhub.exe')).toBe(false)
})

test('killLaunchedApps treats stale taskkill PID responses as closed', async () => {
  const { killLaunchedApps, unclosedProcesses } = await loadProcessModulesWithStore({
    profiles: {
      ac: { activeProfileId: 'default', profiles: [{ id: 'default', name: 'Default' }] }
    },
    appPaths: { simhub: 'C:/Tools/SimHub.exe' }
  })

  markExistingPath('C:/Tools/SimHub.exe')
  processNames.add('simhub.exe')
  staleTaskkillPids.add('4321')

  const result = await killLaunchedApps('ac')

  expect(result).toMatchObject({
    success: true,
    closedCount: 1,
    failedCount: 0,
    failures: []
  })
  expect(result.error).toBeUndefined()
  expect(unclosedProcesses.has('ac:c:/tools/simhub.exe')).toBe(false)
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
  unclosedProcesses.set('ac:c:/tools/stale.exe', {
    path: 'C:/Tools/Stale.exe',
    name: 'Stale.exe',
    gameKey: 'ac',
    error: 'still running',
    reason: 'still_running',
    elevated: false
  })
  unclosedProcesses.set('ac:c:/tools/simhub.exe', {
    path: 'C:/Tools/SimHub.exe',
    name: 'SimHub.exe',
    gameKey: 'ac',
    error: 'access denied',
    reason: 'access_denied',
    elevated: true
  })

  pruneUnclosedProcesses(new Set(['simhub.exe']))

  expect(unclosedProcesses.has('ac:c:/tools/stale.exe')).toBe(false)
  expect(unclosedProcesses.get('ac:c:/tools/simhub.exe')).toMatchObject({
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
  const { killProfileApps, runningProcesses, unclosedProcesses } =
    await loadProcessModulesWithStore({
      appPaths: { simhub: 'C:/Tools/SimHub.exe' }
    })
  runningProcesses.set('C:/Tools/SimHub.exe', {
    process: { pid: 1234 } as never,
    name: 'SimHub.exe',
    gameKey: 'ac',
    isGame: false
  })
  unclosedProcesses.set('ac:c:/tools/simhub.exe', {
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
  expect(unclosedProcesses.has('ac:c:/tools/simhub.exe')).toBe(false)
  expect(runningProcesses.has('C:/Tools/SimHub.exe')).toBe(false)
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
