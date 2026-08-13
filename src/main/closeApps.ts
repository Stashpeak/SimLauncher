import { dialog } from 'electron'

import { writeMainErrorLog } from './errorLog'
import { hasClosableLaunchedApps, killLaunchedApps } from './processes'
import type { KillFailure } from './processes'
import { formatStrandedConsentPrompts } from '../shared/strandedConsentPrompts'

// Guards against a second tray click while a kill is in flight: concurrent
// killLaunchedApps runs race each other's WMI/taskkill calls and produce false
// failures. Cheap to hit now that the action is one click with no confirmation
// step to slow it down.
let isCloseAppsActive = false

function formatCloseFailures(failures: KillFailure[]): string {
  const names = failures.map((failure) => failure.appName).join(', ')
  // access_denied is by far the common case (elevated/admin apps), so lead with
  // the actionable hint rather than the raw reason codes.
  return `These apps could not be closed and may need to be closed manually (some require administrator rights): ${names}`
}

/**
 * Tray "Close Apps" action (#519): terminate every running companion app across
 * every profile. The game itself is never touched, see killLaunchedApps.
 *
 * This is the ONLY caller that passes no gameKey, which is what made #772 a
 * blocker: with the target map keyed by exe basename, a utility shared across
 * profiles was attributed to whichever profile was enumerated last, so a failed
 * close surfaced under a game the user had not been playing. The item was pulled
 * hours before 1.0.0 for exactly that (`40c5d18`) and is re-landed here now that
 * attribution is correct.
 *
 * No confirmation step, per the re-land plan on #519: it only closes companions,
 * so making the tray a genuine one-click action matches the per-row button,
 * which has never confirmed either.
 *
 * Closability is decided here at click time with a one-shot check rather than a
 * cached predicate kept fresh by a periodic scan. That keeps the tray free of
 * background polling and removes a class of cache/state-sync bugs; when nothing
 * is running we simply say so.
 *
 * Native dialogs rather than the renderer's, because the tray menu can be
 * triggered with the window hidden in the tray, where a React modal rendered
 * into that window's DOM would not be visible. Native dialogs also match the
 * boot-error precedent in index.ts.
 */
export async function closeAppsFromTray(): Promise<void> {
  if (isCloseAppsActive) {
    return
  }
  isCloseAppsActive = true

  try {
    if (!(await hasClosableLaunchedApps())) {
      await dialog.showMessageBox({
        type: 'info',
        title: 'Close Apps',
        message: 'No companion apps are currently running.',
        detail:
          'SimLauncher closes the overlays, telemetry tools, and other utilities it launched when they are running.'
      })
      return
    }

    const result = await killLaunchedApps()
    // A cancelled elevated handoff leaves its consent prompt on screen (#809).
    // The row button appends this to its toast; the tray has no toast, and the
    // window may not even be visible, so it goes in the dialog or gets its own.
    const strandedNote = formatStrandedConsentPrompts(result.strandedConsentPrompts)

    if (result.failures.length > 0) {
      dialog.showErrorBox(
        'Some apps could not be closed',
        [formatCloseFailures(result.failures), strandedNote].filter(Boolean).join('\n\n')
      )
      return
    }

    if (strandedNote) {
      await dialog.showMessageBox({
        type: 'info',
        title: 'Close Apps',
        message: 'Companion apps closed.',
        detail: strandedNote
      })
    }
  } catch (error) {
    writeMainErrorLog('closeAppsFailure', error)
    dialog.showErrorBox('Close Apps failed', error instanceof Error ? error.message : String(error))
  } finally {
    isCloseAppsActive = false
  }
}
