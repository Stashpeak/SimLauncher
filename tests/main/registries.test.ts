import { describe, expect, it } from 'vitest'
import {
  GAMES,
  BUILT_IN_UTILITIES,
  KNOWN_GAME_KEYS,
  BUILT_IN_UTILITY_KEYS
} from '../../src/shared/domain/registries'

// Pins the canonical registry content and the key collections derived from it.
// Before #692 these lists were three hand-maintained parallel copies; now they
// have one source, so this guards against an accidental drop/rename/reorder in
// GAMES or BUILT_IN_UTILITIES silently changing the derived allowlists.

const EXPECTED_GAME_KEYS = [
  'ac',
  'acc',
  'acevo',
  'acrally',
  'aeroflyfs4',
  'ams',
  'ams2',
  'beamng',
  'dcsw',
  'dirtrally',
  'dirtrally2',
  'eawrc',
  'f124',
  'f125',
  'il2gb',
  'iracing',
  'lmu',
  'msfs2020',
  'msfs2024',
  'p3d',
  'pmr',
  'raceroom',
  'rbr',
  'rennsport',
  'rf1',
  'rf2',
  'xplane12'
]

// Order is load-bearing: it is the default launch order for legacy flat-boolean
// profiles (see getEnabledUtilityEntries in src/main/profiles.ts).
const EXPECTED_UTILITY_KEYS = [
  'tracktitan',
  'simhub',
  'crewchief',
  'tradingpaints',
  'garage61',
  'secondmonitor'
]

describe('shared domain registries', () => {
  it('exposes exactly the expected game keys', () => {
    expect(GAMES.map((game) => game.key)).toEqual(EXPECTED_GAME_KEYS)
  })

  it('exposes exactly the expected built-in utility keys, in order', () => {
    expect(BUILT_IN_UTILITIES.map((utility) => utility.key)).toEqual(EXPECTED_UTILITY_KEYS)
  })

  it('derives KNOWN_GAME_KEYS from GAMES', () => {
    expect([...KNOWN_GAME_KEYS].sort()).toEqual([...EXPECTED_GAME_KEYS].sort())
    expect(KNOWN_GAME_KEYS.size).toBe(GAMES.length)
    for (const game of GAMES) {
      expect(KNOWN_GAME_KEYS.has(game.key)).toBe(true)
    }
  })

  it('derives BUILT_IN_UTILITY_KEYS from BUILT_IN_UTILITIES (order preserved)', () => {
    expect(BUILT_IN_UTILITY_KEYS).toEqual(BUILT_IN_UTILITIES.map((utility) => utility.key))
    expect(BUILT_IN_UTILITY_KEYS).toEqual(EXPECTED_UTILITY_KEYS)
  })

  it('every game has a non-empty name and icon path', () => {
    for (const game of GAMES) {
      expect(game.name.length).toBeGreaterThan(0)
      expect(game.icon).toMatch(/^assets\/.+\.png$/)
    }
  })
})
