/**
 * Tray "Close Apps" (#519). Restored from the version pulled in `40c5d18` hours
 * before 1.0.0, with the confirmation step dropped per the re-land plan on the
 * issue, so the tests that pinned the confirm dialog are gone and the ones that
 * pin "one click closes everything" replace them.
 */
import { beforeEach, expect, test, vi } from 'vitest'

import type { dialog as mockDialog } from './electronMock'

const hasClosableLaunchedApps = vi.fn()
const killLaunchedApps = vi.fn()
const writeMainErrorLog = vi.fn()

const CLOSED_NOTHING_PENDING = {
  success: true,
  closedCount: 2,
  failedCount: 0,
  failures: []
}

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

  await mod.closeAppsFromTray()

  expect(dialog.showMessageBox).toHaveBeenCalledTimes(1)
  expect(dialog.showMessageBox.mock.calls[0][0]).toMatchObject({ type: 'info' })
  expect(killLaunchedApps).not.toHaveBeenCalled()
})

// The whole point of the re-land: one click, no question. The per-row button has
// never confirmed either, and neither one can touch the game.
test('closes every companion in one click, with no confirmation (#519)', async () => {
  const { mod, dialog } = await loadCloseApps()
  hasClosableLaunchedApps.mockResolvedValue(true)
  killLaunchedApps.mockResolvedValue(CLOSED_NOTHING_PENDING)

  await mod.closeAppsFromTray()

  expect(killLaunchedApps).toHaveBeenCalledTimes(1)
  // No arguments: every profile, which is the case #772 had to fix first.
  expect(killLaunchedApps.mock.calls[0]).toHaveLength(0)
  // Nothing asked, and nothing reported on a clean close.
  expect(dialog.showMessageBox).not.toHaveBeenCalled()
  expect(dialog.showErrorBox).not.toHaveBeenCalled()
})

test('surfaces apps that could not be closed', async () => {
  const { mod, dialog } = await loadCloseApps()
  hasClosableLaunchedApps.mockResolvedValue(true)
  killLaunchedApps.mockResolvedValue({
    success: false,
    closedCount: 0,
    failedCount: 1,
    failures: [
      { appName: 'iOverlay.exe', appPath: 'C:/Tools/iOverlay.exe', reason: 'access_denied' }
    ]
  })

  await mod.closeAppsFromTray()

  expect(dialog.showErrorBox).toHaveBeenCalledTimes(1)
  const [title, message] = dialog.showErrorBox.mock.calls[0]
  expect(title).toBe('Some apps could not be closed')
  expect(message).toContain('iOverlay.exe')
})

// #809: the tray is the fourth delivery path for the stranded-prompt sentence,
// and the only one with no toast to append it to. The row button's version of
// this is covered in tests/renderer/gameRowStrandedConsentPrompt.test.tsx.
test('explains a stranded consent prompt after a clean close (#809)', async () => {
  const { mod, dialog } = await loadCloseApps()
  hasClosableLaunchedApps.mockResolvedValue(true)
  killLaunchedApps.mockResolvedValue({
    ...CLOSED_NOTHING_PENDING,
    strandedConsentPrompts: 1
  })

  await mod.closeAppsFromTray()

  expect(dialog.showMessageBox).toHaveBeenCalledTimes(1)
  expect(dialog.showMessageBox.mock.calls[0][0].detail).toContain(
    'A Windows permission prompt may still be on screen'
  )
})

test('explains a stranded consent prompt alongside a failure (#809)', async () => {
  const { mod, dialog } = await loadCloseApps()
  hasClosableLaunchedApps.mockResolvedValue(true)
  killLaunchedApps.mockResolvedValue({
    success: false,
    closedCount: 0,
    failedCount: 1,
    failures: [
      { appName: 'iOverlay.exe', appPath: 'C:/Tools/iOverlay.exe', reason: 'access_denied' }
    ],
    strandedConsentPrompts: 2
  })

  await mod.closeAppsFromTray()

  // Both, not one or the other. The failure path is the likelier of the two,
  // since access-denied is the canonical failure for the elevated profiles that
  // can strand a prompt at all.
  const [, message] = dialog.showErrorBox.mock.calls[0]
  expect(message).toContain('iOverlay.exe')
  expect(message).toContain('Windows permission prompts may still be on screen')
})

test('says nothing extra when no prompt was stranded (#809)', async () => {
  const { mod, dialog } = await loadCloseApps()
  hasClosableLaunchedApps.mockResolvedValue(true)
  killLaunchedApps.mockResolvedValue(CLOSED_NOTHING_PENDING)

  await mod.closeAppsFromTray()

  expect(dialog.showMessageBox).not.toHaveBeenCalled()
})

test('a kill failure is logged and surfaced to the user', async () => {
  const { mod, dialog } = await loadCloseApps()
  hasClosableLaunchedApps.mockResolvedValue(true)
  killLaunchedApps.mockRejectedValue(new Error('boom'))

  await mod.closeAppsFromTray()

  expect(writeMainErrorLog).toHaveBeenCalledWith('closeAppsFailure', expect.any(Error))
  expect(dialog.showErrorBox).toHaveBeenCalledTimes(1)
  const [title, message] = dialog.showErrorBox.mock.calls[0]
  expect(title).toBe('Close Apps failed')
  expect(message).toBe('boom')
})

// Codex/Gemini on the original PR: a second tray click while a kill is in flight
// must not start a concurrent run, since concurrent kills race each other's
// WMI/taskkill calls and report false failures. Losing the confirmation step
// makes this MORE reachable, not less: there is no dialog in the way any more.
test('ignores a second invocation while one is in flight', async () => {
  const { mod, dialog } = await loadCloseApps()
  let resolveCheck: (value: boolean) => void = () => {}
  hasClosableLaunchedApps.mockReturnValue(
    new Promise<boolean>((resolve) => {
      resolveCheck = resolve
    })
  )

  const first = mod.closeAppsFromTray()
  // Second call happens while the first is still awaiting the closable check.
  const second = mod.closeAppsFromTray()

  resolveCheck(false)
  await Promise.all([first, second])

  // The lock short-circuited the second call before it ran any check or dialog.
  expect(hasClosableLaunchedApps).toHaveBeenCalledTimes(1)
  expect(dialog.showMessageBox).toHaveBeenCalledTimes(1)
})
