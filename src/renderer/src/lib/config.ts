export interface Game { key: string; name: string; icon: string }
export interface Utility { key: string; name: string; isCustom?: boolean }
export type GameProfile = Record<string, boolean | undefined> & {
  launchAutomatically?: boolean
}
export type Profiles = Record<string, GameProfile>

export const GAMES: Game[] = [
  { key: 'ac', name: 'Assetto Corsa', icon: 'assets/ac.png' },
  { key: 'acc', name: 'Assetto Corsa Competizione', icon: 'assets/acc.png' },
  { key: 'acevo', name: 'Assetto Corsa Evo', icon: 'assets/acevo.png' },
  { key: 'acrally', name: 'Assetto Corsa Rally', icon: 'assets/acrally.png' },
  { key: 'ams', name: 'Automobilista', icon: 'assets/ams.png' },
  { key: 'ams2', name: 'Automobilista 2', icon: 'assets/ams2.png' },
  { key: 'beamng', name: 'BeamNG', icon: 'assets/beamng.png' },
  { key: 'dcsw', name: 'DCS World', icon: 'assets/dcsw.png' },
  { key: 'dirtrally', name: 'Dirt Rally', icon: 'assets/dirtrally.png' },
  { key: 'dirtrally2', name: 'Dirt Rally 2.0', icon: 'assets/dirtrally2.png' },
  { key: 'eawrc', name: 'EA WRC', icon: 'assets/eawrc.png' },
  { key: 'f124', name: 'F1 24', icon: 'assets/f124.png' },
  { key: 'f125', name: 'F1 25', icon: 'assets/f125.png' },
  { key: 'iracing', name: 'iRacing', icon: 'assets/iracing.png' },
  { key: 'lmu', name: 'Le Mans Ultimate', icon: 'assets/lmu.png' },
  { key: 'pmr', name: 'Project Motor Racing', icon: 'assets/pmr.png' },
  { key: 'raceroom', name: 'RaceRoom Racing Experience', icon: 'assets/raceroom.png' },
  { key: 'rbr', name: 'Richard Burns Rally', icon: 'assets/rbr.png' },
  { key: 'rennsport', name: 'Rennsport', icon: 'assets/rennsport.png' },
  { key: 'rf1', name: 'rFactor', icon: 'assets/rf1.png' },
  { key: 'rf2', name: 'rFactor 2', icon: 'assets/rf2.png' },
]

export const UTILITIES: Utility[] = [
  { key: 'simhub', name: 'SimHub' },
  { key: 'crewchief', name: 'Crew Chief' },
  { key: 'tradingpaints', name: 'Trading Paints' },
  { key: 'garage61', name: 'Garage 61' },
  { key: 'secondmonitor', name: 'Second Monitor' },
  { key: 'customapp1', name: 'Custom App 1', isCustom: true },
  { key: 'customapp2', name: 'Custom App 2', isCustom: true },
  { key: 'customapp3', name: 'Custom App 3', isCustom: true },
  { key: 'customapp4', name: 'Custom App 4', isCustom: true },
  { key: 'customapp5', name: 'Custom App 5', isCustom: true },
]
