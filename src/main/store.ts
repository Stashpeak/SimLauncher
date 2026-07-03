import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import Store from 'electron-store'

import { clamp, isRecord, normalizePathForComparison } from './utils'

export const DEFAULT_ZOOM_FACTOR = 1.0
export const MIN_ZOOM_FACTOR = 0.5
export const MAX_ZOOM_FACTOR = 3.0
export const MAX_CUSTOM_SLOTS = 20
export const MAX_CONFIG_IMPORT_BYTES = 1_000_000

const MAX_IMPORT_PATH_LENGTH = 300
const MAX_CONFIG_STRING_LENGTH = 100
const MAX_CONFIG_ARGS_LENGTH = 500
const MAX_ACCENT_PRESET_LENGTH = 50
const MAX_PROFILE_COUNT_PER_GAME = 20
const MAX_TRACKED_PROCESS_PATHS = 50
const ACCENT_CUSTOM_PATTERN = /^#[0-9a-fA-F]{6}$/
const THEME_MODES = new Set(['light', 'dark', 'system'])
const FORBIDDEN_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
export const KNOWN_GAME_KEYS = new Set([
  'ac',
  'acc',
  'acevo',
  'acrally',
  'aeroflyfs4',
  'ams',
  'ams2',
  'beamng',
  'dcsw',
  'dirtrally',
  'dirtrally2',
  'eawrc',
  'f124',
  'f125',
  'il2gb',
  'iracing',
  'lmu',
  'msfs2020',
  'msfs2024',
  'p3d',
  'pmr',
  'raceroom',
  'rbr',
  'rennsport',
  'rf1',
  'rf2',
  'xplane12'
])
// Must stay in sync with BUILT_IN_UTILITIES in renderer/src/lib/config.ts.
const KNOWN_UTILITY_KEYS = [
  'tracktitan',
  'simhub',
  'crewchief',
  'tradingpaints',
  'garage61',
  'secondmonitor'
]
const PROFILE_BOOLEAN_KEYS = [
  'launchAutomatically',
  'trackingEnabled',
  'killControlsEnabled',
  'relaunchControlsEnabled'
]

// Handle ESM/CJS interop for electron-store
const StoreConstructor =
  typeof Store === 'function' ? Store : (Store as unknown as { default: typeof Store }).default

const STORE_OPTIONS = {
  projectName: 'SimLauncher',
  schema: {
    appPaths: { type: 'object', default: {} },
    gamePaths: { type: 'object', default: {} },
    profiles: { type: 'object', default: {} },
    appNames: { type: 'object', default: {} },
    appArgs: { type: 'object', default: {} },
    customSlots: { type: 'number', default: 1, minimum: 1, maximum: MAX_CUSTOM_SLOTS },
    accentPreset: { type: 'string', default: '' },
    accentCustom: { type: 'string', default: '' },
    accentBgTint: { type: 'boolean', default: false },
    themeMode: { type: 'string', default: 'dark', enum: ['light', 'dark', 'system'] },
    focusActiveTitle: { type: 'boolean', default: true },
    launchDelayMs: { type: 'number', default: 1000, minimum: 0, maximum: 30000 },
    startWithWindows: { type: 'boolean', default: false },
    startMinimized: { type: 'boolean', default: false },
    minimizeToTray: { type: 'boolean', default: false },
    showTrayIcon: { type: 'boolean', default: true },
    autoCheckUpdates: { type: 'boolean', default: true },
    zoomFactor: { type: 'number', default: DEFAULT_ZOOM_FACTOR },
    windowBounds: { type: 'object', default: {} },
    profileUtilityOrderMigrated: { type: 'boolean', default: false },
    profileSetsMigrated: { type: 'boolean', default: false },
    migrated: { type: 'boolean', default: false },
    // Internal, LOCAL-only first-run flag (onboarding shown once). Deliberately
    // NOT added to EXPECTED_CONFIG_KEYS so it is excluded from config
    // export/import - it is a local UX flag and must not travel between
    // machines. #641
    onboardingSeen: { type: 'boolean', default: false }
  }
} as ConstructorParameters<typeof StoreConstructor>[0] & { projectName: string }

