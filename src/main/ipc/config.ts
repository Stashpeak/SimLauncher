import { app, dialog, ipcMain, type OpenDialogOptions } from 'electron'
import crypto from 'crypto'
import fs from 'fs'

import { migrateProfilesToNamedSets } from '../migrator'
import { isStoredProfileSet, type StoredProfileSet } from '../profiles'
import {
  CONFIG_FILE_NAME,
  KNOWN_GAME_KEYS,
  MAX_CONFIG_IMPORT_BYTES,
  MAX_CUSTOM_SLOTS,
  getSupportedConfigValues,
  getStoredZoomFactor,
  requireSafeZoomFactor,
  sanitizeImportedConfig,
  sanitizeSettingsPatch,
  store
} from '../store'
import { isRecord } from '../utils'
import { applyTrayVisibility } from '../tray'
import { applyRuntimeConfigSettings, getMainWindow, sendToRenderer } from '../window'

const STORE_CONFIG_CHANGED_CHANNEL = 'store-config-changed'
const IMPORT_PREVIEW_TOKEN_BYTES = 24
const IMPORT_PREVIEW_TTL_MS = 5 * 60 * 1000

interface ConfigImportPreviewEntry {
  key: string
  path?: string
  args?: string
}

interface ConfigImportPreviewSummary {
  changedKeys: string[]
  gamePaths: ConfigImportPreviewEntry[]
  appPaths: ConfigImportPreviewEntry[]
  trackedProcessPaths: ConfigImportPreviewEntry[]
  customAppArgs: ConfigImportPreviewEntry[]
  droppedCount: number
  warnings: string[]
}

let pendingImport: {
  token: string
  filePath: string
  config: Record<string, unknown>
  expiresAt: number
} | null = null

type StoreConfigChangeReason =
  | 'import-config'
  | 'save-settings'
  | 'save-profile'
  | 'save-profiles'
  | 'set-migration-flags'

interface StoreConfigChangePayload {
  reason: StoreConfigChangeReason
  keys: string[]
}

function notifyStoreConfigChanged(payload: StoreConfigChangePayload) {
  sendToRenderer(STORE_CONFIG_CHANGED_CHANNEL, payload)
}

function clearPendingImport() {
  pendingImport = null
}

function countImportedPreviewItems(config: Record<string, unknown>) {
  let count = 0
  const countRecordItems = (value: unknown) => {
    if (isRecord(value)) count += Object.keys(value).length
  }

  countRecordItems(config.gamePaths)
  countRecordItems(config.appPaths)
  countRecordItems(config.appArgs)

  if (isRecord(config.profiles)) {
    Object.values(config.profiles).forEach((profileEntry) => {
      if (!isRecord(profileEntry)) return

      if (Array.isArray(profileEntry.trackedProcessPaths)) {
        count += profileEntry.trackedProcessPaths.length
      }

      if (Array.isArray(profileEntry.profiles)) {
        profileEntry.profiles.forEach((profile) => {
          if (isRecord(profile) && Array.isArray(profile.trackedProcessPaths)) {
            count += profile.trackedProcessPaths.length
          }
        })
      }
    })
  }

  return count
}

function collectTrackedProcessPathPreviews(profiles: unknown): ConfigImportPreviewEntry[] {
  if (!isRecord(profiles)) return []

  const entries: ConfigImportPreviewEntry[] = []
  Object.entries(profiles).forEach(([gameKey, profileEntry]) => {
    if (!isRecord(profileEntry)) return

    const addPaths = (paths: unknown, suffix = '') => {
      if (!Array.isArray(paths)) return
      paths.forEach((path) => {
        if (typeof path === 'string') entries.push({ key: `${gameKey}${suffix}`, path })
      })
    }

    addPaths(profileEntry.trackedProcessPaths)

    if (Array.isArray(profileEntry.profiles)) {
      profileEntry.profiles.forEach((profile) => {
        if (!isRecord(profile)) return
        const profileName = typeof profile.name === 'string' ? `/${profile.name}` : ''
        addPaths(profile.trackedProcessPaths, profileName)
      })
    }
  })

  return entries
}

