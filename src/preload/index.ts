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
  killLaunchedApps: (gameKey?: string) => ipcRenderer.invoke('kill-launched-apps', gameKey),

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
  onUpdateDownloadProgress: (cb: (progress: any) => void) => {
    const handler = (_: unknown, progress: any) => cb(progress)
    ipcRenderer.on('update-download-progress', handler)
    return () => ipcRenderer.removeListener('update-download-progress', handler)
  },
  onUpdateError: (cb: (error: any) => void) => {
    const handler = (_: unknown, error: any) => cb(error)
    ipcRenderer.on('update-error', handler)
    return () => ipcRenderer.removeListener('update-error', handler)
  },
  installUpdate: () => ipcRenderer.invoke('install-update'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),

  // startup & zoom
  setLoginItem: (openAtLogin: boolean) => ipcRenderer.invoke('set-login-item', openAtLogin),
  setZoom: (factor: number) => ipcRenderer.invoke('set-zoom', factor),

  // electron-store
  storeGet: (key: string) => ipcRenderer.invoke('store-get', key),
  storeSet: (key: string, value: unknown) => ipcRenderer.invoke('store-set', key, value),
  getAssetData: (filename: string) => ipcRenderer.invoke('get-asset-data', filename),
  getFileIcon: (filePath: string) => ipcRenderer.invoke('get-file-icon', filePath),
  getVersion: () => ipcRenderer.invoke('get-version')
})
