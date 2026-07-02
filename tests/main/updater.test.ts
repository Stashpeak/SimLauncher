import { beforeEach, expect, test, vi } from 'vitest'

type UpdaterEventHandler = (...args: unknown[]) => void

const autoUpdaterHandlers: Record<string, UpdaterEventHandler> = {}
const quitAndInstall = vi.fn()
const downloadUpdate = vi.fn()
const autoUpdaterCheckForUpdates = vi.fn()

async function loadUpdaterModule({ isPackaged = true } = {}) {
  const { clearIpcHandlers, app } = await import('electron')
  ;(clearIpcHandlers as () => void)()
  ;(app as { isPackaged: boolean }).isPackaged = isPackaged

  Object.keys(autoUpdaterHandlers).forEach((key) => delete autoUpdaterHandlers[key])
  vi.doMock('electron-updater', () => ({
    autoUpdater: {
      autoDownload: true,
      on: vi.fn((event: string, handler: UpdaterEventHandler) => {
        autoUpdaterHandlers[event] = handler
      }),
      quitAndInstall,
      downloadUpdate,
      checkForUpdates: autoUpdaterCheckForUpdates
    }
  }))

  const updaterModule = await import('../../src/main/updater')
  const appState = await import('../../src/main/app-state')
  const { autoUpdater } = await import('electron-updater')
  const sendToRenderer = vi.fn()
  updaterModule.registerUpdaterEvents(sendToRenderer)
  updaterModule.registerUpdaterHandlers(sendToRenderer)
  const { __ipcHandlers } = await import('electron')
  return {
    updaterModule,
    appState,
    autoUpdater,
    sendToRenderer,
    handlers: __ipcHandlers as Record<string, (...args: unknown[]) => Promise<unknown>>
  }
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})

// The preload bridge (src/preload/index.ts) subscribes to these literal
// channel names. Renaming a channel on either side silently kills the updater
// UI — there is no runtime error, updates just stop surfacing.
test('updater events forward to the renderer on the channels the preload subscribes to', async () => {
  const { sendToRenderer, autoUpdater } = await loadUpdaterModule()

  // Forced off at module load: downloads must wait for explicit user consent.
  expect(autoUpdater.autoDownload).toBe(false)

  autoUpdaterHandlers['update-available']({ version: '1.2.3' })
  autoUpdaterHandlers['update-downloaded']({ version: '1.2.3' })
  autoUpdaterHandlers['update-not-available']({ version: '1.2.3' })
  autoUpdaterHandlers['download-progress']({ percent: 50 })
  autoUpdaterHandlers['error'](new Error('boom'))

  expect(sendToRenderer.mock.calls.map((call) => call[0])).toEqual([
    'update-available',
    'update-downloaded',
    'update-not-available',
    'update-download-progress',
    'update-error'
  ])
})

test('install-update with a downloaded update sets isQuitting before quitAndInstall', async () => {
  const { appState, handlers } = await loadUpdaterModule()
  let isQuittingWhenInstalling: boolean | undefined
  quitAndInstall.mockImplementationOnce(() => {
    isQuittingWhenInstalling = appState.getIsQuitting()
  })

  autoUpdaterHandlers['update-downloaded']({ version: '1.2.3' })
  quitAndInstall.mockClear()
  await handlers['install-update']({})

  expect(quitAndInstall).toHaveBeenCalledTimes(1)
  // The window 'close' interceptor must see isQuitting=true, otherwise it
  // would preventDefault the updater's quit and swallow the install.
  expect(isQuittingWhenInstalling).toBe(true)
})

test('a deferred install with a DIRTY renderer does NOT force-quit (#671)', async () => {
  const { appState, handlers, sendToRenderer } = await loadUpdaterModule()
  downloadUpdate.mockResolvedValue(undefined)

  // The user consents to install while the download is still in progress...
  await handlers['install-update']({})
  expect(downloadUpdate).toHaveBeenCalledTimes(1)

  // ...then keeps editing, so the renderer is dirty when the download lands.
  appState.setRendererDirty(true)
  autoUpdaterHandlers['update-downloaded']({ version: '1.2.3' })

  // The app must NOT quit past the dirty close-confirm machinery. Instead it
  // tells the renderer the update is ready so the user can decide.
  expect(quitAndInstall).not.toHaveBeenCalled()
  expect(sendToRenderer).toHaveBeenCalledWith('update-ready-while-dirty', { version: '1.2.3' })
})

test('a deferred install with a CLEAN renderer auto-installs as before (#671)', async () => {
  const { appState, handlers, sendToRenderer } = await loadUpdaterModule()
  downloadUpdate.mockResolvedValue(undefined)

  await handlers['install-update']({})
  appState.setRendererDirty(false)
  autoUpdaterHandlers['update-downloaded']({ version: '1.2.3' })

  // Clean renderer: preserve the original behavior — install immediately, and
  // do not surface the "restart while dirty" prompt.
  expect(quitAndInstall).toHaveBeenCalledTimes(1)
  expect(sendToRenderer).not.toHaveBeenCalledWith('update-ready-while-dirty', expect.anything())
})

