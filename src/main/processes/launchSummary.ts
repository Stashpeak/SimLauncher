import { GAMES } from '../../shared/domain/registries'

/**
 * Wording for the launch summary toast. Pure functions, kept out of `spawn.ts`
 * so the sentences can be pinned on their own terms and the sequence stays
 * inside its code-line budget (#918). Exported for `spawn.ts` and its unit
 * tests, not part of the processes barrel surface.
 */

export interface LaunchSummaryDetails {
  /**
   * Display name of the game when it was among the already-running entries.
   * The game is named as the game and left out of the app count: a launch
   * pressed while the sim is up used to say "Started 3 apps; skipped 1 already
   * running", which reads as a fourth app nobody configured (#897).
   */
  skippedGameName?: string
  /**
   * Display name of the game when this sequence started it. The mirror of
   * `skippedGameName`: without it a launch that started the game said "Started 3
   * apps" for a game and two companions (#952). Only a start known to have
   * happened: a game still behind an unanswered consent prompt is counted in
   * `awaitingElevationCount` instead.
   */
  startedGameName?: string
  /**
   * Elevated handoffs whose consent prompt was still unanswered when the
   * sequence ended. `launchedCount` keeps counting them, because the cooldown
   * it drives has to cover a late approval; the sentence gives them their own
   * clause instead of folding them into "Started N apps" (#897).
   */
  awaitingElevationCount?: number
}

/** The registry name for a game key, or the key itself for one it does not know. */
export function getGameDisplayName(gameKey: string): string {
  return GAMES.find((game) => game.key === gameKey)?.name ?? gameKey
}

function countOf(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

/**
 * The already-running clause. With the game among the entries it is named and
 * the number that remains is the companions; without it the wording is the
 * pre-#897 one, in both of its shapes.
 */
function describeAlreadyRunning(
  skippedCount: number,
  skippedGameName: string | undefined,
  anythingStarted: boolean
): string | undefined {
  if (skippedGameName) {
    const companions = Math.max(skippedCount - 1, 0)
    return companions === 0
      ? `${skippedGameName} was already running`
      : `${skippedGameName} and ${countOf(companions, 'app')} were already running`
  }
  if (skippedCount === 0) {
    return undefined
  }
  return anythingStarted
    ? `skipped ${skippedCount} already running`
    : `${skippedCount} ${skippedCount === 1 ? 'was' : 'were'} already running`
}

/**
 * The opening clause. A game this sequence started is named the way an
 * already-running one is (#897), and the number that remains is the companions.
 * A game that started on its own is never "and 0 apps" (#952).
 */
function describeStarted(startedCount: number, startedGameName: string | undefined): string {
  if (startedGameName) {
    return startedCount === 0
      ? `Started ${startedGameName}`
      : `Started ${startedGameName} and ${countOf(startedCount, 'app')}`
  }
  return startedCount === 0 ? 'No apps were started' : `Started ${countOf(startedCount, 'app')}`
}

/**
 * Wording for a sequence that finished with no failures and no kill.
 *
 * `skippedCount` and `missingCount` are two different senses of "skipped" (see
 * LaunchResult): the first is "already running", the second is entries filtered
 * out before spawn for an invalid or missing path. The renderer concatenates the
 * skip warning naming those missing entries onto this string, so claiming "All"
 * while `missingCount > 0` produces a toast that contradicts itself in
 * consecutive sentences (#739).
 *
 * Assembled as clauses rather than nested ternaries, because the ordering IS
 * the logic and both review bots found a wrong branch in the ternary version
 * (#795).
 */
export function buildLaunchSummaryMessage(
  launchedCount: number,
  skippedCount: number,
  missingCount: number,
  details: LaunchSummaryDetails = {}
): string {
  const awaiting = details.awaitingElevationCount ?? 0
  const startedGame = details.startedGameName
  // The companions that actually started, as opposed to what this sequence
  // handed to a prompt it never saw answered, and to the game, which is named
  // rather than counted (#952).
  const startedCount = Math.max(launchedCount - awaiting - (startedGame ? 1 : 0), 0)
  const anythingStarted = startedCount > 0 || startedGame !== undefined

  // Nothing started is reachable without failing or being cancelled:
  // launchedCount subtracts elevated handoffs cancelled by a kill that did not
  // abort this sequence's controller (the `except: launchController` path used
  // by switch-profile-apps). "Started 0 apps" is never emitted.
  const clauses = [describeStarted(startedCount, startedGame)]
  if (awaiting > 0) {
    clauses.push(
      `${awaiting} ${awaiting === 1 ? 'is' : 'are'} waiting for administrator permission`
    )
  }
  const alreadyRunning = describeAlreadyRunning(
    skippedCount,
    details.skippedGameName,
    anythingStarted
  )
  if (alreadyRunning) {
    clauses.push(alreadyRunning)
  }

  // "All" is only true when nothing was skipped in either sense, nothing is
  // still waiting on a prompt, and something started at all.
  if (clauses.length === 1 && anythingStarted && missingCount === 0) {
    return 'All profile applications launched.'
  }
  return `${clauses.join('; ')}.`
}

/**
 * Wording when every valid entry was already running and nothing was spawned.
 * Saying "All" while `missingCount > 0` contradicts the skip warning the
 * renderer concatenates onto this string (#739). With the game among the
 * running entries it is named instead (#897), which claims nothing about "all".
 */
export function buildNothingToLaunchMessage(
  skippedCount: number,
  missingCount: number,
  skippedGameName?: string
): string {
  if (skippedGameName) {
    const companions = Math.max(skippedCount - 1, 0)
    return companions === 0
      ? `${skippedGameName} is already running.`
      : `${skippedGameName} and ${countOf(companions, 'app')} are already running.`
  }
  return missingCount > 0
    ? 'The remaining profile applications are already running.'
    : 'All profile applications are already running.'
}