// One-shot notice that the persisted config was unreadable on boot. The renderer
// pulls it via the 'get-startup-notice' IPC and shows a toast, so settings
// silently reverting to defaults is explained. `ephemeral` marks the last-resort
// case where no store could be built at all (the file is locked/permission-denied,
// so it was NOT reset and the saved settings are intact) versus a corrupt-config
// reset.
type ConfigRecoveryNotice = { backupPath: string | null; ephemeral?: boolean }

let configRecoveryNotice: ConfigRecoveryNotice | null = null

export function consumeConfigRecoveryNotice(): ConfigRecoveryNotice | null {
  const notice = configRecoveryNotice
  configRecoveryNotice = null
  return notice
}

export function formatConfigRecoveryNotice(notice: ConfigRecoveryNotice): {
  type: 'warn'
  message: string
} {
  if (notice.ephemeral) {
    // The saved file could not be opened (e.g. locked by AV/sync/another
    // instance), so nothing was reset — defaults are in effect only for this
    // session and the real settings load again once the file is readable.
    return {
      type: 'warn',
      message:
        "Your saved settings couldn't be opened — they may be locked by another program. SimLauncher started with defaults for now; your saved settings are untouched and will load next time."
    }
  }

  const backupSuffix = notice.backupPath
    ? ' A copy of the unreadable file was kept next to it.'
    : ''
  return {
    type: 'warn',
    message: `Your saved settings couldn't be read and were reset to defaults.${backupSuffix}`
  }
}

// Move an unreadable config file aside so the user can recover/inspect it,
// returning the backup path (or null when there was nothing to move). The
// default electron-store file is config.json in userData.
function quarantineCorruptConfig(): string | null {
  try {
    const file = path.join(app.getPath('userData'), 'config.json')
    if (!fs.existsSync(file)) {
      return null
    }
    const backup = path.join(app.getPath('userData'), `config.corrupt-${Date.now()}.json`)
    fs.renameSync(file, backup)
    return backup
  } catch {
    return null
  }
}

/**
 * Build the store while surviving an unreadable config file. Without this,
 * electron-store rethrows on construction and the app cannot launch at all (no
 * window, no tray, no dialog). Recovery ladder:
 *   1. construct normally;
 *   2. on failure, move the bad file aside (quarantine) and retry fresh;
 *   3. if that also fails, retry with clearInvalidConfig so electron-store resets
 *      a corrupt or schema-invalid file in place;
 *   4. if even that throws — the file is locked or permission-denied (EBUSY/
 *      EPERM/EACCES), which electron-store rethrows rather than resetting because
 *      it cannot read the file to reset it — boot on an ephemeral in-memory store
 *      seeded with defaults instead of letting the throw brick boot.
 * Constructor/quarantine/fallback are injected so all four paths are unit-testable.
 */
export function createResilientStore<T>(
  construct: (clearInvalidConfig: boolean) => T,
  quarantine: () => string | null,
  createFallback: () => T
): { store: T; recovery: ConfigRecoveryNotice | null } {
  try {
    return { store: construct(false), recovery: null }
  } catch {
    const backupPath = quarantine()
    try {
      return { store: construct(false), recovery: { backupPath } }
    } catch {
      try {
        return { store: construct(true), recovery: { backupPath } }
      } catch {
        return { store: createFallback(), recovery: { backupPath, ephemeral: true } }
      }
    }
  }
}

type StoreInstance = InstanceType<typeof StoreConstructor>

