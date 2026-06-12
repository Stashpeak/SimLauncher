import { beforeEach, expect, test, vi } from 'vitest'

const storeData: Record<string, unknown> = {}

async function loadSpawnModule() {
  const storeMock = {
    getStoredStringRecord: vi.fn((key: string) => {
      const value = storeData[key]
      return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, string>)
        : {}
    }),
    store: {
      get: vi.fn((key: string) => storeData[key])
    }
  }
  vi.doMock('../store', () => storeMock)
  vi.doMock('/src/main/store.ts', () => storeMock)
  vi.doMock('../../src/main/store', () => storeMock)
  vi.doMock('../../src/main/store.ts', () => storeMock)

  return await import('../../src/main/processes/spawn')
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  Object.keys(storeData).forEach((key) => delete storeData[key])
})

test('getLaunchDelayMs clamps stored values into the 0–30000 ms range', async () => {
  const { getLaunchDelayMs } = await loadSpawnModule()

  storeData.launchDelayMs = -500
  expect(getLaunchDelayMs()).toBe(0)

  storeData.launchDelayMs = 35000
  expect(getLaunchDelayMs()).toBe(30000)

  storeData.launchDelayMs = 1234.6
  expect(getLaunchDelayMs()).toBe(1235)
})

test('getLaunchDelayMs falls back to 1000 ms for missing or non-finite values', async () => {
  const { getLaunchDelayMs } = await loadSpawnModule()

  for (const value of [undefined, NaN, Infinity, 'fast']) {
    storeData.launchDelayMs = value
    expect(getLaunchDelayMs()).toBe(1000)
  }
})

test('normalizeLaunchInput passes {key, path} entries through unchanged', async () => {
  const { normalizeLaunchInput } = await loadSpawnModule()

  expect(
    normalizeLaunchInput({ key: 'customapp2', path: 'C:/Tools/Overlay.exe' }, 'iracing')
  ).toEqual({ key: 'customapp2', path: 'C:/Tools/Overlay.exe' })
})

// The key drives both per-slot launch args (#357) and the isGame flag on the
// running-process entry, which in turn feeds kill exclusion — a wrong key here
// means a profile switch could treat the running sim as a closable utility.
test('normalizeLaunchInput resolves a plain game path to the game key', async () => {
  const { normalizeLaunchInput } = await loadSpawnModule()
  storeData.gamePaths = { iracing: 'C:/Games/iRacingUI.exe' }
  storeData.appPaths = { simhub: 'C:/Tools/SimHub.exe' }

  expect(normalizeLaunchInput('c:\\games\\IRACINGUI.EXE', 'iracing')).toEqual({
    key: 'iracing',
    path: 'c:\\games\\IRACINGUI.EXE'
  })
})

test('normalizeLaunchInput resolves a plain utility path via appPaths reverse lookup', async () => {
  const { normalizeLaunchInput } = await loadSpawnModule()
  storeData.gamePaths = { iracing: 'C:/Games/iRacingUI.exe' }
  storeData.appPaths = { simhub: 'C:/Tools/SimHub.exe' }

  expect(normalizeLaunchInput('C:/Tools/SimHub.exe', 'iracing')).toEqual({
    key: 'simhub',
    path: 'C:/Tools/SimHub.exe'
  })

  // Unknown paths keep the path itself as the key (no args lookup match).
  expect(normalizeLaunchInput('C:/Tools/Unknown.exe', 'iracing')).toEqual({
    key: 'C:/Tools/Unknown.exe',
    path: 'C:/Tools/Unknown.exe'
  })
})
