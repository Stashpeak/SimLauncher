import { isBareExeName } from '../../../shared/path'

import type { RunningApp } from '../hooks/useRunningApps'

// Windows paths are case-insensitive, but the main process may return them in
// any case (process snapshots vs. settings-stored paths), so compare lowercased.
const normalize = (path: string): string => path.toLowerCase()

/**
 * True when the game's OWN executable (its configured path) is among the running
 * apps for this game key — i.e. the game itself is running, as opposed to only
 * companion apps being up.
 *
 * This is deliberately narrower than `runningStatus[key]`, which is an aggregate
 * that is also true when only a companion (e.g. SimHub) is running. The green
 * status dot and the "now running" announcement both mean "the game is running",
 * so both derive from this — keeping them in agreement (#587).
 *
 * Note: launcher / secondary-watch games where the in-session executable is not
 * `gamePaths[key]` (iRacing via its UI, AC via Content Manager) are out of scope
 * here and handled by the running-state pass (#585/#586).
 */
export function findGameExeRunningApp<T extends Pick<RunningApp, 'path' | 'gameKey'>>(
  runningApps: T[],
  gameKey: string,
  gamePath: string | undefined
): T | undefined {
  if (!gamePath) return undefined
  const target = normalize(gamePath)
  return runningApps.find((app) => app.gameKey === gameKey && normalize(app.path) === target)
}

export function isGameExeRunning(
  runningApps: Pick<RunningApp, 'path' | 'gameKey'>[],
  gameKey: string,
  gamePath: string | undefined
): boolean {
  return !!findGameExeRunningApp(runningApps, gameKey, gamePath)
}

/**
 * Whether a running-strip entry is something Close Apps could actually close.
 *
 * `getProfileCompanionTargets` (src/main/processes/kill.ts) drops every entry
 * that is not path-scoped, because a name-scoped one is the GAME under a name
 * we do not hold as a game path and Close Apps promises never to close the game
 * (#929). The row has to make the same distinction: it derives its Close Apps
 * affordance from what is in the strip, and counting an entry the kill path
 * refuses offered a red Close Apps that closed nothing — and, because that
 * button REPLACES the primary rather than adding to it, took the row's Launch
 * button with it (#947).
 *
 * Shape alone cannot decide it, though (Codex P2 on #950). A bare name also
 * reaches the strip when a curated `/IM` target such as the Garage61 agent
 * fails to close: `registerUnclosedProcess` records the image name where a path
 * would go, and the kill path still targets it. So the refusal is keyed to the
 * rule kill.ts actually applies, a bare name the profile lists under "Secondary
 * executables to watch", not to every bare name. Residual: a curated name the
 * user ALSO lists as a secondary reads as refused here while kill.ts would
 * close it; the ambient Close control (`canCloseLeftovers`) still covers that.
 *
 * Deliberately narrower than "is this the game": it asks only whether the entry
 * is closable, so it cannot widen what the row offers. How the strip should
 * represent a name-scoped entry at all is #946, and this predicate does not
 * decide it — the chip stays where it is.
 */
export function isClosableStripEntry(
  app: Pick<RunningApp, 'path'>,
  nameScopedSecondaries: ReadonlySet<string>
): boolean {
  return !isBareExeName(app.path) || !nameScopedSecondaries.has(app.path.trim().toLowerCase())
}

/**
 * The active profile's "Secondary executables to watch" entries that are bare
 * image names, keyed the way main dedupes them in `getProfileTrackablePaths`
 * (trimmed, lowercased). These are exactly the entries
 * `getProfileCompanionTargets` refuses, and the only bare names the row must not
 * count as closable.
 *
 * Takes `unknown` on purpose: a legacy or hand-edited config can hold anything
 * in this field, and the store validates only the outer `profiles` object. Main
 * reads it through the same `Array.isArray` guard (`getProfileTrackablePaths`),
 * so one malformed profile cannot break the Games view here (Codex P2 on #950).
 */
export function getNameScopedSecondaries(trackedProcessPaths: unknown): Set<string> {
  const entries: unknown[] = Array.isArray(trackedProcessPaths) ? trackedProcessPaths : []
  return new Set(
    entries
      .filter((entry): entry is string => isBareExeName(entry))
      .map((entry) => entry.trim().toLowerCase())
  )
}
