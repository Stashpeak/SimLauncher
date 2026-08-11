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
 * Lives in the renderer, like formatKillFailures and formatSkippedLaunchEntries:
 * the main process reports a count, the wording is composed here. An earlier
 * version of this baked the sentence into the kill result's `message` string in
 * the main process, which the profile-switch flow discards outright and the
 * renderer ignores on a failed kill, so it was produced correctly and never
 * shown to anyone.
 */
export function formatStrandedConsentPrompts(count: number | undefined): string | undefined {
  if (!count || count < 1) {
    return undefined
  }

  return count === 1
    ? 'A Windows permission prompt may still be on screen. Answering it will not start the app.'
    : 'Windows permission prompts may still be on screen. Answering them will not start those apps.'
}
