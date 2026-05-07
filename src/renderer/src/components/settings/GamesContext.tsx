import { createContext, useContext } from 'react'

export interface GamesContextValue {
  gamePaths: Record<string, string>
  gameIcons: Record<string, string>
  onBrowse: (key: string, isGame: boolean) => void
  onGamePathChange: (key: string, path: string) => void
}

export const GamesContext = createContext<GamesContextValue | null>(null)

export function useGamesSettings() {
  const context = useContext(GamesContext)

  if (!context) {
    throw new Error('useGamesSettings must be used within SettingsProvider')
  }

  return context
}
