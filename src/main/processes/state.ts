import { getExeName } from '../utils'

import type {
  ProcessNameMismatchWarningEntry,
  RunningProcessEntry,
  UnclosedProcessEntry
} from './types'

export const runningProcesses = new Map<string, RunningProcessEntry>()
export const unclosedProcesses = new Map<string, UnclosedProcessEntry>()
export const processNameMismatchWarnings = new Map<string, ProcessNameMismatchWarningEntry>()
export const suppressedProcessNameMismatchWarnings = new Set<string>()

export function suppressProcessNameMismatchWarning(appPath: string) {
  suppressedProcessNameMismatchWarnings.add(appPath.toLowerCase())
}

export function consumeProcessNameMismatchWarningSuppression(appPath: string) {
  const key = appPath.toLowerCase()
  const suppressed = suppressedProcessNameMismatchWarnings.has(key)
  suppressedProcessNameMismatchWarnings.delete(key)
  return suppressed
}

export function pruneStoppedRunningProcesses(processNames: Set<string>) {
  runningProcesses.forEach((_appProcess, appPath) => {
    if (!processNames.has(getExeName(appPath))) {
      runningProcesses.delete(appPath)
    }
  })
}

export function pruneExpiredProcessNameMismatchWarnings(now = Date.now()) {
  processNameMismatchWarnings.forEach((entry, key) => {
    if (entry.expiresAt !== undefined && entry.expiresAt <= now) {
      processNameMismatchWarnings.delete(key)
    }
  })
}
