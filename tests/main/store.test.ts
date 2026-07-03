import { expect, test, vi } from 'vitest'

async function loadStoreModule() {
  vi.doMock('electron-store', () => ({
    default: class MockStore {
      store: Record<string, unknown> = {}

      get(key: string) {
        return this.store[key]
      }

      set(key: string, value: unknown) {
        this.store[key] = value
      }
    }
  }))

  const storeModule = await import('../../src/main/store')
  return {
    getStoredBoolean: storeModule.getStoredBoolean,
    getStoredStringRecord: storeModule.getStoredStringRecord,
    EXPECTED_CONFIG_KEYS: storeModule.EXPECTED_CONFIG_KEYS,
    MAX_CUSTOM_SLOTS: storeModule.MAX_CUSTOM_SLOTS,
    sanitizeSettingsPatch: storeModule.sanitizeSettingsPatch,
    sanitizeImportedConfig: storeModule.sanitizeImportedConfig,
    createResilientStore: storeModule.createResilientStore,
    createInMemoryFallbackStore: storeModule.createInMemoryFallbackStore,
    formatConfigRecoveryNotice: storeModule.formatConfigRecoveryNotice,
    store: storeModule.store
  }
}

test('createResilientStore returns the store with no recovery notice when construction succeeds', async () => {
  const { createResilientStore } = await loadStoreModule()
  const fakeStore = { id: 'ok' }
  const quarantine = vi.fn(() => null)

  const createFallback = vi.fn(() => ({ id: 'fallback' }))

  const result = createResilientStore(() => fakeStore, quarantine, createFallback)

  expect(result.store).toBe(fakeStore)
  expect(result.recovery).toBeNull()
  expect(quarantine).not.toHaveBeenCalled()
  expect(createFallback).not.toHaveBeenCalled()
})

test('createResilientStore quarantines a corrupt config and retries fresh', async () => {
  const { createResilientStore } = await loadStoreModule()
  const fresh = { id: 'fresh' }
  let attempt = 0
  const construct = vi.fn(() => {
    attempt += 1
    if (attempt === 1) throw new Error('corrupt config')
    return fresh
  })
  const quarantine = vi.fn(() => 'C:/userdata/config.corrupt-1.json')
  const createFallback = vi.fn(() => ({ id: 'fallback' }))

  const result = createResilientStore(construct, quarantine, createFallback)

  expect(result.store).toBe(fresh)
  expect(result.recovery).toEqual({ backupPath: 'C:/userdata/config.corrupt-1.json' })
  expect(quarantine).toHaveBeenCalledOnce()
  expect(construct).toHaveBeenNthCalledWith(1, false)
  expect(construct).toHaveBeenNthCalledWith(2, false)
  expect(createFallback).not.toHaveBeenCalled()
})

test('createResilientStore falls back to clearInvalidConfig when the retry also fails', async () => {
  const { createResilientStore } = await loadStoreModule()
  const cleared = { id: 'cleared' }
  const construct = vi.fn((clearInvalidConfig: boolean) => {
    if (!clearInvalidConfig) throw new Error('still corrupt / file locked')
    return cleared
  })
  const quarantine = vi.fn(() => null)
  const createFallback = vi.fn(() => ({ id: 'fallback' }))

  const result = createResilientStore(construct, quarantine, createFallback)

  expect(result.store).toBe(cleared)
  expect(result.recovery).toEqual({ backupPath: null })
  expect(construct).toHaveBeenLastCalledWith(true)
  expect(createFallback).not.toHaveBeenCalled()
})

test('createResilientStore boots an ephemeral in-memory fallback when even clearInvalidConfig throws (locked file)', async () => {
  const { createResilientStore } = await loadStoreModule()
  // Every construction attempt throws — simulates a locked/permission-denied
  // config.json, which electron-store rethrows (EBUSY/EPERM) instead of
  // resetting because it cannot read the file to reset it.
  const construct = vi.fn(() => {
    throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' })
  })
  const quarantine = vi.fn(() => null)
  const fallback = { id: 'in-memory' }
  const createFallback = vi.fn(() => fallback)

  const result = createResilientStore(construct, quarantine, createFallback)

  // The app gets a usable store and an ephemeral recovery notice instead of an
  // uncaught throw that would brick boot with no window/tray/dialog.
  expect(result.store).toBe(fallback)
  expect(result.recovery).toEqual({ backupPath: null, ephemeral: true })
  expect(construct).toHaveBeenCalledTimes(3)
  expect(construct).toHaveBeenLastCalledWith(true)
  expect(createFallback).toHaveBeenCalledOnce()
})

