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

// open-external-url is the only sanctioned path from the renderer to the OS
// (window.ts denies will-navigate / setWindowOpenHandler) — it is a security
// gate, not a convenience wrapper. #657
test('open-external-url rejects non-string input', async () => {
  const handlers = await loadSystemHandlers()

  await expect(handlers['open-external-url']({}, 42)).resolves.toBe(false)
  await expect(handlers['open-external-url']({}, null)).resolves.toBe(false)
  await expect(handlers['open-external-url']({}, undefined)).resolves.toBe(false)
  expect(shell.openExternal).not.toHaveBeenCalled()
})

test('open-external-url rejects an unparseable URL', async () => {
  const handlers = await loadSystemHandlers()

  await expect(handlers['open-external-url']({}, 'not a url')).resolves.toBe(false)
  expect(shell.openExternal).not.toHaveBeenCalled()
})

test('open-external-url rejects a non-https protocol', async () => {
  const handlers = await loadSystemHandlers()

  await expect(handlers['open-external-url']({}, 'http://github.com')).resolves.toBe(false)
  await expect(
    handlers['open-external-url']({}, 'file:///C:/Windows/System32/cmd.exe')
  ).resolves.toBe(false)
  expect(shell.openExternal).not.toHaveBeenCalled()
})

test('open-external-url rejects a host outside the allowlist', async () => {
  const handlers = await loadSystemHandlers()

  await expect(handlers['open-external-url']({}, 'https://evil.example.com')).resolves.toBe(false)
  await expect(handlers['open-external-url']({}, 'https://not-github.com.evil.com')).resolves.toBe(
    false
  )
  expect(shell.openExternal).not.toHaveBeenCalled()
})

test('open-external-url opens an allowlisted https host', async () => {
  const handlers = await loadSystemHandlers()
  const url = 'https://github.com/Stashpeak/SimLauncher'

  await expect(handlers['open-external-url']({}, url)).resolves.toBe(true)
  expect(shell.openExternal).toHaveBeenCalledOnce()
  expect(shell.openExternal).toHaveBeenCalledWith(url)
})

test('open-external-url returns false (and does not throw) when shell.openExternal rejects', async () => {
  ;(shell.openExternal as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
    new Error('no registered handler')
  )
  const handlers = await loadSystemHandlers()

  await expect(handlers['open-external-url']({}, 'https://discord.gg/abc123')).resolves.toBe(false)
})
