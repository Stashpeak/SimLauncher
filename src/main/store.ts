import Store from 'electron-store'

import { clamp, isRecord } from './utils'

export const DEFAULT_ZOOM_FACTOR = 1.0
export const MIN_ZOOM_FACTOR = 0.5
export const MAX_ZOOM_FACTOR = 3.0
export const MAX_CUSTOM_SLOTS = 10
export const MAX_CONFIG_IMPORT_BYTES = 1_000_000

const MAX_IMPORT_PATH_LENGTH = 300
const MAX_CONFIG_STRING_LENGTH = 100
const MAX_ACCENT_PRESET_LENGTH = 50
const MAX_PROFILE_COUNT_PER_GAME = 20
const MAX_TRACKED_PROCESS_PATHS = 50
const ACCENT_CUSTOM_PATTERN = /^#[0-9a-fA-F]{6}$/
const THEME_MODES = new Set(['light', 'dark', 'system'])
const FORBIDDEN_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const KNOWN_GAME_KEYS = new Set([
  'ac',
  'acc',
  'acevo',
  'acrally',
  'ams',
  'ams2',
  'beamng',
  'dcsw',
  'dirtrally',
  'dirtrally2',
  'eawrc',
  'f124',
  'f125',
  'iracing',
  'lmu',
  'pmr',
  'raceroom',
  'rbr',
  'rennsport',
  'rf1',
  'rf2'
])
const KNOWN_UTILITY_KEYS = ['simhub', 'crewchief', 'tradingpaints', 'garage61', 'secondmonitor']
const PROFILE_BOOLEAN_KEYS = [
  'launchAutomatically',
  'trackingEnabled',
  'killControlsEnabled',
  'relaunchControlsEnabled'
]

// Handle ESM/CJS interop for electron-store
const StoreConstructor =
  typeof Store === 'function' ? Store : (Store as unknown as { default: typeof Store }).default

export const store = new StoreConstructor({
  schema: {
    appPaths: { type: 'object', default: {} },
    gamePaths: { type: 'object', default: {} },
    profiles: { type: 'object', default: {} },
    appNames: { type: 'object', default: {} },
    customSlots: { type: 'number', default: 1, minimum: 1, maximum: MAX_CUSTOM_SLOTS },
    accentPreset: { type: 'string', default: '' },
    accentCustom: { type: 'string', default: '' },
    accentBgTint: { type: 'boolean', default: false },
    themeMode: { type: 'string', default: 'dark', enum: ['light', 'dark', 'system'] },
    focusActiveTitle: { type: 'boolean', default: true },
    launchDelayMs: { type: 'number', default: 1000, minimum: 0, maximum: 5000 },
    startWithWindows: { type: 'boolean', default: false },
    startMinimized: { type: 'boolean', default: false },
    minimizeToTray: { type: 'boolean', default: false },
    autoCheckUpdates: { type: 'boolean', default: true },
    zoomFactor: { type: 'number', default: DEFAULT_ZOOM_FACTOR },
    windowBounds: { type: 'object', default: {} },
    profileUtilityOrderMigrated: { type: 'boolean', default: false },
    profileSetsMigrated: { type: 'boolean', default: false },
    migrated: { type: 'boolean', default: false }
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
  'themeMode',
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
const LEGACY_CONFIG_KEYS = new Set(['killOnClose'])
const IMPORTABLE_CONFIG_KEYS = new Set([...EXPECTED_CONFIG_KEYS, ...LEGACY_CONFIG_KEYS])
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
    throw new Error(
      `Zoom factor must be a finite number from ${MIN_ZOOM_FACTOR} to ${MAX_ZOOM_FACTOR}.`
    )
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

function getSafeObjectEntries(value: Record<string, unknown>) {
  return Object.entries(value).filter(([key]) => !FORBIDDEN_OBJECT_KEYS.has(key))
}

function getSafeString(value: unknown, maxLength: number, allowEmpty = false) {
  if (typeof value !== 'string') {
    return undefined
  }

  const trimmedValue = value.trim()

  if (trimmedValue.length > maxLength || (!allowEmpty && trimmedValue.length === 0)) {
    return undefined
  }

  return trimmedValue
}

function getSafeCustomSlots(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined
  }

  return clamp(Math.floor(value), 1, MAX_CUSTOM_SLOTS)
}

function getSafeLaunchDelayMs(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined
  }

  return clamp(Math.round(value), 0, 5000)
}

function getSafeThemeMode(value: unknown) {
  return typeof value === 'string' && THEME_MODES.has(value) ? value : undefined
}

function isImportableExePath(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false
  }

  const trimmedPath = value.trim()

  return (
    trimmedPath.length > 0 &&
    trimmedPath.length <= MAX_IMPORT_PATH_LENGTH &&
    /\.exe$/i.test(trimmedPath)
  )
}

