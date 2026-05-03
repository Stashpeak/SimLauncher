import type { ChildProcess } from 'child_process'

export type KillFailureReason = 'access_denied' | 'still_running' | 'unknown'

export interface KillFailure {
  appName: string
  appPath: string
  reason: KillFailureReason
}

export interface LaunchResult {
  success: boolean
  message?: string
  warning?: string
  error?: string
  launchedCount?: number
  skippedCount?: number
  elevatedCount?: number
  failedCount?: number
  killFailures?: KillFailure[]
}

export interface KillResult {
  success: boolean
  message?: string
  error?: string
  closedCount: number
  failedCount: number
  failures: KillFailure[]
}

export type AppLaunchResult =
  | { status: 'launched'; appPath: string }
  | { status: 'elevated'; appPath: string; warning: string }
  | { status: 'failed'; appPath: string; error: string }

export interface RunningProcessEntry {
  process: ChildProcess
  name: string
  gameKey: string
  isGame: boolean
}

export interface UnclosedProcessEntry {
  path: string
  name: string
  gameKey: string
  error: string
  reason: KillFailureReason
  elevated?: boolean
}