test('createInMemoryFallbackStore seeds schema defaults and supports get/set/clear/store', async () => {
  const { createInMemoryFallbackStore } = await loadStoreModule()
  const fallback = createInMemoryFallbackStore()

  // Seeded with schema defaults so the app behaves like a fresh install.
  expect(fallback.get('themeMode')).toBe('dark')
  expect(fallback.get('showTrayIcon')).toBe(true)
  expect(fallback.get('customSlots')).toBe(1)
  // Unknown keys honor the get(key, default) form.
  expect(fallback.get('nope', 'fallbackValue')).toBe('fallbackValue')

  fallback.set('themeMode', 'light')
  expect(fallback.get('themeMode')).toBe('light')

  // store getter returns a copy of the full config.
  const snapshot = fallback.store
  expect(snapshot.themeMode).toBe('light')
  snapshot.themeMode = 'mutated'
  expect(fallback.get('themeMode')).toBe('light')

  // The copy is DEEP (electron-store deserializes a fresh object per read), so
  // mutating a nested object on the returned config must not touch internal state.
  const deepSnapshot = fallback.store as { profiles: Record<string, unknown> }
  deepSnapshot.profiles.ac = { activeProfileId: 'mutated', profiles: [] }
  expect(fallback.get('profiles')).toEqual({})

  // clear() resets to schema defaults, matching electron-store semantics.
  fallback.clear()
  expect(fallback.get('themeMode')).toBe('dark')

  // Object defaults are cloned, not shared by reference: a handler mutating a
  // returned object default (e.g. save-profile does `profiles[key] = ...`) must
  // not corrupt the seed, so clear() still resets to a fresh empty object and a
  // second fallback instance is unaffected.
  const profiles = fallback.get('profiles') as Record<string, unknown>
  profiles.ac = { activeProfileId: 'x', profiles: [] }
  fallback.clear()
  expect(fallback.get('profiles')).toEqual({})
  expect(createInMemoryFallbackStore().get('profiles')).toEqual({})
})

test('formatConfigRecoveryNotice describes the reset and mentions a kept backup only when present', async () => {
  const { formatConfigRecoveryNotice } = await loadStoreModule()

  const withBackup = formatConfigRecoveryNotice({ backupPath: 'C:/x/config.corrupt-1.json' })
  expect(withBackup.type).toBe('warn')
  expect(withBackup.message).toContain('reset to defaults')
  expect(withBackup.message).toContain('kept next to it')

  const noBackup = formatConfigRecoveryNotice({ backupPath: null })
  expect(noBackup.message).toContain('reset to defaults')
  expect(noBackup.message).not.toContain('kept next to it')

  // The ephemeral (locked-file) case must NOT claim the settings were reset —
  // they were never touched and reload next launch.
  const ephemeral = formatConfigRecoveryNotice({ backupPath: null, ephemeral: true })
  expect(ephemeral.type).toBe('warn')
  expect(ephemeral.message).toContain('defaults for now')
  expect(ephemeral.message).toContain('untouched')
  expect(ephemeral.message).not.toContain('reset to defaults')
})

test('store accessors validate scalar and string-record values at runtime', async () => {
  const { getStoredBoolean, getStoredStringRecord, store } = await loadStoreModule()

  store.set('startWithWindows', 'yes')
  store.set('appPaths', {
    simhub: 'C:/Tools/SimHub.exe',
    bad: 42,
    nested: { path: 'C:/Tools/Nested.exe' }
  })

  expect(getStoredBoolean('startWithWindows')).toBe(false)
  expect(getStoredBoolean('missing', true)).toBe(true)
  expect(getStoredStringRecord('appPaths')).toEqual({ simhub: 'C:/Tools/SimHub.exe' })
  expect(getStoredStringRecord('missing')).toEqual({})
})

test('sanitizeImportedConfig rejects non-SimLauncher config payloads', async () => {
  const { sanitizeImportedConfig } = await loadStoreModule()
  expect(() => sanitizeImportedConfig(null)).toThrow('JSON object')
  expect(() => sanitizeImportedConfig({})).toThrow('empty')
  expect(() => sanitizeImportedConfig({ unknown: true })).toThrow('unsupported keys')
  expect(() => sanitizeImportedConfig({ killOnClose: true })).toThrow('SimLauncher settings')
})

