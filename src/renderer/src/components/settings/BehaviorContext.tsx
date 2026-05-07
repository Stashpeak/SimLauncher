import { createContext, useContext } from 'react'

export interface BehaviorContextValue {
  startWithWindows: boolean
  startMinimized: boolean
  minimizeToTray: boolean
  launchDelayMs: number
  onStartWithWindowsChange: (checked: boolean) => void
  onStartMinimizedChange: (checked: boolean) => void
  onMinimizeToTrayChange: (checked: boolean) => void
  onLaunchDelayMsChange: (delayMs: number) => void
}

export const BehaviorContext = createContext<BehaviorContextValue | null>(null)

export function useBehaviorSettings() {
  const context = useContext(BehaviorContext)

  if (!context) {
    throw new Error('useBehaviorSettings must be used within SettingsProvider')
  }

  return context
}
