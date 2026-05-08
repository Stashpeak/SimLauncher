import { BrowserWindow, Menu, MenuItemConstructorOptions, ipcMain } from 'electron'
import { dismissAppIcon, publishRunningApps } from '../processes'

export function registerContextMenuHandlers() {
  ipcMain.handle('show-app-context-menu', (event, appPath: string) => {
    const template: MenuItemConstructorOptions[] = [
      {
        label: 'Dismiss Icon',
        click: () => {
          dismissAppIcon(appPath)
          publishRunningApps('scan').catch((err) => {
            console.error('Failed to publish running apps after dismissing icon', err)
          })
        }
      }
    ]

    const menu = Menu.buildFromTemplate(template)
    const window = BrowserWindow.fromWebContents(event.sender)

    if (window) {
      menu.popup({ window })
    }
  })
}
