import { BUILT_IN_UTILITY_KEYS } from '../shared/domain/registries'
import {
  isProfileUtility as isStoredProfileUtility,
  isProfileSet as isStoredProfileSet
} from '../shared/domain/guards'
import type {
  Profile,
  NamedProfile,
  ProfileSet,
  ProfileEntry,
  ProfileUtility,
  GamePosition
} from '../shared/domain/profile'
import type { ProfileLaunchEntry } from './processes/types'
import { getStoredStringRecord, store } from './store'
import {
  isBareExeName,
  isRecord,
  isTrackableSecondaryExe,
  isValidExePath,
  normalizePathForComparison
} from './utils'

// Profile domain types are process-agnostic (#692); the canonical defs live in
// the shared domain layer. Re-exported here under the main process's historical
// Stored* names so existing importers keep their `from './profiles'` path.
export type StoredProfile = Profile
export type StoredNamedProfile = NamedProfile
export type StoredProfileSet = ProfileSet
export type StoredProfileEntry = ProfileEntry
export type StoredProfileUtility = ProfileUtility
export type { GamePosition }

/**
 * Resolve where the game sits in the launch sequence. Anything other than an
 * explicit 'last' (absent, legacy, corrupted) means 'first' — the behavior
 * every profile had before #471.
 */
export function getGamePosition(profile: StoredProfile): GamePosition {
  return profile.gamePosition === 'last' ? 'last' : 'first'
}

// The built-in utility key list (and its load-bearing order — it is the default
// launch order for legacy flat-boolean profiles, see getEnabledUtilityEntries
// below) lives in the shared domain layer now (#692). Re-exported so existing
// importers keep their `from './profiles'` path.
export { BUILT_IN_UTILITY_KEYS }

// The profile discriminators live in the shared domain layer now (#692);
// re-exported under their historical Stored* names so importers are unchanged.
export { isStoredProfileUtility, isStoredProfileSet }

export function getStoredProfiles(): Record<string, StoredProfileEntry> {
  const value = store.get('profiles')

  if (!isRecord(value)) {
    return {}
  }

  const profiles: Record<string, StoredProfileEntry> = {}

  Object.entries(value).forEach(([gameKey, entry]) => {
    if (isStoredProfileSet(entry) || isRecord(entry)) {
      profiles[gameKey] = entry
    }
  })

  return profiles
}

export function resolveActiveProfile(entry: StoredProfileEntry | undefined): StoredNamedProfile {
  if (!entry) {
    return { id: 'default', name: 'Default' }
  }
  if (isStoredProfileSet(entry)) {
    const validProfiles = entry.profiles.filter(
      (p): p is StoredNamedProfile => isRecord(p) && typeof p.id === 'string'
    )
    if (validProfiles.length === 0) return { id: 'default', name: 'Default' }
    // Silent recovery: if activeProfileId no longer matches any profile (e.g.
    // after an import that replaced the set), fall back to the first available
    // profile rather than erroring — the user can correct the selection in UI.
    return validProfiles.find((p) => p.id === entry.activeProfileId) || validProfiles[0]
  }
  return { ...(entry as StoredProfile), id: 'default', name: 'Default' }
}

export function resolveNamedProfile(
  entry: StoredProfileEntry | undefined,
  profileId: string
): StoredNamedProfile {
  if (isStoredProfileSet(entry)) {
    const validProfiles = entry.profiles.filter(
      (p): p is StoredNamedProfile => isRecord(p) && typeof p.id === 'string'
    )
    return (
      validProfiles.find((p) => p.id === profileId) ||
      validProfiles[0] || { id: 'default', name: 'Default' }
    )
  }
  return { ...((entry as StoredProfile | undefined) || {}), id: 'default', name: 'Default' }
}

/**
 * The utility SLOTS a profile has switched on, whether or not they currently
 * have an executable configured.
 *
 * Split out from `getEnabledUtilityEntries` because "which slots does this
 * profile own?" and "what can this profile launch?" are different questions and
 * only the second one needs a path. Cancelling a pending UAC handoff asks the
 * first: the handoff was created when the slot DID have a path, so deciding
 * ownership from the current `appPaths` means clearing that path in Settings
 * makes the slot vanish from the outgoing profile, the switch finds nothing
 * leaving, and approving the old prompt still launches the executable recorded
 * at launch time (Codex P2 on #842).
 *
 * Preserves the launch ordering of both profile shapes, including the legacy
 * flat-boolean one, because it is the single place that decides membership.
 *
 * SLOT keys, hence the name: unlike `getEnabledUtilityKeys` below, every key is
 * validated against the configured slot list, so the legacy branch cannot leak
 * non-utility booleans like `launchAutomatically`. That looser version is
 * tolerable for its own caller and would not be here, where a stray key becomes
 * a slot the switch claims to be leaving.
 */
