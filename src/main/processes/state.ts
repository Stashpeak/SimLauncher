import { getExeName } from '../utils'

import type { RunningProcessEntry, UnclosedProcessEntry } from './types'

export const runningProcesses = new Map<string, RunningProcessEntry>()
export const unclosedProcesses = new Map<string, UnclosedProcessEntry>()

export function pruneStoppedRunningProcesses(processNames: Set<string>) {
  runningProcesses.forEach((_appProcess, appPath) => {
    if (!processNames.has(getExeName(appPath))) {
      runningProcesses.delete(appPath)
    }
  })
}
