export { killLaunchedApps, killProfileApps } from './processes/kill'
export {
  getRunningApps,
  publishRunningApps,
  subscribeRunningApps,
  unsubscribeRunningApps
} from './processes/running'
export { launchProfileApps, isRunningExePath } from './processes/spawn'
export { readRunningProcessNames } from './processes/tasklist'
export type { RunningAppsChangedPayload, RunningAppsChangeReason } from './processes/running'
export type { KillFailure, KillFailureReason, KillResult, LaunchResult } from './processes/types'
