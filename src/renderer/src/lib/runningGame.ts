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
export function isGameExeRunning(
  runningApps: Pick<RunningApp, 'path' | 'gameKey'>[],
  gameKey: string,
  gamePath: string | undefined
): boolean {
  if (!gamePath) return false
  const target = normalize(gamePath)
  return runningApps.some((app) => app.gameKey === gameKey && normalize(app.path) === target)
}
