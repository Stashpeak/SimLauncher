export const getSettings = () => window.electronAPI.getSettings()
export const saveSettings: typeof window.electronAPI.saveSettings = (patch) =>
  window.electronAPI.saveSettings(patch)
export const getProfiles = () => window.electronAPI.getProfiles()
export const saveProfile: typeof window.electronAPI.saveProfile = (key, profile) =>
  window.electronAPI.saveProfile(key, profile)
export const saveProfiles: typeof window.electronAPI.saveProfiles = (profiles) =>
  window.electronAPI.saveProfiles(profiles)
export const getMigrationFlags = () => window.electronAPI.getMigrationFlags()
export const setMigrationFlags: typeof window.electronAPI.setMigrationFlags = (patch) =>
  window.electronAPI.setMigrationFlags(patch)
export const exportConfig = () => window.electronAPI.exportConfig()
export const importConfig = () => window.electronAPI.importConfig()
