import { app, dialog, ipcMain } from 'electron'
import fs from 'fs'

import { migrateProfilesToNamedSets } from '../migrator'
import {
  CONFIG_FILE_NAME,
  EXPECTED_CONFIG_KEYS,
  getSupportedConfigValues,
  requireSafeZoomFactor,
  store,
  validateImportedConfig
} from '../store'
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

      await fs.promises.writeFile(result.filePath, JSON.stringify(getSupportedConfigValues(store.store), null, 2), 'utf8')
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

      const rawConfig = await fs.promises.readFile(result.filePaths[0], 'utf8')
      const parsedConfig = JSON.parse(rawConfig) as unknown
      validateImportedConfig(parsedConfig)
      const supportedConfig = getSupportedConfigValues(parsedConfig)

      store.clear()
      store.set(supportedConfig)
      migrateProfilesToNamedSets()
      applyRuntimeConfigSettings()

      return { success: true, filePath: result.filePaths[0] }
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
    store.set('startWithWindows', openAtLogin)
    app.setLoginItemSettings({ openAtLogin })
  })

  ipcMain.handle('set-zoom', (_event, factor: unknown) => {
    const zoomFactor = requireSafeZoomFactor(factor)

    store.set('zoomFactor', zoomFactor)
    getMainWindow()?.webContents.setZoomFactor(zoomFactor)
  })

  ipcMain.handle('store-get', (_event, key: unknown) => {
    if (typeof key !== 'string' || !EXPECTED_CONFIG_KEYS.has(key)) return undefined
    return store.get(key)
  })

  ipcMain.handle('store-set', (_event, key: unknown, value: unknown) => {
    if (typeof key !== 'string' || !EXPECTED_CONFIG_KEYS.has(key)) return
    if (key === 'zoomFactor') {
      store.set('zoomFactor', requireSafeZoomFactor(value))
      return
    }

    store.set(key, value)
  })
}
