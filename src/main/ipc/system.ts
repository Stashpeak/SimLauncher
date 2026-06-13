import { app, ipcMain, shell } from 'electron'

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
}
