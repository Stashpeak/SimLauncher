/**
 * The in-process process snapshot behind the poll (#975), against a fake koffi.
 *
 * Whether the real binding agrees with the real `tasklist` is the job of
 * `processEnumeration.win.test.ts`, which can only run on Windows. This file pins
 * what the module does with whatever the binding answers, on every OS: above
 * all, that every way of failing lands on `null`, because `null` is what hands
 * the read back to `tasklist`.
 */
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

interface FakeRow {
  SessionId: number
  ProcessId: number
  pProcessName: string | null
}

const INFO_POINTER = { fake: 'WTS_PROCESS_INFOW array' }
const originalPlatform = process.platform

let rows: FakeRow[] = []
let enumerateSucceeds = true
let decodeThrows = false
let loadThrows = false
let freed: unknown[] = []

function setPlatform(platform: string) {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
}

async function loadModule() {
  vi.resetModules()
  vi.doMock('koffi', () => {
    if (loadThrows) {
      throw new Error('Cannot find the native Koffi module')
    }
    return {
      default: {
        load: () => ({
          func: (definition: string) =>
            definition.includes('WTSEnumerateProcessesW')
              ? (
                  _server: unknown,
                  _reserved: number,
                  _version: number,
                  out: unknown[],
                  count: number[]
                ) => {
                  if (!enumerateSucceeds) {
                    return false
                  }
                  out[0] = INFO_POINTER
                  count[0] = rows.length
                  return true
                }
              : (pointer: unknown) => {
                  freed.push(pointer)
                }
        }),
        struct: () => ({}),
        decode: (pointer: unknown, _type: unknown, length: number) => {
          if (decodeThrows) {
            throw new Error('decode failed')
          }
          expect(pointer).toBe(INFO_POINTER)
          return rows.slice(0, length)
        }
      }
    }
  })
  return await import('../../src/main/processes/processSnapshot')
}

beforeEach(() => {
  setPlatform('win32')
  rows = [
    { SessionId: 1, ProcessId: 1234, pProcessName: 'SimHub.exe' },
    // The System Idle Process, which the WTS call returns without a name.
    { SessionId: 0, ProcessId: 0, pProcessName: null },
    { SessionId: 0, ProcessId: 4, pProcessName: 'System' }
  ]
  enumerateSucceeds = true
  decodeThrows = false
  loadThrows = false
  freed = []
})

afterEach(() => {
  setPlatform(originalPlatform)
  vi.doUnmock('koffi')
  vi.restoreAllMocks()
})

test('the first read leaves tasklist to answer while the binding loads, then reads are native', async () => {
  const { prepareProcessSnapshot, readProcessSnapshot } = await loadModule()

  // Null on the first call is the contract, not a race: that read must still
  // be answered, and `tasklist` is what answers it.
  expect(readProcessSnapshot()).toBeNull()

  await prepareProcessSnapshot()

  expect(readProcessSnapshot()).toEqual([
    { name: 'simhub.exe', processId: 1234, sessionId: 1 },
    // Unnamed row dropped, the same as the tasklist parser drops an empty name.
    { name: 'system', processId: 4, sessionId: 0 }
  ])
  expect(freed).toEqual([INFO_POINTER])
})

test('a failed enumeration answers null and reports it once, not on every tick', async () => {
  enumerateSucceeds = false
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  const { prepareProcessSnapshot, readProcessSnapshot } = await loadModule()
  await prepareProcessSnapshot()

  expect(readProcessSnapshot()).toBeNull()
  expect(readProcessSnapshot()).toBeNull()

  expect(consoleError).toHaveBeenCalledTimes(1)
})

test('an empty enumeration is a broken read, not an empty machine (#399)', async () => {
  rows = []
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const { prepareProcessSnapshot, readProcessSnapshot } = await loadModule()
  await prepareProcessSnapshot()

  expect(readProcessSnapshot()).toBeNull()
  expect(freed).toEqual([INFO_POINTER])
})

test('the enumeration memory is freed even when decoding it throws', async () => {
  decodeThrows = true
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const { prepareProcessSnapshot, readProcessSnapshot } = await loadModule()
  await prepareProcessSnapshot()

  expect(readProcessSnapshot()).toBeNull()
  expect(freed).toEqual([INFO_POINTER])
})

test('a binding that cannot load leaves every read to tasklist and never throws', async () => {
  loadThrows = true
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  const { prepareProcessSnapshot, readProcessSnapshot } = await loadModule()

  await expect(prepareProcessSnapshot()).resolves.toBeUndefined()
  expect(readProcessSnapshot()).toBeNull()
  expect(readProcessSnapshot()).toBeNull()

  expect(consoleError).toHaveBeenCalledTimes(1)
  expect(String(consoleError.mock.calls[0][0])).toContain('Native process snapshot unavailable')
})

test('nothing is loaded off Windows', async () => {
  setPlatform('linux')
  // Would be reported if a load were attempted.
  loadThrows = true
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  const { prepareProcessSnapshot, readProcessSnapshot } = await loadModule()

  await prepareProcessSnapshot()

  expect(readProcessSnapshot()).toBeNull()
  expect(consoleError).not.toHaveBeenCalled()
})
