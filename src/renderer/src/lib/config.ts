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
export type GamePosition = 'first' | 'last'
export interface GameProfile {
  // Index signature preserved so that legacy flat keys (e.g. 'simhub': true)
  // can coexist with the typed properties during migration. Any code reading a
  // known key should use the typed property, not the index signature.
  [key: string]: unknown
  utilities?: ProfileUtility[]
  launchAutomatically?: boolean
  gamePosition?: GamePosition
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
// The on-disk representation can be either the old flat-profile format
// (GameProfile) or the newer profile-set format (GameProfileSet). Callers
// should normalise through normalizeGameProfileSet before operating on profiles.
export type StoredGameProfile = GameProfile | GameProfileSet
export type Profiles = Record<string, StoredGameProfile>

export const DEFAULT_ACCENT_COLOR = '#008c99'
export const DEFAULT_CUSTOM_SLOTS = 1
export const DEFAULT_PROFILE_ID = 'default'
export const DEFAULT_PROFILE_NAME = 'Default'
export const MAX_CUSTOM_SLOTS = 20

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export const GAMES: Game[] = [
  { key: 'ac', name: 'Assetto Corsa', icon: 'assets/ac.png' },
  { key: 'acc', name: 'Assetto Corsa Competizione', icon: 'assets/acc.png' },
  { key: 'acevo', name: 'Assetto Corsa Evo', icon: 'assets/acevo.png' },
  { key: 'acrally', name: 'Assetto Corsa Rally', icon: 'assets/acrally.png' },
  { key: 'aeroflyfs4', name: 'Aerofly FS 4', icon: 'assets/aeroflyfs4.png' },
  { key: 'ams', name: 'Automobilista', icon: 'assets/ams.png' },
  { key: 'ams2', name: 'Automobilista 2', icon: 'assets/ams2.png' },
  { key: 'beamng', name: 'BeamNG', icon: 'assets/beamng.png' },
  { key: 'dcsw', name: 'DCS World', icon: 'assets/dcsw.png' },
  { key: 'dirtrally', name: 'Dirt Rally', icon: 'assets/dirtrally.png' },
  { key: 'dirtrally2', name: 'Dirt Rally 2.0', icon: 'assets/dirtrally2.png' },
  { key: 'eawrc', name: 'EA WRC', icon: 'assets/eawrc.png' },
  { key: 'f124', name: 'F1 24', icon: 'assets/f124.png' },
  { key: 'f125', name: 'F1 25', icon: 'assets/f125.png' },
  { key: 'il2gb', name: 'IL-2 Sturmovik: Great Battles', icon: 'assets/il2gb.png' },
  { key: 'iracing', name: 'iRacing', icon: 'assets/iracing.png' },
  { key: 'lmu', name: 'Le Mans Ultimate', icon: 'assets/lmu.png' },
  { key: 'msfs2020', name: 'Microsoft Flight Simulator 2020', icon: 'assets/msfs2020.png' },
  { key: 'msfs2024', name: 'Microsoft Flight Simulator 2024', icon: 'assets/msfs2024.png' },
  { key: 'p3d', name: 'Prepar3D', icon: 'assets/p3d.png' },
  { key: 'pmr', name: 'Project Motor Racing', icon: 'assets/pmr.png' },
  { key: 'raceroom', name: 'RaceRoom Racing Experience', icon: 'assets/raceroom.png' },
  { key: 'rbr', name: 'Richard Burns Rally', icon: 'assets/rbr.png' },
  { key: 'rennsport', name: 'Rennsport', icon: 'assets/rennsport.png' },
  { key: 'rf1', name: 'rFactor', icon: 'assets/rf1.png' },
  { key: 'rf2', name: 'rFactor 2', icon: 'assets/rf2.png' },
  { key: 'xplane12', name: 'X-Plane 12', icon: 'assets/xplane12.png' }
]

export const BUILT_IN_UTILITIES: Utility[] = [
  { key: 'simhub', name: 'SimHub' },
  { key: 'crewchief', name: 'Crew Chief' },
  { key: 'tradingpaints', name: 'Trading Paints' },
  { key: 'garage61', name: 'Garage 61' },
  { key: 'secondmonitor', name: 'Second Monitor' }
]

export function normalizeCustomSlots(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_CUSTOM_SLOTS
  }

  return Math.max(1, Math.min(Math.floor(value), MAX_CUSTOM_SLOTS))
}

export function getCustomUtilityKey(index: number): string {
  return `customapp${index}`
}

// A custom-app slot is considered "in use" when the stored value is either a
// non-empty string (a configured path or name) or a boolean true (legacy enabled
// flag). Other falsy values mean the slot is unconfigured.
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

