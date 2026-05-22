import { execFile } from 'child_process'

const CACHE_TTL_MS = 500

export interface RunningProcessNamesResult {
  processNames: Set<string>
  succeeded: boolean
}

let cachedResult: RunningProcessNamesResult | undefined
let cachedAt = 0
let inflight: Promise<RunningProcessNamesResult> | undefined

function spawnTasklist(): Promise<RunningProcessNamesResult> {
  return new Promise<RunningProcessNamesResult>((resolve) => {
    execFile('tasklist', ['/fo', 'csv', '/nh'], { windowsHide: true }, (error, stdout) => {
      if (error) {
        console.error('Failed to read running processes:', error)
        resolve({ processNames: new Set(), succeeded: false })
        return
      }

      const names = new Set<string>()
      stdout.split(/\r?\n/).forEach((line) => {
        const match = line.match(/^"([^"]+)"/)
        if (match) {
          names.add(match[1].toLowerCase())
        }
      })
      resolve({ processNames: names, succeeded: true })
    })
  })
}

export function readRunningProcessNames(): Promise<RunningProcessNamesResult> {
  if (cachedResult && Date.now() - cachedAt < CACHE_TTL_MS) {
    return Promise.resolve(cachedResult)
  }

  if (inflight) {
    return inflight
  }

  inflight = spawnTasklist()
    .then((result) => {
      // Only cache successful reads so a transient tasklist failure doesn't
      // poison subsequent calls for the full TTL window and so callers can
      // distinguish "process is gone" from "we don't know".
      if (result.succeeded) {
        cachedResult = result
        cachedAt = Date.now()
      }
      return result
    })
    .finally(() => {
      inflight = undefined
    })

  return inflight
}

export function invalidateProcessNameCache(): void {
  cachedResult = undefined
  cachedAt = 0
}