// Last-resort store used when electron-store cannot construct at all (config.json
// locked/permission-denied — EBUSY/EPERM — which it rethrows rather than
// resetting). It is ephemeral and seeded with the schema defaults, so the app
// boots usable with defaults instead of bricking; nothing persists, which is moot
// when the file can't be read or written anyway. Only the surface the app actually
// uses (get/set/clear/`store`) is implemented, and the methods read closure state
// rather than `this`, so the lazy Proxy can bind/forward them safely.
export function createInMemoryFallbackStore(): StoreInstance {
  const schema = STORE_OPTIONS.schema as Record<string, { default?: unknown }> | undefined

  const seedDefaults = () => {
    const seeded: Record<string, unknown> = {}
    Object.entries(schema ?? {}).forEach(([key, spec]) => {
      if (spec && 'default' in spec) {
        // Clone object/array defaults so the fallback never hands out (or reseeds
        // from) the shared STORE_OPTIONS.schema reference. Handlers like
        // save-profile mutate store.get('profiles') in place before setting it,
        // which would otherwise corrupt the schema default and stop clear() from
        // truly resetting.
        seeded[key] = structuredClone(spec.default)
      }
    })
    return seeded
  }

  let data = seedDefaults()

  const fallback = {
    get(key: string, defaultValue?: unknown) {
      return key in data ? data[key] : defaultValue
    },
    set(keyOrValues: string | Record<string, unknown>, value?: unknown) {
      if (typeof keyOrValues === 'string') {
        data[keyOrValues] = value
      } else {
        Object.assign(data, keyOrValues)
      }
    },
    clear() {
      // electron-store's clear() leaves the schema defaults in effect, not an
      // empty object, so re-seed rather than emptying.
      data = seedDefaults()
    },
    get store() {
      // Deep clone, matching electron-store's `.store` which deserializes a fresh
      // object each read. A shallow `{ ...data }` would alias nested objects
      // (profiles/appPaths/...), so a caller mutating the returned config would
      // corrupt the in-memory state.
      return structuredClone(data)
    }
  }

  return fallback as unknown as StoreInstance
}

let storeInstance: StoreInstance | null = null

function ensureStore(): StoreInstance {
  if (!storeInstance) {
    const built = createResilientStore<StoreInstance>(
      (clearInvalidConfig) =>
        new StoreConstructor(
          (clearInvalidConfig
            ? { ...STORE_OPTIONS, clearInvalidConfig: true }
            : STORE_OPTIONS) as ConstructorParameters<typeof StoreConstructor>[0]
        ),
      quarantineCorruptConfig,
      createInMemoryFallbackStore
    )
    storeInstance = built.store
    configRecoveryNotice = built.recovery
  }
  return storeInstance
}

/**
 * The store is built lazily on first access (not at import) so its corrupt-config
 * recovery — which can rewrite/quarantine config.json — only ever runs for the
 * PRIMARY instance. index.ts imports `store` before requestSingleInstanceLock();
 * a second launch quits on the lock before any store access, so it never builds
 * the store and can't touch the live user's config (#516 Codex P2). Every store
 * access in the app runs inside a function that executes after the lock check.
 */
export const store = new Proxy({} as StoreInstance, {
  // Forward reads to the lazily-built instance. The receiver MUST be `instance`,
  // not the Proxy: electron-store exposes accessors like `.store`/`.path`/`.size`
  // as getters that read private (`#`) fields, and a getter invoked with the
  // Proxy as `this` throws because the Proxy is not a Conf instance. Passing the
  // real instance as the receiver lets those getters reach their private state
  // (config import snapshots and export both read `store.store`).
  get(_target, prop) {
    const instance = ensureStore()
    const value = Reflect.get(instance as object, prop, instance)
    return typeof value === 'function' ? value.bind(instance) : value
  }
}) as StoreInstance

