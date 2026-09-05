import path from 'path'
import { execFile } from 'node:child_process'

import { beforeAll, describe, expect, test } from 'vitest'

import { readRunningProcessNames } from '../../src/main/processes/tasklist'
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

/**
 * Both hooks and tests below run on a 30s budget; the warm-up child gets less.
 *
 * The gap is the point, not a rounding choice. `execFile` only STARTS killing a
 * hung child when its own timeout expires, and the callback arrives after that.
 * Give the child the same 30s as the hook and the kill begins exactly as Vitest
 * gives up, so a warm-up that hangs fails the suite — on precisely the slow host
 * the warm-up exists to tolerate, and by way of the one path that is supposed to
 * be fail-open. Raised by Codex on #927.
 *
 * 10s of slack is far more than terminating a process and delivering a callback
 * needs. The warm-up runs the same query the tests do, and on the worst run on
 * record (#914, 09-04 08:56) that query was killed at the 10s production budget
 * twice in a row, so 20s is room to finish even then. If it still cannot, the
 * kill at 20s is swallowed like every other warm-up failure.
 */
const HOOK_TIMEOUT_MS = 30_000
const WARMUP_TIMEOUT_MS = 20_000

/**
 * Start a throwaway PowerShell so the first measured call does not pay for it.
 *
 * The production budget is per call and the first `powershell.exe` on a cold CI
 * runner has exceeded it five times across four days (08-21, 09-01, 09-02 and
 * twice on 09-04, #914). Later spawns in the same job land at four to six
 * seconds, so what the assertions were measuring was start-up, not the shipped
 * script.
 *
 * Deliberately the same invocation as production (`win32KillUtils.ts`, the
 * `-NoProfile -NonInteractive -ExecutionPolicy Bypass` form), and deliberately
 * the same QUERY. `-Command exit` loads the host and stops there; the shipped
 * script also auto-loads CimCmdlets and MMI and makes a first call into the WMI
 * provider, every one of which is cold too. Warming only the host would have
 * warmed a different thing, which is the argument this warm-up rests on.
 *
 * Failures here are swallowed on purpose. This is an optimisation, not a gate:
 * if the warm-up cannot run, the tests should still run and fail on their own
 * terms rather than on this.
 */
async function warmPowerShellHost(): Promise<void> {
  await new Promise<void>((resolve) => {
    const child = execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        'Get-CimInstance Win32_Process -Property Name,ProcessId | Out-Null'
      ],
      { timeout: WARMUP_TIMEOUT_MS, windowsHide: true },
      () => resolve()
    )
    child.on('error', () => resolve())
  })
}

describeWindows('findProcessesByName against the real PowerShell host (#674)', () => {
  // PowerShell startup dominates, so the budget is per CALL, not per test. The
  // production budget is PROCESS_ENUMERATION_TIMEOUT_MS (10s), and the longest
  // test below makes two calls, so the worst case a passing run can reach is
  // 20s. The ceiling sits above that without being so high it hides a hang.
  //
  // Not the 3s WMI_LOOKUP_TIMEOUT_MS: that belongs to the path-scoped lookup,
  // and this comment cited it until the enumeration was given its own budget
  // (CodeRabbit on #845).
  const TIMEOUT_MS = HOOK_TIMEOUT_MS

  beforeAll(warmPowerShellHost, HOOK_TIMEOUT_MS)

  // Pins the relationship rather than the numbers. Both were 30_000 when this
  // shipped, which meant a hung warm-up started its kill exactly as the hook
  // gave up and could fail the suite from the one path meant to be fail-open.
  // Editing either constant back into a tie should go red here, not in CI on a
  // cold runner three weeks later.
  test('the warm-up budget leaves the hook room to collect it', () => {
    expect(WARMUP_TIMEOUT_MS).toBeLessThan(HOOK_TIMEOUT_MS - 5_000)
  })

  test(
    'the shipped script runs and returns an array for zero, one and many matches',
    async () => {
      // Zero. The name cannot exist, so this pins the empty shape rather than
      // the absence of a spawn.
      //
      // Timed, and the elapsed time is in the failure message on purpose. A
      // bare `expected false to be true` sent three separate people to the job
      // log to find out whether the script was broken or the runner was slow
      // (#914). An elapsed time at or near the 10s production budget says
      // timeout; anything well under it says the script itself failed.
      const startedAt = Date.now()
      const none = await findProcessesByName(['simlauncher-no-such-process.exe'])
      const elapsedMs = Date.now() - startedAt

      expect(
        none.succeeded,
        `enumeration reported failure after ${elapsedMs}ms. At or near PROCESS_ENUMERATION_TIMEOUT_MS (10000) this is a slow host, not a broken script: see #914. Well under it means the script failed and stderr carries the reason.`
      ).toBe(true)
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

/**
 * The same discipline for `tasklist` (#674, second half). The poll now reads
 * PID and Session# out of this snapshot, so the parser is load-bearing in a way
 * it never was while it kept one column: a shape it mishandles does not throw,
 * it just yields fewer instances, and fewer instances resolve to `not-running`
 * — an app the user IS running would disappear from the strip.
 */
describeWindows('readRunningProcessNames against the real tasklist (#674)', () => {
  const TIMEOUT_MS = 30_000

  test(
    'the real snapshot parses into names AND instances, including this process',
    async () => {
      const { processNames, processes, succeeded } = await readRunningProcessNames()

      expect(succeeded).toBe(true)
      const self = path.basename(process.execPath).toLowerCase()
      expect(processNames.has(self)).toBe(true)

      // Every row that produced a NAME should also produce an instance. A gap
      // between the two means the extra columns are being dropped somewhere,
      // which is the silent half of this failure mode.
      expect(new Set(processes.map((entry) => entry.name))).toEqual(processNames)

      const mine = processes.filter((entry) => entry.name === self)
      expect(mine.length).toBeGreaterThan(0)
      expect(mine.some((entry) => entry.processId === process.pid)).toBe(true)
      mine.forEach((entry) => {
        expect(Number.isInteger(entry.sessionId)).toBe(true)
      })
    },
    TIMEOUT_MS
  )

  test(
    'session 0 is populated, which is the half of the discriminator that is free',
    async () => {
      // The services session is what lets an unreadable path be dismissed with
      // no enumeration at all. If this came back empty, the column being read
      // would be the wrong one (`Session Name` is localized text, `Session#` is
      // the number) and the cheap path would silently stop applying.
      const { processes, succeeded } = await readRunningProcessNames()

      expect(succeeded).toBe(true)
      expect(processes.some((entry) => entry.sessionId === 0)).toBe(true)
      expect(processes.some((entry) => entry.sessionId !== 0)).toBe(true)
    },
    TIMEOUT_MS
  )
})
