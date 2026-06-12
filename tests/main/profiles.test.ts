import { beforeEach, expect, test, vi } from 'vitest'

const storeData: Record<string, unknown> = {}

vi.mock('../../src/main/store', () => ({
  getStoredStringRecord: vi.fn((key: string) => {
    const value = storeData[key]
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, string>)
      : {}
  }),
  store: {
    get: vi.fn((key: string) => storeData[key])
  }
}))

// utils.isValidExePath checks fs.existsSync; pretend every .exe exists except
// paths containing "missing", so trackable-path tests stay host-independent.
vi.mock('fs', () => ({
  default: {
    existsSync: (filePath: unknown) =>
      typeof filePath === 'string' &&
      /\.exe$/i.test(filePath) &&
      !filePath.toLowerCase().includes('missing')
  }
}))

import {
  buildActiveProfileLaunchEntries,
  buildNamedProfileLaunchEntries,
  getActiveStoredProfile,
  getProfileTrackablePaths,
  resolveActiveProfile,
  type StoredProfileEntry
} from '../../src/main/profiles'

function seedProfile(profileFields: Record<string, unknown>) {
  storeData.gamePaths = { iracing: 'C:/Games/iRacingUI.exe' }
  storeData.appPaths = {
    simhub: 'C:/Tools/SimHub.exe',
    crewchief: 'C:/Tools/CrewChief.exe'
  }
  storeData.customSlots = 1
  storeData.profiles = {
    iracing: {
      activeProfileId: 'p1',
      profiles: [
        {
          id: 'p1',
          name: 'Default',
          utilities: [
            { id: 'simhub', enabled: true },
            { id: 'crewchief', enabled: true }
          ],
          ...profileFields
        }
      ]
    }
  }
}

beforeEach(() => {
  Object.keys(storeData).forEach((key) => delete storeData[key])
})

test('game launches first by default (no gamePosition)', () => {
  seedProfile({})

  expect(buildActiveProfileLaunchEntries('iracing').map((entry) => entry.key)).toEqual([
    'iracing',
    'simhub',
    'crewchief'
  ])
})

test('gamePosition last launches the game after all companion apps (#471)', () => {
  seedProfile({ gamePosition: 'last' })

  expect(buildActiveProfileLaunchEntries('iracing').map((entry) => entry.key)).toEqual([
    'simhub',
    'crewchief',
    'iracing'
  ])
})

test('gamePosition last with disabled game launch yields utilities only (#471)', () => {
  seedProfile({ gamePosition: 'last', launchAutomatically: false })

  expect(buildActiveProfileLaunchEntries('iracing').map((entry) => entry.key)).toEqual([
    'simhub',
    'crewchief'
  ])
})

test('invalid gamePosition values fall back to game-first (#471)', () => {
  seedProfile({ gamePosition: 'banana' })

  expect(buildActiveProfileLaunchEntries('iracing').map((entry) => entry.key)).toEqual([
    'iracing',
    'simhub',
    'crewchief'
  ])
})

test('buildNamedProfileLaunchEntries honors gamePosition last (#471)', () => {
  seedProfile({ gamePosition: 'last' })

  expect(buildNamedProfileLaunchEntries('iracing', 'p1').map((entry) => entry.key)).toEqual([
    'simhub',
    'crewchief',
    'iracing'
  ])
})

test('resolveActiveProfile falls back through stale ids, invalid entries, and legacy shapes', () => {
  expect(resolveActiveProfile(undefined)).toEqual({ id: 'default', name: 'Default' })

  // Stale activeProfileId (profile was deleted) → first valid profile.
  expect(
    resolveActiveProfile({
      activeProfileId: 'deleted',
      profiles: [{ id: 'p1', name: 'Race' }]
    })
  ).toEqual({ id: 'p1', name: 'Race' })

  // Corrupted entries are skipped when picking the fallback.
  expect(
    resolveActiveProfile({
      activeProfileId: 'deleted',
      profiles: [null, { name: 'no-id' }, { id: 'p2', name: 'Valid' }]
    } as unknown as StoredProfileEntry)
  ).toEqual({ id: 'p2', name: 'Valid' })

  // A set with no valid profiles still yields a usable default.
  expect(
    resolveActiveProfile({
      activeProfileId: 'x',
      profiles: [{ name: 'no-id' }]
    } as unknown as StoredProfileEntry)
  ).toEqual({ id: 'default', name: 'Default' })

  // Legacy flat profile (pre-named-sets) keeps its fields under the default id.
  expect(resolveActiveProfile({ launchAutomatically: false })).toEqual({
    id: 'default',
    name: 'Default',
    launchAutomatically: false
  })
})

test('getActiveStoredProfile resolves sets, stale ids, and legacy flat entries', () => {
  expect(getActiveStoredProfile(undefined)).toBeUndefined()

  const active = { id: 'p2', name: 'Race', trackingEnabled: true }
  expect(
    getActiveStoredProfile({
      activeProfileId: 'p2',
      profiles: [{ id: 'p1', name: 'Default' }, active]
    })
  ).toBe(active)

  expect(
    getActiveStoredProfile({
      activeProfileId: 'deleted',
      profiles: [{ id: 'p1', name: 'Default' }]
    })
  ).toEqual({ id: 'p1', name: 'Default' })

  const legacyProfile = { simhub: true }
  expect(getActiveStoredProfile(legacyProfile)).toBe(legacyProfile)
})

// Close-all and tracking both consume this list: a disabled utility leaking in
// means SimLauncher would kill processes the profile explicitly left alone.
test('getProfileTrackablePaths includes only the game, enabled utilities, and extra watched paths', () => {
  const profile = {
    utilities: [
      { id: 'simhub', enabled: true },
      { id: 'crewchief', enabled: false }
    ],
    trackedProcessPaths: ['C:/Tools/Extra.exe', 'c:\\tools\\extra.exe', 'C:/Tools/MissingTool.exe']
  }

  expect(
    getProfileTrackablePaths(
      'iracing',
      profile,
      { simhub: 'C:/Tools/SimHub.exe', crewchief: 'C:/Tools/CrewChief.exe' },
      { iracing: 'C:/Games/iRacingUI.exe' }
    )
  ).toEqual([
    // Game first, then enabled utilities, then extra watched paths — with the
    // disabled crewchief excluded, the separator/case duplicate deduped, and
    // the non-existent exe dropped.
    'C:/Games/iRacingUI.exe',
    'C:/Tools/SimHub.exe',
    'C:/Tools/Extra.exe'
  ])
})

test('getProfileTrackablePaths tolerates a missing profile and missing path records', () => {
  expect(
    getProfileTrackablePaths('iracing', undefined, undefined, {
      iracing: 'C:/Games/iRacingUI.exe'
    })
  ).toEqual(['C:/Games/iRacingUI.exe'])

  expect(getProfileTrackablePaths('iracing', undefined, undefined, undefined)).toEqual([])
})
