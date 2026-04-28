import {
  DEFAULT_PROFILE_ID,
  createDefaultProfile,
  getHighestCustomSlot,
  getUtilities,
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

export async function migrateFromLocalStorage() {
  const flags = await getMigrationFlags()
  if (flags.migrated) return

  const patch: Partial<WritableSettings> = {}

  const appPathsRaw = localStorage.getItem('simLauncherAppPaths')
  const gamePathsRaw = localStorage.getItem('simLauncherGamePaths')
  let appPaths: Record<string, unknown> = {}

  if (appPathsRaw) {
    appPaths = JSON.parse(appPathsRaw)
    patch.appPaths = appPaths as Record<string, string>
  }

  if (gamePathsRaw) patch.gamePaths = JSON.parse(gamePathsRaw)

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
    if (raw) profiles[key] = JSON.parse(raw)
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
  ) as Record<string, GameProfileSet>

  if (migratedCustomSlots > 1) patch.customSlots = migratedCustomSlots
  if (Object.keys(patch).length > 0) await saveSettings(patch)
  if (Object.keys(migratedProfiles).length > 0) await saveProfiles(migratedProfiles)

  await setMigrationFlags({
    profileUtilityOrderMigrated: true,
    migrated: true
  })
}

export async function runStartupMigrations() {
  try {
    await migrateFromLocalStorage()
  } catch (err) {
    console.error('Failed to run startup migrations', err)
  }
}
