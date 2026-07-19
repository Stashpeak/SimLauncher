// Process-agnostic runtime guards (#692).
//
// isRecord was duplicated in the renderer (lib/config.ts) and the main process
// (utils.ts); the two profile discriminators were duplicated under different
// names (config.ts's isGameProfileSet / isProfileUtility and profiles.ts's
// isStoredProfileSet / isStoredProfileUtility). This is the single source; the
// old names are re-exported from those files so importers do not change.

import type { ProfileSet, ProfileUtility } from './profile'

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function isProfileUtility(value: unknown): value is ProfileUtility {
  return isRecord(value) && typeof value.id === 'string' && typeof value.enabled === 'boolean'
}

export function isProfileSet(value: unknown): value is ProfileSet {
  return (
    isRecord(value) && typeof value.activeProfileId === 'string' && Array.isArray(value.profiles)
  )
}
