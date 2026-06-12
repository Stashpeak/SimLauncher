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
    store: storeModule.store
  }
}

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
