import type { ChildProcess } from 'child_process'

export interface LaunchResult {
  success: boolean
  message?: string
  warning?: string
  error?: string
  launchedCount?: number
  skippedCount?: number
  elevatedCount?: number
  failedCount?: number
}

export interface KillResult {
  success: boolean
  message?: string
  warning?: string
  error?: string
  closedCount: number
  failedCount: number
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
}
