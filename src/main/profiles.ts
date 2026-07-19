import { BUILT_IN_UTILITY_KEYS } from '../shared/domain/registries'
import type {
  Profile,
  NamedProfile,
  ProfileSet,
  ProfileEntry,
  ProfileUtility,
  GamePosition
} from '../shared/domain/profile'
import type { ProfileLaunchEntry } from './processes/types'
import { getStoredStringRecord, store } from './store'
import { isRecord, isValidExePath, normalizePathForComparison } from './utils'

// Profile domain types are process-agnostic (#692); the canonical defs live in
// the shared domain layer. Re-exported here under the main process's historical
// Stored* names so existing importers keep their `from './profiles'` path.
export type StoredProfile = Profile
export type StoredNamedProfile = NamedProfile
export type StoredProfileSet = ProfileSet
export type StoredProfileEntry = ProfileEntry
export type StoredProfileUtility = ProfileUtility
export type { GamePosition }

/**
 * Resolve where the game sits in the launch sequence. Anything other than an
 * explicit 'last' (absent, legacy, corrupted) means 'first' — the behavior
 * every profile had before #471.
 */
export function getGamePosition(profile: StoredProfile): GamePosition {
  return profile.gamePosition === 'last' ? 'last' : 'first'
}

// The built-in utility key list (and its load-bearing order — it is the default
// launch order for legacy flat-boolean profiles, see getEnabledUtilityEntries
// below) lives in the shared domain layer now (#692). Re-exported so existing
// importers keep their `from './profiles'` path.
export { BUILT_IN_UTILITY_KEYS }

export function isStoredProfileUtility(value: unknown): value is StoredProfileUtility {
  if (!isRecord(value)) {
    return false
  }

  return typeof value.id === 'string' && typeof value.enabled === 'boolean'
}

export function isStoredProfileSet(value: unknown): value is StoredProfileSet {
  if (!isRecord(value)) {
    return false
  }

  return typeof value.activeProfileId === 'string' && Array.isArray(value.profiles)
}

export function getStoredProfiles(): Record<string, StoredProfileEntry> {
  const value = store.get('profiles')

  if (!isRecord(value)) {
    return {}
  }

  const profiles: Record<string, StoredProfileEntry> = {}

  Object.entries(value).forEach(([gameKey, entry]) => {
    if (isStoredProfileSet(entry) || isRecord(entry)) {
      profiles[gameKey] = entry
    }
  })

  return profiles
}

export function resolveActiveProfile(entry: StoredProfileEntry | undefined): StoredNamedProfile {
  if (!entry) {
    return { id: 'default', name: 'Default' }
  }
  if (isStoredProfileSet(entry)) {
    const validProfiles = entry.profiles.filter(
      (p): p is StoredNamedProfile => isRecord(p) && typeof p.id === 'string'
    )
    if (validProfiles.length === 0) return { id: 'default', name: 'Default' }
    // Silent recovery: if activeProfileId no longer matches any profile (e.g.
    // after an import that replaced the set), fall back to the first available
    // profile rather than erroring — the user can correct the selection in UI.
    return validProfiles.find((p) => p.id === entry.activeProfileId) || validProfiles[0]
  }
  return { ...(entry as StoredProfile), id: 'default', name: 'Default' }
}

export function resolveNamedProfile(
  entry: StoredProfileEntry | undefined,
  profileId: string
): StoredNamedProfile {
  if (isStoredProfileSet(entry)) {
    const validProfiles = entry.profiles.filter(
      (p): p is StoredNamedProfile => isRecord(p) && typeof p.id === 'string'
    )
    return (
      validProfiles.find((p) => p.id === profileId) ||
      validProfiles[0] || { id: 'default', name: 'Default' }
    )
  }
  return { ...((entry as StoredProfile | undefined) || {}), id: 'default', name: 'Default' }
}

export function getEnabledUtilityEntries(
  profile: StoredProfile,
  appPaths: Record<string, string>,
  customSlots: unknown
): ProfileLaunchEntry[] {
  const count =
    typeof customSlots === 'number' && Number.isFinite(customSlots)
      ? Math.max(1, Math.floor(customSlots))
      : 1
  const utilityKeys = [
    ...BUILT_IN_UTILITY_KEYS,
    ...Array.from({ length: count }, (_, i) => `customapp${i + 1}`)
  ]
  const entries: ProfileLaunchEntry[] = []

  if (Array.isArray(profile.utilities)) {
    profile.utilities
      .filter(
        (u): u is StoredProfileUtility =>
          isRecord(u) && typeof u.id === 'string' && typeof u.enabled === 'boolean'
      )
      .filter((u) => u.enabled && utilityKeys.includes(u.id) && appPaths[u.id])
      .forEach((u) => entries.push({ key: u.id, path: appPaths[u.id] }))
  } else {
    utilityKeys.forEach((key) => {
      if (profile[key] === true && appPaths[key]) entries.push({ key, path: appPaths[key] })
    })
  }

  return entries
}

