import { ipcMain } from 'electron'
import { dismissAppIcon, publishRunningApps } from '../processes'

export function registerContextMenuHandlers(): void {
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
