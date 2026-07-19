// Process-agnostic profile domain model (#692).
//
// A "profile" is one game's saved launch configuration. It is persisted in the
// electron-store `profiles` map (keyed by game key) and travels renderer <-> main
// over IPC unchanged, so both processes must agree on its shape. Before #692 the
// renderer (renderer/src/lib/config.ts) and the main process (main/profiles.ts)
// each declared their own structurally-identical copy under different names
// (Game* vs Stored*); the two had already drifted (killControlsEnabled /
// relaunchControlsEnabled were typed on the renderer side only). This module is
// the single source of truth; the old names are kept as re-exported aliases in
// those files so existing importers do not change.

export interface ProfileUtility {
  id: string
  enabled: boolean
}

// Where the game sits in the launch sequence relative to its utilities. Anything
// other than an explicit 'last' means 'first' — the behavior before #471.
export type GamePosition = 'first' | 'last'

export interface Profile {
  // Index signature preserved so that legacy flat keys (e.g. 'simhub': true) can
  // coexist with the typed properties during migration. Any code reading a known
  // key should use the typed property, not the index signature.
  [key: string]: unknown
  utilities?: ProfileUtility[]
  launchAutomatically?: boolean
  gamePosition?: GamePosition
  trackingEnabled?: boolean
  killControlsEnabled?: boolean
  relaunchControlsEnabled?: boolean
  trackedProcessPaths?: string[]
}

// A profile plus its identity within a profile set.
export interface NamedProfile extends Profile {
  id: string
  name: string
}

export interface ProfileSet {
  activeProfileId: string
  profiles: NamedProfile[]
}

// The on-disk representation for a single game can be either the old flat-profile
// format (Profile) or the newer profile-set format (ProfileSet). Callers should
// normalise (normalizeGameProfileSet in the renderer, resolveActiveProfile in the
// main process) before operating on individual profiles.
export type ProfileEntry = Profile | ProfileSet

export type Profiles = Record<string, ProfileEntry>
