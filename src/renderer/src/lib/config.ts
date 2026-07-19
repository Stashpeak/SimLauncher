// Game/Utility registries live in the process-agnostic domain layer (#692).
// Re-exported here so the many renderer importers keep their `from '../lib/config'`
// import path; new code can import from '../../../shared/domain/registries' directly.
import {
  GAMES,
  BUILT_IN_UTILITIES,
  type Game,
  type Utility
} from '../../../shared/domain/registries'
import type {
  Profile,
  NamedProfile,
  ProfileSet,
  ProfileEntry,
  Profiles,
  ProfileUtility
} from '../../../shared/domain/profile'
import { getHighestCustomSlot } from '../../../shared/domain/slots'

export { GAMES, BUILT_IN_UTILITIES, type Game, type Utility }
export { getHighestCustomSlot }

// Profile domain types are process-agnostic (#692); the canonical defs live in
// the shared domain layer. Re-exported here under the renderer's historical
// Game*/Stored* names so existing importers keep their `from '../lib/config'`
// import path. New code can import from '../../../shared/domain/profile'.
export type GameProfile = Profile
export type NamedGameProfile = NamedProfile
export type GameProfileSet = ProfileSet
export type StoredGameProfile = ProfileEntry
export type { Profiles, ProfileUtility }
export type { GamePosition } from '../../../shared/domain/profile'

// Namespaced icon-load-error key for a built-in's bundled icon (#727/#728).
// Bundled and shell icons share one per-surface error store (same state
// shape, same lifecycle); the prefix keeps their failure states independent,
// so a failed bundled data URI falls through to the shell icon without
// masking it. Never collides with utility keys or custom-slot renumbering
// (customapp<N>). Shared by every surface that renders utility icons
// (AppsSection, ProfileUtilitiesSection).
export function getBundledIconErrorKey(key: string): string {
  return `bundled:${key}`
}

export const DEFAULT_ACCENT_COLOR = '#008c99'
export const DEFAULT_CUSTOM_SLOTS = 1
export const DEFAULT_PROFILE_ID = 'default'
export const DEFAULT_PROFILE_NAME = 'Default'
export const MAX_CUSTOM_SLOTS = 20

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function normalizeCustomSlots(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_CUSTOM_SLOTS
  }

  return Math.max(1, Math.min(Math.floor(value), MAX_CUSTOM_SLOTS))
}

export function getCustomUtilityKey(index: number): string {
  return `customapp${index}`
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
