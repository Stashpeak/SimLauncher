import { dialog } from 'electron'

import { writeMainErrorLog } from './errorLog'
import { hasClosableLaunchedApps, killLaunchedApps } from './processes'
import type { KillFailure } from './processes'

// Guards against a second tray click while a confirmation dialog (or the kill
// itself) is in flight: stacked dialogs would otherwise trigger concurrent
// killLaunchedApps runs, racing WMI/taskkill and producing false failures.
let isCloseAppsActive = false

function formatCloseFailures(failures: KillFailure[]): string {
  const names = failures.map((failure) => failure.appName).join(', ')
  // access_denied is by far the common case (elevated/admin apps), so lead with
  // the actionable hint rather than the raw reason codes.
  return `These apps could not be closed and may need to be closed manually (some require administrator rights): ${names}`
}

/**
 * Tray "Close Apps" action (#519): terminate every running companion app (the
 * game itself is never touched — see killLaunchedApps).
 *
 * The menu item is always enabled; closability is decided here at click time
 * with a one-shot check rather than a cached predicate kept fresh by a periodic
 * scan. That keeps the tray free of background polling and removes a whole class
 * of cache/state-sync edge cases — when nothing is running we simply say so.
 *
 * Uses native dialogs rather than the renderer ConfirmDialog because the tray
 * menu can be triggered with the window hidden in the tray, where a React modal
 * (rendered into the window's DOM) would not be visible. Native dialogs also
 * match the boot-error precedent in index.ts.
 */
export async function confirmAndCloseApps(): Promise<void> {
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

    const result = await killLaunchedApps()
    if (result.failures.length > 0) {
      dialog.showErrorBox('Some apps could not be closed', formatCloseFailures(result.failures))
    }
  } catch (error) {
    writeMainErrorLog('closeAppsFailure', error)
    dialog.showErrorBox('Close Apps failed', error instanceof Error ? error.message : String(error))
  } finally {
    isCloseAppsActive = false
  }
}
