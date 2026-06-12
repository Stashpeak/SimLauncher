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

import {
  buildActiveProfileLaunchEntries,
  buildNamedProfileLaunchEntries
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
