import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  // launch
  launchProfile: (apps: string[]) => ipcRenderer.invoke('launch-profile', apps),
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
  onUpdateAvailable:  (cb: (info: unknown) => void) => ipcRenderer.on('update-available',  (_, info) => cb(info)),
  onUpdateDownloaded: (cb: (info: unknown) => void) => ipcRenderer.on('update-downloaded', (_, info) => cb(info)),
  installUpdate: () => ipcRenderer.invoke('install-update'),

  // electron-store
  storeGet: (key: string) => ipcRenderer.invoke('store-get', key),
  storeSet: (key: string, value: unknown) => ipcRenderer.invoke('store-set', key, value),
})
