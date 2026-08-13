import { beforeEach, expect, test, vi } from 'vitest'

import type { MockMenuItem, Tray as MockTray } from './electronMock'

const showMainWindow = vi.fn()
const quitApp = vi.fn()
const closeApps = vi.fn()

async function loadTrayModule({ configure = true } = {}) {
  const trayModule = await import('../../src/main/tray')

  if (configure) {
    trayModule.configureTray({
      getIconPath: () => 'C:/app/SimLauncher.ico',
      showMainWindow,
      quitApp,
      closeApps
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
    closeApps
  })
  trayModule.createTray()
  trayModule.createTray()
  expect(TrayMock.instances).toHaveLength(1)
})

// #519: the item is always enabled, deciding at click time whether anything is
// running, and routes to the configured hook. Removed in `40c5d18` before 1.0.0
// because the all-profiles kill it triggers misattributed shared companions
// (#772); re-landed now that it does not.
test('clicking Close Apps invokes the configured closeApps hook (#519)', async () => {
  const { trayModule, MenuMock } = await loadTrayModule()

  trayModule.createTray()

  const template = MenuMock.buildFromTemplate.mock.calls[0][0] as MockMenuItem[]
  const closeItem = template.find((item) => item.label === 'Close Apps')
  expect(closeItem).toBeDefined()
  expect(closeItem!.enabled).not.toBe(false)
  closeItem!.click!()
  expect(closeApps).toHaveBeenCalledTimes(1)
})

// Ordering guards a misclick: Close Apps force-terminates companions and there
// is no confirmation step any more, so it must not sit adjacent to the item
// people reach for most.
test('Close Apps is separated from Show SimLauncher and Quit (#519)', async () => {
  const { trayModule, MenuMock } = await loadTrayModule()

  trayModule.createTray()

  const template = MenuMock.buildFromTemplate.mock.calls[0][0] as MockMenuItem[]
  const labels = template.map((item) => item.label ?? item.type)
  expect(labels).toEqual(['Show SimLauncher', 'separator', 'Close Apps', 'separator', 'Quit'])
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
