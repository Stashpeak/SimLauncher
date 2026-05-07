import {
  getUtilities,
  normalizeProfileUtilities,
  resolveCustomSlots,
  type ProfileUtility
} from './config'

export function syncProfileUtilitiesWithSettings(
  currentUtilities: ProfileUtility[],
  settingsCustomSlots: number,
  settingsAppPaths: Record<string, string>,
  settingsAppNames: Record<string, string>
) {
  const resolvedUtilities = getUtilities(
    resolveCustomSlots(settingsCustomSlots, settingsAppPaths, settingsAppNames)
  )

  return {
    utilities: resolvedUtilities,
    profileUtilities: normalizeProfileUtilities({ utilities: currentUtilities }, resolvedUtilities)
  }
}
