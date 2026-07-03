import { afterEach, expect, test, vi } from 'vitest'

interface FsMock {
  statSync: ReturnType<typeof vi.fn>
  renameSync: ReturnType<typeof vi.fn>
  appendFileSync: ReturnType<typeof vi.fn>
}

async function loadModule() {
  vi.resetModules()
  const appMock = { getPath: vi.fn(() => 'C:/userData') }
  vi.doMock('electron', () => ({ app: appMock }))
  const fsMock: FsMock = {
    statSync: vi.fn(() => ({ size: 0 })),
    renameSync: vi.fn(),
    appendFileSync: vi.fn()
  }
  vi.doMock('fs', () => ({ default: fsMock }))
  const mod = await import('../../src/main/errorLog')
  return { mod, fsMock, appMock }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.doUnmock('electron')
  vi.doUnmock('fs')
})

test('formatMainError renders an Error with kind, name, message, stack and an ISO timestamp', async () => {
  const { mod } = await loadModule()

  const out = mod.formatMainError('uncaughtException', new Error('boom'))

  expect(out).toMatch(/^\[\d{4}-\d\d-\d\dT[\d:.]+Z\] uncaughtException: Error: boom/)
  expect(out).toContain('at ') // stack frame
})

test('formatMainError stringifies a non-Error rejection reason', async () => {
  const { mod } = await loadModule()

  expect(mod.formatMainError('unhandledRejection', 'just a string')).toContain(
    'unhandledRejection: just a string'
  )
  expect(mod.formatMainError('unhandledRejection', { code: 42 })).toContain('[object Object]')
})

test('writeMainErrorLog appends to <userData>/main-error.log without rotating a small file', async () => {
  const { mod, fsMock } = await loadModule()
  fsMock.statSync.mockReturnValue({ size: 100 })

  mod.writeMainErrorLog('uncaughtException', new Error('x'))

  expect(fsMock.renameSync).not.toHaveBeenCalled()
  expect(fsMock.appendFileSync).toHaveBeenCalledWith(
    expect.stringContaining('main-error.log'),
    expect.stringContaining('uncaughtException')
  )
})

test('writeMainErrorLog rotates to a .old companion once the file exceeds the cap', async () => {
  const { mod, fsMock } = await loadModule()
  fsMock.statSync.mockReturnValue({ size: 600 * 1024 })

  mod.writeMainErrorLog('uncaughtException', new Error('x'))

  expect(fsMock.renameSync).toHaveBeenCalledWith(
    expect.stringContaining('main-error.log'),
    expect.stringContaining('main-error.log.old')
  )
  expect(fsMock.appendFileSync).toHaveBeenCalled()
})

test('writeMainErrorLog does not rotate when there is no existing file (stat throws)', async () => {
  const { mod, fsMock } = await loadModule()
  fsMock.statSync.mockImplementation(() => {
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
  })

  mod.writeMainErrorLog('uncaughtException', new Error('x'))

  expect(fsMock.renameSync).not.toHaveBeenCalled()
  expect(fsMock.appendFileSync).toHaveBeenCalled()
})

test('writeMainErrorLog never throws even when the disk write fails', async () => {
  const { mod, fsMock } = await loadModule()
  fsMock.appendFileSync.mockImplementation(() => {
    throw new Error('ENOSPC: no space left on device')
  })

  expect(() => mod.writeMainErrorLog('uncaughtException', new Error('x'))).not.toThrow()
})

test('formatAppErrorLog renders an operation, detail and an ISO timestamp on a single line', async () => {
  const { mod } = await loadModule()

  const out = mod.formatAppErrorLog('launch', 'Error launching C:/Apps/App.exe: spawn ENOENT')

  expect(out).toMatch(
    /^\[\d{4}-\d\d-\d\dT[\d:.]+Z\] launch: Error launching C:\/Apps\/App\.exe: spawn ENOENT\n$/
  )
})

test('formatAppErrorLog collapses stderr-style embedded newlines into one line', async () => {
  const { mod } = await loadModule()

  // taskkill/PowerShell stderr routinely carries \r\n; a single failure must
  // never span multiple log lines.
  const out = mod.formatAppErrorLog('kill', 'Failed to close app:\r\nAccess is denied.\n')

  expect(out).toMatch(/^\[[^\]]+\] kill: Failed to close app: Access is denied\.\n$/)
})

test('writeAppErrorLog appends to the same <userData>/main-error.log used by crash logging (#638)', async () => {
  const { mod, fsMock } = await loadModule()
  fsMock.statSync.mockReturnValue({ size: 100 })

  mod.writeAppErrorLog('kill', 'Error killing C:/Tools/SimHub.exe: Access is denied.')

  expect(fsMock.appendFileSync).toHaveBeenCalledWith(
    expect.stringContaining('main-error.log'),
    expect.stringContaining('kill: Error killing C:/Tools/SimHub.exe: Access is denied.')
  )
})

test('writeAppErrorLog rotates to a .old companion once the file exceeds the cap, same as writeMainErrorLog', async () => {
  const { mod, fsMock } = await loadModule()
  fsMock.statSync.mockReturnValue({ size: 600 * 1024 })

  mod.writeAppErrorLog('launch', 'boom')

  expect(fsMock.renameSync).toHaveBeenCalledWith(
    expect.stringContaining('main-error.log'),
    expect.stringContaining('main-error.log.old')
  )
  expect(fsMock.appendFileSync).toHaveBeenCalled()
})

test('writeAppErrorLog never throws even when the disk write fails', async () => {
  const { mod, fsMock } = await loadModule()
  fsMock.appendFileSync.mockImplementation(() => {
    throw new Error('ENOSPC: no space left on device')
  })

  expect(() => mod.writeAppErrorLog('launch', 'boom')).not.toThrow()
})

test('installMainProcessErrorLogging registers both handlers exactly once (idempotent)', async () => {
  const { mod } = await loadModule()
  const onSpy = vi.spyOn(process, 'on').mockImplementation(() => process)

  mod.installMainProcessErrorLogging()
  mod.installMainProcessErrorLogging() // second call must be a no-op

  const events = onSpy.mock.calls.map((call) => call[0])
  expect(events.filter((e) => e === 'uncaughtException')).toHaveLength(1)
  expect(events.filter((e) => e === 'unhandledRejection')).toHaveLength(1)
})

test('the registered uncaughtException handler writes the error to the log', async () => {
  const { mod, fsMock } = await loadModule()
  const handlers: Record<string, (value: unknown) => void> = {}
  vi.spyOn(process, 'on').mockImplementation((event: string, handler: (value: unknown) => void) => {
    handlers[event] = handler
    return process
  })

  mod.installMainProcessErrorLogging()
  handlers.uncaughtException(new Error('kaboom'))

  expect(fsMock.appendFileSync).toHaveBeenCalledWith(
    expect.stringContaining('main-error.log'),
    expect.stringContaining('kaboom')
  )
})
