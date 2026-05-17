import { app } from 'electron'

import { setIsQuitting } from './app-state'
import { registerHandlers } from './ipc'
import { migrateProfilesToNamedSets } from './migrator'
import { registerContentSecurityPolicy } from './security'
import { createTray } from './tray'
import { createWindow, getAppIconPath, showMainWindow } from './window'

app.on('before-quit', () => {
  setIsQuitting(true)
})

app.whenReady().then(() => {
  registerContentSecurityPolicy()
  migrateProfilesToNamedSets()
  registerHandlers()
  createTray({
    getIconPath: getAppIconPath,
    showMainWindow,
    quitApp: () => {
      setIsQuitting(true)
      app.quit()
    }
  })
  createWindow()
})
