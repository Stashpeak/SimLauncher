import {
  getUtilities,
  normalizeProfileUtilities,
  resolveCustomSlots,
  type ProfileUtility,
  type Utility
} from './config'

export function syncProfileUtilitiesWithSettings(
  currentUtilities: ProfileUtility[],
  settingsCustomSlots: number,
  settingsAppPaths: Record<string, string>,
  settingsAppNames: Record<string, string>
): { utilities: Utility[]; profileUtilities: ProfileUtility[] } {
  const resolvedUtilities = getUtilities(
    resolveCustomSlots(settingsCustomSlots, settingsAppPaths, settingsAppNames)
  )

  return {
    utilities: resolvedUtilities,
    profileUtilities: normalizeProfileUtilities({ utilities: currentUtilities }, resolvedUtilities)
  }
}
