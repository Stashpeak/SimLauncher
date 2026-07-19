// Custom-app slot scanning (#692).
//
// A "custom slot" is a user-defined utility slot keyed `customapp<N>` (1-based),
// referenced in profiles, appPaths, appNames and appArgs. The store persists a
// `customSlots` count, but the actual data can reference a higher slot than the
// stored count (e.g. an import, a manual edit, or a profile saved in the same
// batch as a customSlots increase). Both processes need to find the highest
// referenced slot; before #692 this walker was copied three times (renderer
// lib/config.ts, main migrator.ts, main ipc/config.ts).

import type { ProfileSet } from './profile'

// Parse the slot number N out of a `customapp<N>` key or utility id. Returns
// null for anything that is not a custom-slot reference.
export function getCustomSlotNumberFromKey(key: string): number | null {
  const match = key.match(/^customapp(\d+)$/)
  return match ? Number(match[1]) : null
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

// A custom-app slot is "in use" when the stored value is a non-empty string (a
// configured path or name) or boolean true (legacy enabled flag). Other falsy
// values (false, '', 0, null) mean the slot is referenced but not configured.
function hasCustomSlotValue(value: unknown): boolean {
  if (value === true) {
    return true
  }

  if (typeof value === 'string') {
    return value.trim().length > 0
  }

  return false
}

// 'in-use'     count a slot only when its value / enabled flag marks it active.
//              Sizes the visible slot count so configured slots are never
//              dropped from the UI.
// 'referenced' count a slot whenever it appears at all, even disabled or empty.
//              Widens the save-time sanitizer whitelist so a referenced slot is
//              not stripped (which would lose the user's data). Collapsing this
//              into 'in-use' is a data-loss regression - see the divergence test
//              in tests/main/customSlots.test.ts.
type SlotScanMode = 'in-use' | 'referenced'

function scanHighestSlot(
  records: Array<Record<string, unknown> | undefined>,
  mode: SlotScanMode
): number {
  let highest = 0

  // Number.isFinite guards the (unreachable) case of a customapp<N> whose N has
  // 309+ digits and overflows Number() to Infinity; it also keeps parity with
  // the old referenced scanner, which already dropped non-finite slot numbers.
  const consider = (slotNumber: number | null) => {
    if (slotNumber !== null && Number.isFinite(slotNumber) && slotNumber > highest) {
      highest = slotNumber
    }
  }

  const scanRecord = (record: Record<string, unknown> | undefined) => {
    if (!record) {
      return
    }

    Object.entries(record).forEach(([key, value]) => {
      // Recurse into a profile set's profiles array so slots buried inside a
      // GameProfileSet are found without the caller flattening the structure.
      // Uniform across modes: for the referenced scan this makes the result a
      // safe superset of a flat per-profile scan - it can only widen, never drop.
      if (key === 'profiles' && Array.isArray(value)) {
        value.forEach((profile) => {
          if (isRecordLike(profile)) {
            scanRecord(profile)
          }
        })
        return
      }

      if (key === 'utilities' && Array.isArray(value)) {
        value.forEach((entry) => {
          if (!isRecordLike(entry) || typeof entry.id !== 'string') {
            return
          }

          // In-use counts only enabled utilities; referenced counts any entry.
          if (mode === 'in-use' && entry.enabled !== true) {
            return
          }

          consider(getCustomSlotNumberFromKey(entry.id))
        })
        return
      }

      const slotNumber = getCustomSlotNumberFromKey(key)

      if (slotNumber === null) {
        return
      }

      if (mode === 'referenced' || hasCustomSlotValue(value)) {
        consider(slotNumber)
      }
    })
  }

  records.forEach(scanRecord)

  return highest
}

/**
 * Highest custom-app slot number actively IN USE across the given records
 * (settings, profiles, or nested profile objects). A slot counts only when its
 * stored value marks it active (non-empty string / boolean true) or, inside a
 * profile's utilities array, when the entry is enabled. Returns 0 when none.
 */
export function getHighestCustomSlot(
  ...records: Array<Record<string, unknown> | undefined>
): number {
  return scanHighestSlot(records, 'in-use')
}

/**
 * Highest custom-app slot number REFERENCED anywhere in a profile set, whether
 * or not it is enabled or configured. Used to widen the save-time sanitizer
 * whitelist so a referenced slot is never stripped (data loss). This must NOT
 * be reduced to getHighestCustomSlot - see the mode doc above.
 */
export function getHighestReferencedCustomSlot(profileSet: ProfileSet): number {
  return scanHighestSlot(profileSet.profiles, 'referenced')
}
