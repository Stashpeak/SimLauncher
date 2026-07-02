export const getSettings = () => window.electronAPI.getSettings()
export const saveSettings = window.electronAPI.saveSettings
export const getProfiles = () => window.electronAPI.getProfiles()
export const saveProfile = window.electronAPI.saveProfile
export const saveProfiles = window.electronAPI.saveProfiles
export const getMigrationFlags = () => window.electronAPI.getMigrationFlags()
export const setMigrationFlags = window.electronAPI.setMigrationFlags
export const getOnboardingSeen = () => window.electronAPI.getOnboardingSeen()
export const setOnboardingSeen = window.electronAPI.setOnboardingSeen
export const onStoreConfigChanged = window.electronAPI.onStoreConfigChanged
export const exportConfig = () => window.electronAPI.exportConfig()
export const previewImportConfig = () => window.electronAPI.previewImportConfig()
export const applyImportConfig = window.electronAPI.applyImportConfig
export const cancelImportConfig = window.electronAPI.cancelImportConfig
