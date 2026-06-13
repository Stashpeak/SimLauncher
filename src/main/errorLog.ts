import { app } from 'electron'
import fs from 'fs'
import path from 'path'

// Cap the log so a tight error loop can't fill the disk. When the file exceeds
// MAX_LOG_BYTES it is rotated to a single `.old` companion (bounding the total
// footprint to ~2x this).
const MAX_LOG_BYTES = 512 * 1024

function logFilePath(): string {
  return path.join(app.getPath('userData'), 'main-error.log')
}

export function formatMainError(kind: string, value: unknown): string {
  const time = new Date().toISOString()

  if (value instanceof Error) {
    return `[${time}] ${kind}: ${value.name}: ${value.message}\n${value.stack ?? ''}\n\n`
  }

  return `[${time}] ${kind}: ${String(value)}\n\n`
}

// Best-effort append. The crash logger must NEVER throw — a failure here would
// itself surface as an uncaught error and defeat the purpose — so every fs
// operation is guarded and swallowed.
export function writeMainErrorLog(kind: string, value: unknown): void {
  try {
    const file = logFilePath()

    try {
      if (fs.statSync(file).size > MAX_LOG_BYTES) {
        fs.renameSync(file, `${file}.old`)
      }
    } catch {
      // No existing file (ENOENT) or stat failed — nothing to rotate.
    }

    fs.appendFileSync(file, formatMainError(kind, value))
  } catch {
    // Disk full / file locked / permission denied — give up silently.
  }
}

let installed = false

/**
 * Registers global main-process crash logging to `<userData>/main-error.log`.
 *
 * Side effect to be aware of: once these listeners exist, Node no longer
 * crash-exits on an uncaught exception or an unhandled rejection — the app logs
 * the error and keeps running. That is intentional for a desktop app that lives
 * in the tray (a silent hard-exit on a background error is worse UX than limping
 * on), but it does mean the process can continue in a degraded state. Behavior
 * beyond logging (showing a dialog, quitting) is deliberately out of scope.
 *
 * Idempotent — safe to call more than once.
 */
export function installMainProcessErrorLogging(): void {
  if (installed) {
    return
  }
  installed = true

  process.on('uncaughtException', (error) => {
    console.error('Uncaught exception in main process:', error)
    writeMainErrorLog('uncaughtException', error)
  })

  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection in main process:', reason)
    writeMainErrorLog('unhandledRejection', reason)
  })
}
