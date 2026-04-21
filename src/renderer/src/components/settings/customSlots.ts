import {
  getCustomUtilityKey,
  isGameProfileSet,
  isProfileUtility,
  type GameProfile,
  type NamedGameProfile,
  type Profiles
} from '../../lib/config'

export const shiftCustomSlotRecord = <T>(
  record: Record<string, T>,
  removedSlot: number,
  slotCount: number
) => {
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

export const shiftCustomSlotSet = (values: Set<string>, removedSlot: number, slotCount: number) => {
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

export const shiftProfileCustomSlots = (
  profile: Profiles[string],
  removedSlot: number,
  slotCount: number
) => {
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
