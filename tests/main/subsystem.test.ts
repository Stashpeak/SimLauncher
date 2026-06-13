import { afterAll, afterEach, expect, test, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

import { isConsoleExecutable } from '../../src/main/processes/subsystem'

const SUBSYSTEM_GUI = 2
const SUBSYSTEM_CONSOLE = 3

const tempFiles: string[] = []

/**
 * Build a minimal PE file: MZ header with e_lfanew at 0x3C pointing to a
 * "PE\0\0" signature + COFF header (20 bytes) + optional header whose
 * Subsystem field sits at optional-header offset 68.
 */
function buildPeFixture(opts: { subsystem?: number; corrupt?: 'no-mz' | 'no-pe' } = {}) {
  const peOffset = 0x80
  const buf = Buffer.alloc(0x200)
  if (opts.corrupt !== 'no-mz') buf.writeUInt16LE(0x5a4d, 0) // 'MZ'
  buf.writeUInt32LE(peOffset, 0x3c)
  if (opts.corrupt !== 'no-pe') {
    buf.writeUInt32LE(0x00004550, peOffset) // 'PE\0\0'
    buf.writeUInt16LE(0x10b, peOffset + 24) // optional header magic (PE32)
    buf.writeUInt16LE(opts.subsystem ?? SUBSYSTEM_GUI, peOffset + 24 + 68)
  }
  return buf
}

function writeFixture(name: string, content: Buffer) {
  const filePath = path.join(os.tmpdir(), `simlauncher-subsystem-${name}-${process.pid}.exe`)
  fs.writeFileSync(filePath, content)
  tempFiles.push(filePath)
  return filePath
}

afterAll(() => {
  tempFiles.forEach((file) => {
    try {
      fs.unlinkSync(file)
    } catch {
      // best effort
    }
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

function lockError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`mock ${code}`), { code })
}

test('detects a console-subsystem PE (#486)', async () => {
  const file = writeFixture('console', buildPeFixture({ subsystem: SUBSYSTEM_CONSOLE }))
  await expect(isConsoleExecutable(file)).resolves.toBe(true)
})

test('detects a GUI-subsystem PE as non-console (#486)', async () => {
  const file = writeFixture('gui', buildPeFixture({ subsystem: SUBSYSTEM_GUI }))
  await expect(isConsoleExecutable(file)).resolves.toBe(false)
})

test('fails open (non-console) on a file without an MZ header (#486)', async () => {
  const file = writeFixture('no-mz', buildPeFixture({ corrupt: 'no-mz' }))
  await expect(isConsoleExecutable(file)).resolves.toBe(false)
})

test('fails open (non-console) on a missing PE signature (#486)', async () => {
  const file = writeFixture('no-pe', buildPeFixture({ corrupt: 'no-pe' }))
  await expect(isConsoleExecutable(file)).resolves.toBe(false)
})

test('fails open (non-console) on a truncated file (#486)', async () => {
  const file = writeFixture('truncated', buildPeFixture().subarray(0, 0x50))
  await expect(isConsoleExecutable(file)).resolves.toBe(false)
})

test('fails open (non-console) on a nonexistent path (#486)', async () => {
  await expect(isConsoleExecutable('C:/does/not/exist.exe')).resolves.toBe(false)
})

test('retries once on a transient lock and then succeeds (#505)', async () => {
  const file = writeFixture('lock-retry', buildPeFixture({ subsystem: SUBSYSTEM_CONSOLE }))
  const realOpen = fs.promises.open
  const openSpy = vi
    .spyOn(fs.promises, 'open')
    .mockRejectedValueOnce(lockError('EBUSY'))
    .mockImplementation((...args: Parameters<typeof fs.promises.open>) =>
      realOpen.apply(fs.promises, args)
    )

  await expect(isConsoleExecutable(file)).resolves.toBe(true)
  expect(openSpy).toHaveBeenCalledTimes(2)
})

test('does not retry on a non-transient error (#505)', async () => {
  const file = writeFixture('no-retry', buildPeFixture({ subsystem: SUBSYSTEM_CONSOLE }))
  const openSpy = vi.spyOn(fs.promises, 'open').mockRejectedValue(lockError('ENOENT'))

  await expect(isConsoleExecutable(file)).resolves.toBe(false)
  expect(openSpy).toHaveBeenCalledTimes(1)
})

test('fails open after the retry still hits the lock (#505)', async () => {
  const file = writeFixture('lock-persist', buildPeFixture({ subsystem: SUBSYSTEM_CONSOLE }))
  const openSpy = vi.spyOn(fs.promises, 'open').mockRejectedValue(lockError('EBUSY'))

  await expect(isConsoleExecutable(file)).resolves.toBe(false)
  expect(openSpy).toHaveBeenCalledTimes(2)
})

// Real-world sanity against actual Windows system binaries (skipped on the
// Linux CI runner; runs on dev machines).
test.runIf(process.platform === 'win32')('classifies real system executables (#486)', async () => {
  await expect(isConsoleExecutable('C:/Windows/System32/cmd.exe')).resolves.toBe(true)
  await expect(
    isConsoleExecutable('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe')
  ).resolves.toBe(true)
  await expect(isConsoleExecutable('C:/Windows/explorer.exe')).resolves.toBe(false)
})
