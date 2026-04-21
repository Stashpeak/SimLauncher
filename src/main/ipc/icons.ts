import { app, ipcMain, nativeImage } from 'electron'
import fs from 'fs'
import path from 'path'

import { store } from '../store'

let genericIconFingerprint: string | null | undefined
let genericIconFingerprintPromise: Promise<string | null> | null = null

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
    if (typeof filename !== 'string' || path.basename(filename) !== filename || !filename) return null
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
    const storedPaths = [
      ...Object.values((store.get('gamePaths') as Record<string, string>) ?? {}),
      ...Object.values((store.get('appPaths') as Record<string, string>) ?? {})
    ]
    if (!storedPaths.includes(filePath)) return null

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
