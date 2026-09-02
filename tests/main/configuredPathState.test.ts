import { beforeEach, describe, expect, test, vi } from 'vitest'

import {
  findProcessesByName,
  resolveConfiguredPathState,
  type NamedProcessInstance
} from '../../src/main/processes/win32KillUtils'

const execFileMock = vi.hoisted(() => vi.fn())
vi.mock('child_process', () => ({ execFile: execFileMock }))

/**
 * #674: `tasklist` returns image NAMES with no path, so every "is my configured
 * app already running?" answer built on it treats a same-named process from an
 * unrelated path as the configured one. `resolveConfiguredPathState` is the one
 * rule that separates them, shared by every call site that used to ask the
 * name-only question.
 *
 * The rule has to hold two things at once that pull in opposite directions:
 *
 *   - a collision must resolve to `not-running`, or the configured app is
 *     silently never launched and is then blamed on elevation when it cannot be
 *     closed
 *   - a genuinely elevated process invisible to a non-elevated SimLauncher
 *     (#390) must stay `unknown`, because inverting it there reopens #390
 *
 * Those two produce a byte-identical signal from a path-scoped query, which is
 * the whole reason the fix had to widen the query rather than flip a predicate.
 * Everything below is about which side of that line a given shape falls on.
 */

const CONFIGURED = 'C:/Tools/Overlay.exe'

function instance(overrides: Partial<NamedProcessInstance> = {}): NamedProcessInstance {
  return {
    name: 'overlay.exe',
    processId: 1000,
    executablePath: 'C:/Tools/Overlay.exe',
    sessionId: 1,
    ...overrides
  }
}

describe('resolveConfiguredPathState (#674)', () => {
  test('nothing under that name is not running', () => {
    expect(resolveConfiguredPathState([], CONFIGURED)).toBe('not-running')
  })

  // Only instances of the asked-about name may be considered. A caller batches
  // several names into one enumeration, so the list it hands back routinely
  // contains images this path has nothing to do with.
  test('instances of a different name are ignored', () => {
    const other = instance({ name: 'simhub.exe', executablePath: 'C:/Tools/SimHub.exe' })
    expect(resolveConfiguredPathState([other], CONFIGURED)).toBe('not-running')
  })

  test('a process at the configured path is running', () => {
    expect(resolveConfiguredPathState([instance()], CONFIGURED)).toBe('running')
  })

  // Path comparison must survive the forms Windows hands back: different
  // separators, different case, trailing-dot-free normalization.
  test('the path match is normalized, not a string compare', () => {
    const backslashes = instance({ executablePath: 'c:\\tools\\OVERLAY.exe' })
    expect(resolveConfiguredPathState([backslashes], CONFIGURED)).toBe('running')
  })

  // THE BUG. A readable path that differs is positive evidence that this
  // instance is somebody else's, so the configured app is not running.
  test('a same-named process at another path is not running (#674)', () => {
    const collider = instance({ executablePath: 'C:/UserApps/Overlay.exe' })
    expect(resolveConfiguredPathState([collider], CONFIGURED)).toBe('not-running')
  })

  test('several colliders are still not running', () => {
    const colliders = [
      instance({ processId: 1, executablePath: 'C:/UserApps/Overlay.exe' }),
      instance({ processId: 2, executablePath: 'D:/Other/Overlay.exe' })
    ]
    expect(resolveConfiguredPathState(colliders, CONFIGURED)).toBe('not-running')
  })

  // #390 MUST NOT REGRESS. An unreadable path in an interactive session is the
  // signature of a process running at higher integrity than SimLauncher, which
  // is exactly the elevated-invisible case. Answering anything but `unknown`
  // here inverts #390 instead of discriminating.
  test('an unreadable path in an interactive session is unknown (#390)', () => {
    const invisible = instance({ executablePath: null })
    expect(resolveConfiguredPathState([invisible], CONFIGURED)).toBe('unknown')
  })

  // The free half of the discriminator. Session 0 is the non-interactive
  // services session and cannot host a companion the user launched, so an
  // unreadable path is still decidable there. This is what takes the
  // undecidable population from 187 processes to 17 on a real machine, at the
  // cost of one integer already present in the tasklist output.
  test('an unreadable path in session 0 is not running (#674)', () => {
    const service = instance({ executablePath: null, sessionId: 0 })
    expect(resolveConfiguredPathState([service], CONFIGURED)).toBe('not-running')
  })

  test('a readable session 0 path at another location is not running either', () => {
    const service = instance({ executablePath: 'C:/Windows/System32/Overlay.exe', sessionId: 0 })
    expect(resolveConfiguredPathState([service], CONFIGURED)).toBe('not-running')
  })

  // Session is only ever allowed to DISMISS an instance, never to deny one that
  // positively matches. A service-hosted copy of the configured exe is still
  // the configured exe, and calling it absent would invent the mirror bug.
  test('a session 0 process AT the configured path still counts as running', () => {
    const service = instance({ sessionId: 0 })
    expect(resolveConfiguredPathState([service], CONFIGURED)).toBe('running')
  })

  // Mixed evidence resolves to the strongest signal available. One undecidable
  // instance does not get to hide a positive match.
  test('a path match wins over an undecidable sibling', () => {
    const mixed = [
      instance({ processId: 1, executablePath: null }),
      instance({ processId: 2, executablePath: 'C:/Tools/Overlay.exe' })
    ]
    expect(resolveConfiguredPathState(mixed, CONFIGURED)).toBe('running')
  })

  // ...but a collider does NOT get to dismiss an undecidable sibling. The
  // undecidable one could be the configured app running elevated, so the honest
  // answer stays `unknown` and the caller keeps its conservative branch.
  test('a collider alongside an undecidable sibling is still unknown', () => {
    const mixed = [
      instance({ processId: 1, executablePath: 'C:/UserApps/Overlay.exe' }),
      instance({ processId: 2, executablePath: null })
    ]
    expect(resolveConfiguredPathState(mixed, CONFIGURED)).toBe('unknown')
  })

  // The realistic ambient shape from the repro: many colliders, all in the user
  // session with readable paths, none of them the configured app.
  test('the measured collision shape resolves cleanly (#674)', () => {
    const ambient = Array.from({ length: 20 }, (_value, index) =>
      instance({
        name: 'cmd.exe',
        processId: 2000 + index,
        executablePath: 'C:/WINDOWS/system32/cmd.exe'
      })
    )
    expect(resolveConfiguredPathState(ambient, 'D:/ReproA/cmd.exe')).toBe('not-running')
  })
})

