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

// Single-line variant for operational failures (failed launch/kill) — see
// writeAppErrorLog below for why these share the crash log's file.
export function formatAppErrorLog(operation: string, detail: string): string {
  // detail often carries stderr/stdout text (taskkill, PowerShell) with
  // embedded newlines; collapse them so one failure is always exactly one
  // line in the log.
  const singleLine = detail.replace(/\s*[\r\n]+\s*/g, ' ').trim()
  return `[${new Date().toISOString()}] ${operation}: ${singleLine}\n`
}

// Best-effort append shared by writeMainErrorLog and writeAppErrorLog. Must
// NEVER throw — a failure here would itself surface as an uncaught error and
// defeat the purpose — so every fs operation is guarded and swallowed.
function appendToLog(line: string): void {
  try {
    const file = logFilePath()

    try {
      if (fs.statSync(file).size > MAX_LOG_BYTES) {
        fs.renameSync(file, `${file}.old`)
      }
    } catch {
      // No existing file (ENOENT) or stat failed — nothing to rotate.
    }

    fs.appendFileSync(file, line)
  } catch {
    // Disk full / file locked / permission denied — give up silently.
  }
}

export function writeMainErrorLog(kind: string, value: unknown): void {
  appendToLog(formatMainError(kind, value))
}

// Routes operational failures (failed launch, failed kill — #638) into the
// same on-disk log as crash reports, instead of console.error only, which is
// not written to disk in a packaged build (DevTools is disabled in prod). We
// reuse main-error.log rather than a second file: it already has a rotation
// guard, and it's already what "Open logs folder" points users at, so there is
// nothing new for the user to find. `detail` should be a short, privacy-safe
// description (app/game name, exe path, error message) — never raw launch
// args, which may carry tokens.
export function writeAppErrorLog(operation: string, detail: string): void {
  appendToLog(formatAppErrorLog(operation, detail))
}

let installed = false

/**
 * Registers global main-process crash logging to `<userData>/main-error.log`.
 *
 * Side effect to be aware of: once these listeners exist, Node no longer
 * crash-exits on an uncaught exception or an unhandled rejection — the app logs
 * the error and keeps running. That is intentional for a desktop app that lives
 * in the tray (a silent hard-exit on a background error is worse UX than limping
 * on), but it does mean the process can continue in a degraded state.
 *
 * Where continuing would be wrong — notably a failure during the boot chain,
 * which would otherwise leave the instance holding the single-instance lock with
 * no usable window — the call site handles termination itself (see the
 * `whenReady().then(...).catch(...)` in index.ts) rather than relying on this
 * log-and-continue default.
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
