import { beforeEach, expect, test, vi } from 'vitest'

const storeData: Record<string, unknown> = {}

async function loadMigratorModule() {
  vi.resetModules()

  const storeModuleMock = {
    store: {
      store: storeData,

      get(key: string) {
        return storeData[key]
      },

      set(key: string, value: unknown) {
        storeData[key] = value
      }
    },
    getStoredStringRecord(key: string) {
      const value = storeData[key]
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {}
      }
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string'
        )
      )
    }
  }

  vi.doMock('../store', () => storeModuleMock)
  vi.doMock('/src/main/store.ts', () => storeModuleMock)
  vi.doMock('../../src/main/store', () => storeModuleMock)
  vi.doMock('../../src/main/store.ts', () => storeModuleMock)
  vi.doMock('../../src/main/store.js', () => storeModuleMock)

  return await import('../../src/main/migrator')
}

beforeEach(() => {
  Object.keys(storeData).forEach((key) => delete storeData[key])
})

test('migrateProfilesToNamedSets preserves existing named profiles after removing invalid and duplicate entries', async () => {
  storeData.customSlots = 1
  storeData.profileSetsMigrated = false
  storeData.profiles = {
    ac: {
      activeProfileId: 'missing',
      profiles: [
        null,
        { id: 'rain', name: ' Rain ', simhub: true, customapp3: true },
        { id: 'rain', name: 'Duplicate', crewchief: true },
        { id: '', name: '', customapp2: true }
      ]
    }
  }

  const { migrateProfilesToNamedSets } = await loadMigratorModule()
  migrateProfilesToNamedSets()

  expect(storeData.customSlots).toBe(3)
  expect(storeData.profiles).toMatchObject({
    ac: {
      activeProfileId: 'rain',
      profiles: [
        {
          id: 'rain',
          name: 'Rain',
          utilities: expect.arrayContaining([
            { id: 'simhub', enabled: true },
            { id: 'customapp3', enabled: true }
          ])
        },
        {
          id: expect.stringMatching(/^profile-/),
          name: 'Profile 4',
          utilities: expect.arrayContaining([{ id: 'customapp2', enabled: true }])
        }
      ]
    }
  })
  expect(storeData.profileUtilityOrderMigrated).toBe(true)
  expect(storeData.profileSetsMigrated).toBe(true)
})

test('migrateProfilesToNamedSets creates a default profile when a stored profile set has no valid profiles', async () => {
  storeData.profiles = {
    acc: {
      activeProfileId: 'missing',
      profiles: [null, false, 'bad']
    }
  }

  const { migrateProfilesToNamedSets } = await loadMigratorModule()
  migrateProfilesToNamedSets()

  expect(storeData.profiles).toEqual({
    acc: {
      activeProfileId: 'default',
      profiles: [
        {
          id: 'default',
          name: 'Default',
          utilities: expect.any(Array)
        }
      ]
    }
  })
})
