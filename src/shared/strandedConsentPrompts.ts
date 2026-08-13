/**
 * User-facing wording for consent prompts left on screen by a cancelled
 * elevated handoff (#809).
 *
 * When SimLauncher cancels a pending elevated launch it kills the PowerShell
 * host. That stops the app from starting, but it does NOT remove the Windows
 * consent prompt: that dialog belongs to the AppInfo service on the secure
 * desktop and is not ours to close. Verified on a real machine, the prompt
 * stayed up and answering Yes started nothing, silently. Without this sentence
 * the readings available to the user are "elevation is broken" or "SimLauncher
 * failed to start it", and neither is true.
 *
 * Two things it deliberately does not say: that the app started (it did not),
 * and that SimLauncher closed the prompt (it cannot).
 *
 * The main process reports a COUNT and the wording is composed at the surface
 * that shows it, like formatKillFailures and formatSkippedLaunchEntries. An
 * earlier version baked the sentence into the kill result's `message` string in
 * main, which the profile-switch flow discards outright and the renderer ignores
 * on a failed kill, so it was produced correctly and never shown to anyone.
 *
 * Shared rather than renderer-only because the tray "Close Apps" (#519) has no
 * renderer at all: it is fired from a native menu that can run with the window
 * hidden, and it reports through native dialogs. Duplicating the sentence there
 * would let the two copies drift, which for this wording matters -- it is
 * carefully phrased NOT to claim the app started or that the prompt was
 * closed.
 */
export function formatStrandedConsentPrompts(count: number | undefined): string | undefined {
  if (!count || count < 1) {
    return undefined
  }

  return count === 1
    ? 'A Windows permission prompt may still be on screen. Answering it will not start the app.'
    : 'Windows permission prompts may still be on screen. Answering them will not start those apps.'
}
