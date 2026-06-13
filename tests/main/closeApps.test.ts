import { beforeEach, expect, test, vi } from 'vitest'

import type { dialog as mockDialog } from './electronMock'

const hasClosableApps = vi.fn()
const killLaunchedApps = vi.fn()
const writeMainErrorLog = vi.fn()

async function loadCloseApps() {
  const processesMock = { hasClosableApps, killLaunchedApps }
  vi.doMock('./processes', () => processesMock)
  vi.doMock('/src/main/processes.ts', () => processesMock)
  vi.doMock('../../src/main/processes', () => processesMock)
  vi.doMock('../../src/main/processes.ts', () => processesMock)

  const errorLogMock = { writeMainErrorLog }
  vi.doMock('./errorLog', () => errorLogMock)
  vi.doMock('/src/main/errorLog.ts', () => errorLogMock)
  vi.doMock('../../src/main/errorLog', () => errorLogMock)
  vi.doMock('../../src/main/errorLog.ts', () => errorLogMock)

  const mod = await import('../../src/main/closeApps')
  const { dialog } = await import('electron')
  return { mod, dialog: dialog as unknown as typeof mockDialog }
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})

// Guards against killing nothing if the menu's enabled state is stale.
test('does nothing when no apps are running', async () => {
  const { mod, dialog } = await loadCloseApps()
  hasClosableApps.mockReturnValue(false)

  await mod.confirmAndCloseApps()

  expect(dialog.showMessageBox).not.toHaveBeenCalled()
  expect(killLaunchedApps).not.toHaveBeenCalled()
})

test('cancelling the confirmation does not kill anything', async () => {
  const { mod, dialog } = await loadCloseApps()
  hasClosableApps.mockReturnValue(true)
  dialog.showMessageBox.mockResolvedValue({ response: 1 })

  await mod.confirmAndCloseApps()

  expect(dialog.showMessageBox).toHaveBeenCalledTimes(1)
  expect(killLaunchedApps).not.toHaveBeenCalled()
})

// Confirming must close EVERY companion across all profiles, i.e. call
// killLaunchedApps with no game key.
test('confirming closes all companion apps with no game key', async () => {
  const { mod, dialog } = await loadCloseApps()
  hasClosableApps.mockReturnValue(true)
  dialog.showMessageBox.mockResolvedValue({ response: 0 })
  killLaunchedApps.mockResolvedValue({
    success: true,
    closedCount: 2,
    failedCount: 0,
    failures: []
  })

  await mod.confirmAndCloseApps()

  expect(killLaunchedApps).toHaveBeenCalledTimes(1)
  expect(killLaunchedApps.mock.calls[0]).toHaveLength(0)
  expect(dialog.showErrorBox).not.toHaveBeenCalled()
})

test('surfaces apps that could not be closed', async () => {
  const { mod, dialog } = await loadCloseApps()
  hasClosableApps.mockReturnValue(true)
  dialog.showMessageBox.mockResolvedValue({ response: 0 })
  killLaunchedApps.mockResolvedValue({
    success: false,
    closedCount: 0,
    failedCount: 1,
    failures: [
      { appName: 'iOverlay.exe', appPath: 'C:/Tools/iOverlay.exe', reason: 'access_denied' }
    ]
  })

  await mod.confirmAndCloseApps()

  expect(dialog.showErrorBox).toHaveBeenCalledTimes(1)
  const [title, message] = dialog.showErrorBox.mock.calls[0]
  expect(title).toBe('Some apps could not be closed')
  expect(message).toContain('iOverlay.exe')
})

test('a kill failure is logged and surfaced to the user', async () => {
  const { mod, dialog } = await loadCloseApps()
  hasClosableApps.mockReturnValue(true)
  dialog.showMessageBox.mockResolvedValue({ response: 0 })
  killLaunchedApps.mockRejectedValue(new Error('boom'))

  await mod.confirmAndCloseApps()

  expect(writeMainErrorLog).toHaveBeenCalledWith('closeAppsFailure', expect.any(Error))
  expect(dialog.showErrorBox).toHaveBeenCalledTimes(1)
  const [title, message] = dialog.showErrorBox.mock.calls[0]
  expect(title).toBe('Close Apps failed')
  expect(message).toBe('boom')
})