export const CONFIG_FILE_NAME = 'simlauncher-config.json'
export const EXPECTED_CONFIG_KEYS = new Set([
  'appPaths',
  'gamePaths',
  'profiles',
  'appNames',
  'appArgs',
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
  'showTrayIcon',
  'autoCheckUpdates',
  'zoomFactor',
  'windowBounds',
  'profileUtilityOrderMigrated',
  'profileSetsMigrated',
  'migrated'
])
const LEGACY_CONFIG_KEYS = new Set(['killOnClose'])
const IMPORTABLE_CONFIG_KEYS = new Set([...EXPECTED_CONFIG_KEYS, ...LEGACY_CONFIG_KEYS])
// Keys that live in the store but are deliberately NOT in EXPECTED_CONFIG_KEYS
// (excluded from config export/import). A config import clears the store, so
// these local-only UX flags must be preserved across it or they silently reset. #641
export const LOCAL_ONLY_STORE_KEYS = ['onboardingSeen'] as const
const BOOLEAN_CONFIG_KEYS = new Set([
  'accentBgTint',
  'focusActiveTitle',
  'startWithWindows',
  'startMinimized',
  'minimizeToTray',
  'showTrayIcon',
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
  if (!isRecord(value)) {
    return false
  }

  return ['x', 'y', 'width', 'height'].every((key) => {
    const coordinate = value[key]
    return typeof coordinate === 'number' && Number.isFinite(coordinate)
  })
}

export function requireSafeZoomFactor(value: unknown): number {
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

export function getStoredZoomFactor(): number {
  const storedZoomFactor = store.get('zoomFactor')
  const safeZoomFactor = getSafeZoomFactor(storedZoomFactor)

  if (storedZoomFactor !== safeZoomFactor) {
    store.set('zoomFactor', safeZoomFactor)
  }

  return safeZoomFactor
}

export function getStoredBoolean(key: string, fallback = false): boolean {
  const value = store.get(key)
  return typeof value === 'boolean' ? value : fallback
}

export function getStoredStringRecord(key: string): Record<string, string> {
  const value = store.get(key)

  if (!isRecord(value)) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  )
}

// Strip prototype-pollution keys before iterating any object from an imported
// or IPC-supplied config. JSON.parse does not produce these, but a crafted
// config file saved with a hex editor can. Dropping them here ensures no
// sanitizer downstream has to guard against '__proto__' assignments.
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

  return clamp(Math.round(value), 0, 30000)
}

function getSafeThemeMode(value: unknown) {
  return typeof value === 'string' && THEME_MODES.has(value) ? value : undefined
}

// Single source of truth for WHY an exe path is rejected, so the sanitizer's
// accept/reject decision and the dropped-entry reason reported to the renderer
// (#669) can never disagree. Returns null when the path is acceptable.
function getExePathRejectReason(value: unknown): DroppedSettingsReason | null {
  if (typeof value !== 'string') {
    return 'not-an-exe'
  }

  const trimmedPath = value.trim()

  if (trimmedPath.length === 0 || !/\.exe$/i.test(trimmedPath)) {
    return 'not-an-exe'
  }

  if (trimmedPath.length > MAX_IMPORT_PATH_LENGTH) {
    return 'too-long'
  }

  return null
}

