import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'

const spawnCalls: { command: string }[] = []
const execFileCalls: { file: string }[] = []

async function loadGuardedStart() {
  vi.resetModules()
  spawnCalls.length = 0
  execFileCalls.length = 0

  vi.doMock('child_process', () => ({
    spawn: vi.fn((command: string) => {
      spawnCalls.push({ command })
      return { pid: 1234 }
    }),
    execFile: vi.fn((file: string) => {
      execFileCalls.push({ file })
      return { pid: 5678 }
    })
  }))

  return await import('../../src/main/processes/guardedStart')
}

afterEach(() => {
  vi.restoreAllMocks()
})

// --- Behavior of the two primitives (#715) ---

test('spawnUnlessAborted starts the app while the launch is live', async () => {
  const { spawnUnlessAborted } = await loadGuardedStart()
  const controller = new AbortController()

  const child = spawnUnlessAborted(controller.signal, 'C:/Tools/SimHub.exe', [], {})

  expect(child).not.toBeNull()
  expect(spawnCalls).toEqual([{ command: 'C:/Tools/SimHub.exe' }])
})

test('spawnUnlessAborted starts nothing once the launch is aborted', async () => {
  const { spawnUnlessAborted } = await loadGuardedStart()
  const controller = new AbortController()
  controller.abort()

  const child = spawnUnlessAborted(controller.signal, 'C:/Tools/SimHub.exe', [], {})

  expect(child).toBeNull()
  expect(spawnCalls).toEqual([])
})

// killLaunchedApps outside a launch, and spawnDetachedApp's direct unit tests,
// both reach these with no signal at all. An absent signal is "not cancellable",
// not "already cancelled" — it must still start.
test('spawnUnlessAborted starts the app when there is no signal', async () => {
  const { spawnUnlessAborted } = await loadGuardedStart()

  expect(spawnUnlessAborted(undefined, 'C:/Tools/SimHub.exe', [], {})).not.toBeNull()
  expect(spawnCalls).toHaveLength(1)
})

test('execFileUnlessAborted starts the elevation host while the launch is live', async () => {
  const { execFileUnlessAborted } = await loadGuardedStart()
  const controller = new AbortController()

  const host = execFileUnlessAborted(controller.signal, 'powershell.exe', [], {}, () => {})

  expect(host).not.toBeNull()
  expect(execFileCalls).toEqual([{ file: 'powershell.exe' }])
})

test('execFileUnlessAborted starts no elevation host once the launch is aborted', async () => {
  const { execFileUnlessAborted } = await loadGuardedStart()
  const controller = new AbortController()
  controller.abort()

  const host = execFileUnlessAborted(controller.signal, 'powershell.exe', [], {}, () => {})

  expect(host).toBeNull()
  expect(execFileCalls).toEqual([])
})

test('execFileUnlessAborted starts the elevation host when there is no signal', async () => {
  const { execFileUnlessAborted } = await loadGuardedStart()

  expect(execFileUnlessAborted(undefined, 'powershell.exe', [], {}, () => {})).not.toBeNull()
  expect(execFileCalls).toHaveLength(1)
})

// --- Structural properties the primitives depend on (#715) ---
//
// The behavioral tests above prove the check works. These prove it cannot be
// bypassed, which is the actual point of centralizing it: the old per-await
// checks were correct too, and still lost to every await someone forgot.
// Asserted against the source text because that is where both properties live —
// no runtime observation can tell you an await was NOT added, or that some
// other module did not call spawn() directly.

const root = process.cwd()

function readSource(relativePath: string) {
  return readFileSync(path.join(root, relativePath), 'utf8')
}

// Comments in these files talk about spawn(), execFile() and awaits at length,
// so the assertions below have to look at code only.
function stripComments(source: string) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function listSourceFiles(directory: string): string[] {
  return readdirSync(path.join(root, directory)).flatMap((entry) => {
    const relativePath = path.posix.join(directory, entry)
    return statSync(path.join(root, relativePath)).isDirectory()
      ? listSourceFiles(relativePath)
      : relativePath.endsWith('.ts')
        ? [relativePath]
        : []
  })
}

// Main-process modules that start a process for a reason OTHER than launching
// the user's apps, and so are correctly outside the launch guard. Adding a file
// here is a deliberate claim that it never starts anything on the user's behalf.
const NON_LAUNCH_PROCESS_STARTERS = [
  // Reads the process list. Starts nothing the user could be asked to close.
  'src/main/processes/tasklist.ts',
  // taskkill — the kill side, which the abort exists to serve in the first place.
  'src/main/processes/win32KillUtils.ts'
]

test('the launch path starts processes only through the guarded primitives (#715)', () => {
  const startsAProcess = listSourceFiles('src/main').filter((file) =>
    /\b(spawn|execFile|exec|fork|execFileSync|spawnSync|execSync)\s*\(/.test(
      stripComments(readSource(file))
    )
  )

  expect(startsAProcess.sort()).toEqual(
    ['src/main/processes/guardedStart.ts', ...NON_LAUNCH_PROCESS_STARTERS].sort()
  )
})

test('nothing can suspend between the abort check and the start (#715)', () => {
  const source = readSource('src/main/processes/guardedStart.ts')
  const code = stripComments(source)

  // The whole module is synchronous, so there is no suspension point for an
  // abort to slip through — and no way to add one without failing here.
  expect(code).not.toMatch(/\b(await|async)\b/)

  // And the check is the statement immediately before the start, in both.
  const collapsed = code.replace(/\s+/g, ' ')
  expect(collapsed).toContain('if (signal?.aborted) { return null } return spawn(')
  expect(collapsed).toContain('if (signal?.aborted) { return null } return execFile(')
})
