export { hasClosableLaunchedApps, killLaunchedApps, killProfileApps } from './processes/kill'
export {
  getRunningApps,
  publishRunningApps,
  subscribeRunningApps,
  unsubscribeRunningApps
} from './processes/running'
export { dismissAppIcon, registerActiveLaunch, unregisterActiveLaunch } from './processes/state'
export { launchProfileApps, isAnyLaunchActive, isRunningExePath } from './processes/spawn'
export { readRunningProcessNames, invalidateProcessNameCache } from './processes/tasklist'
export type { RunningAppsChangedPayload, RunningAppsChangeReason } from './processes/running'
export type {
  KillFailure,
  KillFailureReason,
  KillResult,
  LaunchResult,
  ProfileLaunchEntry,
  ProfileLaunchInput
} from './processes/types'
