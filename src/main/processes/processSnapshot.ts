/**
 * Every running process as image name, PID and session number, read in-process
 * instead of by spawning `tasklist.exe` (#975).
 *
 * The poll used to spawn `tasklist` on every tick, and on a real race setup that
 * was the most expensive thing SimLauncher did: ~184 ms of main-process CPU per
 * spawn from an Electron main, plus ~394 ms inside `tasklist.exe` itself, which
 * at the 2 s cadence is roughly a quarter of a core for a whole session.
 * `WTSEnumerateProcessesW` returns the same three columns in one call for about
 * 7 ms, with no child process at all.
 *
 * Why this API rather than the more obvious Toolhelp32 snapshot: Toolhelp has no
 * session column, and `ProcessIdToSessionId` has to open each process, which
 * Windows refuses for most of the services session. On the machine this was
 * measured on that was 173 of 429 processes, and session 0 is exactly what the
 * #674 rule reads. The WTS call agreed with `tasklist` on every PID and every
 * session number. It does not need the Remote Desktop services to be running:
 * all three were stopped when it was measured.
 *
 * Strictly an optimisation. Anything that goes wrong here answers `null` and the
 * caller falls back to `tasklist`, which is the pre-#975 behaviour exactly: a
 * missing binding, a load that throws, a failed or empty enumeration.
 */
import type { TasklistProcess } from './tasklist'

type SnapshotReader = () => TasklistProcess[] | null

interface WtsProcessInfo {
  SessionId: number
  ProcessId: number
  pProcessName: string | null
}

let loading: Promise<void> | undefined
let reader: SnapshotReader | null = null
let reportedReadFailure = false

async function loadReader(): Promise<SnapshotReader> {
  const koffi = (await import('koffi')).default
  const wtsapi32 = koffi.load('wtsapi32.dll')
  // Anonymous on purpose. A named koffi type is registered for the whole
  // process, so a second load (a test resetting its modules) would throw on the
  // duplicate name and silently turn the native path off.
  const processInfo = koffi.struct({
    SessionId: 'uint32',
    ProcessId: 'uint32',
    pProcessName: 'str16',
    pUserSid: 'void *'
  })
  const enumerateProcesses = wtsapi32.func(
    'bool __stdcall WTSEnumerateProcessesW(void *hServer, uint32 Reserved, uint32 Version, _Out_ void **ppProcessInfo, _Out_ uint32 *pCount)'
  )
  const freeMemory = wtsapi32.func('void __stdcall WTSFreeMemory(void *pMemory)')

  return () => {
    const infoPointer: unknown[] = [null]
    const count = [0]
    // A null server handle is WTS_CURRENT_SERVER_HANDLE, this machine. The
    // version argument must be 1.
    if (!enumerateProcesses(null, 0, 1, infoPointer, count)) {
      return null
    }

    try {
      const rows = koffi.decode(infoPointer[0], processInfo, count[0]) as WtsProcessInfo[]
      const processes = rows.flatMap((row) => {
        const name = (row.pProcessName ?? '').toLowerCase()
        // The System Idle Process comes back with no name. `tasklist` invents
        // one for it, which no configured app can match, so dropping the row
        // loses nothing and keeps the empty string out of the name set, the
        // same as the `tasklist` parser does.
        return name ? [{ name, processId: row.ProcessId, sessionId: row.SessionId }] : []
      })
      // A machine with no processes is not an observation, it is a broken
      // read. Answering it would read as everything having stopped at once,
      // which is the #399 failure all over again.
      return processes.length > 0 ? processes : null
    } finally {
      freeMemory(infoPointer[0])
    }
  }
}

/**
 * Start loading the binding if nothing has tried yet, and resolve once that
 * attempt has finished either way. Never rejects.
 *
 * `readProcessSnapshot` calls this itself, so production never has to. It is
 * exported so a test can wait for the binding instead of racing it.
 */
export function prepareProcessSnapshot(): Promise<void> {
  if (!loading) {
    loading =
      process.platform === 'win32'
        ? loadReader()
            .then((loaded) => {
              reader = loaded
            })
            .catch((err: unknown) => {
              console.error('Native process snapshot unavailable, using tasklist instead:', err)
            })
        : Promise.resolve()
  }
  return loading
}

/**
 * The running processes, or `null` whenever `tasklist` has to answer instead.
 *
 * Synchronous, and deliberately so: the binding loads in the background on the
 * first call, which therefore answers `null`, and every read after it is
 * native. Keeping this synchronous is what keeps the fallback spawn where it
 * always was, inside the same call, so the cache, the in-flight coalescing and
 * the invalidation generations in `tasklist.ts` see no difference at all.
 */
export function readProcessSnapshot(): TasklistProcess[] | null {
  if (!reader) {
    void prepareProcessSnapshot()
    return null
  }

  try {
    const processes = reader()
    if (processes) {
      return processes
    }
    reportReadFailure('the enumeration returned nothing')
  } catch (err) {
    reportReadFailure(err)
  }
  return null
}

// Once per session. The poll runs every 2 s, and a read that fails once will
// usually fail on every tick after it; the fallback keeps working either way.
function reportReadFailure(reason: unknown): void {
  if (reportedReadFailure) {
    return
  }
  reportedReadFailure = true
  console.error('Native process snapshot read failed, using tasklist instead:', reason)
}
