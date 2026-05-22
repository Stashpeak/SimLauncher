import { BrowserWindow, Menu, MenuItemConstructorOptions, ipcMain } from 'electron'
import path from 'path'
import { dismissAppIcon, publishRunningApps } from '../processes'

interface ShowAppContextMenuOptions {
  tracked?: boolean
  name?: string
}

// Strip the `.exe` suffix so context-menu labels read naturally (e.g. "Dismiss
// OTT Warning" instead of "Dismiss OTT.exe Warning").
function formatAppDisplayName(appPath: string, providedName?: string): string {
  const rawName = providedName?.trim() || path.basename(appPath)
  return rawName.replace(/\.exe$/i, '') || rawName
}

export function buildDismissLabel(
  appPath: string,
  options: ShowAppContextMenuOptions = {}
): string {
  const displayName = formatAppDisplayName(appPath, options.name)
  // Tracked utilities keep their icon visible after the warning clears, so
  // labeling the action "Dismiss Icon" is misleading (see #363). Use
  // "Dismiss Warning" for tracked apps and "Dismiss Icon" only for untracked
  // mismatches where the icon truly disappears.
  const action = options.tracked ? 'Dismiss Warning' : 'Dismiss Icon'
  return displayName ? `${action} for ${displayName}` : action
}

export function registerContextMenuHandlers() {
  ipcMain.handle(
    'show-app-context-menu',
    (event, appPath: string, gameKey: string, options?: ShowAppContextMenuOptions) => {
      const template: MenuItemConstructorOptions[] = [
        {
          label: buildDismissLabel(appPath, options),
          click: () => {
            dismissAppIcon(appPath, gameKey)
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
    }
  )
}