function getImportableExePath(value: unknown) {
  return isImportableExePath(value) ? value.trim() : undefined
}

function getUtilityKeySet(customSlots: number) {
  return new Set([
    ...KNOWN_UTILITY_KEYS,
    ...Array.from({ length: customSlots }, (_value, index) => `customapp${index + 1}`)
  ])
}

function sanitizePathRecord(value: unknown, allowedKeys: Set<string>) {
  if (!isRecord(value)) {
    return undefined
  }

  const safeRecord: Record<string, string> = {}

  getSafeObjectEntries(value).forEach(([key, entry]) => {
    const safePath = getImportableExePath(entry)

    if (allowedKeys.has(key) && safePath) {
      safeRecord[key] = safePath
    }
  })

  return safeRecord
}

function sanitizeNameRecord(value: unknown, allowedKeys: Set<string>) {
  if (!isRecord(value)) {
    return undefined
  }

  const safeRecord: Record<string, string> = {}

  getSafeObjectEntries(value).forEach(([key, entry]) => {
    const safeName = getSafeString(entry, MAX_CONFIG_STRING_LENGTH)

    if (allowedKeys.has(key) && safeName) {
      safeRecord[key] = safeName
    }
  })

  return safeRecord
}

function sanitizeTrackedProcessPaths(value: unknown) {
  if (!Array.isArray(value)) {
    return undefined
  }

  const safePaths: string[] = []
  const seen = new Set<string>()

  value.slice(0, MAX_TRACKED_PROCESS_PATHS).forEach((entry) => {
    const safePath = getImportableExePath(entry)
    const key = safePath?.toLowerCase()

    if (safePath && key && !seen.has(key)) {
      safePaths.push(safePath)
      seen.add(key)
    }
  })

  return safePaths.length > 0 ? safePaths : undefined
}

function sanitizeProfileUtilities(value: unknown, utilityKeys: Set<string>) {
  if (!Array.isArray(value)) {
    return undefined
  }

  const utilities: Array<{ id: string; enabled: boolean }> = []
  const seen = new Set<string>()

  value.forEach((entry) => {
    if (!isRecord(entry)) {
      return
    }

    const id = entry.id
    const enabled = entry.enabled

    if (
      typeof id === 'string' &&
      utilityKeys.has(id) &&
      typeof enabled === 'boolean' &&
      !seen.has(id)
    ) {
      utilities.push({ id, enabled })
      seen.add(id)
    }
  })

  return utilities.length > 0 ? utilities : undefined
}

function sanitizeProfileFields(profile: Record<string, unknown>, utilityKeys: Set<string>) {
  const safeProfile: Record<string, unknown> = {}

  PROFILE_BOOLEAN_KEYS.forEach((key) => {
    const value = profile[key]

    if (typeof value === 'boolean') {
      safeProfile[key] = value
    }
  })

  utilityKeys.forEach((key) => {
    const value = profile[key]

    if (typeof value === 'boolean') {
      safeProfile[key] = value
    }
  })

  const utilities = sanitizeProfileUtilities(profile.utilities, utilityKeys)
  if (utilities) {
    safeProfile.utilities = utilities
  }

  const trackedProcessPaths = sanitizeTrackedProcessPaths(profile.trackedProcessPaths)
  if (trackedProcessPaths) {
    safeProfile.trackedProcessPaths = trackedProcessPaths
  }

  return safeProfile
}

function sanitizeNamedProfile(value: unknown, utilityKeys: Set<string>) {
  if (!isRecord(value)) {
    return null
  }

  const id = getSafeString(value.id, MAX_CONFIG_STRING_LENGTH)
  const name = getSafeString(value.name, MAX_CONFIG_STRING_LENGTH)

  if (!id || !name) {
    return null
  }

  return {
    ...sanitizeProfileFields(value, utilityKeys),
    id,
    name
  }
}

