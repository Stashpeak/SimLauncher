import { beforeEach, expect, test, vi } from 'vitest'

// Spy on the running-apps module so these tests assert the WIRING (which
// window events drive which visibility signal) in isolation from the cadence
// engine itself — that engine's FAST/SLOW behavior is covered directly in
// running.test.ts (#672 / #708).
const setRunningAppsWindowVisibleMock = vi.fn()

async function loadWindowModuleForCreate() {
  const { clearIpcHandlers } = await import('electron')
  ;(clearIpcHandlers as () => void)()

  const storeValues: Record<string, unknown> = {
    startMinimized: false,
    showTrayIcon: true,
    minimizeToTray: false,
    autoCheckUpdates: false
  }

  vi.doMock('../../src/main/store', () => ({
    getStoredBoolean: vi.fn((key: string, defaultValue = false) => {
      const value = storeValues[key]
      return typeof value === 'boolean' ? value : defaultValue
    }),
    getStoredZoomFactor: vi.fn(() => 1),
    isWindowBounds: vi.fn(() => false),
    store: { get: vi.fn((key: string) => storeValues[key]), set: vi.fn() }
  }))
  vi.doMock('../../src/main/updater', () => ({
    registerUpdaterEvents: vi.fn(),
    checkForUpdates: vi.fn().mockResolvedValue(null)
  }))
  vi.doMock('../../src/main/processes/running', () => ({
    setRunningAppsWindowVisible: setRunningAppsWindowVisibleMock
  }))

  return import('../../src/main/window')
}

async function getCreatedWindow() {
  const { BrowserWindow } = await import('electron')
  type MockWindow = {
    show: () => void
    hide: () => void
    minimize: () => void
    restore: () => void
    isVisible: () => boolean
    isMinimized: () => boolean
    emit: (event: string, ...args: unknown[]) => void
  }
  return (BrowserWindow as unknown as { instances: MockWindow[] }).instances[0]
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})

// #708: minimizing to the taskbar fires 'minimize'/'restore', not 'hide'/'show',
// and isVisible() stays true while minimized — #672's show/hide-only wiring
// never told the running-apps cadence about this, so the poll ran FAST forever
// once a user minimized to the taskbar instead of hiding to the tray.
test('minimizing to the taskbar marks the running-apps poll not-visible (#708)', async () => {
  const { createWindow } = await loadWindowModuleForCreate()
  createWindow()
  const win = await getCreatedWindow()

  win.show()
  win.emit('show')
  setRunningAppsWindowVisibleMock.mockClear()

  win.minimize()
  win.emit('minimize')

  expect(setRunningAppsWindowVisibleMock).toHaveBeenCalledWith(false)
})

test('restoring from the taskbar marks the running-apps poll visible again (#708)', async () => {
  const { createWindow } = await loadWindowModuleForCreate()
  createWindow()
  const win = await getCreatedWindow()

  win.show()
  win.emit('show')
  win.minimize()
  win.emit('minimize')
  setRunningAppsWindowVisibleMock.mockClear()

  win.restore()
  win.emit('restore')

  expect(setRunningAppsWindowVisibleMock).toHaveBeenCalledWith(true)
})

// The pre-existing tray path (#672) must keep working unchanged.
test('hiding to the tray still marks the running-apps poll not-visible (#672)', async () => {
  const { createWindow } = await loadWindowModuleForCreate()
  createWindow()
  const win = await getCreatedWindow()

  win.show()
  win.emit('show')
  setRunningAppsWindowVisibleMock.mockClear()

  win.hide()
  win.emit('hide')

  expect(setRunningAppsWindowVisibleMock).toHaveBeenCalledWith(false)
})

test('showing from the tray still marks the running-apps poll visible (#672)', async () => {
  const { createWindow } = await loadWindowModuleForCreate()
  createWindow()
  const win = await getCreatedWindow()

  win.show()
  win.emit('show')

  expect(setRunningAppsWindowVisibleMock).toHaveBeenCalledWith(true)
})

// Defensive safety net (#708 fix sketch): some setups fire 'minimize' without a
// matching 'restore'. 'focus' recomputes visibility from the window's own live
// state on every event, so a later focus (e.g. clicking the taskbar icon) still
// self-corrects even if 'restore' itself never fires.
test('a focus event self-corrects a dropped restore (#708)', async () => {
  const { createWindow } = await loadWindowModuleForCreate()
  createWindow()
  const win = await getCreatedWindow()

  win.show()
  win.emit('show')
  win.minimize()
  win.emit('minimize')
  setRunningAppsWindowVisibleMock.mockClear()

  // The platform un-minimizes the window (state changes) but never fires the
  // 'restore' event itself — only 'focus' arrives, as it reliably does on a
  // taskbar click-to-restore.
  win.restore()
  win.emit('focus')

  expect(setRunningAppsWindowVisibleMock).toHaveBeenCalledWith(true)
})

// A stray focus event while still minimized must not be misread as "visible" —
// the handler always recomputes from isVisible() && !isMinimized(), not from
// the event name alone.
test('a focus event while still minimized does not mark the poll visible (#708)', async () => {
  const { createWindow } = await loadWindowModuleForCreate()
  createWindow()
  const win = await getCreatedWindow()

  win.show()
  win.emit('show')
  win.minimize()
  win.emit('minimize')
  setRunningAppsWindowVisibleMock.mockClear()

  win.emit('focus')

  expect(setRunningAppsWindowVisibleMock).toHaveBeenCalledWith(false)
})