export function getEnabledUtilitySlotKeys(profile: StoredProfile, customSlots: unknown): string[] {
  const count =
    typeof customSlots === 'number' && Number.isFinite(customSlots)
      ? Math.max(1, Math.floor(customSlots))
      : 1
  const utilityKeys = [
    ...BUILT_IN_UTILITY_KEYS,
    ...Array.from({ length: count }, (_, i) => `customapp${i + 1}`)
  ]

  if (Array.isArray(profile.utilities)) {
    return profile.utilities
      .filter(
        (u): u is StoredProfileUtility =>
          isRecord(u) && typeof u.id === 'string' && typeof u.enabled === 'boolean'
      )
      .filter((u) => u.enabled && utilityKeys.includes(u.id))
      .map((u) => u.id)
  }

  return utilityKeys.filter((key) => profile[key] === true)
}

export function getEnabledUtilityEntries(
  profile: StoredProfile,
  appPaths: Record<string, string>,
  customSlots: unknown
): ProfileLaunchEntry[] {
  // The path filter lives here and nowhere else: a slot with no configured
  // executable is still owned by the profile, it just has nothing to launch.
  return getEnabledUtilitySlotKeys(profile, customSlots)
    .filter((key) => appPaths[key])
    .map((key) => ({ key, path: appPaths[key] }))
}

function buildProfileLaunchEntries(gameKey: string, profile: StoredNamedProfile) {
  const appPaths = getStoredStringRecord('appPaths')
  const gamePaths = getStoredStringRecord('gamePaths')
  const customSlots = store.get('customSlots')
  const entries: ProfileLaunchEntry[] = []
  const gameEntry =
    profile.launchAutomatically !== false && gamePaths[gameKey]
      ? { key: gameKey, path: gamePaths[gameKey] }
      : undefined

  if (gameEntry && getGamePosition(profile) === 'first') {
    entries.push(gameEntry)
  }
  getEnabledUtilityEntries(profile, appPaths, customSlots).forEach((entry) => entries.push(entry))
  if (gameEntry && getGamePosition(profile) === 'last') {
    entries.push(gameEntry)
  }

  return entries
}

export function buildActiveProfileLaunchEntries(gameKey: string): ProfileLaunchEntry[] {
  const profiles = getStoredProfiles()
  return buildProfileLaunchEntries(gameKey, resolveActiveProfile(profiles[gameKey]))
}

/**
 * Identity of a launch entry: the SLOT plus the path, never the path alone.
 * After the #357 key-based arg refactor `customapp1` and `customapp2` can point
 * at the same exe while carrying different `appArgs`, so two entries sharing a
 * path are still two different things to launch.
 *
 * Lives here rather than in `ipc/launch.ts` because more than one caller has to
 * agree on it, and agreeing by having copied the same expression is how they
 * stop agreeing (Codex P1 on #782).
 */
export function getProfileLaunchEntryId(entry: ProfileLaunchEntry): string {
  return `${entry.key} ${normalizePathForComparison(entry.path)}`
}

/**
 * The utility SLOTS a profile switch leaves behind: switched on in the OUTGOING
 * profile and not in the incoming one.
 *
 * Keys, not entries, and computed from slot membership rather than from built
 * launch entries. Three separate findings pushed it here and they only agree on
 * the key:
 *
 *   - the path alone cancels both of two slots sharing an exe (#357), because it
 *     cannot tell them apart (CodeRabbit on #782)
 *   - `key + path` misses a slot whose executable was edited in Settings after
 *     the handoff was recorded, since the registry holds the path AS LAUNCHED
 *     while this side is rebuilt from the current `appPaths` (Codex on #842)
 *   - and building entries at all drops a slot whose path was CLEARED, because
 *     an entry needs something to launch, so the switch would find nothing
 *     leaving and cancel nothing (Codex on #842)
 *
 * The game is excluded by construction: it is not a utility slot, and a switch
 * never stops the game.
 *
 * Takes the incoming set as an argument rather than reading it back, because the
 * one caller runs BEFORE the store is written and the outgoing side has to come
 * from what is still on disk.
 *
 * Returns nothing unless `activeProfileId` actually changed. Editing the profile
 * you are already on is not a switch, however much its contents moved, and
 * treating it as one would let a profile edit cancel a permission prompt (#782).
 */
export function getProfileSwitchLeavingKeys(
  gameKey: string,
  nextEntry: StoredProfileEntry | undefined
): string[] {
  const storedEntry = getStoredProfiles()[gameKey]
  const fromProfileId = isStoredProfileSet(storedEntry) ? storedEntry.activeProfileId : undefined
  const toProfileId = isStoredProfileSet(nextEntry) ? nextEntry.activeProfileId : undefined

  if (!fromProfileId || !toProfileId || fromProfileId === toProfileId) {
    return []
  }

  const customSlots = store.get('customSlots')
  const utilityKeys = (entry: StoredProfileEntry | undefined, profileId: string): string[] =>
    getEnabledUtilitySlotKeys(resolveNamedProfile(entry, profileId), customSlots)

  const incoming = new Set(utilityKeys(nextEntry, toProfileId))

  return utilityKeys(storedEntry, fromProfileId).filter((key) => !incoming.has(key))
}

