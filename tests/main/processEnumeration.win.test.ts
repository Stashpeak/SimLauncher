import path from 'path'

import { describe, expect, test } from 'vitest'

import {
  findProcessesByName,
  resolveConfiguredPathState
} from '../../src/main/processes/win32KillUtils'

/**
 * The only test in the suite that actually runs the PowerShell the app ships.
 *
 * Everything else mocks `child_process`, which means every assertion about the
 * enumeration is really an assertion about the mock. That gap is not
 * theoretical: the first version of this script used `ConvertTo-Json -AsArray`,
 * a PowerShell 6+ parameter. On Windows PowerShell 5.1 — which is what
 * `powershell.exe` always is — it fails at runtime with a parameter-binding
 * error, `findProcessesByName` reports `succeeded: false`, every candidate
 * resolves `unknown`, and the whole #674 discriminator degrades to exactly the
 * name-only behaviour it exists to replace. 776 mocked tests were green.
 *
 * A failure here is therefore never cosmetic: it means the feature is off in
 * production while the rest of the suite still passes.
 *
 * Windows-only by necessity, not by convenience. CI's `test` job runs on
 * windows-latest, so this is a live gate there; a developer on another OS
 * simply cannot exercise it.
 */
const describeWindows = process.platform === 'win32' ? describe : describe.skip

describeWindows('findProcessesByName against the real PowerShell host (#674)', () => {
  // PowerShell startup dominates, so the budget is per CALL, not per test. The
  // production budget is PROCESS_ENUMERATION_TIMEOUT_MS (10s), and the longest
  // test below makes two calls, so the worst case a passing run can reach is
  // 20s. The ceiling sits above that without being so high it hides a hang.
  //
  // Not the 3s WMI_LOOKUP_TIMEOUT_MS: that belongs to the path-scoped lookup,
  // and this comment cited it until the enumeration was given its own budget
  // (CodeRabbit on #845).
  const TIMEOUT_MS = 30_000

  test(
    'the shipped script runs and returns an array for zero, one and many matches',
    async () => {
      // Zero. The name cannot exist, so this pins the empty shape rather than
      // the absence of a spawn.
      const none = await findProcessesByName(['simlauncher-no-such-process.exe'])
      expect(none.succeeded).toBe(true)
      expect(none.instances).toEqual([])

      // One and many at once. The single-match case is the one PowerShell
      // unrolls to a scalar if the array is not forced, so it is the reason
      // this test exists in this shape.
      const self = path.basename(process.execPath).toLowerCase()
      const some = await findProcessesByName([self])
      expect(some.succeeded).toBe(true)
      expect(Array.isArray(some.instances)).toBe(true)
      expect(some.instances.length).toBeGreaterThan(0)
      expect(some.instances[0]).toMatchObject({
        name: self,
        processId: expect.any(Number),
        sessionId: expect.any(Number)
      })
    },
    TIMEOUT_MS
  )

  test(
    'the decision rule finds this very process at its own path',
    async () => {
      // End to end: spawn, parse, normalize, decide. The test runner is itself
      // a running process at a path we know exactly, so `running` is the only
      // correct answer and any break in that chain produces a different one.
      const self = path.basename(process.execPath).toLowerCase()
      const { instances, succeeded } = await findProcessesByName([self])

      expect(succeeded).toBe(true)
      expect(resolveConfiguredPathState(instances, process.execPath)).toBe('running')
    },
    TIMEOUT_MS
  )

  test(
    'a same-named process at another path is not running',
    async () => {
      // The collision, against live data. Same image name, a path nothing is
      // at. `unknown` would be a failure here too: this process IS readable, so
      // the rule has the evidence to decide.
      const self = path.basename(process.execPath).toLowerCase()
      const { instances, succeeded } = await findProcessesByName([self])

      expect(succeeded).toBe(true)
      expect(resolveConfiguredPathState(instances, `C:/SimLauncher-No-Such-Dir/${self}`)).toBe(
        'not-running'
      )
    },
    TIMEOUT_MS
  )
})
