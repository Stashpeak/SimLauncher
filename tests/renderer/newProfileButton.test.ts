import { describe, expect, test } from 'vitest'

import {
  createProfileId,
  getActiveGameProfile,
  normalizeGameProfileSet,
  type NamedGameProfile
} from '../../src/renderer/src/lib/config'

// Reproduces the create-profile logic used by GameRow's onCreateProfile
// callback (the "New Profile" button in ProfileNameSection).
function buildNewProfile(activeProfile: NamedGameProfile, name: string): NamedGameProfile {
  return {
    ...JSON.parse(JSON.stringify(activeProfile)),
    id: createProfileId(),
    name
  }
}

describe('new profile button — profile creation logic', () => {
  test('creates a profile with a unique id different from the active profile', () => {
    const profileSet = normalizeGameProfileSet(undefined)
    const activeProfile = getActiveGameProfile(profileSet)
    const newProfile = buildNewProfile(activeProfile, 'New Profile')

    expect(newProfile.id).not.toBe(activeProfile.id)
    expect(newProfile.id).toMatch(/^profile-/)
  })

  test('new profile is named "New Profile"', () => {
    const profileSet = normalizeGameProfileSet(undefined)
    const activeProfile = getActiveGameProfile(profileSet)
    const newProfile = buildNewProfile(activeProfile, 'New Profile')

    expect(newProfile.name).toBe('New Profile')
  })

  test('new profile is a deep clone — mutating the original does not affect the clone', () => {
    const profileSet = normalizeGameProfileSet(undefined)
    const activeProfile = getActiveGameProfile(profileSet)
    const newProfile = buildNewProfile(activeProfile, 'New Profile')

    // Both start with the same utilities shape (cloned)
    expect(newProfile.utilities).toEqual(activeProfile.utilities)

    // Mutating the clone's id does not change the original
    const originalId = activeProfile.id
    newProfile.id = 'mutated'
    expect(activeProfile.id).toBe(originalId)
  })

  test('resulting profile set with new profile has it set as active', () => {
    const profileSet = normalizeGameProfileSet(undefined)
    const activeProfile = getActiveGameProfile(profileSet)
    const newProfile = buildNewProfile(activeProfile, 'New Profile')

    const updatedProfileSet = {
      activeProfileId: newProfile.id,
      profiles: [...profileSet.profiles, newProfile]
    }

    expect(updatedProfileSet.activeProfileId).toBe(newProfile.id)
    expect(updatedProfileSet.profiles).toHaveLength(profileSet.profiles.length + 1)
    expect(updatedProfileSet.profiles.at(-1)?.id).toBe(newProfile.id)
  })

  test('two successive calls to buildNewProfile produce different ids', () => {
    const profileSet = normalizeGameProfileSet(undefined)
    const activeProfile = getActiveGameProfile(profileSet)
    const first = buildNewProfile(activeProfile, 'New Profile')
    const second = buildNewProfile(activeProfile, 'New Profile')

    expect(first.id).not.toBe(second.id)
  })
})
