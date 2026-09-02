import { beforeEach, describe, expect, test, vi } from 'vitest'

type EnumerationResult = {
  instances: { name: string; processId: number; executablePath: string | null; sessionId: number }[]
  succeeded: boolean
}

// Typed by SIGNATURE rather than by implementation, so `mock.calls` still knows
// the argument is a name array while the stub itself ignores it.
const findProcessesByName = vi.hoisted(() =>
  vi.fn<(names: string[]) => Promise<EnumerationResult>>(async () => ({
    instances: [],
    succeeded: true
  }))
)

// Only the enumeration is mocked. `resolveConfiguredPathState` is the real rule
// (pinned on its own in configuredPathState.test.ts), because the entire claim
// of this module is that it feeds THAT rule from a cheaper source. Substituting
// a stand-in here would test a second rule that happens to agree.
vi.mock('../../src/main/processes/win32KillUtils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/main/processes/win32KillUtils')>()
  return { ...actual, findProcessesByName }
})

const { resolveTrackedPathStates, resetPathResolutionCache } =
  await import('../../src/main/processes/pathResolution')

/**
 * #674, second half: answering "is my configured app running?" on the 2s poll.
 *
 * The correctness question was settled by the decision rule. What is at stake
 * here is COST. The poll runs forever, in the tray, and a design that spawns a
 * process enumeration per tick would trade one bug for a footprint regression
 * that the 1.3.0 milestone exists to avoid. So most of what follows counts
 * enumerations rather than checking verdicts.
 */
const CONFIGURED = 'C:/Tools/Overlay.exe'

function snapshot(
  processes: { name?: string; processId: number; sessionId?: number }[],
  succeeded = true,
  // Defaults to exactly the names the rows carry, which is what the real parser
  // produces. Passed explicitly only to model the one case where the two can
  // legitimately disagree: a row whose name was recorded but whose PID or
  // session would not parse, so it yields no instance.
  extraNames: string[] = []
) {
  const rows = processes.map((entry) => ({
    name: entry.name ?? 'overlay.exe',
    processId: entry.processId,
    sessionId: entry.sessionId ?? 1
  }))
  return {
    processNames: new Set([...rows.map((entry) => entry.name), ...extraNames]),
    processes: rows,
    succeeded
  }
}

function answerWith(
  instances: { name?: string; processId: number; executablePath: string | null }[]
) {
  findProcessesByName.mockResolvedValue({
    instances: instances.map((entry) => ({
      name: entry.name ?? 'overlay.exe',
      processId: entry.processId,
      executablePath: entry.executablePath,
      sessionId: 1
    })),
    succeeded: true
  })
}

beforeEach(() => {
  resetPathResolutionCache()
  findProcessesByName.mockReset()
  findProcessesByName.mockResolvedValue({ instances: [], succeeded: true })
})

