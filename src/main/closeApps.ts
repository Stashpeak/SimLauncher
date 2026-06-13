import { dialog } from 'electron'

import { writeMainErrorLog } from './errorLog'
import { hasClosableApps, killLaunchedApps } from './processes'
import type { KillFailure } from './processes'

function formatCloseFailures(failures: KillFailure[]): string {
  const names = failures.map((failure) => failure.appName).join(', ')
  // access_denied is by far the common case (elevated/admin apps), so lead with
  // the actionable hint rather than the raw reason codes.
  return `These apps could not be closed and may need to be closed manually (some require administrator rights): ${names}`
}

/**
 * Tray "Close Apps" action (#519): confirm, then terminate every running
 * companion app (the game itself is never touched — see killLaunchedApps).
 *
 * Uses a native dialog rather than the renderer ConfirmDialog because the tray
 * menu can be triggered with the window hidden in the tray, where a React modal
 * (rendered into the window's DOM) would not be visible. The native dialog also
 * matches the boot-error precedent in index.ts.
 */
export async function confirmAndCloseApps(): Promise<void> {
  // Re-check at click time: the menu's enabled state is only as fresh as the
  // last running-apps refresh, and apps may have exited since.
  if (!hasClosableApps()) {
    return
  }

  const { response } = await dialog.showMessageBox({
    type: 'question',
    buttons: ['Close Apps', 'Cancel'],
    // Default to Cancel so a stray Enter/Space on the dialog never terminates a
    // running session by accident.
    defaultId: 1,
    cancelId: 1,
    title: 'Close Apps',
    message: 'Close all running companion apps?',
    detail:
      'This stops the utility apps SimLauncher launched (overlays, telemetry tools, and similar). Your game is not affected.'
  })

  if (response !== 0) {
    return
  }

  try {
    const result = await killLaunchedApps()
    if (result.failures.length > 0) {
      dialog.showErrorBox('Some apps could not be closed', formatCloseFailures(result.failures))
    }
  } catch (error) {
    writeMainErrorLog('closeAppsFailure', error)
    dialog.showErrorBox('Close Apps failed', error instanceof Error ? error.message : String(error))
  }
}
