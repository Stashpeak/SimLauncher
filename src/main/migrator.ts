import {
  StoredNamedProfile,
  StoredProfile,
  StoredProfileEntry,
  getStoredProfiles,
  getUtilityKeys,
  isStoredProfileSet,
  isStoredProfileUtility
} from './profiles'
import { getStoredStringRecord, store } from './store'
import { isRecord } from './utils'

function getCustomSlotNumber(key: string) {
  const match = key.match(/^customapp(\d+)$/)
  return match ? Number(match[1]) : null
}

// Scan every record that could reference a custom app slot and return the
// highest slot number found. Both pre-migration (flat boolean/path keys) and
// post-migration (utilities array) shapes are checked because the store may
// contain a mix when this runs (e.g. gamePaths is always flat; profiles may
// already be in the new shape from a partial earlier migration attempt).
function getHighestCustomSlot(...records: Array<Record<string, unknown> | undefined>) {
  let highestSlot = 0

  const scanRecord = (record: Record<string, unknown> | undefined) => {
    Object.entries(record || {}).forEach(([key, value]) => {
      if (key === 'profiles' && Array.isArray(value)) {
        value.forEach((profile) => {
          if (isRecord(profile)) {
            scanRecord(profile)
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

// Convert a pre-migration profile (flat boolean keys like { simhub: true })
// into the structured utilities array ({ id, enabled }[]). If utilities already
// exists it is kept as-is (filtered for validity). The flat boolean keys are
// then deleted so the result is in the canonical post-migration shape.
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
  if (!isRecord(value)) {
    return null
  }

  const profile = value as StoredProfile
  const orderedProfile = normalizeStoredProfileUtilityOrder(profile, utilityKeys)

  return {
    ...orderedProfile,
    id:
      typeof value.id === 'string' && value.id.trim().length > 0
        ? value.id
        : `profile-${Date.now().toString(36)}-${fallbackIndex}`,
    name:
      typeof value.name === 'string' && value.name.trim().length > 0
        ? value.name.trim()
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

export function migrateProfilesToNamedSets(): void {
  try {
    runProfileSetMigration()
  } catch (error) {
    // A malformed legacy profile must not brick boot. Every store write happens
    // at the very end of runProfileSetMigration, after the migrated shape is
    // fully built, so a throw leaves the original profiles untouched and the
    // migrated flags unset — a future launch retries against the original data.
    console.error('Profile migration failed; leaving stored profiles unchanged.', error)
  }
}

function runProfileSetMigration(): void {
  // Both migration flags are gated on profileSetsMigrated so the whole
  // pipeline only runs once. profileUtilityOrderMigrated was a predecessor
  // one-time migration; it is set here retroactively for installs that were
  // created after that migration landed but before this one did.
  if (store.get('profileSetsMigrated') === true) {
    return
  }

  const profiles = getStoredProfiles()
  const appPaths = getStoredStringRecord('appPaths')

  if (!profiles || Object.keys(profiles).length === 0) {
    // Fresh install or fully cleared store: mark both flags so future
    // launches skip this function immediately without touching the store.
    store.set('profileUtilityOrderMigrated', true)
    store.set('profileSetsMigrated', true)
    return
  }

  const savedCustomSlots = store.get('customSlots')
  // Derive the required slot count from both the persisted setting and a scan
  // of the actual data. A user could have configured customapp5, for example,
  // while customSlots was still 1 (e.g. after an import or manual edit), so
  // the data scan acts as a floor to avoid silently discarding those entries.
  const customSlots = Math.max(
    typeof savedCustomSlots === 'number' && Number.isFinite(savedCustomSlots)
      ? savedCustomSlots
      : 1,
    getHighestCustomSlot(appPaths, ...Object.values(profiles).filter(isRecord))
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
