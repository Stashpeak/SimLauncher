export const launchProfile = window.electronAPI.launchProfile
export const relaunchMissingProfile = window.electronAPI.relaunchMissingProfile
export const getProfileSwitchDiff = window.electronAPI.getProfileSwitchDiff
export const switchProfileApps = window.electronAPI.switchProfileApps
export const browsePath = window.electronAPI.browsePath
export const onAppLaunchError = window.electronAPI.onAppLaunchError
export const onProcessNameMismatchWarning = window.electronAPI.onProcessNameMismatchWarning
export const minimize = () => window.electronAPI.minimize()
export const maximize = () => window.electronAPI.maximize()
export const close = () => window.electronAPI.close()
export const restartApp = () => window.electronAPI.restartApp()
export const getRunningApps = () => window.electronAPI.getRunningApps()
export const subscribeRunningApps = () => window.electronAPI.subscribeRunningApps()
export const unsubscribeRunningApps = () => window.electronAPI.unsubscribeRunningApps()
export const onRunningAppsChanged = window.electronAPI.onRunningAppsChanged
export const killLaunchedApps = window.electronAPI.killLaunchedApps
export const onUpdateAvailable = window.electronAPI.onUpdateAvailable
export const onUpdateDownloaded = window.electronAPI.onUpdateDownloaded
export const onUpdateNotAvailable = window.electronAPI.onUpdateNotAvailable
export const onUpdateDownloadProgress = window.electronAPI.onUpdateDownloadProgress
export const onUpdateError = window.electronAPI.onUpdateError
export const installUpdate = () => window.electronAPI.installUpdate()
export const checkForUpdates = () => window.electronAPI.checkForUpdates()
export const getUpdateInfo = () => window.electronAPI.getUpdateInfo()
export const setLoginItem = window.electronAPI.setLoginItem
export const setZoom = window.electronAPI.setZoom
export const getAssetData = window.electronAPI.getAssetData
export const getFileIcon = window.electronAPI.getFileIcon
export const getVersion = () => window.electronAPI.getVersion()
export const showAppContextMenu = window.electronAPI.showAppContextMenu