/**
 * Scans one or more records (settings, profiles, or nested profile objects) and
 * returns the highest custom-app slot number that is actively in use.
 *
 * The scan is recursive for the special keys 'profiles' (array of named
 * profiles) and 'utilities' (ProfileUtility[] inside a profile) so that enabled
 * slots buried inside a GameProfileSet are found without callers flattening
 * the structure first. Returns 0 when no custom slot is found.
 */
export function getHighestCustomSlot(
  ...records: Array<Record<string, unknown> | undefined>
): number {
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

/**
 * Returns the effective custom-slot count: at least as large as the stored
 * setting and at least as large as the highest slot already in use across the
 * provided records. This prevents the UI from silently dropping custom-app data
 * when the stored slot count is lower than the actual configured slots.
 */
export function resolveCustomSlots(
  value: unknown,
  ...records: Array<Record<string, unknown> | undefined>
): number {
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
  if (!isRecord(value)) {
    return false
  }

  return typeof value.id === 'string' && typeof value.enabled === 'boolean'
}

/**
 * Returns a canonical ProfileUtility[] for the given profile, aligned to the
 * current utility list.
 *
 * Ordering contract (#438, #480):
 *  - Entries already stored in the profile are emitted first, in their stored
 *    order (preserving the user's drag-reorder choices).
 *  - Unknown or duplicate ids are dropped.
 *  - Utilities not yet in the profile (e.g. newly added custom slots) are
 *    appended at the end with enabled derived from the legacy flat boolean key
 *    (profile[utility.key] === true) so that old data round-trips correctly.
 *
 * The result is used as the dirty-tracking baseline — key order is load-bearing.
 */
export function normalizeProfileUtilities(
  profile: GameProfile | undefined,
  utilities: Utility[]
): ProfileUtility[] {
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

export function getEnabledProfileUtilities(
  profile: GameProfile | undefined,
  utilities: Utility[]
): ProfileUtility[] {
  return normalizeProfileUtilities(profile, utilities).filter((utility) => utility.enabled)
}

/**
 * One-time migration that converts a flat-boolean profile (legacy format where
 * each utility is stored as `{ simhub: true, crewchief: false, ... }`) to the
 * ordered `utilities` array format.
 *
 * After calling this, the flat boolean keys are deleted so the profile does not
 * carry both representations. Only called from migrateFromLocalStorage — do not
 * use for live editor state.
 */
export function migrateProfileToUtilityOrder(
  profile: GameProfile,
  utilities: Utility[]
): GameProfile {
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
  if (!isRecord(value)) {
    return false
  }

  return typeof value.activeProfileId === 'string' && Array.isArray(value.profiles)
}

export function normalizeProfiles(value: unknown): Profiles {
  if (!isRecord(value)) {
    return {}
  }

  const profiles: Profiles = {}

  Object.entries(value).forEach(([gameKey, profile]) => {
    if (isGameProfileSet(profile) || isRecord(profile)) {
      profiles[gameKey] = profile
    }
  })

  return profiles
}

/**
 * Generates a collision-resistant profile id.
 * The timestamp component prevents collisions across sessions; the random
 * suffix handles the (very unlikely) same-millisecond case within a session.
 */
export function createProfileId(): string {
  return `profile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function normalizeNamedProfile(value: unknown, fallbackIndex: number): NamedGameProfile | null {
  if (!isRecord(value)) {
    return null
  }

  const fallbackName = fallbackIndex === 0 ? DEFAULT_PROFILE_NAME : `Profile ${fallbackIndex + 1}`

  return {
    ...value,
    id: typeof value.id === 'string' && value.id.trim().length > 0 ? value.id : createProfileId(),
    name:
      typeof value.name === 'string' && value.name.trim().length > 0
        ? value.name.trim()
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

/**
 * Ensures the stored value is a valid GameProfileSet regardless of its format.
 *
 * Handles three cases:
 *  1. Already a GameProfileSet — sanitises duplicate ids, fills missing names,
 *     and falls back to profiles[0] when the stored activeProfileId is stale.
 *  2. A bare GameProfile (legacy format) — wraps it in a single-profile set
 *     using DEFAULT_PROFILE_ID and DEFAULT_PROFILE_NAME.
 *  3. undefined / null / invalid — returns a fresh default profile set.
 *
 * The guarantee: the returned set always has at least one profile and a valid
 * activeProfileId that points to an existing profile.
 */
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

export function getActiveGameProfile(value: StoredGameProfile | undefined): NamedGameProfile {
  const profileSet = normalizeGameProfileSet(value)
  return (
    profileSet.profiles.find((profile) => profile.id === profileSet.activeProfileId) ||
    profileSet.profiles[0]
  )
}
