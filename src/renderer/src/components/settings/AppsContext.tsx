import { createContext, useContext } from 'react'
import type { Profiles, Utility } from '../../lib/config'

export interface AppsContextValue {
  appPaths: Record<string, string>
  appNames: Record<string, string>
  appArgs: Record<string, string>
  appIcons: Record<string, string>
  // Bundled fallback icons for built-in utilities that ship one (#652), keyed
  // by utility key. Used when the shell-extracted appIcons entry is missing.
  utilityIcons: Record<string, string>
  iconLoadErrors: Set<string>
  customSlots: number
  utilities: Utility[]
  profiles: Profiles
  onBrowse: (key: string, isGame: boolean) => void
  onAppNameChange: (key: string, name: string) => void
  onAppPathChange: (key: string, path: string) => void
  onAppArgsChange: (key: string, args: string) => void
  onIconLoadError: (key: string) => void
  onAddCustomSlot: () => void
  onRemoveCustomSlot: (slotNumber: number) => void
}

export const AppsContext = createContext<AppsContextValue | null>(null)

export function useAppsSettings(): AppsContextValue {
  const context = useContext(AppsContext)

  if (!context) {
    throw new Error('useAppsSettings must be used within SettingsProvider')
  }

  return context
}
