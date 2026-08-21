/**
 * Answering "is my configured app running?" on the 2s poll, without paying for
 * a process enumeration on every tick (#674, second half).
 *
 * The launch and kill paths can afford `findProcessesByName` outright: they are
 * user actions that already spawn PowerShell. The poll cannot. It runs forever,
 * in the tray, and adding a spawn per tick would cut straight against the
 * 1.3.0 footprint milestone.
 *
 * Three things make the cheap version possible, in order of how much they buy:
 *
 *   1. **The tasklist already carries PID and session.** Both were being parsed
 *      and discarded. Session 0 is the non-interactive services session, so an
 *      instance there whose path Windows will not disclose is still decidable,
 *      which on a real machine covers 170 of 537 processes. That dismissal
 *      belongs to the decision rule, not to this module: a session-0 instance AT
 *      the configured path is genuinely running, so session is only ever grounds
 *      to discard an instance, never grounds to skip looking at one.
 *   2. **A path, once learned for a PID, stays true for that PID's lifetime.**
 *      Windows does not move a running image, so the only invalidation needed
 *      is the PID leaving the tasklist. No TTL, and no revalidation.
 *   3. **"Windows will not tell us" is itself an answer worth caching.** An
 *      elevated process hides its path from a non-elevated SimLauncher and will
 *      keep hiding it, so a null result is stored rather than retried. Without
 *      this the pathological cases never converge.
 *
 * Together those give the property this design exists for: **in steady state
 * the poll spawns nothing extra.** A resolution happens when an unfamiliar PID
 * appears under a name we care about, which is a launch, not a tick.
 *
 * The DECISION is not re-implemented here. `resolveConfiguredPathState` in
 * `win32KillUtils` is the one rule, and this module's whole job is to feed it
 * the same `NamedProcessInstance` shape from a cheaper source. Two rules that
 * agreed by convention is exactly what #149 was about.
 */
import { performance } from 'perf_hooks'

import { getExeName } from '../utils'

import type { TasklistProcess } from './tasklist'
import {
  type ConfiguredPathState,
  type NamedProcessInstance,
  findProcessesByName,
  resolveConfiguredPathState
} from './win32KillUtils'

/**
 * How long before the same image name may cost another enumeration.
 *
 * Point 3 above converges the ordinary case on its own, so this is not the
 * mechanism that makes the poll cheap. It bounds the one case that cannot
 * converge: a name that keeps producing NEW pids. On a developer machine
 * `cmd.exe` reaches roughly 30 spawns a minute, and "resolve unfamiliar pids"
 * would chase every one of them. With the cooldown that name costs at most one
 * enumeration per window, and the pids it did not get to are simply still
 * unknown, which the decision rule already handles conservatively.
 */
const NAME_RESOLUTION_COOLDOWN_MS = 45000

/**
 * PID to executable path.
 *
 * PRESENCE means resolved. A `null` VALUE is a resolved answer, "we asked and
 * Windows would not say", and must not be retried; a missing key is "we have
 * not asked". Collapsing those two is what would turn every elevated process
 * into a permanent source of enumerations.
 */
const resolvedPidPaths = new Map<number, string | null>()
/** Image name to the monotonic timestamp of its last enumeration. */
const nameResolvedAt = new Map<string, number>()

/** Test seam. Production never needs this: the maps self-prune from the poll. */
export function resetPathResolutionCache(): void {
  resolvedPidPaths.clear()
  nameResolvedAt.clear()
}

/**
 * Drop everything the latest snapshot says is gone.
 *
 * A PID that is no longer running cannot be running at a different path, so an
 * entry the snapshot does not list is definitively dead. A TTL as the PRIMARY
 * mechanism would be strictly worse, expiring answers that are still true and
 * keeping ones that are not.
 *
 * KNOWN RESIDUAL, recorded on its own issue (Codex P2 on #846). This is exact
 * only for a pid whose absence we OBSERVE, and the poll samples rather than
 * watches: a cached process can exit and Windows can reuse its number before the
 * next snapshot, in which case the pid never appears absent and keeps the old
 * path. Three things have to line up for that to matter, because `buildInstances`
 * takes the NAME from the live snapshot and only the path from here, so a
 * reused pid under a different image name is filtered out by the rule and is
 * harmless. It needs the same pid, reused inside one tick, by a process with the
 * same image name. The fix is a stronger identity than the number alone
 * (creation time, which `tasklist` does not carry) or a long revalidation
 * window, and neither belongs in this issue.
 *
 * ONLY call this for a snapshot that actually succeeded. A failed read yields an
 * empty snapshot, and treating that as "every process ended" would flush the
 * whole cache and buy back all the enumerations at the worst moment (#399).
 */
