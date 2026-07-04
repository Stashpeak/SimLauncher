import { expect, test, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

import { BUILT_IN_UTILITIES } from '../../src/renderer/src/lib/config'
import { BUILT_IN_UTILITY_KEYS } from '../../src/main/profiles'

// Case-insensitive like the GAMES icon check in gamesConfig.test.ts:
// SimLauncher is Windows-only, where filename case is not significant.
const assetFilesLowercase = new Set(
  fs.readdirSync(path.resolve(process.cwd(), 'assets')).map((name) => name.toLowerCase())
)

/**
 * Regression coverage for #652 (Track Titan built-in companion).
 *
 * BUILT_IN_UTILITIES (renderer/src/lib/config.ts) is duplicated in two other
 * places that must stay in lockstep — profiles.ts' BUILT_IN_UTILITY_KEYS
 * (drives default launch order for legacy flat-boolean profiles) and store.ts'
 * KNOWN_UTILITY_KEYS (the config-import allowlist for appPaths). A key added
 * to one and forgotten in another either silently drops a companion's saved
 * path (#669-style) or launches utilities out of the intended order.
 */

test('BUILT_IN_UTILITIES keys match profiles.ts BUILT_IN_UTILITY_KEYS exactly, in order', () => {
  const configKeys = BUILT_IN_UTILITIES.map((utility) => utility.key)
  expect(configKeys).toEqual(BUILT_IN_UTILITY_KEYS)
})

test('every BUILT_IN_UTILITIES entry that declares a bundled icon has it on disk (#727)', () => {
  for (const utility of BUILT_IN_UTILITIES) {
    if (!utility.icon) continue
    const iconFile = path.basename(utility.icon).toLowerCase()
    expect(assetFilesLowercase.has(iconFile), `${utility.icon} missing on disk`).toBe(true)
  }
})

test('Track Titan is registered as a built-in utility, positioned first (#652)', () => {
  const trackTitan = BUILT_IN_UTILITIES.find((utility) => utility.key === 'tracktitan')
  expect(trackTitan).toBeDefined()
  expect(trackTitan?.name).toBe('Track Titan')
  // A telemetry recorder needs to be alive before/at session start to capture
  // the whole lap, so it defaults to the front of the launch order.
  expect(BUILT_IN_UTILITIES[0].key).toBe('tracktitan')
})

// The save-settings harness below is copied from configSaveSettings.test.ts
// (#669 coverage) to exercise the REAL store.ts sanitizer + KNOWN_UTILITY_KEYS
// allowlist through the actual ipcMain handler, rather than reaching into
// store.ts internals (KNOWN_UTILITY_KEYS itself isn't exported).
type MockIpcHandler = (...args: unknown[]) => unknown
interface SaveSettingsResult {
  settings: { appPaths: Record<string, string> }
  dropped: { field: string; key: string; reason: string }[]
}

async function invokeSaveSettings(patch: unknown): Promise<SaveSettingsResult> {
  const { __ipcHandlers } = await import('electron')
  return (await (__ipcHandlers as Record<string, MockIpcHandler>)['save-settings'](
    {},
    patch
  )) as SaveSettingsResult
}

async function loadConfigModule() {
  const { clearIpcHandlers } = await import('electron')
  ;(clearIpcHandlers as () => void)()

  vi.doMock('electron-store', () => ({
    default: class MockStore {
      store: Record<string, unknown> = { customSlots: 1 }

      get(key: string) {
        return this.store[key]
      }

      set(key: string, value: unknown) {
        this.store[key] = value
      }

      clear() {
        this.store = {}
      }
    }
  }))
  vi.doMock('../../src/main/migrator', () => ({ migrateProfilesToNamedSets: vi.fn() }))
  vi.doMock('../../src/main/profiles', () => ({ isStoredProfileSet: vi.fn() }))
  vi.doMock('../../src/main/tray', () => ({ applyTrayVisibility: vi.fn() }))
  vi.doMock('../../src/main/window', () => ({
    applyRuntimeConfigSettings: vi.fn(),
    getMainWindow: vi.fn(),
    sendToRenderer: vi.fn()
  }))

  const mod = await import('../../src/main/ipc/config')
  mod.registerConfigHandlers()
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})

test('save-settings accepts a tracktitan appPaths entry (KNOWN_UTILITY_KEYS allowlist, #652)', async () => {
  await loadConfigModule()

  const result = await invokeSaveSettings({
    appPaths: { tracktitan: 'C:/Program Files/Track Titan/Datalogger.exe' },
    customSlots: 1
  })

  expect(result.dropped).toEqual([])
  expect(result.settings.appPaths).toEqual({
    tracktitan: 'C:/Program Files/Track Titan/Datalogger.exe'
  })
})
