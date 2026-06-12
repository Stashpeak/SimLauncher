import { app, ipcMain, nativeImage } from 'electron'
import fs from 'fs'
import path from 'path'

import { getStoredStringRecord } from '../store'
import { normalizePathForComparison } from '../utils'

// Three-state sentinel: `undefined` = not yet computed, `null` = computation
// failed or platform does not support fingerprinting, `string` = cached data URL.
let genericIconFingerprint: string | null | undefined
// In-flight singleton promise so concurrent calls to getGenericIconFingerprint
// share a single computation rather than spawning multiple temp-file writes.
let genericIconFingerprintPromise: Promise<string | null> | null = null

// The set acts as an LRU approximation: insertion order is preserved by Set,
// so eviction always removes the oldest entry. 32 entries comfortably covers a
// full Settings page reload without unbounded growth.
const RECENTLY_BROWSED_PATH_LIMIT = 32
const recentlyBrowsedPaths = new Set<string>()

/**
 * Marks a file path as having been selected by the user via the OS file
 * dialog. This grants `get-file-icon` permission to read its icon before the
 * path has been persisted to the store, so freshly picked executables show
 * their icon immediately in Settings rather than only after an app restart.
 *
 * Paths are stored canonicalised so case/slash variants of the same file
 * collapse to one entry (see `normalizePathForComparison`).
 */
export function markRecentlyBrowsedPath(filePath: string): void {
  if (typeof filePath !== 'string' || !filePath) return
  const key = normalizePathForComparison(filePath)
  if (!key) return
  if (recentlyBrowsedPaths.has(key)) {
    recentlyBrowsedPaths.delete(key)
  }
  recentlyBrowsedPaths.add(key)
  while (recentlyBrowsedPaths.size > RECENTLY_BROWSED_PATH_LIMIT) {
    const oldest = recentlyBrowsedPaths.values().next().value
    if (oldest === undefined) break
    recentlyBrowsedPaths.delete(oldest)
  }
}

/**
 * Captures the data URL of the generic Windows "unknown application" icon by
 * asking Electron to resolve the icon for a freshly created empty .exe file.
 * This fingerprint is later compared against icon lookups to suppress the
 * generic placeholder — showing it in the UI would be misleading since it
 * implies we found a real icon when we did not.
 *
 * The temp file uses process.pid + timestamp + random suffix to avoid
 * collisions when multiple Electron instances run side-by-side (e.g. during
 * development). The `.exe` extension is required: Windows' shell icon resolver
 * uses file extension to pick the icon source.
 *
 * Only meaningful on Win32; other platforms return null immediately.
 */
async function computeGenericIconFingerprint() {
  if (process.platform !== 'win32') {
    return null
  }

  const tempExePath = path.join(
    app.getPath('temp'),
    `simlauncher-generic-icon-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.exe`
  )
  let tempFileCreated = false

  try {
    // 'wx' flag: create exclusively, fail if the file already exists.
    const fileDescriptor = fs.openSync(tempExePath, 'wx')
    fs.closeSync(fileDescriptor)
    tempFileCreated = true

    const icon = await app.getFileIcon(tempExePath, { size: 'normal' })
    return icon.isEmpty() ? null : icon.toDataURL()
  } catch (err) {
    console.error('Failed to fingerprint generic Windows app icon:', err)
    return null
  } finally {
    if (tempFileCreated) {
      try {
        fs.unlinkSync(tempExePath)
      } catch {
        // Cleanup failures should not hide valid executable icons.
      }
    }
  }
}

function getGenericIconFingerprint() {
  if (genericIconFingerprint !== undefined) {
    return Promise.resolve(genericIconFingerprint)
  }

  if (!genericIconFingerprintPromise) {
    genericIconFingerprintPromise = computeGenericIconFingerprint()
      .then((fingerprint) => {
        genericIconFingerprint = fingerprint
        return fingerprint
      })
      .catch((err) => {
        console.error('Failed to cache generic Windows app icon fingerprint:', err)
        genericIconFingerprint = null
        return null
      })
      .finally(() => {
        genericIconFingerprintPromise = null
      })
  }

  return genericIconFingerprintPromise
}

export function registerIconHandlers(): void {
  // get-asset-data: basename check enforces that `filename` is a plain file
  // name with no path separators, preventing directory traversal outside the
  // assets directory (e.g. "../../main.js" would fail basename comparison).
  ipcMain.handle('get-asset-data', async (_event, filename: unknown) => {
    if (typeof filename !== 'string' || path.basename(filename) !== filename || !filename)
      return null
    const assetsPath = app.isPackaged
      ? path.join(process.resourcesPath, 'assets')
      : path.join(app.getAppPath(), 'assets')
    const fullPath = path.join(assetsPath, filename)
    try {
      const img = nativeImage.createFromPath(fullPath)
      if (img.isEmpty()) return null
      return img.toDataURL()
    } catch (err) {
      console.error(`Error loading asset ${filename}:`, err)
      return null
    }
  })

  // get-file-icon: access-controlled icon fetch. Only paths that are already
  // persisted in the store OR were recently selected via the OS file picker
  // (markRecentlyBrowsedPath) are allowed. This prevents the renderer from
  // using this channel to probe arbitrary file paths on disk for their icons.
  ipcMain.handle('get-file-icon', async (_event, filePath: string) => {
    const storedPathKeys = new Set(
      [
        ...Object.values(getStoredStringRecord('gamePaths')),
        ...Object.values(getStoredStringRecord('appPaths'))
      ]
        .map(normalizePathForComparison)
        .filter((key) => key.length > 0)
    )
    const filePathKey = normalizePathForComparison(filePath)
    if (
      !filePathKey ||
      (!storedPathKeys.has(filePathKey) && !recentlyBrowsedPaths.has(filePathKey))
    )
      return null

    try {
      const icon = await app.getFileIcon(filePath, { size: 'normal' })

      if (icon.isEmpty()) {
        return null
      }

      const iconDataUrl = icon.toDataURL()
      const genericFingerprint = await getGenericIconFingerprint()

      if (genericFingerprint && iconDataUrl === genericFingerprint) {
        return null
      }

      return iconDataUrl
    } catch (err) {
      console.error(`Failed to get file icon for ${filePath}:`, err)
      return null
    }
  })
}
