import { createContext, useContext } from 'react'

export interface SettingsMetaContextValue {
  loading: boolean
  isDirty: boolean
  saveSettings: () => Promise<boolean>
  exportingConfig: boolean
  importingConfig: boolean
  autoCheckUpdates: boolean
  onExportConfig: () => void
  onImportConfig: () => void
  onAutoCheckUpdatesChange: (checked: boolean) => void
}

export const SettingsMetaContext = createContext<SettingsMetaContextValue | null>(null)

export function useSettingsMeta(): SettingsMetaContextValue {
  const context = useContext(SettingsMetaContext)

  if (!context) {
    throw new Error('useSettingsMeta must be used within SettingsProvider')
  }

  return context
}
