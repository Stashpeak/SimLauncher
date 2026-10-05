// #877: a failed launch used to show the raw OS error straight through —
// `spawn UNKNOWN` for a non-program exe, or (on the elevated path) the whole
// base64 `-EncodedCommand` payload plus PowerShell's CLIXML stderr, which can
// carry the user's own launch arguments. Splitting "what went wrong" from
// "how to say it" into a classifier and a formatter, rather than inlining a
// switch at each of the four producers, is what lets every exit (the
// aggregate summary, the late `app-launch-error` IPC payload) compose the
// same sentence instead of four call sites drifting apart on wording.
import { getErrorCode } from '../utils'
import type { LaunchFailureReason } from './types'

/**
 * Maps a spawn/execFile failure to one of the small, stable reasons the user
 * can act on, from the OS error code alone — never from `err.message`, which
 * is the thing #877 was filed to stop forwarding.
 *
 * Measured on Electron 44.5.1 (ELECTRON_RUN_AS_NODE, no window) against three
 * fixtures: a missing path gives `ENOENT`; a text file renamed to `.exe` gives
 * `UNKNOWN` (matching the `spawn UNKNOWN` seen in the 1.2.3 smoke run); and an
 * exe with a deny-execute ACL gives `EPERM`, NOT `EACCES` — `EACCES` on win32
 * is already claimed by `isElevatedLaunchError` to mean "this needs
 * elevation" and is diverted to `launchElevated` before reaching this
 * function, so it is mapped here only for completeness (a non-win32 caller,
 * or a future Node whose error shape differs).
 *
 * Deliberately not called on the elevated handoff's own failure: `error.code`
 * there is `1` for every failure (#953), so there is nothing to classify and
 * the call site sets `elevation_failed` directly instead of routing a
 * meaningless code through here.
 */
export function classifyLaunchFailure(err: unknown): LaunchFailureReason {
  switch (getErrorCode(err)) {
    case 'ENOENT':
      return 'missing'
    case 'UNKNOWN':
      return 'not_a_program'
    case 'EACCES':
    case 'EPERM':
      return 'access_denied'
    default:
      return 'unknown'
  }
}

/**
 * The plain-language clause for a classified failure.
 *
 * Names neither the app nor "Failed to launch" / "failed to launch" —
 * every call site already supplies one of those two prefixes (the aggregate
 * summary built in `launchProfileApps`, and Notify.tsx's `"<app> failed to
 * launch:"` for the late IPC payload), so a context-free clause is the only
 * shape that reads correctly after either prefix without naming the app
 * twice (#877).
 */
export function buildLaunchFailureSentence(reason: LaunchFailureReason): string {
  switch (reason) {
    case 'missing':
      return 'the file could not be found.'
    case 'not_a_program':
      return 'it is not a program Windows can start.'
    case 'access_denied':
      return 'Windows denied permission to run it.'
    case 'elevation_failed':
      return 'Windows did not start it with administrator permission.'
    case 'unknown':
      return 'Windows could not start it.'
  }
}
