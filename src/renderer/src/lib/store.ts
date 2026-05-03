export const getSettings = () => window.electronAPI.getSettings()
export const saveSettings = window.electronAPI.saveSettings
export const getProfiles = () => window.electronAPI.getProfiles()
export const saveProfile = window.electronAPI.saveProfile
export const saveProfiles = window.electronAPI.saveProfiles
export const getMigrationFlags = () => window.electronAPI.getMigrationFlags()
export const setMigrationFlags = window.electronAPI.setMigrationFlags
export const onStoreConfigChanged = window.electronAPI.onStoreConfigChanged
export const exportConfig = () => window.electronAPI.exportConfig()
export const importConfig = () => window.electronAPI.importConfig()
