import { beforeEach, expect, test, vi } from 'vitest'

import type { MockMenuItem, Tray as MockTray } from './electronMock'

const showMainWindow = vi.fn()
const quitApp = vi.fn()
const closeApps = vi.fn()
const hasClosableApps = vi.fn(() => false)

async function loadTrayModule({ configure = true } = {}) {
  const trayModule = await import('../../src/main/tray')

  if (configure) {
    trayModule.configureTray({
      getIconPath: () => 'C:/app/SimLauncher.ico',
      showMainWindow,
      quitApp,
      closeApps,
      hasClosableApps
    })
  }

  const { Tray, Menu } = await import('electron')
  return {
    trayModule,
    TrayMock: Tray as unknown as typeof MockTray,
    MenuMock: Menu as unknown as { buildFromTemplate: ReturnType<typeof vi.fn> }
  }
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})

test('createTray wires click and double-click to showing the main window', async () => {
  const { trayModule, TrayMock } = await loadTrayModule()

  trayModule.createTray()

  const tray = TrayMock.instances[0]
  expect(tray.tooltip).toBe('SimLauncher')

  tray.emit('click')
  tray.emit('double-click')
  expect(showMainWindow).toHaveBeenCalledTimes(2)
})

test('tray menu items show the window and quit through the configured hooks', async () => {
  const { trayModule, MenuMock } = await loadTrayModule()

  trayModule.createTray()

  const template = MenuMock.buildFromTemplate.mock.calls[0][0] as MockMenuItem[]
  const showItem = template.find((item) => item.label === 'Show SimLauncher')
  const quitItem = template.find((item) => item.label === 'Quit')

  showItem!.click!()
  expect(showMainWindow).toHaveBeenCalledTimes(1)

  quitItem!.click!()
  expect(quitApp).toHaveBeenCalledTimes(1)
})

test('createTray is a no-op when unconfigured or when a tray already exists', async () => {
  const { trayModule, TrayMock } = await loadTrayModule({ configure: false })

  // Unconfigured: nothing to wire the menu to, so no tray may be created.
  trayModule.createTray()
  expect(TrayMock.instances).toHaveLength(0)

  trayModule.configureTray({
    getIconPath: () => 'C:/app/SimLauncher.ico',
    showMainWindow,
    quitApp,
    closeApps,
    hasClosableApps
  })
  trayModule.createTray()
  trayModule.createTray()
  expect(TrayMock.instances).toHaveLength(1)
})

// #519: the Close Apps item must be disabled when nothing is running so it never
// silently no-ops, and enabled when there is a companion app to close.
test('the Close Apps item is disabled when no apps are running (#519)', async () => {
  hasClosableApps.mockReturnValue(false)
  const { trayModule, MenuMock } = await loadTrayModule()

  trayModule.createTray()

  const template = MenuMock.buildFromTemplate.mock.calls[0][0] as MockMenuItem[]
  const closeItem = template.find((item) => item.label === 'Close Apps')
  expect(closeItem).toBeDefined()
  expect(closeItem!.enabled).toBe(false)
})

test('the Close Apps item is enabled when a companion app is running (#519)', async () => {
  hasClosableApps.mockReturnValue(true)
  const { trayModule, MenuMock } = await loadTrayModule()

  trayModule.createTray()

  const template = MenuMock.buildFromTemplate.mock.calls[0][0] as MockMenuItem[]
  const closeItem = template.find((item) => item.label === 'Close Apps')
  expect(closeItem!.enabled).toBe(true)
})

test('clicking Close Apps invokes the configured closeApps hook (#519)', async () => {
  hasClosableApps.mockReturnValue(true)
  const { trayModule, MenuMock } = await loadTrayModule()

  trayModule.createTray()

  const template = MenuMock.buildFromTemplate.mock.calls[0][0] as MockMenuItem[]
  const closeItem = template.find((item) => item.label === 'Close Apps')
  closeItem!.click!()
  expect(closeApps).toHaveBeenCalledTimes(1)
})

// The menu is static once built, so the enabled state is kept fresh by rebuilding
// the whole menu when running apps change (#519).
test('refreshTrayMenu rebuilds the menu with the updated enabled state (#519)', async () => {
  hasClosableApps.mockReturnValue(false)
  const { trayModule, TrayMock, MenuMock } = await loadTrayModule()

  trayModule.createTray()
  const tray = TrayMock.instances[0]
  expect(tray.setContextMenu).toHaveBeenCalledTimes(1)

  hasClosableApps.mockReturnValue(true)
  trayModule.refreshTrayMenu()

  expect(tray.setContextMenu).toHaveBeenCalledTimes(2)
  const rebuilt = MenuMock.buildFromTemplate.mock.calls[1][0] as MockMenuItem[]
  const closeItem = rebuilt.find((item) => item.label === 'Close Apps')
  expect(closeItem!.enabled).toBe(true)
})

test('refreshTrayMenu is a no-op when the tray has not been created (#519)', async () => {
  const { trayModule, MenuMock } = await loadTrayModule()

  expect(() => trayModule.refreshTrayMenu()).not.toThrow()
  expect(MenuMock.buildFromTemplate).not.toHaveBeenCalled()
})

// The #391 toggle cycle: turning the tray off must null the handle so a later
// re-enable can build a fresh tray (a stale handle would block recreation
// forever — the createTray guard checks it).
test('applyTrayVisibility survives the on → off → on cycle', async () => {
  const { trayModule, TrayMock } = await loadTrayModule()

  trayModule.applyTrayVisibility(true)
  expect(TrayMock.instances).toHaveLength(1)

  trayModule.applyTrayVisibility(false)
  expect(TrayMock.instances[0].destroy).toHaveBeenCalled()

  trayModule.applyTrayVisibility(true)
  expect(TrayMock.instances).toHaveLength(2)
  expect(TrayMock.instances[1].isDestroyed()).toBe(false)
})

test('destroyTray tolerates being called with no tray', async () => {
  const { trayModule, TrayMock } = await loadTrayModule()

  expect(() => trayModule.destroyTray()).not.toThrow()
  expect(TrayMock.instances).toHaveLength(0)
})
