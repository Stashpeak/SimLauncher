import { execFile } from 'child_process'

// 500 ms is short enough that UI updates feel live (polling interval is 2 s)
// but long enough to collapse the burst of tasklist calls that fire during a
// multi-app launch sequence (spawn → kill verify → running-apps publish).
const CACHE_TTL_MS = 500

/**
 * One row of the `tasklist` snapshot, beyond the image name.
 *
 * `tasklist /fo csv /nh` has always returned five columns and this module has
 * always kept one of them. PID and session were being parsed away and thrown
 * out on every tick, which is why the poll could only ever answer questions
 * about NAMES (#674). Reading them costs nothing: same command, same spawn.
 *
 * `sessionId` is column 4, `Session#`, the NUMBER. Deliberately not column 3,
 * `Session Name`, which reads "Services" or "Console" on an English install and
 * is localized everywhere else.
 */
export interface TasklistProcess {
  /** Lowercased image name, matching how `processNames` is keyed. */
  name: string
  processId: number
  sessionId: number
}

export interface RunningProcessNamesResult {
  processNames: Set<string>
  /**
   * Every row of the same snapshot `processNames` was derived from, so the two
   * can never disagree about what was running at that instant.
   *
   * Additive (#674): `processNames` keeps its exact meaning and every existing
   * consumer is untouched. A failed read leaves this empty for the same reason
   * `processNames` is empty, and carries the same no-observation warning.
   */
  processes: TasklistProcess[]
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
        resolve({ processNames: new Set(), processes: [], succeeded: false })
        return
      }

      const names = new Set<string>()
      const processes: TasklistProcess[] = []
      stdout.split(/\r?\n/).forEach((line) => {
        // Every field is quoted and none can contain a quote of its own: a
        // Windows image name cannot, and the other four are numbers or fixed
        // words. So splitting on quoted groups is sufficient here and needs no
        // CSV escaping rules. Verified against a real 537-row snapshot, where
        // all five columns parsed on every line.
        const fields = line.match(/"([^"]*)"/g)
        if (!fields || fields.length === 0) {
          return
        }
        const unquote = (field: string) => field.slice(1, -1)
        const name = unquote(fields[0]).toLowerCase()
        if (!name) {
          return
        }

        // The name is recorded from the FIRST field alone, exactly as it was
        // before the other columns were read, so no row can lose its name by
        // failing to yield an instance. That asymmetry is the safe direction:
        // losing a name says an app is not running when it is, while losing an
        // instance only leaves the answer ambiguous, which every caller already
        // handles conservatively.
        names.add(name)

        // The instance needs all four. Inventing a value for a field that would
        // not parse is the one genuinely dangerous option here, because session
        // 0 is what lets an unreadable path be dismissed.
        if (fields.length < 4) {
          return
        }
        const processId = Number(unquote(fields[1]))
        const sessionId = Number(unquote(fields[3]))
        if (!Number.isInteger(processId) || !Number.isInteger(sessionId)) {
          return
        }
        processes.push({ name, processId, sessionId })
      })
      resolve({ processNames: names, processes, succeeded: true })
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
