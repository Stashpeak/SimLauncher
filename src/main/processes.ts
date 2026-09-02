export { AUTO_CLOSE_GRACE_MS, initAutoClose } from './processes/autoClose'
export { killLaunchedApps, killProfileApps } from './processes/kill'
export {
  getRunningApps,
  publishRunningApps,
  subscribeRunningApps,
  unsubscribeRunningApps
} from './processes/running'
export {
  abortActiveLaunches,
  cancelPendingElevatedHandoffs,
  dismissAppIcon,
  drainStrandedConsentPrompts,
  hasOtherActiveLaunchControllers,
  registerActiveLaunch,
  unregisterActiveLaunch
} from './processes/state'
export { launchProfileApps, isAnyLaunchActive } from './processes/spawn'
export { readRunningProcessNames, invalidateProcessNameCache } from './processes/tasklist'
export { resolveRunningConfiguredPaths } from './processes/win32KillUtils'
export type { RunningAppsChangedPayload, RunningAppsChangeReason } from './processes/running'
export type {
  KillFailure,
  KillFailureReason,
  KillResult,
  LaunchResult,
  ProfileLaunchEntry,
  ProfileLaunchInput
} from './processes/types'