function buildProfileLaunchEntries(gameKey: string, profile: StoredNamedProfile) {
  const appPaths = getStoredStringRecord('appPaths')
  const gamePaths = getStoredStringRecord('gamePaths')
  const customSlots = store.get('customSlots')
  const entries: ProfileLaunchEntry[] = []
  const gameEntry =
    profile.launchAutomatically !== false && gamePaths[gameKey]
      ? { key: gameKey, path: gamePaths[gameKey] }
      : undefined

  if (gameEntry && getGamePosition(profile) === 'first') {
    entries.push(gameEntry)
  }
  getEnabledUtilityEntries(profile, appPaths, customSlots).forEach((entry) => entries.push(entry))
  if (gameEntry && getGamePosition(profile) === 'last') {
    entries.push(gameEntry)
  }

  return entries
}

export function buildActiveProfileLaunchEntries(gameKey: string): ProfileLaunchEntry[] {
  const profiles = getStoredProfiles()
  return buildProfileLaunchEntries(gameKey, resolveActiveProfile(profiles[gameKey]))
}

export function buildNamedProfileLaunchEntries(
  gameKey: string,
  profileId: string
): ProfileLaunchEntry[] {
  const profiles = getStoredProfiles()
  return buildProfileLaunchEntries(gameKey, resolveNamedProfile(profiles[gameKey], profileId))
}

export function getUtilityKeys(customSlots: unknown): string[] {
  const slotCount =
    typeof customSlots === 'number' && Number.isFinite(customSlots)
      ? Math.max(1, Math.floor(customSlots))
      : 1

  return [
    ...BUILT_IN_UTILITY_KEYS,
    ...Array.from({ length: slotCount }, (_value, index) => `customapp${index + 1}`)
  ]
}

export function getEnabledUtilityKeys(profile: StoredProfile | undefined): string[] {
  if (!profile) {
    return []
  }

  if (Array.isArray(profile.utilities)) {
    return profile.utilities
      .filter((utility) => isStoredProfileUtility(utility) && utility.enabled)
      .map((utility) => utility.id)
  }

  // Legacy path: profiles stored before the utilities-array migration keep
  // utility state as top-level boolean keys (e.g. { simhub: true }). The
  // migrator converts these on first run, but this branch handles any profile
  // that missed migration (manual store edit, partial import, etc.). NOTE: this
  // returns ALL top-level keys set to `true`, so non-utility booleans like
  // launchAutomatically / trackingEnabled are included too; the only caller
  // (getProfileTrackablePaths) tolerates this because those keys have no matching
  // appPaths entry and are dropped by the isValidExePath filter.
  return Object.entries(profile)
    .filter(([, value]) => value === true)
    .map(([key]) => key)
}

export function isUtilityEnabled(profile: StoredProfile | undefined, utilityKey: string): boolean {
  if (!profile) {
    return false
  }

  if (Array.isArray(profile.utilities)) {
    return profile.utilities.some(
      (utility) => isStoredProfileUtility(utility) && utility.id === utilityKey && utility.enabled
    )
  }

  return profile[utilityKey] === true
}

export function getActiveStoredProfile(
  profileEntry: StoredProfileEntry | undefined
): StoredProfile | StoredNamedProfile | undefined {
  if (!profileEntry) {
    return undefined
  }

  if (isStoredProfileSet(profileEntry)) {
    return (
      profileEntry.profiles.find((profile) => profile.id === profileEntry.activeProfileId) ||
      profileEntry.profiles[0]
    )
  }

  return profileEntry
}

export function getProfileTrackablePaths(
  gameKey: string,
  profile: StoredProfile | undefined,
  appPaths: Record<string, string> | undefined,
  gamePaths: Record<string, string> | undefined
): string[] {
  const trackablePaths = [
    gamePaths?.[gameKey],
    ...getEnabledUtilityKeys(profile)
      .filter((profileKey) => isValidExePath(appPaths?.[profileKey]))
      .map((profileKey) => appPaths![profileKey]),
    ...(Array.isArray(profile?.trackedProcessPaths) ? profile.trackedProcessPaths : [])
  ].filter((candidate): candidate is string => isValidExePath(candidate))
  const seen = new Set<string>()

  return trackablePaths.filter((trackablePath) => {
    const key = normalizePathForComparison(trackablePath)

    if (!key || seen.has(key)) {
      return false
    }

    seen.add(key)
    return true
  })
}
