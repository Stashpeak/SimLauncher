import { app, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'

import { getRendererDirty, setIsQuitting } from './app-state'

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

// Opt out of electron-updater's built-in install-on-quit hook. Once a download
// completes, electron-updater arms its own app 'quit' handler that installs the
// pending update on the NEXT normal quit (autoInstallOnAppQuit defaults to
// true). That would silently bypass the dirty-defer guard below (#671): a user
// who chose "keep working, install later" would get the update installed anyway
// the next time they close the app, with no consent at that moment. Make this
// code the sole authority on when an install happens — it only ever installs
// via an explicit quitAndInstallUpdate() call (mirrors autoDownload=false).
autoUpdater.autoInstallOnAppQuit = false

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

  // Match only genuine connectivity failures. In particular do NOT match the
  // broad `net::ERR_` prefix: that would also classify TLS/security errors like
  // net::ERR_CERT_AUTHORITY_INVALID as "offline" and (via check-for-updates
  // swallowing them) hide a real update-server/security misconfiguration behind
  // the calm offline notice.
  const message = err instanceof Error ? err.message : String(err ?? '')
  return /\b(ENOTFOUND|ETIMEDOUT|ECONNREFUSED|ECONNRESET|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|ENETDOWN)\b|getaddrinfo|net::ERR_(INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|NAME_RESOLUTION_FAILED|NETWORK_CHANGED|CONNECTION_(REFUSED|TIMED_OUT|RESET|CLOSED|ABORTED)|ADDRESS_UNREACHABLE|PROXY_CONNECTION_FAILED|TIMED_OUT|NETWORK_ACCESS_DENIED)/i.test(
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
    // download was still in progress. Their consent could be minutes old, so
    // if they've since made unsaved settings/profile edits, force-quitting now
    // would bypass the close-confirm machinery (via isQuitting) and silently
    // discard those edits (#671). In that case defer: tell the renderer the
    // update is ready and let the user pick restart-now vs keep-working. Only
    // auto-install when the renderer is clean (the original behavior).
    if (installAfterDownload) {
      if (getRendererDirty()) {
        sendToRenderer('update-ready-while-dirty', info)
      } else {
        quitAndInstallUpdate()
      }
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
      // The update is already on disk. Re-check dirty state at THIS click — not
      // just at download-complete — because the "Download & Install" button
      // stays visible after the user cancels the dirty prompt once. Re-clicking
      // it while still dirty must re-surface the same non-destructive prompt,
      // not force-quit past the close-confirm and silently discard the edits
      // (that would reopen #671 through the very flow the prompt tells users to
      // take: "keep working, install later from Settings").
      if (getRendererDirty()) {
        sendToRenderer('update-ready-while-dirty', availableUpdate ?? { version: '' })
        return { success: true }
      }
      quitAndInstallUpdate()
      return { success: true }
    }

    try {
      await autoUpdater.downloadUpdate()
      return { success: true }
    } catch (err) {
      installAfterDownload = false
      // downloadUpdate() both emits the 'error' event AND rejects. The event
      // already surfaced a categorized message to the renderer, so for a network
      // failure swallow the rejection here — otherwise the renderer's install
      // catch fires a second, generic "Failed to install update" error that
      // overrides the calmer offline notice (mirrors the check-for-updates
      // handler). Re-throw anything else so genuine failures still surface.
      if (isUpdateNetworkError(err)) {
        return { success: false, offline: true }
      }
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
