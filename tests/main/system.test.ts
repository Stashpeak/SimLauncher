import { beforeEach, expect, test, vi } from 'vitest'

import { __ipcHandlers, app, clearIpcHandlers, shell } from './electronMock'

async function loadSystemHandlers() {
  // No vi.resetModules() here: it would create a fresh electron mock instance
  // whose __ipcHandlers diverges from the one imported at the top of this file.
  // system.ts has no module-level state, so re-registering into the shared mock
  // (cleared first) is sufficient and keeps app/shell mocks shared.
  clearIpcHandlers()
  const mod = await import('../../src/main/ipc/system')
  mod.registerSystemHandlers()
  return __ipcHandlers
}

beforeEach(() => {
  vi.clearAllMocks()
})

test('open-logs-folder opens the app userData folder', async () => {
  ;(app.getPath as ReturnType<typeof vi.fn>).mockReturnValue('C:/userData')
  const handlers = await loadSystemHandlers()

  expect(handlers['open-logs-folder']).toBeTypeOf('function')

  await handlers['open-logs-folder']()

  expect(app.getPath).toHaveBeenCalledWith('userData')
  expect(shell.openPath).toHaveBeenCalledWith('C:/userData')
})

test('open-logs-folder surfaces shell.openPath result (error string on failure)', async () => {
  ;(shell.openPath as ReturnType<typeof vi.fn>).mockResolvedValueOnce('Failed to open path')
  const handlers = await loadSystemHandlers()

  await expect(handlers['open-logs-folder']()).resolves.toBe('Failed to open path')
})