export function buildImportPreviewSummary(
  rawConfig: Record<string, unknown>,
  supportedConfig: Record<string, unknown>
): ConfigImportPreviewSummary {
  const gamePaths = isRecord(supportedConfig.gamePaths)
    ? Object.entries(supportedConfig.gamePaths).flatMap(([key, path]) =>
        typeof path === 'string' ? [{ key, path }] : []
      )
    : []
  const appPaths = isRecord(supportedConfig.appPaths)
    ? Object.entries(supportedConfig.appPaths).flatMap(([key, path]) =>
        typeof path === 'string' ? [{ key, path }] : []
      )
    : []
  const customAppArgs = isRecord(supportedConfig.appArgs)
    ? Object.entries(supportedConfig.appArgs).flatMap(([key, args]) =>
        typeof args === 'string' ? [{ key, args }] : []
      )
    : []
  const trackedProcessPaths = collectTrackedProcessPathPreviews(supportedConfig.profiles)
  const previewItemCount =
    gamePaths.length + appPaths.length + customAppArgs.length + trackedProcessPaths.length
  const droppedCount = Math.max(0, countImportedPreviewItems(rawConfig) - previewItemCount)
  const warnings =
    droppedCount > 0
      ? [`${droppedCount} unsupported or invalid path/argument entries were dropped.`]
      : []

  return {
    changedKeys: Object.keys(supportedConfig).sort(),
    gamePaths,
    appPaths,
    trackedProcessPaths,
    customAppArgs,
    droppedCount,
    warnings
  }
}

async function readAndSanitizeConfig(filePath: string) {
  const stat = await fs.promises.stat(filePath)

  if (stat.size > MAX_CONFIG_IMPORT_BYTES) {
    throw new Error('Config file exceeds the 1 MB size limit.')
  }

  const rawConfig = await fs.promises.readFile(filePath, 'utf8')
  const parsedConfig: unknown = JSON.parse(rawConfig)
  if (!isRecord(parsedConfig)) {
    throw new Error('Config file must contain a JSON object.')
  }
  const supportedConfig = sanitizeImportedConfig(parsedConfig)
  const summary = buildImportPreviewSummary(parsedConfig, supportedConfig)

  return { supportedConfig, summary }
}

function applySanitizedConfig(supportedConfig: Record<string, unknown>) {
  const snapshot = { ...store.store }

  try {
    store.clear()
    setStoreEntries(supportedConfig)
    migrateProfilesToNamedSets()
    applyRuntimeConfigSettings()
    applyTrayVisibility(store.get('showTrayIcon') !== false)
    notifyStoreConfigChanged({ reason: 'import-config', keys: ['*'] })
  } catch (err) {
    store.clear()
    setStoreEntries(snapshot)
    applyRuntimeConfigSettings()
    applyTrayVisibility(store.get('showTrayIcon') !== false)
    throw err
  }
}

function setStoreEntries(values: Record<string, unknown>) {
  Object.entries(values).forEach(([key, value]) => {
    store.set(key, value)
  })
}

function getHighestCustomSlotInProfileSet(profileSet: StoredProfileSet) {
  let highest = 0

  const visitId = (id: unknown) => {
    if (typeof id !== 'string') return
    const match = id.match(/^customapp(\d+)$/)
    if (!match) return
    const slot = Number(match[1])
    if (Number.isFinite(slot) && slot > highest) {
      highest = slot
    }
  }

  profileSet.profiles.forEach((profile) => {
    if (!isRecord(profile)) return
    Object.keys(profile).forEach(visitId)
    if (Array.isArray(profile.utilities)) {
      profile.utilities.forEach((utility) => {
        if (isRecord(utility)) visitId(utility.id)
      })
    }
  })

  return highest
}

function getSanitizedProfileSet(gameKey: string, profileSet: unknown) {
  if (!KNOWN_GAME_KEYS.has(gameKey) || !isStoredProfileSet(profileSet)) {
    return undefined
  }

  const storedCustomSlots = store.get('customSlots')
  const baseSlots =
    typeof storedCustomSlots === 'number' && Number.isFinite(storedCustomSlots)
      ? storedCustomSlots
      : 1
  // Widen the allowed slot count so a profile saved in parallel with a
  // customSlots increase isn't silently stripped before save-settings lands.
  const effectiveCustomSlots = Math.min(
    MAX_CUSTOM_SLOTS,
    Math.max(baseSlots, getHighestCustomSlotInProfileSet(profileSet))
  )

  const supportedConfig = getSupportedConfigValues({
    customSlots: effectiveCustomSlots,
    profiles: { [gameKey]: profileSet }
  })
  const profiles = supportedConfig.profiles

  if (!isRecord(profiles)) {
    return undefined
  }

  const sanitizedProfileSet = profiles[gameKey]
  return isStoredProfileSet(sanitizedProfileSet) ? sanitizedProfileSet : undefined
}

