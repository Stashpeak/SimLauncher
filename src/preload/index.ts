import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  // launch
  launchProfile: (gameKey: string, apps: string[]) => ipcRenderer.invoke('launch-profile', gameKey, apps),
  browsePath: (inputId: string) => ipcRenderer.invoke('browse-path', inputId),
  onAppLaunchError: (cb: (data: unknown) => void) => {
    const handler = (_: unknown, data: unknown) => cb(data)
    ipcRenderer.on('app-launch-error', handler)
    return () => ipcRenderer.removeListener('app-launch-error', handler)
  },

  // window controls
  minimize: () => ipcRenderer.invoke('window-minimize'),
  maximize: () => ipcRenderer.invoke('window-maximize'),
  close:    () => ipcRenderer.invoke('window-close'),

  // process monitoring
  getRunningApps:   () => ipcRenderer.invoke('get-running-apps'),
  killLaunchedApps: () => ipcRenderer.invoke('kill-launched-apps'),

  // updater
  onUpdateAvailable: (cb: (info: any) => void) => {
    const handler = (_: unknown, info: any) => cb(info)
    ipcRenderer.on('update-available', handler)
    return () => ipcRenderer.removeListener('update-available', handler)
  },
  onUpdateDownloaded: (cb: (info: any) => void) => {
    const handler = (_: unknown, info: any) => cb(info)
    ipcRenderer.on('update-downloaded', handler)
    return () => ipcRenderer.removeListener('update-downloaded', handler)
  },
  onUpdateNotAvailable: (cb: (info: any) => void) => {
    const handler = (_: unknown, info: any) => cb(info)
    ipcRenderer.on('update-not-available', handler)
    return () => ipcRenderer.removeListener('update-not-available', handler)
  },
  installUpdate: () => ipcRenderer.invoke('install-update'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),

  // electron-store
  storeGet: (key: string) => ipcRenderer.invoke('store-get', key),
  storeSet: (key: string, value: unknown) => ipcRenderer.invoke('store-set', key, value),
  getAssetData: (filename: string) => ipcRenderer.invoke('get-asset-data', filename),
  getFileIcon: (filePath: string) => ipcRenderer.invoke('get-file-icon', filePath),
  getVersion: () => ipcRenderer.invoke('get-version')
})
