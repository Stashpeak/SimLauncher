import { afterEach, beforeEach, expect, test, vi } from 'vitest'

let tasklistCallCount = 0
let tasklistOutput =
  '"SimHub.exe","1234","Console","1","50,000 K"\r\n"CrewChief.exe","5678","Console","1","30,000 K"'

async function loadTasklistModule() {
  vi.resetModules()

  vi.doMock('child_process', () => ({
    execFile: vi.fn((_command, _args, _options, callback) => {
      tasklistCallCount += 1
      callback(null, tasklistOutput, '')
    })
  }))

  return await import('../../src/main/processes/tasklist')
}

beforeEach(() => {
  tasklistCallCount = 0
  tasklistOutput =
    '"SimHub.exe","1234","Console","1","50,000 K"\r\n"CrewChief.exe","5678","Console","1","30,000 K"'
})

afterEach(() => {
  vi.restoreAllMocks()
})

test('readRunningProcessNames parses tasklist CSV output into lowercase process names', async () => {
  const { readRunningProcessNames } = await loadTasklistModule()

  const names = await readRunningProcessNames()

  expect(names).toBeInstanceOf(Set)
  expect(names.has('simhub.exe')).toBe(true)
  expect(names.has('crewchief.exe')).toBe(true)
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
  expect(first.has('simhub.exe')).toBe(true)

  tasklistOutput = '"NewApp.exe","9999","Console","1","10,000 K"'
  invalidateProcessNameCache()

  const second = await readRunningProcessNames()
  expect(tasklistCallCount).toBe(2)
  expect(second.has('newapp.exe')).toBe(true)
  expect(second.has('simhub.exe')).toBe(false)
})
