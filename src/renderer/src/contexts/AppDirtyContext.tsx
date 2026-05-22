import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

export type DirtyScopeId = 'settings' | string

export interface AppDirtyContextValue {
  isAnyDirty: boolean
  isSettingsDirty: boolean
  isProfileEditorDirty: boolean
  activeProfileEditorScope: string | null
  reportSettingsDirty: (isDirty: boolean) => void
  reportProfileEditorDirty: (scopeId: string, isDirty: boolean) => void
  registerSaveHandler: (
    scope: 'settings' | 'profile-editor',
    handler: (() => Promise<void> | void) | null
  ) => void
  registerDiscardHandler: (
    scope: 'settings' | 'profile-editor',
    handler: (() => void) | null
  ) => void
  requestSaveAll: () => Promise<void>
  requestDiscardAll: () => void
}

const AppDirtyContext = createContext<AppDirtyContextValue | null>(null)

export function AppDirtyProvider({ children }: { children: ReactNode }) {
  const [isSettingsDirty, setIsSettingsDirty] = useState(false)
  const [profileEditorDirtyScope, setProfileEditorDirtyScope] = useState<string | null>(null)
  const [settingsSaveHandler, setSettingsSaveHandler] = useState<
    (() => Promise<void> | void) | null
  >(null)
  const [profileSaveHandler, setProfileSaveHandler] = useState<(() => Promise<void> | void) | null>(
    null
  )
  const [settingsDiscardHandler, setSettingsDiscardHandler] = useState<(() => void) | null>(null)
  const [profileDiscardHandler, setProfileDiscardHandler] = useState<(() => void) | null>(null)

  const reportSettingsDirty = useCallback((isDirty: boolean) => {
    setIsSettingsDirty(isDirty)
  }, [])

  const reportProfileEditorDirty = useCallback((scopeId: string, isDirty: boolean) => {
    setProfileEditorDirtyScope((current) => {
      if (isDirty) {
        return scopeId
      }
      return current === scopeId ? null : current
    })
  }, [])

  const registerSaveHandler = useCallback(
    (scope: 'settings' | 'profile-editor', handler: (() => Promise<void> | void) | null) => {
      if (scope === 'settings') {
        setSettingsSaveHandler(() => handler)
      } else {
        setProfileSaveHandler(() => handler)
      }
    },
    []
  )

  const registerDiscardHandler = useCallback(
    (scope: 'settings' | 'profile-editor', handler: (() => void) | null) => {
      if (scope === 'settings') {
        setSettingsDiscardHandler(() => handler)
      } else {
        setProfileDiscardHandler(() => handler)
      }
    },
    []
  )

  const requestSaveAll = useCallback(async () => {
    if (profileSaveHandler) {
      await profileSaveHandler()
    }
    if (settingsSaveHandler) {
      await settingsSaveHandler()
    }
  }, [profileSaveHandler, settingsSaveHandler])

  const requestDiscardAll = useCallback(() => {
    profileDiscardHandler?.()
    settingsDiscardHandler?.()
  }, [profileDiscardHandler, settingsDiscardHandler])

  const value = useMemo<AppDirtyContextValue>(
    () => ({
      isAnyDirty: isSettingsDirty || profileEditorDirtyScope !== null,
      isSettingsDirty,
      isProfileEditorDirty: profileEditorDirtyScope !== null,
      activeProfileEditorScope: profileEditorDirtyScope,
      reportSettingsDirty,
      reportProfileEditorDirty,
      registerSaveHandler,
      registerDiscardHandler,
      requestSaveAll,
      requestDiscardAll
    }),
    [
      isSettingsDirty,
      profileEditorDirtyScope,
      reportSettingsDirty,
      reportProfileEditorDirty,
      registerSaveHandler,
      registerDiscardHandler,
      requestSaveAll,
      requestDiscardAll
    ]
  )

  return <AppDirtyContext.Provider value={value}>{children}</AppDirtyContext.Provider>
}

export function useAppDirty() {
  const context = useContext(AppDirtyContext)
  if (!context) {
    throw new Error('useAppDirty must be used within AppDirtyProvider')
  }
  return context
}
