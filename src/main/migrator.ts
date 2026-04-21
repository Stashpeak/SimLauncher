import {
  StoredNamedProfile,
  StoredProfile,
  StoredProfileEntry,
  getUtilityKeys,
  isStoredProfileSet,
  isStoredProfileUtility
} from './profiles'
import { store } from './store'

function getCustomSlotNumber(key: string) {
  const match = key.match(/^customapp(\d+)$/)
  return match ? Number(match[1]) : null
}

function getHighestCustomSlot(...records: Array<Record<string, unknown> | undefined>) {
  let highestSlot = 0

  const scanRecord = (record: Record<string, unknown> | undefined) => {
    Object.entries(record || {}).forEach(([key, value]) => {
      if (key === 'profiles' && Array.isArray(value)) {
        value.forEach((profile) => {
          if (profile && typeof profile === 'object') {
            scanRecord(profile as Record<string, unknown>)
          }
        })
        return
      }

      const slotNumber = getCustomSlotNumber(key)

      if (
        slotNumber !== null &&
        (value === true || (typeof value === 'string' && value.trim().length > 0))
      ) {
        highestSlot = Math.max(highestSlot, slotNumber)
      }

      if (key === 'utilities' && Array.isArray(value)) {
        value.filter(isStoredProfileUtility).forEach((utility) => {
          const utilitySlotNumber = getCustomSlotNumber(utility.id)

          if (utility.enabled && utilitySlotNumber !== null) {
            highestSlot = Math.max(highestSlot, utilitySlotNumber)
          }
        })
      }
    })
  }

  records.forEach((record) => {
    scanRecord(record)
  })

  return highestSlot
}

function normalizeStoredProfileUtilityOrder(profile: StoredProfile, utilityKeys: string[]) {
  const normalizedProfile: StoredProfile = {
    ...profile,
    utilities: Array.isArray(profile.utilities)
      ? profile.utilities.filter(isStoredProfileUtility)
      : utilityKeys.map((utilityKey) => ({
          id: utilityKey,
          enabled: profile[utilityKey] === true
        }))
  }

  utilityKeys.forEach((utilityKey) => {
    delete normalizedProfile[utilityKey]
  })

  return normalizedProfile
}

function normalizeStoredNamedProfile(
  value: unknown,
  utilityKeys: string[],
  fallbackIndex: number
): StoredNamedProfile | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const profile = value as StoredProfile
  const orderedProfile = normalizeStoredProfileUtilityOrder(profile, utilityKeys)
  const rawProfile = value as Record<string, unknown>

  return {
    ...orderedProfile,
    id:
      typeof rawProfile.id === 'string' && rawProfile.id.trim().length > 0
        ? rawProfile.id
        : `profile-${Date.now().toString(36)}-${fallbackIndex}`,
    name:
      typeof rawProfile.name === 'string' && rawProfile.name.trim().length > 0
        ? rawProfile.name.trim()
        : fallbackIndex === 0
          ? 'Default'
          : `Profile ${fallbackIndex + 1}`
  }
}

function normalizeStoredProfileSet(profileEntry: StoredProfileEntry, utilityKeys: string[]) {
  if (isStoredProfileSet(profileEntry)) {
    const seen = new Set<string>()
    const profiles = profileEntry.profiles.flatMap((profile, index) => {
      const normalizedProfile = normalizeStoredNamedProfile(profile, utilityKeys, index)

      if (!normalizedProfile || seen.has(normalizedProfile.id)) {
        return []
      }

      seen.add(normalizedProfile.id)
      return [normalizedProfile]
    })

    if (profiles.length === 0) {
      const defaultProfile = normalizeStoredNamedProfile({}, utilityKeys, 0)!
      defaultProfile.id = 'default'
      defaultProfile.name = 'Default'
      return {
        activeProfileId: defaultProfile.id,
        profiles: [defaultProfile]
      }
    }

    return {
      activeProfileId: profiles.some((profile) => profile.id === profileEntry.activeProfileId)
        ? profileEntry.activeProfileId
        : profiles[0].id,
      profiles
    }
  }

  const defaultProfile = normalizeStoredNamedProfile(profileEntry, utilityKeys, 0)!
  defaultProfile.id = 'default'
  defaultProfile.name = 'Default'

  return {
    activeProfileId: defaultProfile.id,
    profiles: [defaultProfile]
  }
}

export function migrateProfilesToNamedSets() {
  if (store.get('profileSetsMigrated') === true) {
    return
  }

  const profiles = store.get('profiles') as Record<string, StoredProfileEntry> | undefined
  const appPaths = store.get('appPaths') as Record<string, string> | undefined

  if (!profiles || Object.keys(profiles).length === 0) {
    store.set('profileUtilityOrderMigrated', true)
    store.set('profileSetsMigrated', true)
    return
  }

  const savedCustomSlots = store.get('customSlots')
  const customSlots = Math.max(
    typeof savedCustomSlots === 'number' && Number.isFinite(savedCustomSlots)
      ? savedCustomSlots
      : 1,
    getHighestCustomSlot(
      appPaths,
      ...Object.values(profiles).map((profile) => profile as Record<string, unknown>)
    )
  )
  const utilityKeys = getUtilityKeys(customSlots)
  const migratedProfiles = Object.fromEntries(
    Object.entries(profiles).map(([gameKey, profileEntry]) => [
      gameKey,
      normalizeStoredProfileSet(profileEntry, utilityKeys)
    ])
  )

  store.set('customSlots', customSlots)
  store.set('profiles', migratedProfiles)
  store.set('profileUtilityOrderMigrated', true)
  store.set('profileSetsMigrated', true)
}
