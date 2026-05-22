import {
  DEFAULT_PROFILE_ID,
  createDefaultProfile,
  getHighestCustomSlot,
  getUtilities,
  isRecord,
  migrateProfileToUtilityOrder,
  type GameProfile,
  type GameProfileSet
} from './config'
import { getMigrationFlags, saveProfiles, saveSettings, setMigrationFlags } from './store'

const LEGACY_UTILITY_KEYS = [
  'simhub',
  'crewchief',
  'tradingpaints',
  'garage61',
  'secondmonitor',
  'customapp1',
  'customapp2',
  'customapp3',
  'customapp4',
  'customapp5'
]

const LEGACY_GAME_KEYS = [
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
]

function parseLegacyRecord(raw: string | null) {
  if (!raw) {
    return {}
  }

  const parsed: unknown = JSON.parse(raw)
  return isRecord(parsed) ? parsed : {}
}

function getStringRecord(value: unknown) {
  if (!isRecord(value)) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  )
}

export async function migrateFromLocalStorage(): Promise<void> {
  const flags = await getMigrationFlags()
  if (flags.migrated) return

  const patch: Partial<WritableSettings> = {}

  const appPathsRaw = localStorage.getItem('simLauncherAppPaths')
  const gamePathsRaw = localStorage.getItem('simLauncherGamePaths')
  const appPaths = parseLegacyRecord(appPathsRaw)

  if (Object.keys(appPaths).length > 0) {
    patch.appPaths = getStringRecord(appPaths)
  }

  const gamePaths = getStringRecord(parseLegacyRecord(gamePathsRaw))
  if (Object.keys(gamePaths).length > 0) patch.gamePaths = gamePaths

  const accentPreset = localStorage.getItem('simLauncherAccentPreset')
  const accentCustom = localStorage.getItem('simLauncherAccentCustom')
  if (accentPreset) patch.accentPreset = accentPreset
  if (accentCustom) patch.accentCustom = accentCustom

  const appNames: Record<string, string> = {}
  for (const key of LEGACY_UTILITY_KEYS) {
    const name = localStorage.getItem(`simLauncherAppName_${key}`)
    if (name) appNames[key] = name
  }
  if (Object.keys(appNames).length > 0) patch.appNames = appNames

  const profiles: Record<string, GameProfile> = {}
  for (const key of LEGACY_GAME_KEYS) {
    const raw = localStorage.getItem(`profile_${key}`)
    const profile = parseLegacyRecord(raw)
    if (Object.keys(profile).length > 0) profiles[key] = profile
  }

  const migratedCustomSlots = getHighestCustomSlot(appPaths, appNames, ...Object.values(profiles))
  const utilities = getUtilities(migratedCustomSlots)
  const migratedProfiles: Record<string, GameProfileSet> = Object.fromEntries(
    Object.entries(profiles).map(([gameKey, profile]) => [
      gameKey,
      {
        activeProfileId: DEFAULT_PROFILE_ID,
        profiles: [createDefaultProfile(migrateProfileToUtilityOrder(profile, utilities))]
      }
    ])
  )

  if (migratedCustomSlots > 1) patch.customSlots = migratedCustomSlots
  if (Object.keys(patch).length > 0) await saveSettings(patch)
  if (Object.keys(migratedProfiles).length > 0) await saveProfiles(migratedProfiles)

  await setMigrationFlags({
    profileUtilityOrderMigrated: true,
    migrated: true
  })
}

export async function runStartupMigrations(): Promise<void> {
  try {
    await migrateFromLocalStorage()
  } catch (err) {
    console.error('Failed to run startup migrations', err)
  }
}