function reconcileResolvedPaths(processes: TasklistProcess[]): void {
  const livePids = new Set(processes.map((entry) => entry.processId))
  resolvedPidPaths.forEach((_path, pid) => {
    if (!livePids.has(pid)) {
      resolvedPidPaths.delete(pid)
    }
  })

  const liveNames = new Set(processes.map((entry) => entry.name))
  nameResolvedAt.forEach((_at, name) => {
    // A name with nothing running has no pids to resolve, so its cooldown is
    // holding back an enumeration that would not happen anyway. Clearing it
    // means the NEXT appearance of that name is answered promptly instead of
    // inheriting a stale timer from a previous run of the app.
    if (!liveNames.has(name)) {
      nameResolvedAt.delete(name)
    }
  })
}

/**
 * The tasklist snapshot expressed as the shape the decision rule consumes,
 * enriched with whatever paths are already known.
 *
 * An unresolved PID becomes `executablePath: null`, which is the same thing the
 * enumeration reports for a path Windows withholds. That is deliberate and it
 * is what keeps the rule honest: both mean "this instance cannot be ruled out",
 * so both land on `unknown` and the caller keeps its pre-#674 behaviour.
 */
function buildInstances(processes: TasklistProcess[]): NamedProcessInstance[] {
  return processes.map((entry) => ({
    name: entry.name,
    processId: entry.processId,
    executablePath: resolvedPidPaths.get(entry.processId) ?? null,
    sessionId: entry.sessionId
  }))
}

/**
 * Image names holding a pid we have never resolved, and that are off cooldown,
 * i.e. the names worth spending one enumeration on.
 *
 * A pid with a stored path is excluded, and so is one with a stored `null`,
 * because asking again would get the same refusal. What is left is genuinely
 * unfamiliar.
 *
 * Session 0 is deliberately NOT a reason to skip, though it looks like an easy
 * saving and was one until the review bot on #846 took it apart. Dismissing a
 * session-0 instance is the RULE's job, and the rule only dismisses one whose
 * path it could not read: a session-0 instance AT the configured path is
 * `running`, because a service-hosted copy of the configured exe is still the
 * configured exe. Skipping it here meant its path was never learned, so that
 * branch could not fire and the answer collapsed to `not-running` — while the
 * launch and kill paths, which enumerate unconditionally, said `running`. This
 * module's whole claim is that it feeds the SAME rule from a cheaper source, and
 * a cheaper source that changes the answer is not that.
 *
 * The saving it appeared to buy was mostly illusory anyway. It only applied to a
 * configured app whose name collides with a service, and a resolved pid stays
 * resolved for its lifetime — services being long-lived, that is one enumeration
 * ever, not one per tick. The steady-state guarantee is untouched.
 */
function collectNamesWorthResolving(
  processes: TasklistProcess[],
  wantedNames: Set<string>,
  now: number
): string[] {
  const names = new Set<string>()

  processes.forEach((entry) => {
    if (!wantedNames.has(entry.name)) {
      return
    }
    if (resolvedPidPaths.has(entry.processId)) {
      return
    }
    const lastResolvedAt = nameResolvedAt.get(entry.name)
    if (lastResolvedAt !== undefined && now - lastResolvedAt < NAME_RESOLUTION_COOLDOWN_MS) {
      return
    }
    names.add(entry.name)
  })

  return Array.from(names)
}