describe('what the tasklist alone can decide (#674)', () => {
  test('a name nothing is running under costs no enumeration', async () => {
    const states = await resolveTrackedPathStates(snapshot([]), [CONFIGURED])

    expect(states.get(CONFIGURED)).toBe('not-running')
    expect(findProcessesByName).not.toHaveBeenCalled()
  })

  test('a session-0 process whose path is unreadable is dismissed, then never re-asked', async () => {
    // Session 0 is what makes an UNREADABLE path decidable, and that dismissal
    // is the rule's, applied to what the enumeration came back with. It is not
    // grounds to skip the enumeration: see the test below for why.
    findProcessesByName.mockResolvedValue({
      instances: [{ name: 'overlay.exe', processId: 400, executablePath: null, sessionId: 0 }],
      succeeded: true
    })
    const live = snapshot([{ processId: 400, sessionId: 0 }])

    expect((await resolveTrackedPathStates(live, [CONFIGURED])).get(CONFIGURED)).toBe('not-running')
    expect((await resolveTrackedPathStates(live, [CONFIGURED])).get(CONFIGURED)).toBe('not-running')

    // Bounded: the null is cached like any other answer, so a service costs one
    // enumeration ever rather than one per tick.
    expect(findProcessesByName).toHaveBeenCalledTimes(1)
  })

  test('a configured app hosted as a service in session 0 resolves to running (#846)', async () => {
    // The poll must not disagree with the launch and kill paths, which enumerate
    // unconditionally. Skipping session-0 pids looked like a free saving and was
    // not: their paths were then never learned, the rule's "a path match wins
    // outright, INCLUDING in session 0" branch could never fire, and a genuine
    // service-hosted match collapsed to `not-running` on the poll alone.
    findProcessesByName.mockResolvedValue({
      instances: [
        { name: 'overlay.exe', processId: 400, executablePath: CONFIGURED, sessionId: 0 }
      ],
      succeeded: true
    })

    const states = await resolveTrackedPathStates(snapshot([{ processId: 400, sessionId: 0 }]), [
      CONFIGURED
    ])

    expect(states.get(CONFIGURED)).toBe('running')
  })

  test('a session-0 pid the cooldown skipped is unknown, not dismissed (#846)', async () => {
    // The dangerous half of the cooldown. Session 0 is the one case where the
    // rule dismisses an instance whose path it does not have, and that is only
    // sound when the null means "Windows refused" rather than "nobody looked".
    // A configured app starting as a service inside a cooldown window would
    // otherwise read as stopped for 45s, and be pruned.
    answerWith([{ processId: 100, executablePath: 'C:/Elsewhere/Overlay.exe' }])
    await resolveTrackedPathStates(snapshot([{ processId: 100 }]), [CONFIGURED])
    expect(findProcessesByName).toHaveBeenCalledTimes(1)

    // Same name, brand new session-0 pid, still inside the cooldown.
    const states = await resolveTrackedPathStates(
      snapshot([{ processId: 100 }, { processId: 500, sessionId: 0 }]),
      [CONFIGURED]
    )

    expect(states.get(CONFIGURED)).toBe('unknown')
    expect(findProcessesByName).toHaveBeenCalledTimes(1)
  })

  test('a name whose row would not parse is unknown, not not-running (#846)', async () => {
    // The parser records the NAME from field 0 alone but yields no instance for
    // a row whose PID or session is malformed. The rule then sees nothing under
    // that name, which is indistinguishable from an absent process unless the
    // gap is carried explicitly.
    const states = await resolveTrackedPathStates(snapshot([], true, ['overlay.exe']), [CONFIGURED])

    expect(states.get(CONFIGURED)).toBe('unknown')
  })

  test('a failed snapshot answers nothing rather than answering wrongly', async () => {
    const states = await resolveTrackedPathStates(snapshot([], false), [CONFIGURED])

    expect(states.size).toBe(0)
    expect(findProcessesByName).not.toHaveBeenCalled()
  })
})

describe('resolving an unfamiliar pid (#674)', () => {
  test('a pid at the configured path resolves to running', async () => {
    answerWith([{ processId: 100, executablePath: CONFIGURED }])

    const states = await resolveTrackedPathStates(snapshot([{ processId: 100 }]), [CONFIGURED])

    expect(states.get(CONFIGURED)).toBe('running')
    expect(findProcessesByName).toHaveBeenCalledTimes(1)
  })

  test('a pid at another path is the collision, and resolves to not-running', async () => {
    answerWith([{ processId: 100, executablePath: 'C:/Elsewhere/Overlay.exe' }])

    const states = await resolveTrackedPathStates(snapshot([{ processId: 100 }]), [CONFIGURED])

    expect(states.get(CONFIGURED)).toBe('not-running')
  })

  test('a pid whose path Windows withholds stays unknown (#390)', async () => {
    answerWith([{ processId: 100, executablePath: null }])

    const states = await resolveTrackedPathStates(snapshot([{ processId: 100 }]), [CONFIGURED])

    expect(states.get(CONFIGURED)).toBe('unknown')
  })

  test('several configured paths are resolved in one enumeration', async () => {
    answerWith([
      { processId: 100, executablePath: CONFIGURED },
      { name: 'launcher.exe', processId: 200, executablePath: 'C:/Tools/Launcher.exe' }
    ])

    await resolveTrackedPathStates(
      snapshot([{ processId: 100 }, { name: 'launcher.exe', processId: 200 }]),
      [CONFIGURED, 'C:/Tools/Launcher.exe']
    )

    expect(findProcessesByName).toHaveBeenCalledTimes(1)
    expect(findProcessesByName.mock.calls[0]![0].sort()).toEqual(['launcher.exe', 'overlay.exe'])
  })
})

