import { app, ipcMain, shell } from 'electron'

// Hosts the app is allowed to hand to the OS via shell.openExternal. Kept to an
// explicit allowlist so a renderer-side bug can never turn this into an
// arbitrary-URL launcher: shell.openExternal honours any protocol handler the OS
// has registered, so only vetted https hosts are ever forwarded.
const ALLOWED_EXTERNAL_HOSTS = new Set(['github.com', 'discord.gg', 'discord.com'])

/**
 * System/OS integration handlers that don't belong to a more specific domain.
 */
export function registerSystemHandlers(): void {
  // Open the app's data folder (where main-error.log and config.json live) in the
  // OS file manager, so a user can find the crash log to attach to a bug report
  // without hunting through a hidden %APPDATA% path. The path is fixed and
  // app-owned — the renderer cannot pass an arbitrary path to open.
  ipcMain.handle('open-logs-folder', async () => {
    // shell.openPath resolves to '' on success or an error string on failure.
    return shell.openPath(app.getPath('userData'))
  })

  // Open a vetted external URL (Discord invite, GitHub repo/issues) in the user's
  // browser. The window denies in-app navigation and window.open (see window.ts),
  // so UI links route through here. Returns false when the URL is rejected so the
  // renderer can surface a failure instead of looking like a dead click.
  ipcMain.handle('open-external-url', async (_event, url: unknown) => {
    if (typeof url !== 'string') {
      return false
    }
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return false
    }
    if (parsed.protocol !== 'https:' || !ALLOWED_EXTERNAL_HOSTS.has(parsed.hostname)) {
      return false
    }
    // shell.openExternal can reject (no registered OS handler, launch failure).
    // Map that to false so the renderer surfaces its error toast instead of the
    // IPC invoke rejecting and the failure being dropped as an unhandled rejection.
    try {
      await shell.openExternal(url)
      return true
    } catch {
      return false
    }
  })
}
