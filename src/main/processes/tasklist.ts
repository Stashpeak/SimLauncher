import { execFile } from 'child_process'

// 500 ms is short enough that UI updates feel live (polling interval is 2 s)
// but long enough to collapse the burst of tasklist calls that fire during a
// multi-app launch sequence (spawn → kill verify → running-apps publish).
const CACHE_TTL_MS = 500

export interface RunningProcessNamesResult {
  processNames: Set<string>
  succeeded: boolean
}

let cachedResult: RunningProcessNamesResult | undefined
let cachedAt = 0
let inflight: Promise<RunningProcessNamesResult> | undefined
// Bumped on every invalidation so an in-flight read can tell whether the
// process set changed while it was running (see readRunningProcessNames).
let generation = 0

function spawnTasklist(): Promise<RunningProcessNamesResult> {
  return new Promise<RunningProcessNamesResult>((resolve) => {
    // `/fo csv` gives a stable, quote-delimited format that is safe to parse
    // even when process names contain spaces or special characters.
    // `/nh` suppresses the header row so we can match from line 1.
    // `windowsHide: true` prevents a console window flashing on screen.
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

/**
 * Return the set of currently running exe names (lowercase) from a `tasklist`
 * snapshot.
 *
 * Concurrent callers within the TTL window share a single in-flight promise so
 * that a burst of simultaneous callers (e.g. launch + publish) issues at most
 * one `tasklist` process.  Failed reads are NOT cached so callers can retry
 * immediately after a transient failure instead of waiting out the TTL.
 */
export function readRunningProcessNames(): Promise<RunningProcessNamesResult> {
  if (cachedResult && Date.now() - cachedAt < CACHE_TTL_MS) {
    return Promise.resolve(cachedResult)
  }

  if (inflight) {
    // A tasklist is already in-flight; piggyback on it rather than starting
    // a second process.
    return inflight
  }

  const generationAtStart = generation
  const read: Promise<RunningProcessNamesResult> = spawnTasklist()
    .then((result) => {
      // Only cache successful reads so a transient tasklist failure doesn't
      // poison subsequent calls for the full TTL window and so callers can
      // distinguish "process is gone" from "we don't know". The generation
      // check keeps a read that was already in flight when an invalidation
      // happened (a launch/exit changed the process set) from re-populating
      // the cache with its now-stale snapshot (#500).
      if (result.succeeded && generation === generationAtStart) {
        cachedResult = result
        cachedAt = Date.now()
      }
      return result
    })
    .finally(() => {
      // Only clear the slot we own: an invalidation may have detached this
      // read and a fresh one may already be in flight in its place.
      if (inflight === read) {
        inflight = undefined
      }
    })
  inflight = read

  return read
}

export function invalidateProcessNameCache(): void {
  generation += 1
  cachedResult = undefined
  cachedAt = 0
  // Detach any in-flight read: it was sampled before the process set changed,
  // so callers arriving after the invalidation must not piggyback on it — the
  // next read spawns a fresh tasklist. The detached read still resolves for
  // its own (pre-invalidation) callers; the generation guard above keeps its
  // result out of the cache.
  inflight = undefined
}
