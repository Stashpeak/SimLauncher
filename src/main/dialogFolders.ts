/**
 * Which folder the native file dialogs open in (#907).
 *
 * Up to Electron 42, a dialog given no `defaultPath` let Windows choose, and
 * Windows reopened the folder the user last browsed to, across restarts.
 * Electron 43 fills an empty `defaultPath` with the Downloads folder and hands
 * it to Windows as a forced folder, so every Browse and every import now starts
 * in Downloads and Windows' own memory is never consulted again
 * (electron/electron#49868). This module puts the memory back in the main
 * process, so the renderer and the IPC contract do not change.
 *
 * Two kinds of folder rather than the single one Windows kept: executables and
 * config files almost never live together, so a shared memory would send the
 * import dialog into a game folder right after a Browse.
 *
 * The export dialog does not take its folder from here. It passes a bare file
 * name, which Electron leaves alone (neither the Downloads default nor a forced
 * folder applies to a relative `defaultPath`), so Windows still picks its
 * folder exactly as it did on 42. It does record where the file went, so the
 * next import opens next to the last export.
 */
import fs from 'fs'
import path from 'path'

import { getStoredStringRecord, store } from './store'
import { isRecord } from './utils'

/** Which remembered folder a dialog reads and updates. */
export type DialogFolderKind = 'executable' | 'config'

// Persisted, unlike the per-field map below, because Windows kept its memory
// across restarts, and a game installed since the last run is found by the
// first Browse of a session. A schema key with a default, so an older config
// simply reads {} and nothing has to be migrated. Local-only, see store.ts.
const STORE_KEY = 'dialogFolders'

// This session's last pick per Browse field. Main can only read the SAVED
// path of a field, so without this a second Browse on a field whose unsaved
// value the user just picked would reopen the old saved folder, the one they
// had just navigated away from. Not persisted: after a restart the saved path
// is the better answer. Grows only on a real pick in a native dialog.
const lastPickByField = new Map<string, string>()

// A saved path on an unreachable network share keeps `stat` pending for the
// SMB timeout, measured at about 21 s (#907). On Electron 42 the dialog opened
// at once, so a candidate that has not answered by then is skipped rather than
// waited for: the dialog then opens one candidate further down, or in
// Downloads, instead of after a long freeze with no feedback.
const FOLDER_CHECK_TIMEOUT_MS = 1000

/**
 * The saved path of the setting a Browse button fills, found from the input id
 * the renderer sends with `browse-path`.
 *
 * Game rows and companion slots send their store key (`acc`, `simhub`,
 * `customapp3`), and no game key is also a companion key, so the id finds the
 * saved path directly. A profile's secondary executable sends
 * `<game>-tracked-<n>`, which names a row of whichever profile is open in the
 * editor rather than a stored value, so it finds nothing and falls through to
 * the remembered folder.
 */
export function getSavedPathForInput(
  inputId: string,
  gamePaths: Record<string, string>,
  appPaths: Record<string, string>
): string | undefined {
  // Own keys only: the id comes from the renderer, and `constructor` must not
  // resolve to something inherited.
  for (const record of [gamePaths, appPaths]) {
    if (Object.prototype.hasOwnProperty.call(record, inputId)) return record[inputId]
  }
  return undefined
}

/**
 * The folders a Browse dialog may open in, best first: where this field's
 * last pick this session was, then the folder of the field's saved path, then
 * the last folder any Browse used. Only paths with a drive or a UNC root
 * survive, because Electron forces a folder only for an absolute
 * `defaultPath`, by Chromium's stricter definition, and reads anything else
 * as a file name to prefill.
 *
 * Pure, so the order is testable without a filesystem or a store.
 */
export function getBrowseFolderCandidates(input: {
  lastPickForField?: string
  savedPath?: string
  lastFolder?: string
}): string[] {
  const savedPath = input.savedPath?.trim()
  const savedFolder = savedPath ? path.win32.dirname(savedPath) : undefined
  return uniqueAbsolute([input.lastPickForField, savedFolder, input.lastFolder])
}