test('sanitizeImportedConfig sanitizes scalar settings and clamps numeric values', async () => {
  const { MAX_CUSTOM_SLOTS, sanitizeImportedConfig } = await loadStoreModule()
  expect(
    sanitizeImportedConfig({
      customSlots: 999,
      launchDelayMs: 99999.7,
      zoomFactor: 99,
      themeMode: 'invalid',
      accentCustom: ' #AABBCC ',
      accentPreset: '',
      autoCheckUpdates: false,
      startWithWindows: 'yes'
    })
  ).toEqual({
    customSlots: MAX_CUSTOM_SLOTS,
    launchDelayMs: 30000,
    zoomFactor: 3,
    accentCustom: '#AABBCC',
    accentPreset: '',
    autoCheckUpdates: false
  })
})

test('sanitizeImportedConfig filters path, name, args, and prototype pollution keys', async () => {
  const { sanitizeImportedConfig } = await loadStoreModule()
  expect(
    sanitizeImportedConfig({
      customSlots: 2,
      gamePaths: {
        iracing: ' C:/Games/iRacing/iRacingSim64DX11.exe ',
        unknown: 'C:/Games/Unknown.exe',
        acc: 'C:/Games/ACC/readme.txt',
        __proto__: 'C:/Games/Polluted.exe'
      },
      appPaths: {
        simhub: 'C:/Tools/SimHub.exe',
        customapp2: 'C:/Tools/Overlay.exe',
        customapp3: 'C:/Tools/OutOfRange.exe'
      },
      appNames: {
        simhub: ' SimHub ',
        customapp2: 'Overlay',
        customapp3: 'Hidden'
      },
      appArgs: {
        customapp2: ' --safe ',
        simhub: '--not-allowed'
      }
    })
  ).toEqual({
    customSlots: 2,
    gamePaths: { iracing: 'C:/Games/iRacing/iRacingSim64DX11.exe' },
    appPaths: { simhub: 'C:/Tools/SimHub.exe', customapp2: 'C:/Tools/Overlay.exe' },
    appNames: { simhub: 'SimHub', customapp2: 'Overlay' },
    appArgs: { customapp2: '--safe', simhub: '--not-allowed' }
  })
})

// #691: windowBounds must go through the same forbidden-key stripping as
// every other imported record instead of being assigned wholesale.
// JSON.parse (unlike an object literal) creates a genuine own '__proto__'
// property, which is the real-world hand-crafted-config attack shape.
test('sanitizeImportedConfig rebuilds windowBounds from validated fields only', async () => {
  const { sanitizeImportedConfig } = await loadStoreModule()
  const polluted = JSON.parse(
    '{"windowBounds":{"x":10,"y":20,"width":800,"height":600,"__proto__":"polluted","extra":"nope"}}'
  )

  const sanitized = sanitizeImportedConfig(polluted)

  expect(sanitized.windowBounds).toEqual({ x: 10, y: 20, width: 800, height: 600 })
  expect(Object.keys(sanitized.windowBounds as object).sort()).toEqual([
    'height',
    'width',
    'x',
    'y'
  ])
})

test('sanitizeSettingsPatch filters object settings like config import', async () => {
  const { sanitizeSettingsPatch, store } = await loadStoreModule()
  store.set('customSlots', 2)

  expect(
    sanitizeSettingsPatch({
      gamePaths: {
        iracing: ' C:/Games/iRacing/iRacingSim64DX11.exe ',
        unknown: 'C:/Games/Unknown.exe',
        acc: 'C:/Games/ACC/readme.txt',
        __proto__: 'C:/Games/Polluted.exe'
      },
      appPaths: {
        simhub: 'C:/Tools/SimHub.exe',
        customapp2: 'C:/Tools/Overlay.exe',
        customapp3: 'C:/Tools/OutOfRange.exe'
      },
      appNames: {
        simhub: ' SimHub ',
        customapp2: 'Overlay',
        customapp3: 'Hidden'
      },
      appArgs: {
        customapp2: ' --safe ',
        customapp3: '--out-of-range',
        constructor: '--polluted'
      }
    })
  ).toEqual({
    gamePaths: { iracing: 'C:/Games/iRacing/iRacingSim64DX11.exe' },
    appPaths: { simhub: 'C:/Tools/SimHub.exe', customapp2: 'C:/Tools/Overlay.exe' },
    appNames: { simhub: 'SimHub', customapp2: 'Overlay' },
    appArgs: { customapp2: '--safe' }
  })
})

