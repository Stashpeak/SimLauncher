import { Menu, nativeImage, Tray } from 'electron'

let tray: Tray | null = null

interface CreateTrayOptions {
  getIconPath: () => string
  showMainWindow: () => void
  quitApp: () => void
}

export function createTray({ getIconPath, showMainWindow, quitApp }: CreateTrayOptions) {
  if (tray) {
    return
  }

  const icon = nativeImage.createFromPath(getIconPath())
  tray = new Tray(icon)
  tray.setToolTip('SimLauncher')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show SimLauncher', click: showMainWindow },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        quitApp()
      }
    }
  ]))

  tray.on('click', showMainWindow)
  tray.on('double-click', showMainWindow)
}
