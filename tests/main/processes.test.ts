import type { WebContents } from 'electron'
import { beforeEach, expect, test, vi } from 'vitest'

type StoreData = Record<string, unknown>
type MockWebContents = {
  isDestroyed: () => boolean
  send: ReturnType<typeof vi.fn>
  once: ReturnType<typeof vi.fn>
}

const storeData: StoreData = {}
const existingPaths = new Set<string>()
const processNames = new Set<string>()
const accessDeniedPids = new Set<string>()
const nullExecutablePathPids = new Set<string>()
const execFileCalls: { command: string; args: string[]; options: Record<string, unknown> }[] = []
const spawnCalls: { appPath: string; args: string[]; options: Record<string, unknown> }[] = []
const spawnErrors = new Map<string, NodeJS.ErrnoException>()

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
    }
  }))

  vi.doMock('fs', () => ({
    default: {
      existsSync: (filePath: string) => existingPaths.has(filePath.replace(/\\/g, '/').trim())
    }
  }))

  vi.doMock('child_process', () => ({
    execFile: vi.fn((command, args, options, callback) => {
      execFileCalls.push({ command, args, options })
      if (command === 'powershell.exe') {
        const pids = [
          ...(processNames.has('simhub.exe') ? ['4321'] : []),
          ...Array.from(nullExecutablePathPids)
        ]
        callback(null, pids.length ? JSON.stringify(pids.map(Number)) : '', '')
        return
      }
      if (command === 'taskkill' && args.includes('/PID')) {
        const pid = args[args.indexOf('/PID') + 1]
        if (accessDeniedPids.has(pid)) {
          callback(new Error('Access is denied.'), '', 'Access is denied.')
          return
        }
        if (pid === '4321') {
          processNames.delete('simhub.exe')
        }
        nullExecutablePathPids.delete(pid)
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

  vi.doMock('../../src/main/processes/tasklist', () => ({
    readRunningProcessNames: vi.fn(() => Promise.resolve(new Set(processNames)))
  }))

  vi.doMock('../../src/main/store', () => ({
    store: {
      get: vi.fn((key: string) => storeData[key]),
      set: vi.fn((key: string, value: unknown) => {
        storeData[key] = value
      })
    }
  }))

  vi.doMock('../../src/main/profiles', () => ({
    getActiveStoredProfile: vi.fn((p: { activeProfileId: string; profiles: { id: string }[] }) =>
      p.profiles.find((i) => i.id === p.activeProfileId)
    ),
    getProfileTrackablePaths: vi.fn(
      (
        gameKey: string,
        _profile: unknown,
        appPaths: Record<string, string> | undefined,
        gamePaths: Record<string, string> | undefined
      ) => [...(gamePaths?.[gameKey] ? [gamePaths[gameKey]] : []), ...Object.values(appPaths || {})]
    )
  }))

  const spawnModule = await import('../../src/main/processes/spawn')
  const killModule = await import('../../src/main/processes/kill')
  const stateModule = await import('../../src/main/processes/state')

  return {
    launchProfileApps: spawnModule.launchProfileApps,
    killLaunchedApps: killModule.killLaunchedApps,
    killProfileApps: killModule.killProfileApps,
    runningProcesses: stateModule.runningProcesses,
    unclosedProcesses: stateModule.unclosedProcesses,
    getRunningApps: (await import('../../src/main/processes/running')).getRunningApps,
    subscribeRunningApps: (await import('../../src/main/processes/running')).subscribeRunningApps,
    publishRunningApps: (await import('../../src/main/processes/running')).publishRunningApps
  }
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
} as never

beforeEach(async () => {
  const { runningProcesses, unclosedProcesses } = await loadProcessModules()

  vi.clearAllMocks()
  existingPaths.clear()
  processNames.clear()
  accessDeniedPids.clear()
  nullExecutablePathPids.clear()
  execFileCalls.length = 0
  spawnCalls.length = 0
  spawnErrors.clear()
  runningProcesses.clear()
  unclosedProcesses.clear()
  Object.keys(storeData).forEach((key) => delete storeData[key])
  storeData.launchDelayMs = 0
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

  existingPaths.add('C:/Tools/SimHub.exe')
  processNames.add('simhub.exe')

  await expect(launchProfileApps(sender, 'ac', ['C:/Tools/SimHub.exe'])).resolves.toMatchObject({
    success: true,
    launchedCount: 0,
    skippedCount: 1,
    message: 'All profile applications are already running.'
  })
})

test('launchProfileApps parses custom app arguments with quoted paths and escaped quotes', async () => {
  const { launchProfileApps } = await loadProcessModules()

  existingPaths.add('C:/Tools/Custom Tool.exe')
  storeData.appPaths = { customapp1: 'C:/Tools/Custom Tool.exe' }
  storeData.appArgs = {
    customapp1: String.raw`--config "C:/Users/Driver/Sim Configs/main profile.json" --label "Crew \"Chief\""`
  }

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
})

test('launchProfileApps treats PowerShell-sensitive custom argument characters as literal spawn args', async () => {
  const { launchProfileApps } = await loadProcessModules()

  existingPaths.add('C:/Tools/Custom Tool.exe')
  existingPaths.add('C:/Tools/Custom Tool.exe --flag ^caret')
  storeData.appPaths = { customapp1: 'C:/Tools/Custom Tool.exe' }
  storeData.appArgs = {
    customapp1:
      '--name "literal & value" --pattern "$(Get-Process); | %{rm} `whoami`" --flag "^caret"'
  }

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
  const { launchProfileApps } = await loadProcessModules()

  existingPaths.add('C:/Tools/Admin Tool.exe')
  existingPaths.add(`C:/Tools/Admin Tool.exe --literal "$(Start-Process calc); 'single' & value"`)
  spawnErrors.set('C:/Tools/Admin Tool.exe', makeAccessDeniedError())
  storeData.appPaths = { customapp1: 'C:/Tools/Admin Tool.exe' }
  storeData.appArgs = {
    customapp1: `--path "C:/Users/Driver/Sim Configs" --literal "$(Start-Process calc); 'single' & value"`
  }

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

  existingPaths.add('C:/Tools/Admin Tool.exe')
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

  existingPaths.add('C:/Tools/Unknown.exe')
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
  const { killProfileApps } = await loadProcessModules()

  existingPaths.add('C:/Tools/SimHub.exe')
  processNames.add('simhub.exe')
  storeData.appPaths = { simhub: 'C:/Tools/SimHub.exe' }

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
})

test('killProfileApps includes processes with null executable paths when resolving PIDs', async () => {
  const { killProfileApps } = await loadProcessModules()

  existingPaths.add('C:/Tools/SimHub.exe')
  processNames.add('simhub.exe')
  nullExecutablePathPids.add('9876')
  storeData.appPaths = { simhub: 'C:/Tools/SimHub.exe' }

  await expect(killProfileApps('ac', ['C:/Tools/SimHub.exe'])).resolves.toMatchObject({
    success: true,
    closedCount: 1,
    failedCount: 0
  })

  expect(execFileCalls).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        command: 'powershell.exe',
        args: expect.arrayContaining([expect.stringContaining('(-not $_.ExecutablePath) -or')])
      }),
      expect.objectContaining({
        command: 'taskkill',
        args: ['/PID', '9876', '/T', '/F']
      })
    ])
  )
  expect(execFileCalls).not.toEqual(
    expect.arrayContaining([
      expect.objectContaining({ command: 'taskkill', args: ['/IM', 'simhub.exe', '/T', '/F'] })
    ])
  )
})

