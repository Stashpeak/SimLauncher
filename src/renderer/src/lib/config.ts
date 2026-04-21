export interface Game {
  key: string
  name: string
  icon: string
}
export interface Utility {
  key: string
  name: string
  isCustom?: boolean
}
export interface ProfileUtility {
  id: string
  enabled: boolean
}
export interface GameProfile {
  [key: string]: unknown
  utilities?: ProfileUtility[]
  launchAutomatically?: boolean
  trackingEnabled?: boolean
  killControlsEnabled?: boolean
  relaunchControlsEnabled?: boolean
  trackedProcessPaths?: string[]
}
export interface NamedGameProfile extends GameProfile {
  id: string
  name: string
}
export interface GameProfileSet {
  activeProfileId: string
  profiles: NamedGameProfile[]
}
export type StoredGameProfile = GameProfile | GameProfileSet
export type Profiles = Record<string, StoredGameProfile>

export const DEFAULT_ACCENT_COLOR = '#00eaff'
export const DEFAULT_CUSTOM_SLOTS = 1
export const DEFAULT_PROFILE_ID = 'default'
export const DEFAULT_PROFILE_NAME = 'Default'
export const MAX_CUSTOM_SLOTS = 10

export const GAMES: Game[] = [
  { key: 'ac', name: 'Assetto Corsa', icon: 'assets/ac.png' },
  { key: 'acc', name: 'Assetto Corsa Competizione', icon: 'assets/acc.png' },
  { key: 'acevo', name: 'Assetto Corsa Evo', icon: 'assets/acevo.png' },
  { key: 'acrally', name: 'Assetto Corsa Rally', icon: 'assets/acrally.png' },
  { key: 'ams', name: 'Automobilista', icon: 'assets/ams.png' },
  { key: 'ams2', name: 'Automobilista 2', icon: 'assets/ams2.png' },
  { key: 'beamng', name: 'BeamNG', icon: 'assets/beamng.png' },
  { key: 'dcsw', name: 'DCS World', icon: 'assets/dcsw.png' },
  { key: 'dirtrally', name: 'Dirt Rally', icon: 'assets/dirtrally.png' },
  { key: 'dirtrally2', name: 'Dirt Rally 2.0', icon: 'assets/dirtrally2.png' },
  { key: 'eawrc', name: 'EA WRC', icon: 'assets/eawrc.png' },
  { key: 'f124', name: 'F1 24', icon: 'assets/f124.png' },
  { key: 'f125', name: 'F1 25', icon: 'assets/f125.png' },
  { key: 'iracing', name: 'iRacing', icon: 'assets/iracing.png' },
  { key: 'lmu', name: 'Le Mans Ultimate', icon: 'assets/lmu.png' },
  { key: 'pmr', name: 'Project Motor Racing', icon: 'assets/pmr.png' },
  { key: 'raceroom', name: 'RaceRoom Racing Experience', icon: 'assets/raceroom.png' },
  { key: 'rbr', name: 'Richard Burns Rally', icon: 'assets/rbr.png' },
  { key: 'rennsport', name: 'Rennsport', icon: 'assets/rennsport.png' },
  { key: 'rf1', name: 'rFactor', icon: 'assets/rf1.png' },
  { key: 'rf2', name: 'rFactor 2', icon: 'assets/rf2.png' }
]

export const BUILT_IN_UTILITIES: Utility[] = [
  { key: 'simhub', name: 'SimHub' },
  { key: 'crewchief', name: 'Crew Chief' },
  { key: 'tradingpaints', name: 'Trading Paints' },
  { key: 'garage61', name: 'Garage 61' },
  { key: 'secondmonitor', name: 'Second Monitor' }
]

export function normalizeCustomSlots(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_CUSTOM_SLOTS
  }

  return Math.max(1, Math.min(Math.floor(value), MAX_CUSTOM_SLOTS))
}

export function getCustomUtilityKey(index: number) {
  return `customapp${index}`
}

function hasCustomSlotValue(value: unknown) {
  if (value === true) {
    return true
  }

  if (typeof value === 'string') {
    return value.trim().length > 0
  }

  return false
}

function getCustomSlotNumberFromKey(key: string) {
  const match = key.match(/^customapp(\d+)$/)
  return match ? Number(match[1]) : null
}

export function getHighestCustomSlot(...records: Array<Record<string, unknown> | undefined>) {
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

      if (key === 'utilities' && Array.isArray(value)) {
        value.forEach((entry) => {
          if (!isProfileUtility(entry) || !entry.enabled) {
            return
          }

          const slotNumber = getCustomSlotNumberFromKey(entry.id)

          if (slotNumber !== null) {
            highestSlot = Math.max(highestSlot, slotNumber)
          }
        })

        return
      }

      const slotNumber = getCustomSlotNumberFromKey(key)

      if (slotNumber !== null && hasCustomSlotValue(value)) {
        highestSlot = Math.max(highestSlot, slotNumber)
      }
    })
  }

  records.forEach((record) => {
    scanRecord(record)
  })

  return highestSlot
}

