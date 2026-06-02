import { Menu, nativeImage, Tray } from 'electron'

let tray: Tray | null = null
let trayOptions: CreateTrayOptions | null = null

interface CreateTrayOptions {
  getIconPath: () => string
  showMainWindow: () => void
  quitApp: () => void
}

// Store the wiring once at startup so the tray can be (re)created later without
// re-passing dependencies from index.ts.
export function configureTray(options: CreateTrayOptions): void {
  trayOptions = options
}

export function createTray(): void {
  if (tray || !trayOptions) return
  const icon = nativeImage.createFromPath(trayOptions.getIconPath())
  tray = new Tray(icon)
  tray.setToolTip('SimLauncher')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show SimLauncher', click: trayOptions.showMainWindow },
      { type: 'separator' },
      { label: 'Quit', click: () => trayOptions!.quitApp() }
    ])
  )
  tray.on('click', trayOptions.showMainWindow)
  tray.on('double-click', trayOptions.showMainWindow)
}

export function destroyTray(): void {
  if (tray) {
    tray.destroy()
    tray = null
  }
}

// Create or destroy the tray to match the persisted preference.
export function applyTrayVisibility(visible: boolean): void {
  if (visible) createTray()
  else destroyTray()
}
