import type { WebContents } from 'electron'
import { beforeEach, expect, test, vi } from 'vitest'

import type { ProfileLaunchEntry } from '../../src/main/processes/types'

type ElectronMockShape = typeof import('./electronMock')

async function loadElectronMock(): Promise<ElectronMockShape> {
  // Use the same `electron` alias as production code so the IPC-handler map
  // we read from is the one the handler registration writes to. Resolved
  // fresh each call so it picks up the post-`vi.resetModules()` instance.
  return (await import('electron')) as unknown as ElectronMockShape
}

type LaunchFailureResult = { success: false; error: string }

type ProfileLaunchInput = string | ProfileLaunchEntry

const mocks = vi.hoisted(() => ({
  storeData: { gamePaths: {} as Record<string, string> },
  buildNamedProfileLaunchEntries: vi.fn<
    (gameKey: string, profileId: string) => ProfileLaunchEntry[]
  >(() => []),
  buildActiveProfileLaunchEntries: vi.fn<(gameKey: string) => ProfileLaunchEntry[]>(() => []),
  readRunningProcessNames: vi.fn<() => Promise<{ processNames: Set<string>; succeeded: boolean }>>(
    async () => ({ processNames: new Set<string>(), succeeded: true })
  ),
  launchProfileApps: vi.fn<
    (sender: WebContents, gameKey: string, entries: ProfileLaunchInput[]) => Promise<unknown>
  >(async () => ({ success: true, launchedCount: 0, skippedCount: 0 })),
  killProfileApps: vi.fn<(gameKey: string, paths: string[]) => Promise<unknown>>(async () => ({
    success: true,
    closedCount: 0,
    failedCount: 0,
    failures: []
  }))
}))

vi.mock('../../src/main/store', () => ({
  KNOWN_GAME_KEYS: new Set(['ac', 'acc']),
  store: {
    get: vi.fn((key: string, fallback?: unknown) => {
      if (key === 'gamePaths') {
        return mocks.storeData.gamePaths ?? fallback
      }
      return fallback
    })
  },
  getStoredStringRecord: vi.fn((key: string) => {
    const value = (mocks.storeData as Record<string, unknown>)[key]
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, string>)
      : {}
  })
}))

vi.mock('../../src/main/profiles', () => ({
  buildActiveProfileLaunchEntries: (gameKey: string) =>
    mocks.buildActiveProfileLaunchEntries(gameKey),
  buildNamedProfileLaunchEntries: (gameKey: string, profileId: string) =>
    mocks.buildNamedProfileLaunchEntries(gameKey, profileId)
}))

vi.mock('../../src/main/processes', () => ({
  readRunningProcessNames: () => mocks.readRunningProcessNames(),
  launchProfileApps: (sender: WebContents, gameKey: string, entries: ProfileLaunchInput[]) =>
    mocks.launchProfileApps(sender, gameKey, entries),
  killProfileApps: (gameKey: string, paths: string[]) => mocks.killProfileApps(gameKey, paths),
  killLaunchedApps: vi.fn(),
  getRunningApps: vi.fn(),
  isRunningExePath: (processNames: Set<string>, appPath: string) =>
    processNames.has(appPath.split(/[\\/]/).pop()?.toLowerCase() ?? ''),
  subscribeRunningApps: vi.fn(),
  unsubscribeRunningApps: vi.fn()
}))

vi.mock('../../src/main/utils', () => ({
  getExeName: (p: string) => p.split(/[\\/]/).pop()?.toLowerCase() ?? ''
}))

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  const { clearIpcHandlers } = await loadElectronMock()
  clearIpcHandlers()
  mocks.storeData = { gamePaths: { ac: 'C:/Games/AssettoCorsa.exe' } }
  mocks.buildNamedProfileLaunchEntries.mockReset()
  mocks.buildActiveProfileLaunchEntries.mockReset()
  mocks.readRunningProcessNames.mockReset()
  mocks.readRunningProcessNames.mockResolvedValue({
    processNames: new Set<string>(),
    succeeded: true
  })
  mocks.launchProfileApps.mockReset()
  mocks.launchProfileApps.mockResolvedValue({
    success: true,
    launchedCount: 0,
    skippedCount: 0
  })
  mocks.killProfileApps.mockReset()
  mocks.killProfileApps.mockResolvedValue({
    success: true,
    closedCount: 0,
    failedCount: 0,
    failures: []
  })
})

