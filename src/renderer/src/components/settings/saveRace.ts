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

export function resolveSettingsObjectsAfterSave({
  savedObjects
}: {
  savedObjects: SettingsObjectRecords
  latestObjects: SettingsObjectRecords
  changedDuringSave: SettingsObjectChangeMap
}): SettingsObjectRecords {
  return savedObjects
}