/**
 * The boundary where PowerShell output becomes a decision. The rule above is
 * only as good as the instances handed to it, and two of the defaults in that
 * parse are the kind that fail silently in the unsafe direction.
 */
describe('findProcessesByName parsing (#674)', () => {
  beforeEach(() => {
    execFileMock.mockReset()
  })

  function respondWith(error: Error | null, stdout: string) {
    execFileMock.mockImplementation(
      (
        _command: string,
        _args: string[],
        _options: unknown,
        callback: (error: Error | null, stdout: string, stderr: string) => void
      ) => callback(error, stdout, '')
    )
  }

  test('a record with no session is left undecidable, not dismissed as a service', async () => {
    // Session 0 is the ONE value that lets an unreadable path be dismissed, so
    // defaulting a malformed record to it would license a double launch on the
    // strength of a field that was not there. The assertion is on the verdict
    // rather than the number, because the verdict is what a caller acts on.
    respondWith(null, JSON.stringify([{ name: 'overlay.exe', processId: 1000 }]))

    const { instances, succeeded } = await findProcessesByName(['overlay.exe'])

    expect(succeeded).toBe(true)
    expect(resolveConfiguredPathState(instances, CONFIGURED)).toBe('unknown')
  })

  test('a bare object is read as a one-element result, not a parse failure', async () => {
    // The script forces an array, so this shape should not reach here. It is
    // accepted anyway because the parse must not DEPEND on that: when the array
    // guarantee broke, the symptom was not a parse error but every candidate
    // resolving `unknown`, i.e. the whole discriminator silently off.
    respondWith(
      null,
      JSON.stringify({
        name: 'overlay.exe',
        processId: 1000,
        executablePath: 'C:/Tools/Overlay.exe',
        sessionId: 1
      })
    )

    const { instances, succeeded } = await findProcessesByName(['overlay.exe'])

    expect(succeeded).toBe(true)
    expect(instances).toHaveLength(1)
    expect(resolveConfiguredPathState(instances, CONFIGURED)).toBe('running')
  })

  test('a failed enumeration is a failure, never an empty result', async () => {
    // `succeeded: false` is what makes every candidate resolve `unknown`
    // upstream. Reporting an empty instance list as a success would read as
    // "nothing is running under that name" and un-skip a running app.
    respondWith(new Error('The RPC server is unavailable.'), '')

    await expect(findProcessesByName(['overlay.exe'])).resolves.toMatchObject({
      instances: [],
      succeeded: false
    })
  })

  test('asking about nothing is a success with no spawn', async () => {
    await expect(findProcessesByName([])).resolves.toMatchObject({
      instances: [],
      succeeded: true
    })
    expect(execFileMock).not.toHaveBeenCalled()
  })
})