async function validate(gameKey: unknown) {
  const { validateGameKey } = await import('../../src/main/ipc/launch')
  return validateGameKey(gameKey) as LaunchFailureResult | undefined
}

test.each([
  'launch-profile',
  'relaunch-missing-profile',
  'get-profile-switch-diff',
  'switch-profile-apps',
  'kill-launched-apps'
])('%s rejects non-string gameKey arguments', async (channel) => {
  expect(channel).toBeTruthy()
  await expect(validate(42)).resolves.toEqual({
    success: false,
    error: 'Invalid argument'
  })
})

test.each([
  'launch-profile',
  'relaunch-missing-profile',
  'get-profile-switch-diff',
  'switch-profile-apps',
  'kill-launched-apps'
])('%s rejects unknown gameKey arguments', async (channel) => {
  expect(channel).toBeTruthy()
  await expect(validate('unknown')).resolves.toEqual({
    success: false,
    error: 'Unknown game key'
  })
})

test('validateGameKey accepts known game keys even when no matching game path is stored', async () => {
  mocks.storeData = { gamePaths: {} }

  await expect(validate('acc')).resolves.toBeUndefined()
})

test('validateGameKey rejects user-injected game path keys that are not known games', async () => {
  mocks.storeData = { gamePaths: { injected: 'C:/Games/Injected.exe' } }

  await expect(validate('injected')).resolves.toEqual({
    success: false,
    error: 'Unknown game key'
  })
})

test('validateProfileIds rejects non-string from-profile ids', async () => {
  const { validateProfileIds } = await import('../../src/main/ipc/launch')

  expect(validateProfileIds(42, 'race')).toEqual({
    success: false,
    error: 'Invalid argument'
  })
})

test('validateProfileIds rejects non-string to-profile ids', async () => {
  const { validateProfileIds } = await import('../../src/main/ipc/launch')

  expect(validateProfileIds('base', {})).toEqual({
    success: false,
    error: 'Invalid argument'
  })
})

test('validateProfileIds accepts string profile ids', async () => {
  const { validateProfileIds } = await import('../../src/main/ipc/launch')

  expect(validateProfileIds('base', 'race')).toBeUndefined()
})

test('getProfileLaunchEntryId distinguishes utility slots that share an executable path', async () => {
  // Two custom-app slots configured with the same .exe but different keys
  // (e.g. one carries `--mode debug` args, the other `--mode silent`). The
  // diff helper that powers `switch-profile-apps` must consider these as
  // different entries so a slot swap triggers a stop + relaunch with the
  // new args (regression for #397, follow-up to #357).
  const { getProfileLaunchEntryId } = await import('../../src/main/ipc/launch')

  const slot1 = { key: 'customapp1', path: 'C:/Tools/Shared Utility.exe' }
  const slot2 = { key: 'customapp2', path: 'C:/Tools/Shared Utility.exe' }

  expect(getProfileLaunchEntryId(slot1)).not.toBe(getProfileLaunchEntryId(slot2))
})

test('getProfileLaunchEntryId is case-insensitive for the executable path', async () => {
  const { getProfileLaunchEntryId } = await import('../../src/main/ipc/launch')

  expect(getProfileLaunchEntryId({ key: 'customapp1', path: 'C:/Tools/Shared Utility.exe' })).toBe(
    getProfileLaunchEntryId({ key: 'customapp1', path: 'c:/Tools/shared utility.exe' })
  )
})