/**
 * Whether anything about this image name is still unaccounted for, in which
 * case `not-running` is a claim the evidence does not support.
 *
 * The shared rule reasons about the instances it is GIVEN. This module builds
 * those instances from a snapshot that can be incomplete in two ways the rule
 * cannot see, and in both of them a missing instance is indistinguishable from
 * an absent process (both CodeRabbit, on #846):
 *
 *   1. **A pid nobody has resolved.** `buildInstances` gives it a null path,
 *      which for a SESSION 0 pid the rule dismisses outright — correctly, when
 *      the null means "Windows refused", and wrongly when it only means "the
 *      cooldown skipped it". A configured app starting as a service inside a
 *      cooldown window would read as stopped, and be pruned.
 *   2. **A row the parser could not turn into an instance.** The name is still
 *      recorded as running, deliberately, but there is no instance to reason
 *      about, so the rule sees nothing at all under that name.
 *
 * Both collapse to the same rule: not having looked is not the same as having
 * looked and found nothing, and only the second may answer `not-running`.
 */
function hasUnaccountedEvidence(
  processNames: Set<string>,
  processes: TasklistProcess[],
  targetName: string
): boolean {
  if (!processNames.has(targetName)) {
    // Nothing is running under this name, which is a fact rather than a gap.
    return false
  }

  const named = processes.filter((entry) => entry.name === targetName)
  if (named.length === 0) {
    return true
  }

  return named.some((entry) => !resolvedPidPaths.has(entry.processId))
}

/**
 * Decide, for each configured path, whether it is running, using the snapshot
 * the poll already paid for and resolving unfamiliar pids at most once.
 *
 * `succeeded === false` short-circuits to an empty map rather than an answer.
 * Every caller reads a missing entry the way it read the pre-#674 world, so a
 * failed read changes nothing rather than emptying the strip.
 */
export async function resolveTrackedPathStates(
  snapshot: { processNames: Set<string>; processes: TasklistProcess[]; succeeded: boolean },
  configuredPaths: string[]
): Promise<Map<string, ConfiguredPathState>> {
  const states = new Map<string, ConfiguredPathState>()

  if (!snapshot.succeeded || configuredPaths.length === 0) {
    return states
  }

  reconcileResolvedPaths(snapshot.processes)

  const wantedNames = new Set(configuredPaths.map((configuredPath) => getExeName(configuredPath)))
  const namesToResolve = collectNamesWorthResolving(
    snapshot.processes,
    wantedNames,
    performance.now()
  )

  if (namesToResolve.length > 0) {
    const { instances, succeeded } = await findProcessesByName(namesToResolve)

    // The cooldown is stamped whether or not the enumeration worked, and the
    // two halves are deliberately separate. A failure teaches nothing, so no
    // path is cached and the ANSWER stays honestly `unknown`. But retrying a
    // broken enumeration on every 2s tick is exactly the footprint regression
    // this module exists to avoid: a persistent failure (PowerShell missing,
    // WMI wedged) would spawn forever. Rate-limiting the retry and refusing to
    // record a verdict are different concerns, and conflating them costs one or
    // the other.
    const now = performance.now()
    namesToResolve.forEach((name) => nameResolvedAt.set(name, now))

    if (succeeded) {
      // Recorded for every pid the enumeration saw, including the ones whose
      // path it would not disclose, so those stop being asked about at all.
      instances.forEach((instance) => {
        resolvedPidPaths.set(instance.processId, instance.executablePath)
      })
    }
  }

  const enriched = buildInstances(snapshot.processes)
  configuredPaths.forEach((configuredPath) => {
    const state = resolveConfiguredPathState(enriched, configuredPath)
    // Only ever weakens `not-running`, never a positive answer: a path match is
    // evidence in its own right and outranks anything still unaccounted for.
    const downgrade =
      state === 'not-running' &&
      hasUnaccountedEvidence(snapshot.processNames, snapshot.processes, getExeName(configuredPath))
    states.set(configuredPath, downgrade ? 'unknown' : state)
  })

  return states
}

/**
 * Whether a configured path should be treated as running, folding `unknown` and
 * "no answer" into "yes".
 *
 * Same conservative reading as the launch and kill paths, and for the same
 * reason: a missing entry means the poll could not observe, and an absence of
 * observation must never remove something the user can see.
 */
export function isTrackedPathRunning(state: ConfiguredPathState | undefined): boolean {
  return state !== 'not-running'
}
