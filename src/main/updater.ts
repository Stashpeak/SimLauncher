import { app, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'

import { setIsQuitting } from './app-state'

type SendToRenderer = (channel: string, payload: unknown) => void
type UpdateAvailability = { version: string }

let sendToRenderer: SendToRenderer = () => {}
let installAfterDownload = false
let updateDownloaded = false
let availableUpdate: UpdateAvailability | null = null

autoUpdater.autoDownload = false

export function registerUpdaterEvents(rendererSender: SendToRenderer) {
  sendToRenderer = rendererSender

  autoUpdater.on('update-available', (info) => {
    updateDownloaded = false
    availableUpdate = { version: info.version }
    sendToRenderer('update-available', info)
  })

  autoUpdater.on('update-downloaded', (info) => {
    updateDownloaded = true
    availableUpdate = { version: info.version }
    sendToRenderer('update-downloaded', info)

    if (installAfterDownload) {
      quitAndInstallUpdate()
    }
  })

  autoUpdater.on('update-not-available', (info) => {
    updateDownloaded = false
    availableUpdate = null
    sendToRenderer('update-not-available', info)
  })

  autoUpdater.on('download-progress', (progress) => {
    sendToRenderer('update-download-progress', progress)
  })

  autoUpdater.on('error', (err) => {
    installAfterDownload = false
    sendToRenderer('update-error', { message: err.message })
  })
}

function quitAndInstallUpdate() {
  setIsQuitting(true)
  autoUpdater.quitAndInstall()
}

export async function checkForUpdates() {
  if (!app.isPackaged) {
    availableUpdate = { version: '99.0.0' }
    sendToRenderer('update-available', availableUpdate)
    return null
  }

  return await autoUpdater.checkForUpdates()
}

export function getAvailableUpdate() {
  return availableUpdate
}

export function registerUpdaterHandlers(rendererSender: SendToRenderer) {
  sendToRenderer = rendererSender

  ipcMain.handle('install-update', async () => {
    if (!app.isPackaged) {
      sendToRenderer('update-downloaded', { version: '99.0.0' })
      return { success: true }
    }

    installAfterDownload = true

    if (updateDownloaded) {
      quitAndInstallUpdate()
      return { success: true }
    }

    try {
      await autoUpdater.downloadUpdate()
      return { success: true }
    } catch (err) {
      installAfterDownload = false
      throw err
    }
  })

  ipcMain.handle('check-for-updates', async () => {
    return await checkForUpdates()
  })

  ipcMain.handle('get-update-info', async () => {
    return getAvailableUpdate()
  })
}
