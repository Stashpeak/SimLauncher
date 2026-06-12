import { ipcMain } from 'electron'
import { dismissAppIcon, publishRunningApps } from '../processes'

export function registerContextMenuHandlers(): void {
  // dismiss-app-icon: removes a running-app entry from the UI overlay without
  // terminating the process. Triggered from the context menu when the user
  // wants to hide a detected app (e.g. a helper process they didn't launch
  // intentionally). publishRunningApps('scan') re-evaluates the process list
  // immediately so subscribers see the updated state in the same tick as the
  // dismiss, rather than waiting for the next polling interval.
  ipcMain.handle('dismiss-app-icon', async (_event, appPath: string, gameKey: string) => {
    if (typeof appPath !== 'string' || appPath.trim().length === 0) {
      return { success: false, error: 'Invalid argument: appPath must be a non-empty string' }
    }
    if (typeof gameKey !== 'string' || gameKey.trim().length === 0) {
      return { success: false, error: 'Invalid argument: gameKey must be a non-empty string' }
    }

    dismissAppIcon(appPath, gameKey)
    await publishRunningApps('scan')
    return { success: true }
  })
}
