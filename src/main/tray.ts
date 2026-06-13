import { Menu, nativeImage, Tray } from 'electron'

let tray: Tray | null = null
let trayOptions: CreateTrayOptions | null = null

interface CreateTrayOptions {
  getIconPath: () => string
  showMainWindow: () => void
  quitApp: () => void
  // Close every running companion app (the game is left alone). Handles its own
  // confirmation; fired from the tray menu, so it may run with no visible window.
  closeApps: () => void
  // Synchronous predicate driving the "Close Apps" item's enabled state. Must be
  // synchronous because Menu.buildFromTemplate is.
  hasClosableApps: () => boolean
}

// Store the wiring once at startup so the tray can be (re)created later without
// re-passing dependencies from index.ts.
export function configureTray(options: CreateTrayOptions): void {
  trayOptions = options
}

function buildContextMenu(options: CreateTrayOptions): Menu {
  return Menu.buildFromTemplate([
    { label: 'Show SimLauncher', click: options.showMainWindow },
    { type: 'separator' },
    // Disabled when nothing is running so the item never silently no-ops; its
    // enabled state is refreshed via refreshTrayMenu() on running-apps changes.
    { label: 'Close Apps', enabled: options.hasClosableApps(), click: () => options.closeApps() },
    { type: 'separator' },
    { label: 'Quit', click: () => options.quitApp() }
  ])
}

// Rebuild the context menu so the "Close Apps" item reflects whether any apps
// are currently running. No-op when the tray is hidden/uncreated.
export function refreshTrayMenu(): void {
  if (!tray || !trayOptions) return
  tray.setContextMenu(buildContextMenu(trayOptions))
}

export function createTray(): void {
  // Guard against double-creation (e.g. applyTrayVisibility called twice) and
  // against being called before configureTray() wires the dependencies.
  if (tray || !trayOptions) return
  const icon = nativeImage.createFromPath(trayOptions.getIconPath())
  tray = new Tray(icon)
  tray.setToolTip('SimLauncher')
  tray.setContextMenu(buildContextMenu(trayOptions))
  // Both events are bound because Windows fires 'click' on a single left-click
  // and 'double-click' on a rapid second click. Without the double-click
  // binding the second click does nothing, making the tray feel unresponsive
  // when users habitually double-click system tray icons.
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
