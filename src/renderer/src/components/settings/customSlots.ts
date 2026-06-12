import {
  getCustomUtilityKey,
  isGameProfileSet,
  isProfileUtility,
  type GameProfile,
  type NamedGameProfile,
  type Profiles
} from '../../lib/config'

/**
 * Shifts all custom-slot keys above `removedSlot` down by one in `record`,
 * then deletes the last (now-vacant) key. The range of affected keys is
 * [removedSlot, slotCount] inclusive — keys below `removedSlot` are untouched.
 *
 * Used to keep appPaths, appNames, and appArgs contiguous after a slot removal
 * so that slot numbers shown in the UI always match the underlying key index.
 */
export const shiftCustomSlotRecord = <T>(
  record: Record<string, T>,
  removedSlot: number,
  slotCount: number
): Record<string, T> => {
  const next = { ...record }

  for (let slot = removedSlot; slot <= slotCount; slot += 1) {
    const currentKey = getCustomUtilityKey(slot)
    const nextKey = getCustomUtilityKey(slot + 1)

    if (slot < slotCount && Object.prototype.hasOwnProperty.call(next, nextKey)) {
      next[currentKey] = next[nextKey]
    } else {
      delete next[currentKey]
    }
  }

  return next
}

/**
 * Mirrors the record-shift logic for Set members that carry a "customappN" key.
 * Keys below the removed slot pass through unchanged; keys at the removed slot
 * are dropped; keys above are decremented by one. Non-matching keys (built-in
 * utility IDs) are passed through as-is.
 *
 * Used for iconLoadErrors, which stores keys rather than values.
 */
export const shiftCustomSlotSet = (
  values: Set<string>,
  removedSlot: number,
  slotCount: number
): Set<string> => {
  const shifted = new Set<string>()

  values.forEach((value) => {
    const match = value.match(/^customapp(\d+)$/)

    if (!match) {
      shifted.add(value)
      return
    }

    const slot = Number(match[1])

    if (slot < removedSlot) {
      shifted.add(value)
    } else if (slot > removedSlot && slot <= slotCount) {
      shifted.add(getCustomUtilityKey(slot - 1))
    }
  })

  return shifted
}

const shiftSingleProfileCustomSlots = <T extends GameProfile>(
  profile: T,
  removedSlot: number,
  slotCount: number
) => {
  const shiftedProfile = shiftCustomSlotRecord(profile, removedSlot, slotCount) as T

  if (Array.isArray(profile.utilities)) {
    shiftedProfile.utilities = profile.utilities.filter(isProfileUtility).flatMap((utility) => {
      const match = utility.id.match(/^customapp(\d+)$/)

      if (!match) {
        return [utility]
      }

      const slot = Number(match[1])

      if (slot < removedSlot) {
        return [utility]
      }

      if (slot > removedSlot && slot <= slotCount) {
        return [{ ...utility, id: getCustomUtilityKey(slot - 1) }]
      }

      return []
    })
  }

  return shiftedProfile
}

/**
 * Applies the slot-shift to a single game's profile entry, handling both the
 * flat GameProfile shape and the ProfileSet shape (which nests multiple named
 * profiles under `.profiles`). The `utilities` array inside each profile also
 * needs its IDs renumbered so that saved launch sequences stay consistent with
 * the shifted slot numbers in appPaths/appNames.
 */
export const shiftProfileCustomSlots = (
  profile: Profiles[string],
  removedSlot: number,
  slotCount: number
): Profiles[string] => {
  if (isGameProfileSet(profile)) {
    return {
      ...profile,
      profiles: profile.profiles.map(
        (namedProfile) =>
          shiftSingleProfileCustomSlots(namedProfile, removedSlot, slotCount) as NamedGameProfile
      )
    }
  }

  return shiftSingleProfileCustomSlots(profile, removedSlot, slotCount)
}
