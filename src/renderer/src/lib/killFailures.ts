export type KillFailureReason = 'access_denied' | 'still_running' | 'unknown'

export interface KillFailureSummary {
  appName: string
  appPath: string
  reason: KillFailureReason
}

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