test('switch-profile-apps stops and relaunches when a slot moves to a new key but keeps the same exe', async () => {
  // Regression for #397: after the #357 key-based arg refactor, switching a
  // utility from one slot/key to another while keeping the same .exe used to
  // be treated as "no change" because the diff only compared paths. The
  // process kept running with the outgoing slot's args. Now we diff on
  // {key, path}, so the outgoing process is stopped and the incoming slot is
  // launched with its own args.
  mocks.buildNamedProfileLaunchEntries.mockImplementation((_game, profileId) => {
    if (profileId === 'from') {
      return [{ key: 'customapp1', path: 'C:/Tools/Shared Utility.exe' }]
    }
    if (profileId === 'to') {
      return [{ key: 'customapp2', path: 'C:/Tools/Shared Utility.exe' }]
    }
    return []
  })
  mocks.readRunningProcessNames
    .mockResolvedValueOnce({ processNames: new Set(['shared utility.exe']), succeeded: true })
    .mockResolvedValueOnce({ processNames: new Set<string>(), succeeded: true })

  const { registerLaunchHandlers } = await import('../../src/main/ipc/launch')
  registerLaunchHandlers()

  const { __ipcHandlers } = await loadElectronMock()
  const handler = __ipcHandlers['switch-profile-apps']
  const sender = { isDestroyed: () => false, send: vi.fn() } as unknown as WebContents
  await handler({ sender } as never, 'ac', 'from', 'to')

  expect(mocks.killProfileApps).toHaveBeenCalledWith('ac', ['C:/Tools/Shared Utility.exe'])
  expect(mocks.launchProfileApps).toHaveBeenCalledWith(sender, 'ac', [
    { key: 'customapp2', path: 'C:/Tools/Shared Utility.exe' }
  ])
})

test('switch-profile-apps relaunches the incoming slot even when its exe is still in tasklist after the kill', async () => {
  // Edge case of the same regression: a same-exe slot swap stops the old
  // process, but the tasklist recheck immediately afterwards may still
  // briefly report the image as running. The handler must still launch the
  // incoming slot — otherwise the old args remain effectively active until
  // the next launch attempt. We rely on `stoppedExeNames` to override the
  // "already running" skip when that exe was just stopped.
  mocks.buildNamedProfileLaunchEntries.mockImplementation((_game, profileId) => {
    if (profileId === 'from') {
      return [{ key: 'customapp1', path: 'C:/Tools/Shared Utility.exe' }]
    }
    if (profileId === 'to') {
      return [{ key: 'customapp2', path: 'C:/Tools/Shared Utility.exe' }]
    }
    return []
  })
  mocks.readRunningProcessNames
    .mockResolvedValueOnce({ processNames: new Set(['shared utility.exe']), succeeded: true })
    .mockResolvedValueOnce({ processNames: new Set(['shared utility.exe']), succeeded: true })

  const { registerLaunchHandlers } = await import('../../src/main/ipc/launch')
  registerLaunchHandlers()

  const { __ipcHandlers } = await loadElectronMock()
  const handler = __ipcHandlers['switch-profile-apps']
  const sender = { isDestroyed: () => false, send: vi.fn() } as unknown as WebContents
  await handler({ sender } as never, 'ac', 'from', 'to')

  expect(mocks.launchProfileApps).toHaveBeenCalledWith(sender, 'ac', [
    { key: 'customapp2', path: 'C:/Tools/Shared Utility.exe' }
  ])
})

test('switch-profile-apps treats unchanged {key, path} entries as no-op', async () => {
  // Sanity check: if the SAME slot/key points at the SAME exe in both
  // profiles, the handler should not kill or relaunch anything.
  mocks.buildNamedProfileLaunchEntries.mockImplementation(() => [
    { key: 'customapp1', path: 'C:/Tools/Shared Utility.exe' }
  ])
  mocks.readRunningProcessNames.mockResolvedValue({
    processNames: new Set(['shared utility.exe']),
    succeeded: true
  })

  const { registerLaunchHandlers } = await import('../../src/main/ipc/launch')
  registerLaunchHandlers()

  const { __ipcHandlers } = await loadElectronMock()
  const handler = __ipcHandlers['switch-profile-apps']
  const sender = { isDestroyed: () => false, send: vi.fn() } as unknown as WebContents
  await handler({ sender } as never, 'ac', 'from', 'to')

  expect(mocks.killProfileApps).not.toHaveBeenCalled()
  expect(mocks.launchProfileApps).not.toHaveBeenCalled()
})
