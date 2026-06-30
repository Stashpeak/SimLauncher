import fs from 'fs'

// PE optional-header Subsystem values (IMAGE_SUBSYSTEM_*).
const SUBSYSTEM_WINDOWS_CUI = 3

const DOS_HEADER_SIZE = 64
const DOS_MAGIC = 0x5a4d // 'MZ'
const PE_OFFSET_FIELD = 0x3c // e_lfanew
const PE_SIGNATURE = 0x00004550 // 'PE\0\0'
// 4-byte PE signature + 20-byte COFF header + Subsystem at optional-header
// offset 68 (same offset for PE32 and PE32+).
const SUBSYSTEM_OFFSET = 4 + 20 + 68
const PE_HEADERS_READ_SIZE = SUBSYSTEM_OFFSET + 2

// Errno codes for a file that exists but is momentarily held by another process
// (a sharing violation surfaces as EBUSY/EPERM/EACCES on Windows; EMFILE/ENFILE
// are transient descriptor exhaustion). These warrant one short retry; anything
// else — a missing file, a malformed PE — is a settled answer that fails open
// immediately.
const TRANSIENT_LOCK_CODES = new Set(['EBUSY', 'EACCES', 'EPERM', 'EMFILE', 'ENFILE'])
const LOCK_RETRY_DELAY_MS = 50

function isTransientLockError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    TRANSIENT_LOCK_CODES.has((error as NodeJS.ErrnoException).code ?? '')
  )
}

/**
 * Read the PE optional header's Subsystem field. Throws on an I/O failure (so
 * the caller can decide whether the failure is worth retrying) and returns
 * `false` for any file that opens cleanly but isn't a console-subsystem PE.
 */
async function readSubsystemIsConsole(exePath: string): Promise<boolean> {
  let file: fs.promises.FileHandle | undefined
  try {
    file = await fs.promises.open(exePath, 'r')

    const dosHeader = Buffer.alloc(DOS_HEADER_SIZE)
    const dosRead = await file.read(dosHeader, 0, DOS_HEADER_SIZE, 0)
    if (dosRead.bytesRead < DOS_HEADER_SIZE || dosHeader.readUInt16LE(0) !== DOS_MAGIC) {
      return false
    }

    const peOffset = dosHeader.readUInt32LE(PE_OFFSET_FIELD)
    const peHeaders = Buffer.alloc(PE_HEADERS_READ_SIZE)
    const peRead = await file.read(peHeaders, 0, PE_HEADERS_READ_SIZE, peOffset)
    if (peRead.bytesRead < PE_HEADERS_READ_SIZE || peHeaders.readUInt32LE(0) !== PE_SIGNATURE) {
      return false
    }

    return peHeaders.readUInt16LE(SUBSYSTEM_OFFSET) === SUBSYSTEM_WINDOWS_CUI
  } finally {
    await file?.close().catch(() => {})
  }
}

/**
 * Read the PE optional header's Subsystem field to detect console-subsystem
 * executables. Spawning those with `detached: true` gives them
 * DETACHED_PROCESS — no console is ever created and tools like powershell.exe
 * exit without executing anything (#486), so the spawner needs to know.
 *
 * Fails open: any unreadable/odd file reports `false` (treated as GUI), which
 * preserves the long-standing detached spawn behavior. A transient sharing
 * violation (another process briefly holding the file) is retried once after a
 * short delay before failing open, so a console app isn't misclassified merely
 * because its file was momentarily locked (#505).
 */
export async function isConsoleExecutable(exePath: string): Promise<boolean> {
  try {
    return await readSubsystemIsConsole(exePath)
  } catch (error) {
    if (!isTransientLockError(error)) {
      return false
    }
    await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_DELAY_MS))
    try {
      return await readSubsystemIsConsole(exePath)
    } catch {
      return false
    }
  }
}
