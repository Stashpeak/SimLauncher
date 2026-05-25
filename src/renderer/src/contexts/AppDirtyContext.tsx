import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'

export type DirtyScopeId = 'settings' | string

export type SaveHandler = () => Promise<boolean> | boolean

export interface AppDirtyContextValue {
  isAnyDirty: boolean
  isSettingsDirty: boolean
  isProfileEditorDirty: boolean
  activeProfileEditorScope: string | null
  reportSettingsDirty: (isDirty: boolean) => void
  reportProfileEditorDirty: (scopeId: string, isDirty: boolean) => void
  registerSaveHandler: (scope: 'settings' | 'profile-editor', handler: SaveHandler | null) => void
  registerDiscardHandler: (
    scope: 'settings' | 'profile-editor',
    handler: (() => void) | null
  ) => void
  /**
   * Runs every registered save handler in turn and returns `true` only if every
   * handler reported success. Handlers report failure either by returning
   * `false` or by throwing — both are treated as a failed save so the caller
   * can keep dirty UI/dialogs open and surface an error toast.
   */
  requestSaveAll: () => Promise<boolean>
  requestDiscardAll: () => void
  /**
   * Routes external "close the profile editor" requests (e.g. the toggle X
   * button in GameRowActions) through the editor's own dirty-confirm flow,
   * instead of letting the caller unmount the editor and lose unsaved edits.
   * When no handler is registered (no editor open), the call is a no-op.
   */
  registerProfileEditorCloseRequestHandler: (handler: (() => void) | null) => void
  requestProfileEditorClose: () => boolean
}

const AppDirtyContext = createContext<AppDirtyContextValue | null>(null)

export function AppDirtyProvider({ children }: { children: ReactNode }): ReactNode {
  const [isSettingsDirty, setIsSettingsDirty] = useState(false)
  const [profileEditorDirtyScope, setProfileEditorDirtyScope] = useState<string | null>(null)
  // Handlers live in refs (not state) so re-registering on every parent render
  // does not trigger a Provider state update, which would cascade re-renders
  // through every consumer of `useAppDirty()` and create a rerender loop when
  // the underlying handler reference is unstable (e.g. an unmemoized
  // `handleSave` from a hook).
  const settingsSaveHandlerRef = useRef<SaveHandler | null>(null)
  const profileSaveHandlerRef = useRef<SaveHandler | null>(null)
  const settingsDiscardHandlerRef = useRef<(() => void) | null>(null)
  const profileDiscardHandlerRef = useRef<(() => void) | null>(null)
  const profileCloseRequestHandlerRef = useRef<(() => void) | null>(null)

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
    (scope: 'settings' | 'profile-editor', handler: SaveHandler | null) => {
      if (scope === 'settings') {
        settingsSaveHandlerRef.current = handler
      } else {
        profileSaveHandlerRef.current = handler
      }
    },
    []
  )

  const registerDiscardHandler = useCallback(
    (scope: 'settings' | 'profile-editor', handler: (() => void) | null) => {
      if (scope === 'settings') {
        settingsDiscardHandlerRef.current = handler
      } else {
        profileDiscardHandlerRef.current = handler
      }
    },
    []
  )

  const runHandler = useCallback(async (handler: SaveHandler | null): Promise<boolean> => {
    if (!handler) {
      return true
    }
    try {
      const result = await handler()
      return result !== false
    } catch (err) {
      console.error('Dirty-scope save handler threw', err)
      return false
    }
  }, [])

  const requestSaveAll = useCallback(async (): Promise<boolean> => {
    const profileOk = await runHandler(profileSaveHandlerRef.current)
    const settingsOk = await runHandler(settingsSaveHandlerRef.current)
    return profileOk && settingsOk
  }, [runHandler])

  const requestDiscardAll = useCallback(() => {
    profileDiscardHandlerRef.current?.()
    settingsDiscardHandlerRef.current?.()
  }, [])

  const registerProfileEditorCloseRequestHandler = useCallback((handler: (() => void) | null) => {
    profileCloseRequestHandlerRef.current = handler
  }, [])

  const requestProfileEditorClose = useCallback((): boolean => {
    const handler = profileCloseRequestHandlerRef.current
    if (!handler) {
      return false
    }
    handler()
    return true
  }, [])

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
      requestDiscardAll,
      registerProfileEditorCloseRequestHandler,
      requestProfileEditorClose
    }),
    [
      isSettingsDirty,
      profileEditorDirtyScope,
      reportSettingsDirty,
      reportProfileEditorDirty,
      registerSaveHandler,
      registerDiscardHandler,
      requestSaveAll,
      requestDiscardAll,
      registerProfileEditorCloseRequestHandler,
      requestProfileEditorClose
    ]
  )

  return <AppDirtyContext.Provider value={value}>{children}</AppDirtyContext.Provider>
}

export function useAppDirty(): AppDirtyContextValue {
  const context = useContext(AppDirtyContext)
  if (!context) {
    throw new Error('useAppDirty must be used within AppDirtyProvider')
  }
  return context
}
