import { afterEach, beforeEach, expect, test, vi } from 'vitest'

let tasklistCallCount = 0
let tasklistOutput =
  '"SimHub.exe","1234","Console","1","50,000 K"\r\n"CrewChief.exe","5678","Console","1","30,000 K"'
let tasklistError: Error | null = null

async function loadTasklistModule() {
  vi.resetModules()

  vi.doMock('child_process', () => ({
    execFile: vi.fn((_command, _args, _options, callback) => {
      tasklistCallCount += 1
      callback(tasklistError, tasklistError ? '' : tasklistOutput, '')
    })
  }))

  return await import('../../src/main/processes/tasklist')
}

beforeEach(() => {
  tasklistCallCount = 0
  tasklistOutput =
    '"SimHub.exe","1234","Console","1","50,000 K"\r\n"CrewChief.exe","5678","Console","1","30,000 K"'
  tasklistError = null
})

afterEach(() => {
  vi.restoreAllMocks()
})

test('readRunningProcessNames parses tasklist CSV output into lowercase process names', async () => {
  const { readRunningProcessNames } = await loadTasklistModule()

  const result = await readRunningProcessNames()

  expect(result.succeeded).toBe(true)
  expect(result.processNames).toBeInstanceOf(Set)
  expect(result.processNames.has('simhub.exe')).toBe(true)
  expect(result.processNames.has('crewchief.exe')).toBe(true)
  expect(tasklistCallCount).toBe(1)
})

test('concurrent calls coalesce into a single tasklist invocation', async () => {
  const { readRunningProcessNames } = await loadTasklistModule()

  const [first, second, third] = await Promise.all([
    readRunningProcessNames(),
    readRunningProcessNames(),
    readRunningProcessNames()
  ])

  expect(tasklistCallCount).toBe(1)
  expect(first).toBe(second)
  expect(second).toBe(third)
})

test('cached result is returned within TTL window', async () => {
  const { readRunningProcessNames } = await loadTasklistModule()

  const first = await readRunningProcessNames()
  const second = await readRunningProcessNames()

  expect(tasklistCallCount).toBe(1)
  expect(first).toBe(second)
})

test('cache expires after TTL and spawns a fresh tasklist', async () => {
  vi.useFakeTimers()
  const { readRunningProcessNames } = await loadTasklistModule()

  await readRunningProcessNames()
  expect(tasklistCallCount).toBe(1)

  // Advance past the 500ms TTL
  vi.advanceTimersByTime(600)

  await readRunningProcessNames()
  expect(tasklistCallCount).toBe(2)

  vi.useRealTimers()
})

test('invalidateProcessNameCache forces a fresh read on next call', async () => {
  const { readRunningProcessNames, invalidateProcessNameCache } = await loadTasklistModule()

  const first = await readRunningProcessNames()
  expect(tasklistCallCount).toBe(1)
  expect(first.processNames.has('simhub.exe')).toBe(true)

  tasklistOutput = '"NewApp.exe","9999","Console","1","10,000 K"'
  invalidateProcessNameCache()

  const second = await readRunningProcessNames()
  expect(tasklistCallCount).toBe(2)
  expect(second.processNames.has('newapp.exe')).toBe(true)
  expect(second.processNames.has('simhub.exe')).toBe(false)
})

test('tasklist execution failure resolves with succeeded: false and an empty Set', async () => {
  tasklistError = new Error('tasklist command not found')
  const { readRunningProcessNames } = await loadTasklistModule()
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

  const result = await readRunningProcessNames()

  expect(result.succeeded).toBe(false)
  expect(result.processNames).toBeInstanceOf(Set)
  expect(result.processNames.size).toBe(0)
  expect(consoleErrorSpy).toHaveBeenCalled()
  consoleErrorSpy.mockRestore()
})

test('failed reads are not cached so the next call retries the tasklist command', async () => {
  tasklistError = new Error('transient tasklist failure')
  const { readRunningProcessNames } = await loadTasklistModule()
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

  const first = await readRunningProcessNames()
  expect(first.succeeded).toBe(false)
  expect(tasklistCallCount).toBe(1)

  // Recover from the failure and verify the next call actually spawns
  // tasklist again (no poisoned-cache reuse of the failed result).
  tasklistError = null
  const second = await readRunningProcessNames()

  expect(tasklistCallCount).toBe(2)
  expect(second.succeeded).toBe(true)
  expect(second.processNames.has('simhub.exe')).toBe(true)
  consoleErrorSpy.mockRestore()
})