export function buildNamedProfileLaunchEntries(
  gameKey: string,
  profileId: string
): ProfileLaunchEntry[] {
  const profiles = getStoredProfiles()
  return buildProfileLaunchEntries(gameKey, resolveNamedProfile(profiles[gameKey], profileId))
}

export function getUtilityKeys(customSlots: unknown): string[] {
  const slotCount =
    typeof customSlots === 'number' && Number.isFinite(customSlots)
      ? Math.max(1, Math.floor(customSlots))
      : 1

  return [
    ...BUILT_IN_UTILITY_KEYS,
    ...Array.from({ length: slotCount }, (_value, index) => `customapp${index + 1}`)
  ]
}

export function getEnabledUtilityKeys(profile: StoredProfile | undefined): string[] {
  if (!profile) {
    return []
  }

  if (Array.isArray(profile.utilities)) {
    return profile.utilities
      .filter((utility) => isStoredProfileUtility(utility) && utility.enabled)
      .map((utility) => utility.id)
  }

  // Legacy path: profiles stored before the utilities-array migration keep
  // utility state as top-level boolean keys (e.g. { simhub: true }). The
  // migrator converts these on first run, but this branch handles any profile
  // that missed migration (manual store edit, partial import, etc.). NOTE: this
  // returns ALL top-level keys set to `true`, so non-utility booleans like
  // launchAutomatically / trackingEnabled are included too; the only caller
  // (getProfileTrackablePaths) tolerates this because those keys have no matching
  // appPaths entry and are dropped by the isValidExePath filter.
  return Object.entries(profile)
    .filter(([, value]) => value === true)
    .map(([key]) => key)
}

export function isUtilityEnabled(profile: StoredProfile | undefined, utilityKey: string): boolean {
  if (!profile) {
    return false
  }

  if (Array.isArray(profile.utilities)) {
    return profile.utilities.some(
      (utility) => isStoredProfileUtility(utility) && utility.id === utilityKey && utility.enabled
    )
  }

  return profile[utilityKey] === true
}

export function getActiveStoredProfile(
  profileEntry: StoredProfileEntry | undefined
): StoredProfile | StoredNamedProfile | undefined {
  if (!profileEntry) {
    return undefined
  }

  if (isStoredProfileSet(profileEntry)) {
    return (
      profileEntry.profiles.find((profile) => profile.id === profileEntry.activeProfileId) ||
      profileEntry.profiles[0]
    )
  }

  return profileEntry
}

export function getActiveProfileForGame(gameKey: string): StoredProfile | undefined {
  const profileEntry = getStoredProfiles()[gameKey]
  return profileEntry ? getActiveStoredProfile(profileEntry) : undefined
}

/**
 * Whether SimLauncher should follow this game's processes at all (#591).
 *
 * `!== false` rather than `=== true`, matching every profile boolean except
 * `closeAppsOnGameExit`: tracking is on unless the user turned it off, so an
 * absent or malformed value means on. Nobody has the key set, so inverting this
 * would silently make every existing profile untracked.
 *
 * One spelling on purpose. The rule is read from three places now (launch
 * recording, tasklist discovery, auto-close arming), and it decides whether a
 * process is recorded at all rather than merely displayed, so two of them
 * drifting apart would leave a game surfaced by one and invisible to the others.
 */
export function isProcessTrackingEnabled(profile: StoredProfile | undefined): boolean {
  return profile?.trackingEnabled !== false
}

export function getProfileTrackablePaths(
  gameKey: string,
  profile: StoredProfile | undefined,
  appPaths: Record<string, string> | undefined,
  gamePaths: Record<string, string> | undefined
): string[] {
  const trackablePaths = [
    gamePaths?.[gameKey],
    ...getEnabledUtilityKeys(profile)
      .filter((profileKey) => isValidExePath(appPaths?.[profileKey]))
      .map((profileKey) => appPaths![profileKey])
  ].filter((candidate): candidate is string => isValidExePath(candidate))
  // Secondary executables are the one list the user types into, and the
  // phantom-exit warning tells them to type an image NAME off Task Manager. A
  // name is never a file relative to the CWD, so holding it to the existence
  // check the game and utility paths pass dropped it without a word, and the
  // app's own repair instruction could not be followed (#929).
  const secondaryExes = (
    Array.isArray(profile?.trackedProcessPaths) ? profile.trackedProcessPaths : []
  ).filter((candidate): candidate is string => isTrackableSecondaryExe(candidate))
  const seen = new Set<string>()

  return [...trackablePaths, ...secondaryExes].filter((trackablePath) => {
    // A bare name has no path to key by, and resolving it against the CWD
    // would hand two spellings of one image two keys.
    const key = isBareExeName(trackablePath)
      ? trackablePath.trim().toLowerCase()
      : normalizePathForComparison(trackablePath)

    if (!key || seen.has(key)) {
      return false
    }

    seen.add(key)
    return true
  })
}