describe('the cost guarantee: steady state is free (#674)', () => {
  test('a resolved pid is never asked about again', async () => {
    // THE property this design exists for. The poll ticks every 2s forever; if
    // a known pid cost an enumeration each time, this fix would be a footprint
    // regression wearing a bugfix.
    answerWith([{ processId: 100, executablePath: CONFIGURED }])
    const live = snapshot([{ processId: 100 }])

    await resolveTrackedPathStates(live, [CONFIGURED])
    expect(findProcessesByName).toHaveBeenCalledTimes(1)

    for (let tick = 0; tick < 20; tick += 1) {
      const states = await resolveTrackedPathStates(live, [CONFIGURED])
      expect(states.get(CONFIGURED)).toBe('running')
    }

    expect(findProcessesByName).toHaveBeenCalledTimes(1)
  })

  test('an unreadable path is a cached ANSWER, not a permanent question', async () => {
    // The case that would otherwise never converge: an elevated process hides
    // its path and will keep hiding it, so "we asked and were refused" has to be
    // remembered as firmly as a path would be. Treating a null as "not yet
    // asked" would make every elevated process a permanent source of spawns.
    answerWith([{ processId: 100, executablePath: null }])
    const live = snapshot([{ processId: 100 }])

    await resolveTrackedPathStates(live, [CONFIGURED])
    await resolveTrackedPathStates(live, [CONFIGURED])
    const states = await resolveTrackedPathStates(live, [CONFIGURED])

    expect(states.get(CONFIGURED)).toBe('unknown')
    expect(findProcessesByName).toHaveBeenCalledTimes(1)
  })

  test('a churning name costs at most one enumeration per cooldown window', async () => {
    // `cmd.exe` on a developer machine reaches ~30 spawns a minute. "Resolve
    // unfamiliar pids" is unbounded against that, because every tick brings new
    // ones, so the cooldown is what stops the pathological case from undoing
    // the guarantee above.
    answerWith([{ processId: 1, executablePath: 'C:/Elsewhere/Overlay.exe' }])

    for (let tick = 0; tick < 10; tick += 1) {
      await resolveTrackedPathStates(snapshot([{ processId: 1000 + tick }]), [CONFIGURED])
    }

    expect(findProcessesByName).toHaveBeenCalledTimes(1)
  })
})

describe('invalidation is the pid, not a clock (#674)', () => {
  test('a pid that leaves the snapshot loses its cached path', async () => {
    // Windows does not move a running image, so a path stays true for exactly
    // as long as its pid lives. That makes the invalidation exact where a TTL
    // would be guesswork in both directions: expiring answers that are still
    // true, and keeping ones that are not.
    answerWith([{ processId: 100, executablePath: CONFIGURED }])
    await resolveTrackedPathStates(snapshot([{ processId: 100 }]), [CONFIGURED])
    expect(findProcessesByName).toHaveBeenCalledTimes(1)

    // The pid is gone, and Windows later hands the same NUMBER to something
    // else at a different path. A cache that kept the old entry would answer
    // "running" for a process that is not ours.
    await resolveTrackedPathStates(snapshot([]), [CONFIGURED])
    answerWith([{ processId: 100, executablePath: 'C:/Elsewhere/Overlay.exe' }])
    const states = await resolveTrackedPathStates(snapshot([{ processId: 100 }]), [CONFIGURED])

    expect(states.get(CONFIGURED)).toBe('not-running')
  })

  test('a failed read does not flush what is already known', async () => {
    // A failed snapshot is not evidence that every process ended (#399).
    // Reconciling against it would empty the cache and buy back every
    // enumeration at the worst possible moment.
    answerWith([{ processId: 100, executablePath: CONFIGURED }])
    const live = snapshot([{ processId: 100 }])
    await resolveTrackedPathStates(live, [CONFIGURED])

    await resolveTrackedPathStates(snapshot([], false), [CONFIGURED])

    const states = await resolveTrackedPathStates(live, [CONFIGURED])
    expect(states.get(CONFIGURED)).toBe('running')
    expect(findProcessesByName).toHaveBeenCalledTimes(1)
  })

  test('a failed enumeration records no verdict, but still rate-limits the retry', async () => {
    // Two separable concerns, and collapsing them costs one of the other. A
    // failure teaches nothing, so nothing may be cached and the answer stays
    // honestly `unknown`. But a PERSISTENT failure (PowerShell missing, WMI
    // wedged) retried on every 2s tick would spawn forever, which is the
    // footprint regression this module exists to avoid.
    findProcessesByName.mockResolvedValue({ instances: [], succeeded: false })
    const live = snapshot([{ processId: 100 }])

    const first = await resolveTrackedPathStates(live, [CONFIGURED])
    expect(first.get(CONFIGURED)).toBe('unknown')

    // No verdict was cached: were the cooldown lifted, this would resolve.
    answerWith([{ processId: 100, executablePath: CONFIGURED }])
    const second = await resolveTrackedPathStates(live, [CONFIGURED])
    expect(second.get(CONFIGURED)).toBe('unknown')
    expect(findProcessesByName).toHaveBeenCalledTimes(1)
  })
})
