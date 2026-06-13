import { app, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'

import { setIsQuitting } from './app-state'

type SendToRenderer = (channel: string, payload: unknown) => void
type UpdateAvailability = { version: string }

let sendToRenderer: SendToRenderer = () => {}
let installAfterDownload = false
let updateDownloaded = false
let availableUpdate: UpdateAvailability | null = null

// Opt out of automatic background download so the user controls when the
// update is fetched (via the 'install-update' IPC). Downloading silently
// without consent would consume bandwidth and could interrupt a race session.
autoUpdater.autoDownload = false

// A dedicated sim rig is often offline, so the most common update "failure" is
// simply no connectivity. Distinguish that from a real updater error (corrupt
// download, server 4xx/5xx, signature mismatch) so the UI can show a calm
// "can't reach the server" notice instead of a scary generic failure.
export function isUpdateNetworkError(err: unknown): boolean {
  const code = (err as { code?: unknown })?.code
  if (
    typeof code === 'string' &&
    /^(ENOTFOUND|ETIMEDOUT|ECONNREFUSED|ECONNRESET|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|ENETDOWN)$/.test(
      code
    )
  ) {
    return true
  }

  const message = err instanceof Error ? err.message : String(err ?? '')
  return /\b(ENOTFOUND|ETIMEDOUT|ECONNREFUSED|ECONNRESET|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|ENETDOWN)\b|getaddrinfo|net::ERR_|ERR_INTERNET_DISCONNECTED/i.test(
    message
  )
}

export function registerUpdaterEvents(rendererSender: SendToRenderer): void {
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

    // installAfterDownload is set when the user clicked Install while the
    // download was still in progress. Complete the deferred install now.
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
    sendToRenderer('update-error', {
      message: err.message,
      isNetworkError: isUpdateNetworkError(err)
    })
  })
}

function quitAndInstallUpdate() {
  // isQuitting must be set BEFORE quitAndInstall() triggers the app quit;
  // otherwise the window 'close' interceptor in window.ts fires first and
  // cancels the quit (or shows the dirty-data confirm dialog) before the
  // installer can take over.
  setIsQuitting(true)
  autoUpdater.quitAndInstall()
}

export async function checkForUpdates(): Promise<Awaited<
  ReturnType<typeof autoUpdater.checkForUpdates>
> | null> {
  if (!app.isPackaged) {
    // Stub a far-future version so the updater UI (banner, download flow,
    // install confirmation) is always exercisable in development without
    // needing a real release server.
    availableUpdate = { version: '99.0.0' }
    sendToRenderer('update-available', availableUpdate)
    return null
  }

  return await autoUpdater.checkForUpdates()
}

export function getAvailableUpdate(): UpdateAvailability | null {
  return availableUpdate
}

export function registerUpdaterHandlers(rendererSender: SendToRenderer): void {
  sendToRenderer = rendererSender

  ipcMain.handle('install-update', async () => {
    if (!app.isPackaged) {
      // Simulate the download-complete event so the dev-mode install flow
      // (confirm dialog → restart) can be exercised end-to-end.
      sendToRenderer('update-downloaded', { version: '99.0.0' })
      return { success: true }
    }

    // Mark intent first: if the download finishes before downloadUpdate()
    // resolves (unlikely but possible), the 'update-downloaded' handler will
    // call quitAndInstallUpdate() immediately rather than waiting.
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
    try {
      return await checkForUpdates()
    } catch (err) {
      // The autoUpdater 'error' event already reported this to the renderer with
      // a categorized message. For a network failure, swallow the rejection so
      // the manual-check flow doesn't additionally surface a generic error that
      // would override the calmer offline notice; re-throw anything else.
      if (isUpdateNetworkError(err)) {
        return null
      }
      throw err
    }
  })

  ipcMain.handle('get-update-info', async () => {
    return getAvailableUpdate()
  })
}
