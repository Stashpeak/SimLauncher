type StoreData = Record<string, unknown>

const storeData: StoreData = {}
const existingPaths = new Set<string>()
const processNames = new Set<string>()

vi.mock('electron-store', () => ({
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

vi.mock('fs', () => ({
  default: {
    existsSync: (filePath: string) => existingPaths.has(filePath.replace(/\\/g, '/').trim())
  }
}))

vi.mock('child_process', () => ({
  execFile: vi.fn((_command, _args, _options, callback) => callback(null, '', '')),
  spawn: vi.fn((appPath: string) => {
    const handlers = new Map<string, (...args: unknown[]) => void>()
    const child = {
      pid: 1234,
      once: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        handlers.set(event, handler)
        if (event === 'spawn') {
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

vi.mock('../../src/main/processes/tasklist', () => ({
  readRunningProcessNames: vi.fn(() => Promise.resolve(new Set(processNames)))
}))

async function loadProcessModules() {
  const spawnModule = await import('../../src/main/processes/spawn')
  const killModule = await import('../../src/main/processes/kill')
  const stateModule = await import('../../src/main/processes/state')

  return {
    launchProfileApps: spawnModule.launchProfileApps,
    killLaunchedApps: killModule.killLaunchedApps,
    killProfileApps: killModule.killProfileApps,
    runningProcesses: stateModule.runningProcesses,
    unclosedProcesses: stateModule.unclosedProcesses
  }
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

test('killLaunchedApps returns a no-op kill result when no companion apps are running', async () => {
  const { killLaunchedApps } = await loadProcessModules()

  await expect(killLaunchedApps('ac')).resolves.toEqual({
    success: true,
    message: 'No running companion apps to close.',
    closedCount: 0,
    failedCount: 0
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
    failedCount: 0
  })
})