/**
 * The first candidate that is an existing folder, or undefined when none is,
 * in which case the caller passes no `defaultPath` and Electron opens
 * Downloads. Checked here rather than left to the dialog because a folder
 * that no longer exists is not ignored by Electron: it treats the path as a
 * file name, prefills its last segment into the name box and opens the
 * parent. Never rejects.
 */
export async function firstExistingFolder(
  candidates: readonly string[],
  isFolder: (candidate: string) => Promise<boolean> = isExistingFolder
): Promise<string | undefined> {
  for (const candidate of candidates) {
    try {
      if (await isFolder(candidate)) return candidate
    } catch {
      // An unreadable candidate is just not the answer; try the next.
    }
  }
  return undefined
}

/** Where the Browse dialog for `inputId` should open. Never rejects. */
export async function getBrowseDefaultPath(inputId: string): Promise<string | undefined> {
  try {
    return await firstExistingFolder(
      getBrowseFolderCandidates({
        lastPickForField: lastPickByField.get(inputId),
        savedPath: getSavedPathForInput(
          inputId,
          getStoredStringRecord('gamePaths'),
          getStoredStringRecord('appPaths')
        ),
        lastFolder: getRememberedFolder('executable')
      })
    )
  } catch {
    // A folder hint must never cost the user the dialog itself.
    return undefined
  }
}

/** Records the folder of an executable the user picked through Browse. */
export function rememberBrowsePick(inputId: string, filePath: string): void {
  const folder = folderOf(filePath)
  if (!folder) return
  lastPickByField.set(inputId, folder)
  rememberFolder('executable', folder)
}

/** Where the config import dialog should open. Never rejects. */
export async function getConfigFileDefaultPath(): Promise<string | undefined> {
  try {
    return await firstExistingFolder(uniqueAbsolute([getRememberedFolder('config')]))
  } catch {
    return undefined
  }
}

/** Records the folder of a config file the user imported or exported. */
export function rememberConfigFile(filePath: string): void {
  const folder = folderOf(filePath)
  if (folder) rememberFolder('config', folder)
}

// Chromium's FilePath::IsAbsolute on Windows, which is the test Electron
// applies to `defaultPath`: a drive letter and a separator, or a leading pair
// of separators. Node's path.win32.isAbsolute also accepts a drive-less rooted
// path such as `\Windows`, which Electron would treat as relative.
const ABSOLUTE_FOR_ELECTRON = /^(?:[A-Za-z]:[\\/]|[\\/]{2})/

function isAbsoluteForElectron(candidate: unknown): candidate is string {
  return typeof candidate === 'string' && ABSOLUTE_FOR_ELECTRON.test(candidate)
}

function uniqueAbsolute(candidates: readonly (string | undefined)[]): string[] {
  return [...new Set(candidates.filter(isAbsoluteForElectron))]
}

function folderOf(filePath: string): string | undefined {
  if (!isAbsoluteForElectron(filePath)) return undefined
  return path.win32.dirname(filePath)
}

/**
 * Whether `candidate` is an existing directory, answered within `timeoutMs`;
 * a check still pending then counts as "no". Rejects when `stat` does, which
 * {@link firstExistingFolder} treats the same way.
 */
export async function isExistingFolder(
  candidate: string,
  stat: (target: string) => Promise<{ isDirectory(): boolean }> = fs.promises.stat,
  timeoutMs = FOLDER_CHECK_TIMEOUT_MS
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const unanswered = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs)
  })
  try {
    return await Promise.race([stat(candidate).then((stats) => stats.isDirectory()), unanswered])
  } finally {
    clearTimeout(timer)
  }
}

function getRememberedFolder(kind: DialogFolderKind): string | undefined {
  try {
    const folder = getStoredStringRecord(STORE_KEY)[kind]
    return typeof folder === 'string' ? folder : undefined
  } catch {
    return undefined
  }
}

function rememberFolder(kind: DialogFolderKind, folder: string): void {
  try {
    const stored = store.get(STORE_KEY)
    store.set(STORE_KEY, { ...(isRecord(stored) ? stored : {}), [kind]: folder })
  } catch {
    // A convenience, not state: failing to save it must not fail the pick.
  }
}
