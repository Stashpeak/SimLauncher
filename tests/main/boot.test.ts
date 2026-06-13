import { beforeEach, expect, test, vi } from 'vitest'

import type { app as mockApp } from './electronMock'

interface BootOptions {
  lockAcquired?: boolean
  showTrayIcon?: boolean
  migrateThrows?: boolean
  windowThrows?: boolean
}

// Imports src/main/index for its side effects with every collaborator module
// mocked, recording the boot sequence in callLog.
async function bootApp(opts: BootOptions = {}) {
  const callLog: string[] = []
  const { app } = await import('electron')
  ;(app as typeof mockApp).requestSingleInstanceLock.mockReturnValue(opts.lockAcquired ?? true)

  const securityMock = {
    registerContentSecurityPolicy: vi.fn(() => callLog.push('csp'))
  }
  vi.doMock('./security', () => securityMock)
  vi.doMock('/src/main/security.ts', () => securityMock)
  vi.doMock('../../src/main/security', () => securityMock)
  vi.doMock('../../src/main/security.ts', () => securityMock)

  // Mock crash logging so importing index doesn't register real process-level
  // uncaughtException/unhandledRejection handlers across the whole test run.
  const errorLogMock = {
    installMainProcessErrorLogging: vi.fn(),
    writeMainErrorLog: vi.fn()
  }
  vi.doMock('./errorLog', () => errorLogMock)
  vi.doMock('/src/main/errorLog.ts', () => errorLogMock)
  vi.doMock('../../src/main/errorLog', () => errorLogMock)
  vi.doMock('../../src/main/errorLog.ts', () => errorLogMock)

  const migratorMock = {
    migrateProfilesToNamedSets: vi.fn(() => {
      if (opts.migrateThrows) {
        throw new Error('mock migration failure')
      }
      callLog.push('migrate')
    })
  }
  vi.doMock('./migrator', () => migratorMock)
  vi.doMock('/src/main/migrator.ts', () => migratorMock)
  vi.doMock('../../src/main/migrator', () => migratorMock)
  vi.doMock('../../src/main/migrator.ts', () => migratorMock)

  const ipcMock = {
    registerHandlers: vi.fn(() => callLog.push('handlers'))
  }
  vi.doMock('./ipc', () => ipcMock)
  vi.doMock('/src/main/ipc/index.ts', () => ipcMock)
  vi.doMock('../../src/main/ipc', () => ipcMock)
  vi.doMock('../../src/main/ipc/index', () => ipcMock)
  vi.doMock('../../src/main/ipc/index.ts', () => ipcMock)

  const trayMock = {
    configureTray: vi.fn(() => callLog.push('configureTray')),
    createTray: vi.fn(() => callLog.push('createTray')),
    destroyTray: vi.fn(),
    applyTrayVisibility: vi.fn()
  }
  vi.doMock('./tray', () => trayMock)
  vi.doMock('/src/main/tray.ts', () => trayMock)
  vi.doMock('../../src/main/tray', () => trayMock)
  vi.doMock('../../src/main/tray.ts', () => trayMock)

  const windowMock = {
    createWindow: vi.fn(() => {
      if (opts.windowThrows) {
        throw new Error('mock window creation failure')
      }
      callLog.push('createWindow')
    }),
    getAppIconPath: vi.fn(() => 'C:/app/SimLauncher.ico'),
    showMainWindow: vi.fn()
  }
  vi.doMock('./window', () => windowMock)
  vi.doMock('/src/main/window.ts', () => windowMock)
  vi.doMock('../../src/main/window', () => windowMock)
  vi.doMock('../../src/main/window.ts', () => windowMock)

  const storeMock = {
    store: {
      get: vi.fn((key: string) =>
        key === 'showTrayIcon' ? (opts.showTrayIcon ?? true) : undefined
      )
    }
  }
  vi.doMock('./store', () => storeMock)
  vi.doMock('/src/main/store.ts', () => storeMock)
  vi.doMock('../../src/main/store', () => storeMock)
  vi.doMock('../../src/main/store.ts', () => storeMock)

  await import('../../src/main/index')
  // Let the whenReady().then(...) boot continuation run.
  await new Promise((resolve) => setTimeout(resolve, 0))

  const appState = await import('../../src/main/app-state')
  return {
    app: app as typeof mockApp,
    appState,
    callLog,
    trayMock,
    windowMock,
    ipcMock,
    errorLogMock
  }
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})

