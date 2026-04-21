export const launchProfile: typeof window.electronAPI.launchProfile = (gameKey) =>
  window.electronAPI.launchProfile(gameKey)
export const relaunchMissingProfile: typeof window.electronAPI.relaunchMissingProfile = (gameKey) =>
  window.electronAPI.relaunchMissingProfile(gameKey)
export const getProfileSwitchDiff: typeof window.electronAPI.getProfileSwitchDiff = (
  gameKey,
  fromProfileId,
  toProfileId
) => window.electronAPI.getProfileSwitchDiff(gameKey, fromProfileId, toProfileId)
export const switchProfileApps: typeof window.electronAPI.switchProfileApps = (
  gameKey,
  fromProfileId,
  toProfileId
) => window.electronAPI.switchProfileApps(gameKey, fromProfileId, toProfileId)
export const browsePath: typeof window.electronAPI.browsePath = (inputId) =>
  window.electronAPI.browsePath(inputId)
export const onAppLaunchError: typeof window.electronAPI.onAppLaunchError = (cb) =>
  window.electronAPI.onAppLaunchError(cb)
export const minimize = () => window.electronAPI.minimize()
export const maximize = () => window.electronAPI.maximize()
export const close = () => window.electronAPI.close()
export const getRunningApps = () => window.electronAPI.getRunningApps()
export const killLaunchedApps: typeof window.electronAPI.killLaunchedApps = (gameKey) =>
  window.electronAPI.killLaunchedApps(gameKey)
export const killProfileApps: typeof window.electronAPI.killProfileApps = (gameKey, appPaths) =>
  window.electronAPI.killProfileApps(gameKey, appPaths)
export const onUpdateAvailable: typeof window.electronAPI.onUpdateAvailable = (cb) =>
  window.electronAPI.onUpdateAvailable(cb)
export const onUpdateDownloaded: typeof window.electronAPI.onUpdateDownloaded = (cb) =>
  window.electronAPI.onUpdateDownloaded(cb)
export const onUpdateNotAvailable: typeof window.electronAPI.onUpdateNotAvailable = (cb) =>
  window.electronAPI.onUpdateNotAvailable(cb)
export const onUpdateDownloadProgress: typeof window.electronAPI.onUpdateDownloadProgress = (cb) =>
  window.electronAPI.onUpdateDownloadProgress(cb)
export const onUpdateError: typeof window.electronAPI.onUpdateError = (cb) =>
  window.electronAPI.onUpdateError(cb)
export const installUpdate = () => window.electronAPI.installUpdate()
export const checkForUpdates = () => window.electronAPI.checkForUpdates()
export const setLoginItem: typeof window.electronAPI.setLoginItem = (openAtLogin) =>
  window.electronAPI.setLoginItem(openAtLogin)
export const setZoom: typeof window.electronAPI.setZoom = (factor) =>
  window.electronAPI.setZoom(factor)
export const getAssetData: typeof window.electronAPI.getAssetData = (filename) =>
  window.electronAPI.getAssetData(filename)
export const getFileIcon: typeof window.electronAPI.getFileIcon = (filePath) =>
  window.electronAPI.getFileIcon(filePath)
export const getVersion = () => window.electronAPI.getVersion()
