import { store } from './store'
import { isValidExePath } from './utils'

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

export const BUILT_IN_UTILITY_KEYS = ['simhub', 'crewchief', 'tradingpaints', 'garage61', 'secondmonitor']

export function isStoredProfileUtility(value: unknown): value is StoredProfileUtility {
  if (!value || typeof value !== 'object') {
    return false
  }

  const utility = value as Record<string, unknown>
  return typeof utility.id === 'string' && typeof utility.enabled === 'boolean'
}

export function isStoredProfileSet(value: unknown): value is StoredProfileSet {
  if (!value || typeof value !== 'object') {
    return false
  }

  const profileSet = value as Record<string, unknown>
  return typeof profileSet.activeProfileId === 'string' && Array.isArray(profileSet.profiles)
}

export function resolveActiveProfile(entry: StoredProfileEntry | undefined): StoredNamedProfile {
  if (!entry) {
    return { id: 'default', name: 'Default' }
  }
  if (isStoredProfileSet(entry)) {
    const validProfiles = entry.profiles.filter(
      (p): p is StoredNamedProfile =>
        !!p && typeof p === 'object' && typeof (p as Record<string, unknown>).id === 'string'
    )
    if (validProfiles.length === 0) return { id: 'default', name: 'Default' }
    return validProfiles.find((p) => p.id === entry.activeProfileId) || validProfiles[0]
  }
  return { ...(entry as StoredProfile), id: 'default', name: 'Default' }
}

export function resolveNamedProfile(entry: StoredProfileEntry | undefined, profileId: string): StoredNamedProfile {
  if (isStoredProfileSet(entry)) {
    const validProfiles = entry.profiles.filter(
      (p): p is StoredNamedProfile =>
        !!p && typeof p === 'object' && typeof (p as Record<string, unknown>).id === 'string'
    )
    return validProfiles.find((p) => p.id === profileId) || validProfiles[0] || { id: 'default', name: 'Default' }
  }
  return { ...(entry as StoredProfile | undefined || {}), id: 'default', name: 'Default' }
}

export function getEnabledUtilityPaths(
  profile: StoredProfile,
  appPaths: Record<string, string>,
  customSlots: unknown
): string[] {
  const count =
    typeof customSlots === 'number' && Number.isFinite(customSlots) ? Math.max(1, Math.floor(customSlots)) : 1
  const utilityKeys = [
    ...BUILT_IN_UTILITY_KEYS,
    ...Array.from({ length: count }, (_, i) => `customapp${i + 1}`)
  ]
  const paths: string[] = []

  if (Array.isArray(profile.utilities)) {
    profile.utilities
      .filter(
        (u): u is StoredProfileUtility =>
          !!u &&
          typeof u === 'object' &&
          typeof (u as Record<string, unknown>).id === 'string' &&
          typeof (u as Record<string, unknown>).enabled === 'boolean'
      )
      .filter((u) => u.enabled && utilityKeys.includes(u.id) && appPaths[u.id])
      .forEach((u) => paths.push(appPaths[u.id]))
  } else {
    utilityKeys.forEach((key) => {
      if (profile[key] === true && appPaths[key]) paths.push(appPaths[key])
    })
  }

  return paths
}

export function buildActiveProfileLaunchPaths(gameKey: string): string[] {
  const appPaths = (store.get('appPaths') as Record<string, string> | undefined) || {}
  const gamePaths = (store.get('gamePaths') as Record<string, string> | undefined) || {}
  const profiles = (store.get('profiles') as Record<string, StoredProfileEntry> | undefined) || {}
  const customSlots = store.get('customSlots')
  const profile = resolveActiveProfile(profiles[gameKey])
  const paths: string[] = []

  if (profile.launchAutomatically !== false && gamePaths[gameKey]) paths.push(gamePaths[gameKey])
  getEnabledUtilityPaths(profile, appPaths, customSlots).forEach((p) => paths.push(p))

  return paths
}

export function buildNamedProfileLaunchPaths(gameKey: string, profileId: string): string[] {
  const appPaths = (store.get('appPaths') as Record<string, string> | undefined) || {}
  const gamePaths = (store.get('gamePaths') as Record<string, string> | undefined) || {}
  const profiles = (store.get('profiles') as Record<string, StoredProfileEntry> | undefined) || {}
  const customSlots = store.get('customSlots')
  const profile = resolveNamedProfile(profiles[gameKey], profileId)
  const paths: string[] = []

  if (profile.launchAutomatically !== false && gamePaths[gameKey]) paths.push(gamePaths[gameKey])
  getEnabledUtilityPaths(profile, appPaths, customSlots).forEach((p) => paths.push(p))

  return paths
}

export function getUtilityKeys(customSlots: unknown) {
  const slotCount = typeof customSlots === 'number' && Number.isFinite(customSlots)
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
    .filter(([_key, value]) => value === true)
    .map(([key]) => key)
}

export function isUtilityEnabled(profile: StoredProfile | undefined, utilityKey: string) {
  if (!profile) {
    return false
  }

  if (Array.isArray(profile.utilities)) {
    return profile.utilities.some((utility) => (
      isStoredProfileUtility(utility) && utility.id === utilityKey && utility.enabled
    ))
  }

  return profile[utilityKey] === true
}

export function getActiveStoredProfile(profileEntry: StoredProfileEntry | undefined) {
  if (!profileEntry) {
    return undefined
  }

  if (isStoredProfileSet(profileEntry)) {
    return profileEntry.profiles.find((profile) => profile.id === profileEntry.activeProfileId) || profileEntry.profiles[0]
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
