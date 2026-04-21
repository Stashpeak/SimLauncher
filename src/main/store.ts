import Store from 'electron-store'

import { clamp, isRecord } from './utils'

export const DEFAULT_ZOOM_FACTOR = 1.0
export const MIN_ZOOM_FACTOR = 0.5
export const MAX_ZOOM_FACTOR = 3.0

export const store = new Store({
  schema: {
    appPaths:     { type: 'object',  default: {} },
    gamePaths:    { type: 'object',  default: {} },
    profiles:     { type: 'object',  default: {} },
    appNames:     { type: 'object',  default: {} },
    customSlots:  { type: 'number',  default: 1, minimum: 1 },
    accentPreset: { type: 'string',  default: '' },
    accentCustom: { type: 'string',  default: '' },
    accentBgTint: { type: 'boolean', default: false },
    focusActiveTitle: { type: 'boolean', default: true },
    launchDelayMs: { type: 'number', default: 1000, minimum: 0, maximum: 5000 },
    startWithWindows: { type: 'boolean', default: false },
    startMinimized:   { type: 'boolean', default: false },
    minimizeToTray:   { type: 'boolean', default: false },
    autoCheckUpdates:  { type: 'boolean', default: true },
    zoomFactor:       { type: 'number',  default: DEFAULT_ZOOM_FACTOR },
    windowBounds:      { type: 'object',  default: {} },
    profileUtilityOrderMigrated: { type: 'boolean', default: false },
    profileSetsMigrated: { type: 'boolean', default: false },
    migrated:     { type: 'boolean', default: false },
  }
})

export const CONFIG_FILE_NAME = 'simlauncher-config.json'
export const EXPECTED_CONFIG_KEYS = new Set([
  'appPaths',
  'gamePaths',
  'profiles',
  'appNames',
  'customSlots',
  'accentPreset',
  'accentCustom',
  'accentBgTint',
  'focusActiveTitle',
  'launchDelayMs',
  'startWithWindows',
  'startMinimized',
  'minimizeToTray',
  'autoCheckUpdates',
  'zoomFactor',
  'windowBounds',
  'profileUtilityOrderMigrated',
  'profileSetsMigrated',
  'migrated'
])
const LEGACY_CONFIG_KEYS = new Set([
  'killOnClose'
])
const IMPORTABLE_CONFIG_KEYS = new Set([...EXPECTED_CONFIG_KEYS, ...LEGACY_CONFIG_KEYS])
const OBJECT_CONFIG_KEYS = new Set(['appPaths', 'gamePaths', 'profiles', 'appNames', 'windowBounds'])
const STRING_CONFIG_KEYS = new Set(['accentPreset', 'accentCustom'])
const BOOLEAN_CONFIG_KEYS = new Set([
  'accentBgTint',
  'focusActiveTitle',
  'startWithWindows',
  'startMinimized',
  'minimizeToTray',
  'autoCheckUpdates',
  'profileUtilityOrderMigrated',
  'profileSetsMigrated',
  'migrated'
])
const LEGACY_BOOLEAN_CONFIG_KEYS = new Set([
  'killOnClose'
])

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

export function isWindowBounds(value: unknown): value is WindowBounds {
  if (!value || typeof value !== 'object') {
    return false
  }

  const bounds = value as Record<string, unknown>
  return ['x', 'y', 'width', 'height'].every((key) => {
    const coordinate = bounds[key]
    return typeof coordinate === 'number' && Number.isFinite(coordinate)
  })
}

export function requireSafeZoomFactor(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Zoom factor must be a finite number from ${MIN_ZOOM_FACTOR} to ${MAX_ZOOM_FACTOR}.`)
  }

  return clamp(value, MIN_ZOOM_FACTOR, MAX_ZOOM_FACTOR)
}

function getSafeZoomFactor(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_ZOOM_FACTOR
  }

  return clamp(value, MIN_ZOOM_FACTOR, MAX_ZOOM_FACTOR)
}

export function getStoredZoomFactor() {
  const storedZoomFactor = store.get('zoomFactor')
  const safeZoomFactor = getSafeZoomFactor(storedZoomFactor)

  if (storedZoomFactor !== safeZoomFactor) {
    store.set('zoomFactor', safeZoomFactor)
  }

  return safeZoomFactor
}

export function validateImportedConfig(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error('Config file must contain a JSON object.')
  }

  const keys = Object.keys(value)

  if (keys.length === 0) {
    throw new Error('Config file is empty.')
  }

  const unexpectedKeys = keys.filter((key) => !IMPORTABLE_CONFIG_KEYS.has(key))

  if (unexpectedKeys.length > 0) {
    throw new Error(`Config file contains unsupported keys: ${unexpectedKeys.join(', ')}`)
  }

  if (!keys.some((key) => EXPECTED_CONFIG_KEYS.has(key))) {
    throw new Error('Config file does not contain SimLauncher settings.')
  }

  keys.forEach((key) => {
    const setting = value[key]

    if (OBJECT_CONFIG_KEYS.has(key) && !isRecord(setting)) {
      throw new Error(`Config value "${key}" must be an object.`)
    }

    if (STRING_CONFIG_KEYS.has(key) && typeof setting !== 'string') {
      throw new Error(`Config value "${key}" must be a string.`)
    }

    if (BOOLEAN_CONFIG_KEYS.has(key) && typeof setting !== 'boolean') {
      throw new Error(`Config value "${key}" must be a boolean.`)
    }

    if (LEGACY_BOOLEAN_CONFIG_KEYS.has(key) && typeof setting !== 'boolean') {
      throw new Error(`Config value "${key}" must be a boolean.`)
    }

    if (key === 'customSlots') {
      if (typeof setting !== 'number' || !Number.isFinite(setting) || setting < 1) {
        throw new Error('Config value "customSlots" must be a number greater than or equal to 1.')
      }
    }

    if (key === 'launchDelayMs') {
      if (typeof setting !== 'number' || !Number.isFinite(setting) || setting < 0 || setting > 5000) {
        throw new Error('Config value "launchDelayMs" must be a number from 0 to 5000.')
      }
    }

    if (key === 'zoomFactor') {
      if (typeof setting !== 'number' || !Number.isFinite(setting)) {
        throw new Error(`Config value "zoomFactor" must be a finite number from ${MIN_ZOOM_FACTOR} to ${MAX_ZOOM_FACTOR}.`)
      }
    }
  })

  return true
}

export function getSupportedConfigValues(config: Record<string, unknown>) {
  const supportedConfig: Record<string, unknown> = {}

  Object.entries(config).forEach(([key, value]) => {
    if (EXPECTED_CONFIG_KEYS.has(key)) {
      supportedConfig[key] = key === 'zoomFactor' ? requireSafeZoomFactor(value) : value
    }
  })

  return supportedConfig
}
