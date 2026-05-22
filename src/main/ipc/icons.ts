import { app, ipcMain, nativeImage } from 'electron'
import fs from 'fs'
import path from 'path'

import { getStoredStringRecord } from '../store'
import { normalizePathForComparison } from '../utils'

let genericIconFingerprint: string | null | undefined
let genericIconFingerprintPromise: Promise<string | null> | null = null

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
export function markRecentlyBrowsedPath(filePath: string) {
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

export function registerIconHandlers() {
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
