import type { ProfileLaunchEntry } from './processes/types'
import { getStoredStringRecord, store } from './store'
import { isRecord, isValidExePath } from './utils'

export interface StoredProfile extends Record<string, unknown> {
  utilities?: StoredProfileUtility[]
  launchAutomatically?: boolean
  trackingEnabled?: boolean
  trackedProcessPaths?: string[]
}

export interface StoredNamedProfile extends StoredProfile {
  id: string
  name: string
}

export interface StoredProfileSet {
  activeProfileId: string
  profiles: StoredNamedProfile[]
}

export type StoredProfileEntry = StoredProfile | StoredProfileSet

export interface StoredProfileUtility {
  id: string
  enabled: boolean
}

export const BUILT_IN_UTILITY_KEYS = [
  'simhub',
  'crewchief',
  'tradingpaints',
  'garage61',
  'secondmonitor'
]

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

export function getStoredProfiles() {
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

export function getEnabledUtilityPaths(
  profile: StoredProfile,
  appPaths: Record<string, string>,
  customSlots: unknown
): string[] {
  return getEnabledUtilityEntries(profile, appPaths, customSlots).map((entry) => entry.path)
}

export function buildActiveProfileLaunchEntries(gameKey: string): ProfileLaunchEntry[] {
  const appPaths = getStoredStringRecord('appPaths')
  const gamePaths = getStoredStringRecord('gamePaths')
  const profiles = getStoredProfiles()
  const customSlots = store.get('customSlots')
  const profile = resolveActiveProfile(profiles[gameKey])
  const entries: ProfileLaunchEntry[] = []

  if (profile.launchAutomatically !== false && gamePaths[gameKey]) {
    entries.push({ key: gameKey, path: gamePaths[gameKey] })
  }
  getEnabledUtilityEntries(profile, appPaths, customSlots).forEach((entry) => entries.push(entry))

  return entries
}

export function buildActiveProfileLaunchPaths(gameKey: string): string[] {
  return buildActiveProfileLaunchEntries(gameKey).map((entry) => entry.path)
}

export function buildNamedProfileLaunchEntries(
  gameKey: string,
  profileId: string
): ProfileLaunchEntry[] {
  const appPaths = getStoredStringRecord('appPaths')
  const gamePaths = getStoredStringRecord('gamePaths')
  const profiles = getStoredProfiles()
  const customSlots = store.get('customSlots')
  const profile = resolveNamedProfile(profiles[gameKey], profileId)
  const entries: ProfileLaunchEntry[] = []

  if (profile.launchAutomatically !== false && gamePaths[gameKey]) {
    entries.push({ key: gameKey, path: gamePaths[gameKey] })
  }
  getEnabledUtilityEntries(profile, appPaths, customSlots).forEach((entry) => entries.push(entry))

  return entries
}

export function buildNamedProfileLaunchPaths(gameKey: string, profileId: string): string[] {
  return buildNamedProfileLaunchEntries(gameKey, profileId).map((entry) => entry.path)
}

export function getUtilityKeys(customSlots: unknown) {
  const slotCount =
    typeof customSlots === 'number' && Number.isFinite(customSlots)
      ? Math.max(1, Math.floor(customSlots))
      : 1

  return [
    ...BUILT_IN_UTILITY_KEYS,
    ...Array.from({ length: slotCount }, (_value, index) => `customapp${index + 1}`)
  ]
}

export function getEnabledUtilityKeys(profile: StoredProfile | undefined) {
  if (!profile) {
    return []
  }

  if (Array.isArray(profile.utilities)) {
    return profile.utilities
      .filter((utility) => isStoredProfileUtility(utility) && utility.enabled)
      .map((utility) => utility.id)
  }

  return Object.entries(profile)
    .filter(([, value]) => value === true)
    .map(([key]) => key)
}

export function isUtilityEnabled(profile: StoredProfile | undefined, utilityKey: string) {
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

export function getActiveStoredProfile(profileEntry: StoredProfileEntry | undefined) {
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
) {
  const trackablePaths = [
    gamePaths?.[gameKey],
    ...getEnabledUtilityKeys(profile)
      .filter((profileKey) => isValidExePath(appPaths?.[profileKey]))
      .map((profileKey) => appPaths![profileKey]),
    ...(Array.isArray(profile?.trackedProcessPaths) ? profile.trackedProcessPaths : [])
  ].filter(isValidExePath)
  const seen = new Set<string>()

  return trackablePaths.filter((trackablePath) => {
    const key = trackablePath.toLowerCase()

    if (seen.has(key)) {
      return false
    }

    seen.add(key)
    return true
  })
}
