import { app } from 'electron'

import { setIsQuitting } from './app-state'
import { registerHandlers } from './ipc'
import { migrateProfilesToNamedSets } from './migrator'
import { registerContentSecurityPolicy } from './security'
import { store } from './store'
import { configureTray, createTray } from './tray'
import { createWindow, getAppIconPath, showMainWindow } from './window'

// Prevent multiple instances: the first instance acquires the lock; any
// subsequent launch is redirected to focus the already-running window.
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  // This is a second (or later) instance — quit immediately so the user sees
  // the existing window pop to the front instead of a duplicate starting up.
  app.quit()
} else {
  // First instance: listen for future launch attempts and bring our window
  // to the foreground when they occur.
  app.on('second-instance', () => {
    showMainWindow()
  })

  app.on('before-quit', () => {
    // Covers system-level quit paths (OS shutdown, taskbar close-all, etc.) that
    // bypass the window 'close' handler, ensuring the close interceptor in
    // window.ts doesn't swallow the quit.
    setIsQuitting(true)
  })

  app.whenReady().then(() => {
    registerContentSecurityPolicy()
    migrateProfilesToNamedSets()
    registerHandlers()
    configureTray({
      getIconPath: getAppIconPath,
      showMainWindow,
      quitApp: () => {
        // Set isQuitting before app.quit() so the window 'close' interceptor
        // does not cancel the quit triggered from the tray menu. The
        // 'before-quit' event fires after app.quit() is called, which would be
        // too late if the interceptor runs first.
        setIsQuitting(true)
        app.quit()
      }
    })
    if (store.get('showTrayIcon') !== false) {
      createTray()
    }
    createWindow()
  })
}
