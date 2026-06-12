import { beforeEach, expect, test, vi } from 'vitest'

type ExecFileCallback = (error: Error | null, stdout: string) => void

let execFileCallbacks: ExecFileCallback[] = []

async function loadTasklistModule() {
  vi.doMock('child_process', () => ({
    execFile: vi.fn((_cmd: string, _args: string[], _opts: unknown, callback: ExecFileCallback) => {
      execFileCallbacks.push(callback)
    })
  }))

  return await import('../../src/main/processes/tasklist')
}

function resolveTasklist(processName: string) {
  const callback = execFileCallbacks.shift()
  callback?.(null, `"${processName}","1234","Console","1","10,000 K"`)
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  execFileCallbacks = []
})

test('successful reads are cached within the TTL', async () => {
  const tasklist = await loadTasklistModule()

  const firstRead = tasklist.readRunningProcessNames()
  resolveTasklist('simhub.exe')
  await firstRead

  // Second call inside the TTL must reuse the cache — no new tasklist spawn.
  const secondRead = await tasklist.readRunningProcessNames()
  expect(secondRead.processNames.has('simhub.exe')).toBe(true)
  expect(execFileCallbacks).toHaveLength(0)
})

// An invalidation means the process set just changed (launch/exit). A read
// that was already in flight when that happened carries a pre-change snapshot
// and must not re-populate the cache with stale data (#500).
test('an in-flight read does not poison the cache after an invalidation', async () => {
  const tasklist = await loadTasklistModule()

  const inFlightRead = tasklist.readRunningProcessNames()
  tasklist.invalidateProcessNameCache()
  resolveTasklist('stale.exe')
  const inFlightResult = await inFlightRead

  // The caller of the in-flight read still gets its result...
  expect(inFlightResult.processNames.has('stale.exe')).toBe(true)

  // ...but the next read must hit tasklist again instead of the stale cache.
  const freshRead = tasklist.readRunningProcessNames()
  expect(execFileCallbacks).toHaveLength(1)
  resolveTasklist('fresh.exe')
  const freshResult = await freshRead
  expect(freshResult.processNames.has('fresh.exe')).toBe(true)
  expect(freshResult.processNames.has('stale.exe')).toBe(false)
})

// Codex P2 on #507: invalidation must also detach the in-flight read, or a
// caller arriving before it resolves would piggyback on the pre-invalidation
// snapshot (launch/exit/kill paths invalidate and immediately re-read).
test('a read started after invalidation does not piggyback on the detached read', async () => {
  const tasklist = await loadTasklistModule()

  const staleRead = tasklist.readRunningProcessNames()
  tasklist.invalidateProcessNameCache()
  const freshRead = tasklist.readRunningProcessNames()

  // Two separate tasklist spawns must exist now.
  expect(execFileCallbacks).toHaveLength(2)

  resolveTasklist('stale.exe')
  resolveTasklist('fresh.exe')

  expect((await staleRead).processNames.has('stale.exe')).toBe(true)
  const freshResult = await freshRead
  expect(freshResult.processNames.has('fresh.exe')).toBe(true)
  expect(freshResult.processNames.has('stale.exe')).toBe(false)

  // And the fresh read's result is cached (its generation is current).
  await tasklist.readRunningProcessNames()
  expect(execFileCallbacks).toHaveLength(0)
})
