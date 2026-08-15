// The launch path's cancellation invariant, in one place (#715).
//
// A kill (Close Apps) aborts the active launch's signal before doing its own
// work (#670). The kill's snapshot cannot include a process that has not
// started yet, so anything the launch starts after that abort is an app the
// user just asked to close and that nothing is going to close.
//
// Before this module the invariant was enforced by a separate `signal.aborted`
// check at every suspension point in the launch sequence. All five review
// findings on #714 were the same check-flag-vs-suspend TOCTOU landing at
// different suspension points, because a check only holds until the next one:
// every new one was a new race window that had to remember its own check.
//
// Here the check sits in the same synchronous block as the process start, so it
// is re-evaluated at the last instant a process can still be prevented. That is
// what makes the suspension points BEFORE it stop being race windows: the
// launch sequence can suspend wherever it likes, however many times, and still
// start nothing once the signal is aborted. Callers therefore do not check the
// signal to protect a start; they check it only to decide what to tell the user.
//
// Two properties keep that true, and tests/main/guardedStart.test.ts asserts
// both rather than leaving them as rules to remember:
//   1. this module is entirely synchronous, so nothing can suspend between the
//      check and the start,
//   2. no other main-process module starts a process on the user's behalf.

import {
  execFile,
  spawn,
  type ChildProcess,
  type ExecFileException,
  type ExecFileOptions,
  type SpawnOptions
} from 'child_process'

// Only the error matters to the launch path — the elevation host's stdout and
// stderr are never read — so the callback is narrowed to it rather than
// re-deriving execFile's encoding-dependent overloads.
type ExecFileErrorCallback = (error: ExecFileException | null) => void

/**
 * Start a detached profile application unless the launch has been cancelled.
 *
 * Returns null when the signal was already aborted — nothing was started, and
 * the caller reports the attempt as cancelled.
 */
export function spawnUnlessAborted(
  signal: AbortSignal | undefined,
  command: string,
  args: readonly string[],
  options: SpawnOptions
): ChildProcess | null {
  if (signal?.aborted) {
    return null
  }
  return spawn(command, args, options)
}

/**
 * Start the elevation host (the PowerShell process that raises the UAC prompt)
 * unless the launch has been cancelled.
 *
 * Returns null when the signal was already aborted. This is the one start where
 * "too late" is unrecoverable rather than merely untidy: once the consent prompt
 * is up, killing the host does not take it back down (#809), so the app can
 * still be started by a user answering a dialog for a launch they cancelled.
 */
export function execFileUnlessAborted(
  signal: AbortSignal | undefined,
  file: string,
  args: readonly string[],
  options: ExecFileOptions,
  callback: ExecFileErrorCallback
): ChildProcess | null {
  if (signal?.aborted) {
    return null
  }
  return execFile(file, args, options, callback)
}
