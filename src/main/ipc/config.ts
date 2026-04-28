import { app, dialog, ipcMain } from 'electron'
import fs from 'fs'

import { migrateProfilesToNamedSets } from '../migrator'
import { isStoredProfileSet, type StoredNamedProfile } from '../profiles'
import {
  CONFIG_FILE_NAME,
  MAX_CONFIG_IMPORT_BYTES,
  MAX_CUSTOM_SLOTS,
  getSupportedConfigValues,
  getStoredZoomFactor,
  requireSafeZoomFactor,
  sanitizeImportedConfig,
  store
} from '../store'
import { isRecord } from '../utils'
import { applyRuntimeConfigSettings, getMainWindow } from '../window'

export function registerConfigHandlers() {
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
      const options = {
        title: 'Import SimLauncher Config',
        properties: ['openFile'] as const,
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
      const stat = await fs.promises.stat(filePath)

      if (stat.size > MAX_CONFIG_IMPORT_BYTES) {
        return { success: false, error: 'Config file exceeds the 1 MB size limit.' }
      }

      const rawConfig = await fs.promises.readFile(filePath, 'utf8')
      const parsedConfig: unknown = JSON.parse(rawConfig)
      const supportedConfig = sanitizeImportedConfig(parsedConfig)
      const snapshot = { ...store.store }

      try {
        store.clear()
        store.set(supportedConfig)
        migrateProfilesToNamedSets()
        applyRuntimeConfigSettings()
      } catch (err) {
        store.clear()
        store.set(snapshot)
        applyRuntimeConfigSettings()
        throw err
      }

      return { success: true, filePath }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('Failed to import config:', err)
      return { success: false, error: message }
    }
  })

  ipcMain.handle('get-version', () => {
    return app.getVersion()
  })

  ipcMain.handle('set-login-item', (_event, openAtLogin: boolean) => {
    app.setLoginItemSettings({ openAtLogin })
  })

  ipcMain.handle('set-zoom', (_event, factor: unknown) => {
    const zoomFactor = requireSafeZoomFactor(factor)
    getMainWindow()?.webContents.setZoomFactor(zoomFactor)
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
      autoCheckUpdates: store.get('autoCheckUpdates'),
      zoomFactor: getStoredZoomFactor()
    }
  })

  ipcMain.handle('save-settings', (_event, patch: unknown) => {
    if (!isRecord(patch)) return
    const OBJECT_KEYS = new Set(['appPaths', 'gamePaths', 'appNames', 'appArgs'])
    const BOOLEAN_KEYS = new Set([
      'accentBgTint',
      'focusActiveTitle',
      'startMinimized',
      'minimizeToTray',
      'autoCheckUpdates',
      'startWithWindows'
    ])
    const STRING_KEYS = new Set(['accentPreset', 'accentCustom'])
    const THEME_MODES = new Set(['light', 'dark', 'system'])
    const WRITABLE_KEYS = new Set([
      ...OBJECT_KEYS,
      ...BOOLEAN_KEYS,
      ...STRING_KEYS,
      'themeMode',
      'customSlots',
      'launchDelayMs',
      'zoomFactor'
    ])

    const safe: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(patch)) {
      if (!WRITABLE_KEYS.has(key)) continue
      if (OBJECT_KEYS.has(key) && isRecord(value)) {
        safe[key] = value
      } else if (BOOLEAN_KEYS.has(key) && typeof value === 'boolean') {
        safe[key] = value
      } else if (STRING_KEYS.has(key) && typeof value === 'string') {
        safe[key] = value
      } else if (key === 'themeMode' && typeof value === 'string' && THEME_MODES.has(value)) {
        safe.themeMode = value
      } else if (
        key === 'customSlots' &&
        typeof value === 'number' &&
        Number.isFinite(value) &&
        value >= 1
      ) {
        safe[key] = Math.min(Math.floor(value), MAX_CUSTOM_SLOTS)
      } else if (key === 'launchDelayMs' && typeof value === 'number' && Number.isFinite(value)) {
        safe[key] = Math.min(Math.max(Math.round(value), 0), 5000)
      } else if (key === 'zoomFactor' && typeof value === 'number' && Number.isFinite(value)) {
        safe[key] = requireSafeZoomFactor(value)
      }
    }
    if (Object.keys(safe).length > 0) store.set(safe)
  })

  ipcMain.handle('get-profiles', () => {
    return store.get('profiles')
  })

  ipcMain.handle('save-profile', (_event, gameKey: unknown, profileSet: unknown) => {
    if (typeof gameKey !== 'string' || !gameKey) return
    if (!isStoredProfileSet(profileSet)) return
    const validProfiles = profileSet.profiles.filter(
      (p): p is StoredNamedProfile =>
        !!p &&
        typeof p === 'object' &&
        typeof (p as Record<string, unknown>).id === 'string' &&
        typeof (p as Record<string, unknown>).name === 'string'
    )
    if (validProfiles.length === 0) return
    const profiles = (store.get('profiles') as Record<string, unknown> | undefined) || {}
    profiles[gameKey] = { activeProfileId: profileSet.activeProfileId, profiles: validProfiles }
    store.set('profiles', profiles)
  })

  ipcMain.handle('save-profiles', (_event, profiles: unknown) => {
    if (!isRecord(profiles)) return
    store.set('profiles', profiles)
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
    if (Object.keys(safe).length > 0) store.set(safe)
  })
}
