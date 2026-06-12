export type KillFailureReason = 'access_denied' | 'still_running' | 'unknown'

export interface KillFailureSummary {
  appName: string
  appPath: string
  reason: KillFailureReason
}

/**
 * Builds a user-facing error string for one or more kill failures.
 *
 * The message is intentionally contextual: a single access-denied failure gets
 * a specific Windows-elevation hint; a mixed batch gets a shorter summary.
 * Callers must not assume a particular sentence structure — treat the return
 * value as an opaque display string.
 *
 * The empty-failures guard returns a generic fallback rather than an empty
 * string because callers typically pass failures.length > 0, but a defensive
 * path is cheaper than a crash in the notification layer.
 */
export function formatKillFailures(failures: KillFailureSummary[]): string {
  if (failures.length === 0) {
    return 'Some companion apps could not be closed.'
  }

  const accessDenied = failures.filter((failure) => failure.reason === 'access_denied')
  const allAccessDenied = accessDenied.length === failures.length

  if (failures.length === 1) {
    const [failure] = failures
    return failure.reason === 'access_denied'
      ? `${failure.appName} is still running because Windows denied SimLauncher permission to close it. If it is running as administrator, close it manually or run SimLauncher as administrator.`
      : `${failure.appName} could not be closed and is still running.`
  }

  const names = failures.map((failure) => failure.appName).join(', ')

  if (allAccessDenied) {
    return `${failures.length} apps could not be closed (${names}) because Windows denied SimLauncher permission. Elevated apps may need to be closed manually or by running SimLauncher as administrator.`
  }

  return `${failures.length} apps could not be closed and are still running (${names}).`
}