test('install-update before download latches and installs when the download lands', async () => {
  const { handlers } = await loadUpdaterModule()
  downloadUpdate.mockResolvedValue(undefined)

  await handlers['install-update']({})

  expect(downloadUpdate).toHaveBeenCalledTimes(1)
  expect(quitAndInstall).not.toHaveBeenCalled()

  autoUpdaterHandlers['update-downloaded']({ version: '1.2.3' })

  expect(quitAndInstall).toHaveBeenCalledTimes(1)
})

test('a failed download resets the install latch', async () => {
  const { handlers } = await loadUpdaterModule()
  downloadUpdate.mockRejectedValue(new Error('network down'))

  await expect(handlers['install-update']({})).rejects.toThrow('network down')

  // A later download (e.g. user retried and it errored mid-flight elsewhere)
  // must not auto-install from the stale latch.
  autoUpdaterHandlers['update-downloaded']({ version: '1.2.3' })
  expect(quitAndInstall).not.toHaveBeenCalled()
})

test('install-update swallows a network failure instead of double-surfacing it (#560)', async () => {
  const { handlers } = await loadUpdaterModule()
  downloadUpdate.mockRejectedValueOnce(
    Object.assign(new Error('getaddrinfo ENOTFOUND github.com'), { code: 'ENOTFOUND' })
  )

  // The 'error' event already showed the calm offline notice; the install IPC
  // must resolve (not reject), otherwise the renderer fires a second generic
  // "Failed to install update" that overrides the offline message.
  await expect(handlers['install-update']({})).resolves.toMatchObject({ offline: true })

  // The latch is still cleared, so a later stray download won't auto-install.
  autoUpdaterHandlers['update-downloaded']({ version: '1.2.3' })
  expect(quitAndInstall).not.toHaveBeenCalled()
})

test('an updater error resets the install latch', async () => {
  const { handlers } = await loadUpdaterModule()
  let resolveDownload: () => void = () => {}
  downloadUpdate.mockReturnValue(new Promise<void>((resolve) => (resolveDownload = resolve)))

  const installPromise = handlers['install-update']({})
  autoUpdaterHandlers['error'](new Error('checksum mismatch'))
  resolveDownload()
  await installPromise

  autoUpdaterHandlers['update-downloaded']({ version: '1.2.3' })
  expect(quitAndInstall).not.toHaveBeenCalled()
})

test('a network error is flagged so the renderer can show an offline notice (#527)', async () => {
  const { sendToRenderer } = await loadUpdaterModule()

  autoUpdaterHandlers['error'](
    Object.assign(new Error('net::ERR_INTERNET_DISCONNECTED'), { code: 'ENOTFOUND' })
  )

  const errorCall = sendToRenderer.mock.calls.find((call) => call[0] === 'update-error')
  expect(errorCall?.[1]).toMatchObject({ isNetworkError: true })
})

test('a non-network updater error is not flagged as network (#527)', async () => {
  const { sendToRenderer } = await loadUpdaterModule()

  autoUpdaterHandlers['error'](new Error('Checksum mismatch'))

  const errorCall = sendToRenderer.mock.calls.find((call) => call[0] === 'update-error')
  expect(errorCall?.[1]).toMatchObject({ isNetworkError: false, message: 'Checksum mismatch' })
})

test('check-for-updates swallows a network failure but rethrows other errors (#527)', async () => {
  const { handlers } = await loadUpdaterModule()

  autoUpdaterCheckForUpdates.mockRejectedValueOnce(
    Object.assign(new Error('getaddrinfo ENOTFOUND update.example.com'), { code: 'ENOTFOUND' })
  )
  await expect(handlers['check-for-updates']({})).resolves.toBeNull()

  autoUpdaterCheckForUpdates.mockRejectedValueOnce(new Error('HTTP 500 from update server'))
  await expect(handlers['check-for-updates']({})).rejects.toThrow('HTTP 500')
})

test('a TLS/cert net error is NOT downgraded to offline (#535)', async () => {
  const { sendToRenderer, handlers } = await loadUpdaterModule()

  autoUpdaterHandlers['error'](new Error('net::ERR_CERT_AUTHORITY_INVALID'))
  const errorCall = sendToRenderer.mock.calls.find((call) => call[0] === 'update-error')
  expect(errorCall?.[1]).toMatchObject({ isNetworkError: false })

  // ...and check-for-updates must NOT swallow it — a security/config error should
  // surface, not hide behind the calm offline notice.
  autoUpdaterCheckForUpdates.mockRejectedValueOnce(new Error('net::ERR_CERT_AUTHORITY_INVALID'))
  await expect(handlers['check-for-updates']({})).rejects.toThrow('ERR_CERT_AUTHORITY_INVALID')
})

test('unpackaged builds simulate the update flow without touching electron-updater', async () => {
  const { updaterModule, handlers, sendToRenderer } = await loadUpdaterModule({
    isPackaged: false
  })

  await expect(updaterModule.checkForUpdates()).resolves.toBeNull()
  expect(sendToRenderer).toHaveBeenCalledWith('update-available', { version: '99.0.0' })
  expect(autoUpdaterCheckForUpdates).not.toHaveBeenCalled()

  await expect(handlers['install-update']({})).resolves.toEqual({ success: true })
  expect(sendToRenderer).toHaveBeenCalledWith('update-downloaded', { version: '99.0.0' })
  expect(downloadUpdate).not.toHaveBeenCalled()
  expect(quitAndInstall).not.toHaveBeenCalled()
})
