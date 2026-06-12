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

/**
 * Read the PE optional header's Subsystem field to detect console-subsystem
 * executables. Spawning those with `detached: true` gives them
 * DETACHED_PROCESS — no console is ever created and tools like powershell.exe
 * exit without executing anything (#486), so the spawner needs to know.
 *
 * Fails open: any unreadable/odd file reports `false` (treated as GUI), which
 * preserves the long-standing detached spawn behavior.
 */
export async function isConsoleExecutable(exePath: string): Promise<boolean> {
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
  } catch {
    return false
  } finally {
    await file?.close().catch(() => {})
  }
}