test('killProfileApps publishes promptly when untracked app remains elevated after kill failure', async () => {
  const { killProfileApps, subscribeRunningApps } = await loadProcessModules()
  const webContents = createMockWebContents()

  storeData.profiles = {
    ac: { activeProfileId: 'default', profiles: [{ id: 'default', name: 'Default' }] }
  }
  storeData.gamePaths = { ac: 'C:/Games/AssettoCorsa.exe' }
  storeData.appPaths = { simhub: 'C:/Tools/SimHub.exe' }
  existingPaths.add('C:/Games/AssettoCorsa.exe')
  existingPaths.add('C:/Tools/SimHub.exe')
  processNames.add('assettocorsa.exe')
  processNames.add('simhub.exe')
  accessDeniedPids.add('4321')

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

test('subscribeRunningApps returns initial snapshot and tracks subscriber', async () => {
  const { subscribeRunningApps } = await loadProcessModules()
  const webContents = createMockWebContents()

  const snapshot = await subscribeRunningApps(asWebContents(webContents))
  expect(snapshot.reason).toBe('initial')
  expect(snapshot.apps).toEqual([])
  expect(webContents.once).toHaveBeenCalledWith('destroyed', expect.any(Function))
})

test('publishRunningApps emits changed event to subscribers when state changes', async () => {
  const { subscribeRunningApps, publishRunningApps } = await loadProcessModules()
  const webContents = createMockWebContents()

  storeData.profiles = {
    ac: { activeProfileId: 'default', profiles: [{ id: 'default', name: 'Default' }] }
  }
  storeData.gamePaths = { ac: 'C:/Games/AssettoCorsa.exe' }
  existingPaths.add('C:/Games/AssettoCorsa.exe')
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
