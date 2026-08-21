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

// #674: the poll now decides what to draw from PID and Session#, so the columns
// this used to parse away are load-bearing. A shape the parser mishandles does
// not throw, it just yields fewer instances, and fewer instances resolve to
// `not-running` — an app the user IS running vanishes from the strip. These run
// everywhere, unlike the real-tasklist assertions in processEnumeration.win.
test('the same rows also yield PID and Session# instances (#674)', async () => {
  const { readRunningProcessNames } = await loadTasklistModule()

  const result = await readRunningProcessNames()

  expect(result.processes).toEqual([
    { name: 'simhub.exe', processId: 1234, sessionId: 1 },
    { name: 'crewchief.exe', processId: 5678, sessionId: 1 }
  ])
})

test('Session# is read, not the localized Session Name beside it (#674)', async () => {
  // Column 3 reads "Console" or "Services" on an English install and is
  // translated everywhere else. Reading it instead of the number would break
  // the session-0 dismissal on every non-English Windows, silently.
  tasklistOutput = '"svchost.exe","900","Dienste","0","5,000 K"'
  const { readRunningProcessNames } = await loadTasklistModule()

  const result = await readRunningProcessNames()

  expect(result.processes).toEqual([{ name: 'svchost.exe', processId: 900, sessionId: 0 }])
})

test('a row that will not parse still counts as a running name (#674)', async () => {
  // The safe direction, and the reason the two outputs are not derived from one
  // another. Losing the NAME would say an app is not running when it is; losing
  // only the instance leaves the answer ambiguous, which every caller already
  // handles conservatively. Inventing a session for it would be the dangerous
  // one: session 0 is what lets an unreadable path be dismissed.
  tasklistOutput = [
    '"broken.exe","not-a-pid","Console","1","10 K"',
    '"nosession.exe","4321","Console","x","10 K"',
    '"truncated.exe","4322"',
    '"","4323","Console","1","10 K"',
    '"good.exe","4324","Console","1","10 K"'
  ].join('\r\n')
  const { readRunningProcessNames } = await loadTasklistModule()

  const result = await readRunningProcessNames()

  // Every one of these keeps its name, including the truncated row: the name
  // comes from field 0 alone, exactly as it did before the other columns were
  // read. Writing this test is what caught the first version dropping a
  // truncated row's name entirely, which the old parser never did.
  expect(result.processNames.has('broken.exe')).toBe(true)
  expect(result.processNames.has('nosession.exe')).toBe(true)
  expect(result.processNames.has('truncated.exe')).toBe(true)
  // ...and only the well-formed row becomes an instance. The empty name is not
  // a name at all, so it contributes neither.
  expect(result.processNames.has('')).toBe(false)
  expect(result.processes).toEqual([{ name: 'good.exe', processId: 4324, sessionId: 1 }])
})

test('a failed read reports no instances rather than an empty machine (#399)', async () => {
  tasklistError = new Error('tasklist unavailable')
  const { readRunningProcessNames } = await loadTasklistModule()

  const result = await readRunningProcessNames()

  expect(result.succeeded).toBe(false)
  expect(result.processes).toEqual([])
  expect(result.processNames.size).toBe(0)
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