export function resolveCustomSlots(
  value: unknown,
  ...records: Array<Record<string, unknown> | undefined>
) {
  return Math.min(
    Math.max(normalizeCustomSlots(value), getHighestCustomSlot(...records)),
    MAX_CUSTOM_SLOTS
  )
}

export function getCustomUtilities(customSlots: unknown): Utility[] {
  const slotCount = normalizeCustomSlots(customSlots)

  return Array.from({ length: slotCount }, (_, index) => {
    const slotNumber = index + 1

    return {
      key: getCustomUtilityKey(slotNumber),
      name: `Custom App ${slotNumber}`,
      isCustom: true
    }
  })
}

export function getUtilities(customSlots: unknown): Utility[] {
  return [...BUILT_IN_UTILITIES, ...getCustomUtilities(customSlots)]
}

export function isProfileUtility(value: unknown): value is ProfileUtility {
  if (!value || typeof value !== 'object') {
    return false
  }

  const entry = value as Record<string, unknown>
  return typeof entry.id === 'string' && typeof entry.enabled === 'boolean'
}

export function normalizeProfileUtilities(profile: GameProfile | undefined, utilities: Utility[]) {
  const utilityIds = new Set(utilities.map((utility) => utility.key))
  const orderedUtilities: ProfileUtility[] = []
  const seen = new Set<string>()
  const storedUtilities = Array.isArray(profile?.utilities)
    ? profile.utilities.filter(isProfileUtility)
    : []

  storedUtilities.forEach((entry) => {
    if (!utilityIds.has(entry.id) || seen.has(entry.id)) {
      return
    }

    orderedUtilities.push({ id: entry.id, enabled: entry.enabled })
    seen.add(entry.id)
  })

  utilities.forEach((utility) => {
    if (seen.has(utility.key)) {
      return
    }

    orderedUtilities.push({
      id: utility.key,
      enabled: profile?.[utility.key] === true
    })
  })

  return orderedUtilities
}

export function getEnabledProfileUtilities(profile: GameProfile | undefined, utilities: Utility[]) {
  return normalizeProfileUtilities(profile, utilities).filter((utility) => utility.enabled)
}

export function migrateProfileToUtilityOrder(profile: GameProfile, utilities: Utility[]) {
  const migratedProfile: GameProfile = {
    ...profile,
    utilities: normalizeProfileUtilities(profile, utilities)
  }

  utilities.forEach((utility) => {
    delete migratedProfile[utility.key]
  })

  return migratedProfile
}

export function isGameProfileSet(value: unknown): value is GameProfileSet {
  if (!value || typeof value !== 'object') {
    return false
  }

  const entry = value as Record<string, unknown>
  return typeof entry.activeProfileId === 'string' && Array.isArray(entry.profiles)
}

export function createProfileId() {
  return `profile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function normalizeNamedProfile(value: unknown, fallbackIndex: number): NamedGameProfile | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const profile = value as Record<string, unknown>
  const fallbackName = fallbackIndex === 0 ? DEFAULT_PROFILE_NAME : `Profile ${fallbackIndex + 1}`

  return {
    ...(profile as GameProfile),
    id:
      typeof profile.id === 'string' && profile.id.trim().length > 0
        ? profile.id
        : createProfileId(),
    name:
      typeof profile.name === 'string' && profile.name.trim().length > 0
        ? profile.name.trim()
        : fallbackName
  }
}

export function createDefaultProfile(profile: GameProfile = {}): NamedGameProfile {
  return {
    ...profile,
    id: DEFAULT_PROFILE_ID,
    name: DEFAULT_PROFILE_NAME
  }
}

export function normalizeGameProfileSet(value: StoredGameProfile | undefined): GameProfileSet {
  if (isGameProfileSet(value)) {
    const seenIds = new Set<string>()
    const profiles = value.profiles.flatMap((profile, index) => {
      const normalizedProfile = normalizeNamedProfile(profile, index)

      if (!normalizedProfile || seenIds.has(normalizedProfile.id)) {
        return []
      }

      seenIds.add(normalizedProfile.id)
      return [normalizedProfile]
    })

    if (profiles.length === 0) {
      const defaultProfile = createDefaultProfile()
      return {
        activeProfileId: defaultProfile.id,
        profiles: [defaultProfile]
      }
    }

    const activeProfileId = profiles.some((profile) => profile.id === value.activeProfileId)
      ? value.activeProfileId
      : profiles[0].id

    return { activeProfileId, profiles }
  }

  return {
    activeProfileId: DEFAULT_PROFILE_ID,
    profiles: [createDefaultProfile(value)]
  }
}

export function getActiveGameProfile(value: StoredGameProfile | undefined) {
  const profileSet = normalizeGameProfileSet(value)
  return (
    profileSet.profiles.find((profile) => profile.id === profileSet.activeProfileId) ||
    profileSet.profiles[0]
  )
}

export const UTILITIES: Utility[] = getUtilities(DEFAULT_CUSTOM_SLOTS)
