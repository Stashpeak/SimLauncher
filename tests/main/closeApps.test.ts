import { beforeEach, expect, test, vi } from 'vitest'

import type { dialog as mockDialog } from './electronMock'

const hasClosableLaunchedApps = vi.fn()
const killLaunchedApps = vi.fn()
const writeMainErrorLog = vi.fn()

async function loadCloseApps() {
  const processesMock = { hasClosableLaunchedApps, killLaunchedApps }
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

// Always-enabled item: when nothing is running it tells the user rather than
// silently doing nothing, and never reaches the kill.
test('shows an info dialog and does not kill when nothing is running', async () => {
  const { mod, dialog } = await loadCloseApps()
  hasClosableLaunchedApps.mockResolvedValue(false)

  await mod.confirmAndCloseApps()

  expect(dialog.showMessageBox).toHaveBeenCalledTimes(1)
  expect(dialog.showMessageBox.mock.calls[0][0]).toMatchObject({ type: 'info' })
  expect(killLaunchedApps).not.toHaveBeenCalled()
})

test('cancelling the confirmation does not kill anything', async () => {
  const { mod, dialog } = await loadCloseApps()
  hasClosableLaunchedApps.mockResolvedValue(true)
  dialog.showMessageBox.mockResolvedValue({ response: 1 })

  await mod.confirmAndCloseApps()

  expect(dialog.showMessageBox).toHaveBeenCalledTimes(1)
  expect(killLaunchedApps).not.toHaveBeenCalled()
})

// Confirming must close EVERY companion across all profiles, i.e. call
// killLaunchedApps with no game key.
test('confirming closes all companion apps with no game key', async () => {
  const { mod, dialog } = await loadCloseApps()
  hasClosableLaunchedApps.mockResolvedValue(true)
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
  hasClosableLaunchedApps.mockResolvedValue(true)
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
  hasClosableLaunchedApps.mockResolvedValue(true)
  dialog.showMessageBox.mockResolvedValue({ response: 0 })
  killLaunchedApps.mockRejectedValue(new Error('boom'))

  await mod.confirmAndCloseApps()

  expect(writeMainErrorLog).toHaveBeenCalledWith('closeAppsFailure', expect.any(Error))
  expect(dialog.showErrorBox).toHaveBeenCalledTimes(1)
  const [title, message] = dialog.showErrorBox.mock.calls[0]
  expect(title).toBe('Close Apps failed')
  expect(message).toBe('boom')
})

// Codex/Gemini: a second tray click while a dialog/kill is in flight must not
// start a concurrent run (stacked dialogs → racing kills → false failures).
test('ignores a second invocation while one is in flight', async () => {
  const { mod, dialog } = await loadCloseApps()
  let resolveCheck: (value: boolean) => void = () => {}
  hasClosableLaunchedApps.mockReturnValue(
    new Promise<boolean>((resolve) => {
      resolveCheck = resolve
    })
  )

  const first = mod.confirmAndCloseApps()
  // Second call happens while the first is still awaiting the closable check.
  const second = mod.confirmAndCloseApps()

  resolveCheck(false)
  await Promise.all([first, second])

  // The lock short-circuited the second call before it ran any check or dialog.
  expect(hasClosableLaunchedApps).toHaveBeenCalledTimes(1)
  expect(dialog.showMessageBox).toHaveBeenCalledTimes(1)
})
