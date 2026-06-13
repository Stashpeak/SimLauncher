import { contextBridge, ipcRenderer } from 'electron'
import type { ProgressInfo, UpdateInfo } from 'electron-updater'
import type {
  ElectronAPI,
  ProcessNameMismatchWarningPayload,
  RunningAppsChangedPayload,
  StoreConfigChangePayload
} from './api'

// The channel strings used in ipcRenderer.invoke / ipcRenderer.on must match
// the ipcMain.handle / sendToRenderer calls in src/main/ipc exactly.
// Renaming a channel in either direction silently breaks the feature — there
// is no compile-time contract between the two sides.

// Each `on*` subscription returns an Unsubscribe function so callers can call
// ipcRenderer.removeListener when the React component unmounts, avoiding
// duplicate-event delivery after hot reloads or re-mounts.

const electronAPI: ElectronAPI = {
  // launch
  launchProfile: (gameKey: string) => ipcRenderer.invoke('launch-profile', gameKey),
  relaunchMissingProfile: (gameKey: string) =>
    ipcRenderer.invoke('relaunch-missing-profile', gameKey),
  getProfileSwitchDiff: (gameKey: string, fromProfileId: string, toProfileId: string) =>
    ipcRenderer.invoke('get-profile-switch-diff', gameKey, fromProfileId, toProfileId),
  switchProfileApps: (gameKey: string, fromProfileId: string, toProfileId: string) =>
    ipcRenderer.invoke('switch-profile-apps', gameKey, fromProfileId, toProfileId),
  browsePath: (inputId: string) => ipcRenderer.invoke('browse-path', inputId),
  onAppLaunchError: (cb: (data: unknown) => void) => {
    const handler = (_: unknown, data: unknown) => cb(data)
    ipcRenderer.on('app-launch-error', handler)
    return () => ipcRenderer.removeListener('app-launch-error', handler)
  },
  onProcessNameMismatchWarning: (cb: (data: ProcessNameMismatchWarningPayload) => void) => {
    const handler = (_: unknown, data: ProcessNameMismatchWarningPayload) => cb(data)
    ipcRenderer.on('process-name-mismatch-warning', handler)
    return () => ipcRenderer.removeListener('process-name-mismatch-warning', handler)
  },

  // window controls
  minimize: () => ipcRenderer.invoke('window-minimize'),
  maximize: () => ipcRenderer.invoke('window-maximize'),
  close: () => ipcRenderer.invoke('window-close'),
  forceClose: () => ipcRenderer.invoke('force-close-window'),
  forceMinimizeToTray: () => ipcRenderer.invoke('force-minimize-to-tray'),
  setRendererDirty: (isDirty: boolean) => ipcRenderer.invoke('set-renderer-dirty', isDirty),
  setPendingMinimizeToTray: (value: boolean | null) =>
    ipcRenderer.invoke('set-pending-minimize-to-tray', value),
  onCloseRequested: (cb: (payload: { minimizeMode: boolean }) => void) => {
    const handler = (_: unknown, payload: { minimizeMode: boolean } | undefined) =>
      cb(payload ?? { minimizeMode: false })
    ipcRenderer.on('close-requested', handler)
    return () => ipcRenderer.removeListener('close-requested', handler)
  },
  restartApp: () => ipcRenderer.invoke('restart-app'),
  onWindowMaximizedChanged: (cb: (isMaximized: boolean) => void) => {
    const handler = (_: unknown, isMaximized: boolean) => cb(isMaximized)
    ipcRenderer.on('window-maximized-changed', handler)
    return () => ipcRenderer.removeListener('window-maximized-changed', handler)
  },

  // process monitoring
  getRunningApps: () => ipcRenderer.invoke('get-running-apps'),
  subscribeRunningApps: () => ipcRenderer.invoke('subscribe-running-apps'),
  unsubscribeRunningApps: () => ipcRenderer.invoke('unsubscribe-running-apps'),
  onRunningAppsChanged: (cb: (payload: RunningAppsChangedPayload) => void) => {
    const handler = (_: unknown, payload: RunningAppsChangedPayload) => cb(payload)
    ipcRenderer.on('running-apps-changed', handler)
    return () => ipcRenderer.removeListener('running-apps-changed', handler)
  },
  killLaunchedApps: (gameKey?: string) => ipcRenderer.invoke('kill-launched-apps', gameKey),

  // updater
  onUpdateAvailable: (cb: (info: UpdateInfo) => void) => {
    const handler = (_: unknown, info: UpdateInfo) => cb(info)
    ipcRenderer.on('update-available', handler)
    return () => ipcRenderer.removeListener('update-available', handler)
  },
  onUpdateDownloaded: (cb: (info: UpdateInfo) => void) => {
    const handler = (_: unknown, info: UpdateInfo) => cb(info)
    ipcRenderer.on('update-downloaded', handler)
    return () => ipcRenderer.removeListener('update-downloaded', handler)
  },
  onUpdateNotAvailable: (cb: (info: UpdateInfo) => void) => {
    const handler = (_: unknown, info: UpdateInfo) => cb(info)
    ipcRenderer.on('update-not-available', handler)
    return () => ipcRenderer.removeListener('update-not-available', handler)
  },
  onUpdateDownloadProgress: (cb: (progress: ProgressInfo) => void) => {
    const handler = (_: unknown, progress: ProgressInfo) => cb(progress)
    ipcRenderer.on('update-download-progress', handler)
    return () => ipcRenderer.removeListener('update-download-progress', handler)
  },
  onUpdateError: (cb: (error: Error) => void) => {
    const handler = (_: unknown, error: Error) => cb(error)
    ipcRenderer.on('update-error', handler)
    return () => ipcRenderer.removeListener('update-error', handler)
  },
  installUpdate: () => ipcRenderer.invoke('install-update'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  getUpdateInfo: () => ipcRenderer.invoke('get-update-info'),

  // startup & zoom
  setLoginItem: (openAtLogin: boolean) => ipcRenderer.invoke('set-login-item', openAtLogin),
  setZoom: (factor: number) => ipcRenderer.invoke('set-zoom', factor),

  // typed store channels
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (patch: unknown) => ipcRenderer.invoke('save-settings', patch),
  getProfiles: () => ipcRenderer.invoke('get-profiles'),
  saveProfile: (gameKey: string, profileSet: unknown) =>
    ipcRenderer.invoke('save-profile', gameKey, profileSet),
  saveProfiles: (profiles: unknown) => ipcRenderer.invoke('save-profiles', profiles),
  getMigrationFlags: () => ipcRenderer.invoke('get-migration-flags'),
  setMigrationFlags: (patch: unknown) => ipcRenderer.invoke('set-migration-flags', patch),
  onStoreConfigChanged: (cb: (payload: StoreConfigChangePayload) => void) => {
    const handler = (_: unknown, payload: StoreConfigChangePayload) => cb(payload)
    ipcRenderer.on('store-config-changed', handler)
    return () => ipcRenderer.removeListener('store-config-changed', handler)
  },
  exportConfig: () => ipcRenderer.invoke('export-config'),
  previewImportConfig: () => ipcRenderer.invoke('preview-import-config'),
  applyImportConfig: (token: string) => ipcRenderer.invoke('apply-import-config', token),
  cancelImportConfig: (token: string) => ipcRenderer.invoke('cancel-import-config', token),
  getAssetData: (filename: string) => ipcRenderer.invoke('get-asset-data', filename),
  getFileIcon: (filePath: string) => ipcRenderer.invoke('get-file-icon', filePath),
  getVersion: () => ipcRenderer.invoke('get-version'),
  getStartupNotice: () => ipcRenderer.invoke('get-startup-notice'),
  dismissAppIcon: (appPath: string, gameKey: string) =>
    ipcRenderer.invoke('dismiss-app-icon', appPath, gameKey)
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)