test('a second instance quits immediately without registering anything', async () => {
  const { app, callLog } = await bootApp({ lockAcquired: false })

  expect(app.quit).toHaveBeenCalled()
  expect(app.whenReady).not.toHaveBeenCalled()
  expect(app.on).not.toHaveBeenCalled()
  expect(callLog).toEqual([])
})

// CSP must be in place before any window exists, migration before any handler
// can read profiles, and the tray wired before the window can minimize to it.
test('first instance boots in the documented order', async () => {
  const { callLog } = await bootApp()

  expect(callLog).toEqual([
    'csp',
    'migrate',
    'handlers',
    'configureTray',
    'createTray',
    'createWindow'
  ])
})

// Crash logging is registered at module load (before the single-instance lock),
// so even a second instance that quits immediately still has a diagnostic trail.
test('boot registers main-process crash logging before anything else (#522)', async () => {
  const { errorLogMock } = await bootApp()
  expect(errorLogMock.installMainProcessErrorLogging).toHaveBeenCalledTimes(1)
})

// migrateProfilesToNamedSets throws on a failed store write so config import can
// roll back, but a malformed legacy profile must not brick startup. The boot
// caller catches it and continues registering handlers, tray and window (#513).
test('boot survives a profile migration failure and still finishes booting (#513)', async () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  const { callLog } = await bootApp({ migrateThrows: true })

  // 'migrate' is absent (the mock threw before recording), but boot continued.
  expect(callLog).toEqual(['csp', 'handlers', 'configureTray', 'createTray', 'createWindow'])
  expect(consoleError).toHaveBeenCalled()
  consoleError.mockRestore()
})

// A failure bringing up handlers/tray/window must not be swallowed by the global
// unhandledRejection logger — that would leave this instance holding the
// single-instance lock with no window. The boot chain's own .catch logs, warns
// the user, and exits so the lock is released and a relaunch can start (#522).
test('boot failure logs, shows an error box, and exits so the lock is released (#522)', async () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  const { app, errorLogMock } = await bootApp({ windowThrows: true })
  const { dialog } = await import('electron')

  expect(errorLogMock.writeMainErrorLog).toHaveBeenCalledWith('bootFailure', expect.any(Error))
  expect(dialog.showErrorBox).toHaveBeenCalled()
  expect(app.exit).toHaveBeenCalledWith(1)
  consoleError.mockRestore()
})

test('tray is not created on boot when showTrayIcon is off (#391)', async () => {
  const { callLog } = await bootApp({ showTrayIcon: false })

  expect(callLog).toEqual(['csp', 'migrate', 'handlers', 'configureTray', 'createWindow'])
})

// Recovery path: with the window hidden in the tray, launching the exe again
// is the user's way of getting the window back.
test('a second launch attempt surfaces the existing window', async () => {
  const { app, windowMock } = await bootApp()

  app.emit('second-instance')

  expect(windowMock.showMainWindow).toHaveBeenCalledTimes(1)
})

test('before-quit marks the app as quitting so the close interceptor lets it die', async () => {
  const { app, appState } = await bootApp()

  expect(appState.getIsQuitting()).toBe(false)
  app.emit('before-quit')
  expect(appState.getIsQuitting()).toBe(true)
})

test('the tray Quit hook sets isQuitting before asking the app to quit', async () => {
  const { app, appState, trayMock } = await bootApp()
  let isQuittingWhenQuitCalled: boolean | undefined
  app.quit.mockImplementationOnce(() => {
    isQuittingWhenQuitCalled = appState.getIsQuitting()
  })

  const configureOptions = trayMock.configureTray.mock.calls[0][0] as { quitApp: () => void }
  configureOptions.quitApp()

  expect(app.quit).toHaveBeenCalledTimes(1)
  expect(isQuittingWhenQuitCalled).toBe(true)
})