function sanitizeProfileEntry(value: unknown, utilityKeys: Set<string>) {
  if (!isRecord(value)) {
    return null
  }

  if (Array.isArray(value.profiles)) {
    const activeProfileId = getSafeString(value.activeProfileId, MAX_CONFIG_STRING_LENGTH)

    if (!activeProfileId) {
      return null
    }

    const profiles = value.profiles.slice(0, MAX_PROFILE_COUNT_PER_GAME).flatMap((profile) => {
      const safeProfile = sanitizeNamedProfile(profile, utilityKeys)
      return safeProfile ? [safeProfile] : []
    })

    if (profiles.length === 0) {
      return null
    }

    return {
      activeProfileId: profiles.some((profile) => profile.id === activeProfileId)
        ? activeProfileId
        : profiles[0].id,
      profiles
    }
  }

  if ('profiles' in value) {
    return null
  }

  return sanitizeProfileFields(value, utilityKeys)
}

function sanitizeProfiles(value: unknown, utilityKeys: Set<string>) {
  if (!isRecord(value)) {
    return undefined
  }

  const safeProfiles: Record<string, unknown> = {}

  getSafeObjectEntries(value).forEach(([gameKey, profileEntry]) => {
    if (!KNOWN_GAME_KEYS.has(gameKey)) {
      return
    }

    const safeProfileEntry = sanitizeProfileEntry(profileEntry, utilityKeys)

    if (safeProfileEntry) {
      safeProfiles[gameKey] = safeProfileEntry
    }
  })

  return safeProfiles
}

export function sanitizeImportedConfig(value: unknown) {
  if (!isRecord(value)) {
    throw new Error('Config file must contain a JSON object.')
  }

  const keys = Object.keys(value).filter((key) => !FORBIDDEN_OBJECT_KEYS.has(key))

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

  return getSupportedConfigValues(value)
}

export function getSupportedConfigValues(config: Record<string, unknown>) {
  const supportedConfig: Record<string, unknown> = {}
  const customSlots = getSafeCustomSlots(config.customSlots)
  const utilityKeys = getUtilityKeySet(customSlots ?? 1)

  if (customSlots !== undefined) {
    supportedConfig.customSlots = customSlots
  }

  getSafeObjectEntries(config).forEach(([key, value]) => {
    if (!EXPECTED_CONFIG_KEYS.has(key) || key === 'customSlots') {
      return
    }

    if (key === 'accentCustom') {
      if (typeof value === 'string' && ACCENT_CUSTOM_PATTERN.test(value.trim())) {
        supportedConfig.accentCustom = value.trim()
      }
      return
    }

    if (key === 'accentPreset') {
      const safeAccentPreset = getSafeString(value, MAX_ACCENT_PRESET_LENGTH, true)

      if (safeAccentPreset !== undefined) {
        supportedConfig.accentPreset = safeAccentPreset
      }
      return
    }

    if (key === 'themeMode') {
      const safeThemeMode = getSafeThemeMode(value)

      if (safeThemeMode) {
        supportedConfig.themeMode = safeThemeMode
      }
      return
    }

    if (BOOLEAN_CONFIG_KEYS.has(key)) {
      if (typeof value === 'boolean') {
        supportedConfig[key] = value
      }
      return
    }

    if (key === 'launchDelayMs') {
      const safeLaunchDelayMs = getSafeLaunchDelayMs(value)

      if (safeLaunchDelayMs !== undefined) {
        supportedConfig.launchDelayMs = safeLaunchDelayMs
      }
      return
    }

    if (key === 'zoomFactor') {
      supportedConfig.zoomFactor = getSafeZoomFactor(value)
      return
    }

    if (key === 'gamePaths') {
      const gamePaths = sanitizePathRecord(value, KNOWN_GAME_KEYS)

      if (gamePaths) {
        supportedConfig.gamePaths = gamePaths
      }
      return
    }

    if (key === 'appPaths') {
      const appPaths = sanitizePathRecord(value, utilityKeys)

      if (appPaths) {
        supportedConfig.appPaths = appPaths
      }
      return
    }

    if (key === 'appNames') {
      const appNames = sanitizeNameRecord(value, utilityKeys)

      if (appNames) {
        supportedConfig.appNames = appNames
      }
      return
    }

    if (key === 'profiles') {
      const profiles = sanitizeProfiles(value, utilityKeys)

      if (profiles) {
        supportedConfig.profiles = profiles
      }
      return
    }

    if (key === 'windowBounds') {
      if (isWindowBounds(value)) {
        supportedConfig.windowBounds = value
      }
      return
    }
  })

  return supportedConfig
}