// Data-loss guard: 'save-settings' runs every patch through
// sanitizeSettingsPatch. If profiles/windowBounds/migration flags ever slip
// through, a settings save would clobber the user's profiles wholesale.
test('sanitizeSettingsPatch strips profiles, windowBounds, and migration flags', async () => {
  const { sanitizeSettingsPatch } = await loadStoreModule()

  expect(
    sanitizeSettingsPatch({
      themeMode: 'light',
      profiles: { iracing: { activeProfileId: 'default', profiles: [] } },
      windowBounds: { x: 0, y: 0, width: 800, height: 600 },
      migrated: true,
      profileSetsMigrated: true,
      profileUtilityOrderMigrated: true
    })
  ).toEqual({ themeMode: 'light' })
})

// Drift alarm: every Settings key must survive sanitization round-trip with a
// valid value. When a new key is added to EXPECTED_CONFIG_KEYS, this test
// fails until a sample value is added here AND getSupportedConfigValues
// actually handles the key — catching the "key added but silently dropped on
// save" failure mode.
test('sanitizeSettingsPatch round-trips every settings key with valid values', async () => {
  const { EXPECTED_CONFIG_KEYS, sanitizeSettingsPatch } = await loadStoreModule()

  const NON_SETTINGS_KEYS = new Set([
    'profiles',
    'windowBounds',
    'profileUtilityOrderMigrated',
    'profileSetsMigrated',
    'migrated'
  ])
  const sampleValues: Record<string, unknown> = {
    appPaths: { simhub: 'C:/Tools/SimHub.exe' },
    gamePaths: { iracing: 'C:/Games/iRacing/iRacingSim64DX11.exe' },
    appNames: { simhub: 'SimHub' },
    appArgs: { customapp1: '--safe' },
    customSlots: 2,
    accentPreset: 'ocean',
    accentCustom: '#AABBCC',
    accentBgTint: true,
    themeMode: 'light',
    focusActiveTitle: false,
    launchDelayMs: 2000,
    startWithWindows: true,
    startMinimized: true,
    minimizeToTray: true,
    showTrayIcon: false,
    autoCheckUpdates: false,
    zoomFactor: 1.5
  }

  const settingsKeys = [...EXPECTED_CONFIG_KEYS].filter((key) => !NON_SETTINGS_KEYS.has(key))
  const missingSamples = settingsKeys.filter(
    (key) => !Object.prototype.hasOwnProperty.call(sampleValues, key)
  )
  expect(missingSamples, 'add a sample value for every new settings key').toEqual([])

  const patch = Object.fromEntries(settingsKeys.map((key) => [key, sampleValues[key]]))

  expect(sanitizeSettingsPatch(patch)).toEqual(patch)
})

test('profile sanitization keeps a valid gamePosition and strips invalid values (#471)', async () => {
  const { sanitizeImportedConfig } = await loadStoreModule()
  const sanitized = sanitizeImportedConfig({
    customSlots: 1,
    profiles: {
      ac: {
        activeProfileId: 'default',
        profiles: [
          { id: 'default', name: 'Default', gamePosition: 'last' },
          { id: 'second', name: 'Second', gamePosition: 'banana' },
          { id: 'third', name: 'Third', gamePosition: 42 }
        ]
      }
    }
  }) as {
    profiles: { ac: { profiles: Array<Record<string, unknown>> } }
  }

  const [first, second, third] = sanitized.profiles.ac.profiles
  expect(first.gamePosition).toBe('last')
  expect(second).not.toHaveProperty('gamePosition')
  expect(third).not.toHaveProperty('gamePosition')
})

test('sanitizeImportedConfig sanitizes profile sets and tracked process paths', async () => {
  const { sanitizeImportedConfig } = await loadStoreModule()
  expect(
    sanitizeImportedConfig({
      customSlots: 1,
      profiles: {
        ac: {
          activeProfileId: 'missing',
          profiles: [
            {
              id: 'default',
              name: ' Default ',
              launchAutomatically: false,
              trackingEnabled: true,
              utilities: [
                { id: 'simhub', enabled: true },
                { id: 'simhub', enabled: false },
                { id: 'customapp2', enabled: true }
              ],
              trackedProcessPaths: [
                'C:/Tools/SimHub.exe',
                'c:/tools/simhub.exe',
                'C:/Tools/readme.txt'
              ]
            }
          ]
        },
        unknown: { simhub: true }
      }
    })
  ).toEqual({
    customSlots: 1,
    profiles: {
      ac: {
        activeProfileId: 'default',
        profiles: [
          {
            id: 'default',
            name: 'Default',
            launchAutomatically: false,
            trackingEnabled: true,
            utilities: [{ id: 'simhub', enabled: true }],
            trackedProcessPaths: ['C:/Tools/SimHub.exe']
          }
        ]
      }
    }
  })
})
