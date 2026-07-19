// Process-agnostic domain registries: the canonical game + built-in-utility
// lists and the key collections derived from them. Pure TS, no DOM/Node/electron
// deps, so the main and renderer processes share ONE source of truth. Before
// #692 these lists lived as three hand-maintained parallel copies (KNOWN_GAME_KEYS
// / GAMES, and KNOWN_UTILITY_KEYS / BUILT_IN_UTILITY_KEYS / BUILT_IN_UTILITIES).

export interface Game {
  key: string
  name: string
  icon: string
}

export interface Utility {
  key: string
  name: string
  isCustom?: boolean
  // Bundled curated icon path (mirrors Game.icon). For a built-in slot the
  // app identity is known, so when this is set the bundled asset is shown
  // FIRST — ahead of the Windows shell-extracted exe icon — with shell
  // extraction only as fallback (#727; originally introduced shell-first by
  // #652). Shell extraction is unreliable across app versions/icon formats
  // and can "succeed" with a broken image (e.g. Crew Chief's black-square
  // alpha artifact), which shell-first would keep forever once cached.
  icon?: string
}

export const GAMES: Game[] = [
  { key: 'ac', name: 'Assetto Corsa', icon: 'assets/ac.png' },
  { key: 'acc', name: 'Assetto Corsa Competizione', icon: 'assets/acc.png' },
  { key: 'acevo', name: 'Assetto Corsa Evo', icon: 'assets/acevo.png' },
  { key: 'acrally', name: 'Assetto Corsa Rally', icon: 'assets/acrally.png' },
  { key: 'aeroflyfs4', name: 'Aerofly FS 4', icon: 'assets/aeroflyfs4.png' },
  { key: 'ams', name: 'Automobilista', icon: 'assets/ams.png' },
  { key: 'ams2', name: 'Automobilista 2', icon: 'assets/ams2.png' },
  { key: 'beamng', name: 'BeamNG', icon: 'assets/beamng.png' },
  { key: 'dcsw', name: 'DCS World', icon: 'assets/dcsw.png' },
  { key: 'dirtrally', name: 'Dirt Rally', icon: 'assets/dirtrally.png' },
  { key: 'dirtrally2', name: 'Dirt Rally 2.0', icon: 'assets/dirtrally2.png' },
  { key: 'eawrc', name: 'EA WRC', icon: 'assets/eawrc.png' },
  { key: 'f124', name: 'F1 24', icon: 'assets/f124.png' },
  { key: 'f125', name: 'F1 25', icon: 'assets/f125.png' },
  { key: 'il2gb', name: 'IL-2 Sturmovik: Great Battles', icon: 'assets/il2gb.png' },
  { key: 'iracing', name: 'iRacing', icon: 'assets/iracing.png' },
  { key: 'lmu', name: 'Le Mans Ultimate', icon: 'assets/lmu.png' },
  { key: 'msfs2020', name: 'Microsoft Flight Simulator 2020', icon: 'assets/msfs2020.png' },
  { key: 'msfs2024', name: 'Microsoft Flight Simulator 2024', icon: 'assets/msfs2024.png' },
  { key: 'p3d', name: 'Prepar3D', icon: 'assets/p3d.png' },
  { key: 'pmr', name: 'Project Motor Racing', icon: 'assets/pmr.png' },
  { key: 'raceroom', name: 'RaceRoom Racing Experience', icon: 'assets/raceroom.png' },
  { key: 'rbr', name: 'Richard Burns Rally', icon: 'assets/rbr.png' },
  { key: 'rennsport', name: 'Rennsport', icon: 'assets/rennsport.png' },
  { key: 'rf1', name: 'rFactor', icon: 'assets/rf1.png' },
  { key: 'rf2', name: 'rFactor 2', icon: 'assets/rf2.png' },
  { key: 'xplane12', name: 'X-Plane 12', icon: 'assets/xplane12.png' }
]

export const BUILT_IN_UTILITIES: Utility[] = [
  // Listed first: a telemetry recorder needs to be alive before/at session
  // start to capture the whole lap, so it defaults to the front of the launch
  // order (#652).
  { key: 'tracktitan', name: 'Track Titan', icon: 'assets/tracktitan.png' },
  { key: 'simhub', name: 'SimHub', icon: 'assets/simhub.png' },
  { key: 'crewchief', name: 'Crew Chief', icon: 'assets/crewchief.png' },
  { key: 'tradingpaints', name: 'Trading Paints', icon: 'assets/tradingpaints.png' },
  { key: 'garage61', name: 'Garage 61', icon: 'assets/garage61.png' },
  // No bundled asset yet — keeps the shell-icon → initials chain (#727).
  { key: 'secondmonitor', name: 'Second Monitor' }
]

// Derived key collections. The single source of truth is GAMES / BUILT_IN_UTILITIES
// above, so these can never drift the way the old hand-maintained copies did.

// Allowlist of recognized game keys — the main process rejects any gameKey that
// is not in this set before it crosses the IPC boundary. Typed as a mutable Set
// only to match the existing allowlist-parameter signatures it is passed into;
// it is never mutated.
export const KNOWN_GAME_KEYS: Set<string> = new Set(GAMES.map((game) => game.key))

// Built-in utility keys in canonical order. Order is load-bearing: it is the
// default launch order for legacy flat-boolean profiles (see
// getEnabledUtilityEntries in src/main/profiles.ts).
export const BUILT_IN_UTILITY_KEYS: string[] = BUILT_IN_UTILITIES.map((utility) => utility.key)
