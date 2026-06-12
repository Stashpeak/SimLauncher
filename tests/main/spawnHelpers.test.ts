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

test('parseCommandLineArgs splits plain and double-quoted arguments', async () => {
  const { parseCommandLineArgs } = await loadSpawnModule()

  expect(parseCommandLineArgs('--fullscreen -w 1920')).toEqual(['--fullscreen', '-w', '1920'])
  expect(parseCommandLineArgs('--config "C:\\My Path\\settings.ini"')).toEqual([
    '--config',
    'C:\\My Path\\settings.ini'
  ])
  expect(parseCommandLineArgs('--title \\"quoted\\"')).toEqual(['--title', '"quoted"'])
})

// The #504 edge: a quoted path with a trailing backslash must close the quote
// instead of swallowing the rest of the line into one argument.
test('parseCommandLineArgs handles quoted paths ending in a backslash (#504)', async () => {
  const { parseCommandLineArgs } = await loadSpawnModule()

  expect(parseCommandLineArgs('"C:\\My Path\\" --flag')).toEqual(['C:\\My Path\\', '--flag'])
  // The strict Windows-convention spelling of the same intent.
  expect(parseCommandLineArgs('"C:\\My Path\\\\" --flag')).toEqual(['C:\\My Path\\', '--flag'])
  // A trailing-backslash path as the final token.
  expect(parseCommandLineArgs('--out "D:\\Logs\\"')).toEqual(['--out', 'D:\\Logs\\'])
})

// Codex P2 on #508: an escaped quote before whitespace inside a NON-path
// quoted value keeps the strict Windows behaviour (one argument containing a
// literal quote) — only path-looking tokens get the closing deviation.
test('parseCommandLineArgs keeps escaped quotes in non-path quoted values', async () => {
  const { parseCommandLineArgs } = await loadSpawnModule()

  expect(parseCommandLineArgs('--title "Lap \\" time"')).toEqual(['--title', 'Lap " time'])
  expect(parseCommandLineArgs('"say \\" loudly \\" twice"')).toEqual(['say " loudly " twice'])
  // A sentence merely CONTAINING a path is not a path token — the heuristic
  // is anchored to the token start, so the literal quote survives here.
  expect(parseCommandLineArgs('--title "Saved under C:\\Logs\\" today"')).toEqual([
    '--title',
    'Saved under C:\\Logs" today'
  ])
})

test('parseCommandLineArgs closes path tokens supplied as --key=value payloads (#504)', async () => {
  const { parseCommandLineArgs } = await loadSpawnModule()

  expect(parseCommandLineArgs('"--log=C:\\Temp\\" -v')).toEqual(['--log=C:\\Temp\\', '-v'])
})

test('parseCommandLineArgs keeps backslash runs not followed by a quote literal', async () => {
  const { parseCommandLineArgs } = await loadSpawnModule()

  expect(parseCommandLineArgs('\\\\server\\share\\file.cfg')).toEqual([
    '\\\\server\\share\\file.cfg'
  ])
  expect(parseCommandLineArgs('"a\\\\b c"')).toEqual(['a\\\\b c'])
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