function isImportableExePath(value: unknown): value is string {
  return typeof value === 'string' && getExePathRejectReason(value) === null
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

function sanitizeArgsRecord(value: unknown, allowedKeys: Set<string>) {
  if (!isRecord(value)) {
    return undefined
  }

  const safeRecord: Record<string, string> = {}

  getSafeObjectEntries(value).forEach(([key, entry]) => {
    const safeArgs = getSafeString(entry, MAX_CONFIG_ARGS_LENGTH)

    if (allowedKeys.has(key) && safeArgs) {
      safeRecord[key] = safeArgs
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
    const key = safePath ? normalizePathForComparison(safePath) : ''

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

  // Only the two known positions survive; anything else (absent, legacy,
  // corrupted) is stripped so readers fall back to game-first (#471).
  if (profile.gamePosition === 'first' || profile.gamePosition === 'last') {
    safeProfile.gamePosition = profile.gamePosition
  }

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

/**
 * Validate and sanitize a raw config object from a file import. All sanitizers
 * called from here are STRICT WHITELISTS — any field not explicitly handled is
 * silently dropped. Adding a new store key therefore requires a corresponding
 * case in getSupportedConfigValues, or it will never survive an import round-trip.
 */
export function sanitizeImportedConfig(value: unknown): Record<string, unknown> {
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

export function getSupportedConfigValues(config: Record<string, unknown>): Record<string, unknown> {
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

    if (key === 'appArgs') {
      const appArgs = sanitizeArgsRecord(value, utilityKeys)

      if (appArgs) {
        supportedConfig.appArgs = appArgs
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
        supportedConfig.windowBounds = {
          x: value.x,
          y: value.y,
          width: value.width,
          height: value.height
        }
      }
      return
    }
  })

  return supportedConfig
}

// customSlots is resolved first because the utility-key whitelist used by
// all other record sanitizers depends on it. Shared by sanitizeSettingsPatch
// and getDroppedSettingsEntries so both agree on the same whitelist.
function resolveEffectiveCustomSlots(patch: Record<string, unknown>): number {
  const currentCustomSlots = getSafeCustomSlots(store.get('customSlots'))
  const patchCustomSlots = getSafeCustomSlots(patch.customSlots)
  return patchCustomSlots ?? currentCustomSlots ?? 1
}

/**
 * Validate and sanitize a partial settings object sent from the renderer via
 * the save-settings IPC. Only scalar/UI settings are accepted here:
 * - 'profiles' and 'windowBounds' are managed by dedicated IPC handlers and
 *   must never be overwritten by a general settings save.
 * - Migration flags ('profileUtilityOrderMigrated', 'profileSetsMigrated',
 *   'migrated') are internal and must not be reset by the renderer.
 */
export function sanitizeSettingsPatch(patch: Record<string, unknown>): Record<string, unknown> {
  const config: Record<string, unknown> = {
    customSlots: resolveEffectiveCustomSlots(patch)
  }

  EXPECTED_CONFIG_KEYS.forEach((key) => {
    if (
      key !== 'profiles' &&
      key !== 'windowBounds' &&
      key !== 'profileUtilityOrderMigrated' &&
      key !== 'profileSetsMigrated' &&
      key !== 'migrated' &&
      Object.prototype.hasOwnProperty.call(patch, key)
    ) {
      config[key] = patch[key]
    }
  })

  const supportedConfig = getSupportedConfigValues(config)
  delete supportedConfig.profiles
  delete supportedConfig.windowBounds
  delete supportedConfig.profileUtilityOrderMigrated
  delete supportedConfig.profileSetsMigrated
  delete supportedConfig.migrated

  if (!Object.prototype.hasOwnProperty.call(patch, 'customSlots')) {
    delete supportedConfig.customSlots
  }

  return supportedConfig
}

export type DroppedSettingsRecordField = 'gamePaths' | 'appPaths' | 'appNames' | 'appArgs'

// Why the sanitizer rejected the value — the renderer picks the warning text
// from this, so it must reflect the check that actually failed (a legit .exe
// path can be rejected purely for length).
export type DroppedSettingsReason = 'not-an-exe' | 'too-long'

export interface DroppedSettingsEntry {
  field: DroppedSettingsRecordField
  key: string
  reason: DroppedSettingsReason
}

/**
 * Reports which appPaths/gamePaths/appNames/appArgs entries in a save-settings
 * patch belong to a known slot/game key but hold a value the sanitizer
 * rejects (bad extension, over the length cap) — as opposed to an
 * unrecognized key or an empty value, both of which are an intentional
 * "clear this field", not data loss. sanitizeSettingsPatch silently drops
 * both cases identically; this lets 'save-settings' tell the renderer
 * specifically what was NOT saved so it can warn instead of showing a plain
 * "Settings saved!". #669
 */
export function getDroppedSettingsEntries(patch: Record<string, unknown>): DroppedSettingsEntry[] {
  const utilityKeys = getUtilityKeySet(resolveEffectiveCustomSlots(patch))
  const dropped: DroppedSettingsEntry[] = []

  const checkRecord = (
    field: DroppedSettingsRecordField,
    allowedKeys: Set<string>,
    getRejectReason: (value: unknown) => DroppedSettingsReason | null
  ) => {
    const rawValue = patch[field]
    if (!isRecord(rawValue)) return

    getSafeObjectEntries(rawValue).forEach(([key, entry]) => {
      if (!allowedKeys.has(key)) return
      if (typeof entry === 'string' && entry.trim().length === 0) return
      const reason = getRejectReason(entry)
      if (reason) {
        dropped.push({ field, key, reason })
      }
    })
  }

  checkRecord('gamePaths', KNOWN_GAME_KEYS, getExePathRejectReason)
  checkRecord('appPaths', utilityKeys, getExePathRejectReason)
  // Names/args have a single sanitizer rule (the length cap), so any rejection
  // of a non-empty value is 'too-long'.
  checkRecord('appNames', utilityKeys, (value) =>
    getSafeString(value, MAX_CONFIG_STRING_LENGTH) !== undefined ? null : 'too-long'
  )
  checkRecord('appArgs', utilityKeys, (value) =>
    getSafeString(value, MAX_CONFIG_ARGS_LENGTH) !== undefined ? null : 'too-long'
  )

  return dropped
}