function getSanitizedProfileRecord(profiles: unknown) {
  if (!isRecord(profiles)) {
    return undefined
  }

  const safeProfiles: Record<string, unknown> = {}

  Object.entries(profiles).forEach(([gameKey, profileSet]) => {
    const sanitizedProfileSet = getSanitizedProfileSet(gameKey, profileSet)

    if (sanitizedProfileSet) {
      safeProfiles[gameKey] = sanitizedProfileSet
    }
  })

  return Object.keys(safeProfiles).length > 0 ? safeProfiles : undefined
}

export function registerConfigHandlers(): void {
  ipcMain.handle('export-config', async () => {
    try {
      const options = {
        title: 'Export SimLauncher Config',
        defaultPath: CONFIG_FILE_NAME,
        filters: [{ name: 'JSON Files', extensions: ['json'] }]
      }
      const mainWindow = getMainWindow()
      const result = mainWindow
        ? await dialog.showSaveDialog(mainWindow, options)
        : await dialog.showSaveDialog(options)

      if (result.canceled || !result.filePath) {
        return { success: false, canceled: true }
      }

      await fs.promises.writeFile(
        result.filePath,
        JSON.stringify(getSupportedConfigValues(store.store), null, 2),
        'utf8'
      )
      return { success: true, filePath: result.filePath }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('Failed to export config:', err)
      return { success: false, error: message }
    }
  })

  ipcMain.handle('import-config', async () => {
    try {
      const options: OpenDialogOptions = {
        title: 'Import SimLauncher Config',
        properties: ['openFile'],
        filters: [{ name: 'JSON Files', extensions: ['json'] }]
      }
      const mainWindow = getMainWindow()
      const result = mainWindow
        ? await dialog.showOpenDialog(mainWindow, options)
        : await dialog.showOpenDialog(options)

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, canceled: true }
      }

      const filePath = result.filePaths[0]
      const { supportedConfig } = await readAndSanitizeConfig(filePath)
      applySanitizedConfig(supportedConfig)

      return { success: true, filePath }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('Failed to import config:', err)
      return { success: false, error: message }
    }
  })

  ipcMain.handle('preview-import-config', async () => {
    try {
      clearPendingImport()
      const options: OpenDialogOptions = {
        title: 'Import SimLauncher Config',
        properties: ['openFile'],
        filters: [{ name: 'JSON Files', extensions: ['json'] }]
      }
      const mainWindow = getMainWindow()
      const result = mainWindow
        ? await dialog.showOpenDialog(mainWindow, options)
        : await dialog.showOpenDialog(options)

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, canceled: true }
      }

      const filePath = result.filePaths[0]
      const { supportedConfig, summary } = await readAndSanitizeConfig(filePath)
      const token = crypto.randomBytes(IMPORT_PREVIEW_TOKEN_BYTES).toString('base64url')
      pendingImport = {
        token,
        filePath,
        config: supportedConfig,
        expiresAt: Date.now() + IMPORT_PREVIEW_TTL_MS
      }

      return { success: true, token, filePath, summary }
    } catch (err) {
      clearPendingImport()
      const message = err instanceof Error ? err.message : String(err)
      console.error('Failed to preview config import:', err)
      return { success: false, error: message }
    }
  })

  ipcMain.handle('apply-import-config', async (_event, token: unknown) => {
    try {
      if (typeof token !== 'string' || !pendingImport || pendingImport.token !== token) {
        return { success: false, error: 'Import preview expired or is no longer valid.' }
      }

      if (Date.now() > pendingImport.expiresAt) {
        clearPendingImport()
        return { success: false, error: 'Import preview expired. Please choose the config again.' }
      }

      const { filePath, config } = pendingImport
      clearPendingImport()
      applySanitizedConfig(config)

      return { success: true, filePath }
    } catch (err) {
      clearPendingImport()
      const message = err instanceof Error ? err.message : String(err)
      console.error('Failed to apply config import:', err)
      return { success: false, error: message }
    }
  })

  ipcMain.handle('cancel-import-config', async (_event, token: unknown) => {
    if (typeof token === 'string' && pendingImport?.token === token) {
      clearPendingImport()
    }

    return { success: true }
  })

  ipcMain.handle('get-version', () => {
    return app.getVersion()
  })

  ipcMain.handle('set-login-item', (_event, openAtLogin: unknown) => {
    if (typeof openAtLogin !== 'boolean') return
    app.setLoginItemSettings({ openAtLogin })
  })

  ipcMain.handle('set-zoom', (_event, factor: unknown) => {
    const zoomFactor = requireSafeZoomFactor(factor)
    const webContents = getMainWindow()?.webContents
    if (!webContents) return
    // Skip same-value calls: re-setting the current zoom on a still-hidden
    // window suppresses 'ready-to-show' on Electron 42 (#382), and the
    // renderer's boot-time set-zoom is always same-value (both sides read the
    // same store).
    if (Math.abs(webContents.getZoomFactor() - zoomFactor) < 0.001) return
    webContents.setZoomFactor(zoomFactor)
  })

  ipcMain.handle('get-settings', () => {
    return {
      appPaths: store.get('appPaths'),
      gamePaths: store.get('gamePaths'),
      appNames: store.get('appNames'),
      appArgs: store.get('appArgs'),
      customSlots: store.get('customSlots'),
      accentPreset: store.get('accentPreset'),
      accentCustom: store.get('accentCustom'),
      accentBgTint: store.get('accentBgTint'),
      themeMode: store.get('themeMode'),
      focusActiveTitle: store.get('focusActiveTitle'),
      launchDelayMs: store.get('launchDelayMs'),
      startWithWindows: store.get('startWithWindows'),
      startMinimized: store.get('startMinimized'),
      minimizeToTray: store.get('minimizeToTray'),
      showTrayIcon: store.get('showTrayIcon'),
      autoCheckUpdates: store.get('autoCheckUpdates'),
      zoomFactor: getStoredZoomFactor()
    }
  })

  ipcMain.handle('save-settings', (_event, patch: unknown) => {
    if (!isRecord(patch)) return
    const safe = sanitizeSettingsPatch(patch)
    const changedKeys = Object.keys(safe)
    if (changedKeys.length > 0) {
      setStoreEntries(safe)
      if (changedKeys.includes('showTrayIcon')) {
        applyTrayVisibility(store.get('showTrayIcon') !== false)
      }
      notifyStoreConfigChanged({ reason: 'save-settings', keys: changedKeys })
    }
  })

  ipcMain.handle('get-profiles', () => {
    return store.get('profiles')
  })

  ipcMain.handle('save-profile', (_event, gameKey: unknown, profileSet: unknown) => {
    if (typeof gameKey !== 'string' || !gameKey) return
    const sanitizedProfileSet = getSanitizedProfileSet(gameKey, profileSet)
    if (!sanitizedProfileSet) return
    const storedProfiles = store.get('profiles')
    const profiles = isRecord(storedProfiles) ? storedProfiles : {}
    profiles[gameKey] = sanitizedProfileSet
    store.set('profiles', profiles)
    notifyStoreConfigChanged({ reason: 'save-profile', keys: ['profiles'] })
  })

  ipcMain.handle('save-profiles', (_event, profiles: unknown) => {
    const sanitizedProfiles = getSanitizedProfileRecord(profiles)
    if (!sanitizedProfiles) return
    store.set('profiles', sanitizedProfiles)
    notifyStoreConfigChanged({ reason: 'save-profiles', keys: ['profiles'] })
  })

  ipcMain.handle('get-migration-flags', () => {
    return {
      migrated: store.get('migrated'),
      profileUtilityOrderMigrated: store.get('profileUtilityOrderMigrated'),
      profileSetsMigrated: store.get('profileSetsMigrated')
    }
  })

  ipcMain.handle('set-migration-flags', (_event, patch: unknown) => {
    if (!isRecord(patch)) return
    const MIGRATION_KEYS = [
      'migrated',
      'profileUtilityOrderMigrated',
      'profileSetsMigrated'
    ] as const
    const safe: Record<string, boolean> = {}
    for (const key of MIGRATION_KEYS) {
      if (key in patch && typeof patch[key] === 'boolean') safe[key] = patch[key] as boolean
    }
    const changedKeys = Object.keys(safe)
    if (changedKeys.length > 0) {
      setStoreEntries(safe)
      notifyStoreConfigChanged({ reason: 'set-migration-flags', keys: changedKeys })
    }
  })
}
