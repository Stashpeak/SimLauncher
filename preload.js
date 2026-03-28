const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    launchProfile: (apps) => ipcRenderer.invoke('launch-profile', apps),
    browsePath: (inputId) => ipcRenderer.invoke('browse-path', inputId),
    onAppLaunchError: (cb) => ipcRenderer.on('app-launch-error', (_, data) => cb(data))
});
