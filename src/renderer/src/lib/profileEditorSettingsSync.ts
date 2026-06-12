import {
  getUtilities,
  normalizeProfileUtilities,
  resolveCustomSlots,
  type ProfileUtility,
  type Utility
} from './config'

/**
 * Reconciles a profile's utility list against the current settings snapshot.
 *
 * Called in two distinct contexts inside useProfileEditor:
 *  1. During initial load — derives both the canonical Utility[] list and the
 *     normalized ProfileUtility[] for the loaded profile.
 *  2. In the settings-change effect — re-runs with an empty `currentUtilities`
 *     to get the updated Utility[] list, then calls again via the setState
 *     updater to merge the live editor state (preserving enabled/order choices
 *     the user has made since the editor opened).
 *
 * Passing an empty array for `currentUtilities` is the intentional signal for
 * "derive utilities only, no profile state to preserve".
 */
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
