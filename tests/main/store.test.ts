vi.mock('electron-store', () => ({
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

async function loadStoreModule() {
  const storeModule = await import('../../src/main/store')
  return {
    MAX_CUSTOM_SLOTS: storeModule.MAX_CUSTOM_SLOTS,
    sanitizeImportedConfig: storeModule.sanitizeImportedConfig
  }
}

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
      launchDelayMs: 9999.7,
      zoomFactor: 99,
      themeMode: 'invalid',
      accentCustom: ' #AABBCC ',
      accentPreset: '',
      autoCheckUpdates: false,
      startWithWindows: 'yes'
    })
  ).toEqual({
    customSlots: MAX_CUSTOM_SLOTS,
    launchDelayMs: 5000,
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
    appArgs: { customapp2: '--safe' }
  })
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
