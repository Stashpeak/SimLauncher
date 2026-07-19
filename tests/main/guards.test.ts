import { describe, expect, it } from 'vitest'
import { isRecord, isProfileUtility, isProfileSet } from '../../src/shared/domain/guards'

// Before #692 these guards were duplicated across the renderer (config.ts:
// isRecord/isProfileUtility/isGameProfileSet) and main (utils.ts: isRecord,
// profiles.ts: isStoredProfileUtility/isStoredProfileSet). Pin the shared source.

describe('isRecord', () => {
  it('accepts plain objects and rejects arrays / null / primitives', () => {
    expect(isRecord({})).toBe(true)
    expect(isRecord({ a: 1 })).toBe(true)
    expect(isRecord([])).toBe(false)
    expect(isRecord(null)).toBe(false)
    expect(isRecord(undefined)).toBe(false)
    expect(isRecord('x')).toBe(false)
    expect(isRecord(3)).toBe(false)
  })
})

describe('isProfileUtility', () => {
  it('requires a string id and a boolean enabled', () => {
    expect(isProfileUtility({ id: 'simhub', enabled: true })).toBe(true)
    expect(isProfileUtility({ id: 'simhub', enabled: false })).toBe(true)
    expect(isProfileUtility({ id: 'simhub' })).toBe(false)
    expect(isProfileUtility({ id: 5, enabled: true })).toBe(false)
    expect(isProfileUtility({ id: 'simhub', enabled: 'yes' })).toBe(false)
    expect(isProfileUtility(null)).toBe(false)
  })
})

describe('isProfileSet', () => {
  it('requires a string activeProfileId and a profiles array', () => {
    expect(isProfileSet({ activeProfileId: 'default', profiles: [] })).toBe(true)
    expect(
      isProfileSet({ activeProfileId: 'default', profiles: [{ id: 'p1', name: 'One' }] })
    ).toBe(true)
    expect(isProfileSet({ activeProfileId: 'default' })).toBe(false)
    expect(isProfileSet({ profiles: [] })).toBe(false)
    expect(isProfileSet({ activeProfileId: 5, profiles: [] })).toBe(false)
    expect(isProfileSet({ activeProfileId: 'default', profiles: {} })).toBe(false)
    expect(isProfileSet(null)).toBe(false)
  })
})
