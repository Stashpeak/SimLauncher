// These four fields are dictionary-typed (Record<string, string>) and can be
// edited concurrently while a save is in flight. All other settings fields are
// scalars whose last-writer-wins behaviour is acceptable, so they are not tracked.
export const SETTINGS_OBJECT_FIELDS = ['appPaths', 'appNames', 'appArgs', 'gamePaths'] as const

export type SettingsObjectField = (typeof SETTINGS_OBJECT_FIELDS)[number]
export type SettingsObjectRecords = Record<SettingsObjectField, Record<string, string>>
export type SettingsObjectVersions = Record<SettingsObjectField, number>
export type SettingsObjectChangeMap = Record<SettingsObjectField, boolean>

export function createSettingsObjectVersions(): SettingsObjectVersions {
  return {
    appPaths: 0,
    appNames: 0,
    appArgs: 0,
    gamePaths: 0
  }
}

export function getSettingsObjectChangesDuringSave(
  versionsAtSave: SettingsObjectVersions,
  currentVersions: SettingsObjectVersions
): SettingsObjectChangeMap {
  return Object.fromEntries(
    SETTINGS_OBJECT_FIELDS.map((field) => [field, currentVersions[field] !== versionsAtSave[field]])
  ) as SettingsObjectChangeMap
}

/**
 * Returns the object records that should become the new dirty-tracking baseline
 * after a save completes.
 *
 * Returning `savedObjects` unconditionally is intentional: the baseline must
 * reflect what is on disk, not the in-flight renderer state. If the user made
 * further edits while the save was awaiting (changedDuringSave[field] === true),
 * those edits will still appear as dirty against this baseline, which is
 * exactly the desired behaviour. Using `latestObjects` instead would silently
 * lose unsaved concurrent edits by making them look already-saved.
 */
export function resolveSettingsObjectsAfterSave({
  savedObjects
}: {
  savedObjects: SettingsObjectRecords
  latestObjects: SettingsObjectRecords
  changedDuringSave: SettingsObjectChangeMap
}): SettingsObjectRecords {
  return savedObjects
}
