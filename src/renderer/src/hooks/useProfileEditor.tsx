import {
  useCallback,
  useEffect,
  useState,
  useMemo,
  type Dispatch,
  type DragEvent,
  type SetStateAction
} from 'react'
import { useDirtyTracking } from './useDirtyTracking'
import {
  getActiveGameProfile,
  getUtilities,
  normalizeGameProfileSet,
  normalizeProfileUtilities,
  type GamePosition,
  type ProfileUtility,
  type Profiles,
  type Utility
} from '../lib/config'
import { useNotify } from '../components/Notify'
import { getSettings, getProfiles, saveProfile } from '../lib/store'
import { getFileIcon, browsePath, launchProfile } from '../lib/electron'
import { useAppsSettings } from '../components/settings/AppsContext'
import { syncProfileUtilitiesWithSettings } from '../lib/profileEditorSettingsSync'

export interface ProfileEditorProps {
  gameKey: string
  activeProfileId: string
  onProfilesChanged: () => Promise<unknown>
  onClose: () => void
  onCreateProfile?: () => void
  // Signals the parent that the active profile was deliberately kept (saved,
  // launched, or deleted) so a freshly-created "+" profile is no longer a
  // discard-on-close candidate (#453).
  onProfileCommitted?: () => void
  // Awaited by the app-level discard pipeline after the editor closes, so the
  // owner can finish async cleanup (delete a pending "+" profile) before the
  // caller remounts views that reload from the store (#478).
  onDiscarded?: () => Promise<void> | void
  onLaunchRequest?: (handleLaunch: () => void) => void
  onLaunchStart?: () => void
  onLaunchEnd?: (cooldownMs: number) => void
}

export interface UseProfileEditorResult {
  loading: boolean
  appPaths: Record<string, string>
  appNames: Record<string, string>
  profileName: string
  setProfileName: Dispatch<SetStateAction<string>>
  profileCount: number
  dragUtilityId: string | null
  dropTarget: { id: string; placement: 'before' | 'after' } | null
  launchAutomatically: boolean
  setLaunchAutomatically: Dispatch<SetStateAction<boolean>>
  gamePosition: GamePosition
  setGamePosition: Dispatch<SetStateAction<GamePosition>>
  trackingEnabled: boolean
  setTrackingEnabled: Dispatch<SetStateAction<boolean>>
  killControlsEnabled: boolean
  setKillControlsEnabled: Dispatch<SetStateAction<boolean>>
  relaunchControlsEnabled: boolean
  setRelaunchControlsEnabled: Dispatch<SetStateAction<boolean>>
  trackedProcessPaths: string[]
  appIconCache: Record<string, string>
  failedIcons: Record<string, boolean>
  setFailedIcons: Dispatch<SetStateAction<Record<string, boolean>>>
  fetchingIcons: boolean
  showConfirm: boolean
  setShowConfirm: Dispatch<SetStateAction<boolean>>
  showNewProfileConfirm: boolean
  setShowNewProfileConfirm: Dispatch<SetStateAction<boolean>>
  showLaunchConfirm: boolean
  setShowLaunchConfirm: Dispatch<SetStateAction<boolean>>
  profileDeleteConfirm: { profileId: string; profileName: string } | null
  setProfileDeleteConfirm: Dispatch<
    SetStateAction<{ profileId: string; profileName: string } | null>
  >
  setDragUtilityId: Dispatch<SetStateAction<string | null>>
  setDropTarget: Dispatch<SetStateAction<{ id: string; placement: 'before' | 'after' } | null>>
  isDirty: boolean
  handleCloseAttempt: () => void
  handleCreateProfileAttempt: () => void
  handleToggleUtility: (key: string) => void
  moveEnabledUtility: (draggedId: string, targetId: string, placement: 'before' | 'after') => void
  startUtilityDrag: (event: DragEvent<HTMLDivElement>, utilityKey: string) => void
  handleAddTrackedProcess: () => void
  handleBrowseTrackedProcess: (index: number) => Promise<void>
  handleRemoveTrackedProcess: (index: number) => void
  handleIconFailed: (utilityKey: string) => void
  handleLaunch: () => Promise<void>
  handleDiscardAndLaunch: () => void
  handleSave: (shouldLaunch?: boolean) => Promise<boolean>
  handleSaveOnly: () => Promise<boolean>
  handleDeleteProfile: () => Promise<void>
  confirmDeleteProfile: () => Promise<void>
  utilityByKey: Map<string, Utility>
  availableUtilities: Utility[]
  enabledUtilityEntries: ProfileUtility[]
  disabledUtilityEntries: ProfileUtility[]
}

export function useProfileEditor({
  gameKey,
  activeProfileId,
  onProfilesChanged,
  onClose,
  onCreateProfile,
  onProfileCommitted,
  onLaunchRequest,
  onLaunchStart,
  onLaunchEnd
}: ProfileEditorProps): UseProfileEditorResult {
  const { notify } = useNotify()
  const {
    appPaths: settingsAppPaths,
    appNames: settingsAppNames,
    customSlots: settingsCustomSlots
  } = useAppsSettings()
  const [loading, setLoading] = useState(true)
  const [appPaths, setAppPaths] = useState<Record<string, string>>({})
  const [appNames, setAppNames] = useState<Record<string, string>>({})
  const [utilities, setUtilities] = useState<Utility[]>(() => getUtilities(1))
  const [profileName, setProfileName] = useState('Default')
  const [profileCount, setProfileCount] = useState(1)
  const [profileUtilities, setProfileUtilities] = useState<ProfileUtility[]>([])
  const [dragUtilityId, setDragUtilityId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{
    id: string
    placement: 'before' | 'after'
  } | null>(null)
  const [launchAutomatically, setLaunchAutomatically] = useState(true)
  const [gamePosition, setGamePosition] = useState<GamePosition>('first')
  const [trackingEnabled, setTrackingEnabled] = useState(true)
  const [killControlsEnabled, setKillControlsEnabled] = useState(false)
  const [relaunchControlsEnabled, setRelaunchControlsEnabled] = useState(false)
  const [trackedProcessPaths, setTrackedProcessPaths] = useState<string[]>([])
  const [appIconCache, setAppIconCache] = useState<Record<string, string>>({})
  const [failedIcons, setFailedIcons] = useState<Record<string, boolean>>({})
  const [fetchingIcons, setFetchingIcons] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [showNewProfileConfirm, setShowNewProfileConfirm] = useState(false)
  const [showLaunchConfirm, setShowLaunchConfirm] = useState(false)
  const [profileDeleteConfirm, setProfileDeleteConfirm] = useState<{
    profileId: string
    profileName: string
  } | null>(null)

  useEffect(() => {
    async function loadData() {
      setLoading(true)
      // Settings and profiles are fetched in parallel; settings are needed to
      // resolve the active utility list before normalising the profile utilities.
      const [settings, allProfiles] = await Promise.all([getSettings(), getProfiles()])
      const paths = settings.appPaths
      const names = settings.appNames
      const savedCustomSlots = settings.customSlots
      const profileSet = normalizeGameProfileSet(
        allProfiles[gameKey] as Profiles[string] | undefined
      )
      const profile =
        profileSet.profiles.find((entry) => entry.id === activeProfileId) ||
        getActiveGameProfile(profileSet)
      const { utilities: resolvedUtilities } = syncProfileUtilitiesWithSettings(
        Array.isArray(profile.utilities) ? profile.utilities : [],
        savedCustomSlots,
        paths,
        names
      )

      setAppPaths(paths)
      setAppNames(names)
      setUtilities(resolvedUtilities)
      setProfileName(profile.name)
      setProfileCount(profileSet.profiles.length)

      setProfileUtilities(normalizeProfileUtilities(profile, resolvedUtilities))
      // Default auto-launch to true unless explicitly disabled
      setLaunchAutomatically(profile.launchAutomatically !== false)
      // Anything other than an explicit 'last' means game-first (#471)
      setGamePosition(profile.gamePosition === 'last' ? 'last' : 'first')
      setTrackingEnabled(profile.trackingEnabled !== false)
      setKillControlsEnabled(profile.killControlsEnabled === true)
      setRelaunchControlsEnabled(profile.relaunchControlsEnabled === true)
      setTrackedProcessPaths(
        Array.isArray(profile.trackedProcessPaths) ? profile.trackedProcessPaths : []
      )
      setLoading(false)

      // Fetch icons for all configured app paths
      setFetchingIcons(true)
      const cache: Record<string, string> = {}
      try {
        await Promise.all(
          Object.values(paths)
            .filter((path): path is string => Boolean(path))
            .map(async (path) => {
              const icon = await getFileIcon(path)
              if (icon) {
                cache[path.toLowerCase()] = icon
              }
            })
        )
      } finally {
        setAppIconCache(cache)
        setFetchingIcons(false)
      }
    }

    loadData()
  }, [gameKey, activeProfileId])

  useEffect(() => {
    // Live-sync: when the user changes app paths/names/custom-slots in Settings
    // while the editor is open, reconcile the utility list and preserve the
    // current enabled/order state. syncProfileUtilitiesWithSettings is called
    // twice intentionally: once with [] to get the updated Utility[] reference,
    // then inside the setState updater (with the current profileUtilities) to
    // merge the live editor choices with the new utility list.
    const { utilities: resolvedUtilities } = syncProfileUtilitiesWithSettings(
      [],
      settingsCustomSlots,
      settingsAppPaths,
      settingsAppNames
    )

    setAppPaths(settingsAppPaths)
    setAppNames(settingsAppNames)
    setUtilities(resolvedUtilities)
    setProfileUtilities(
      (currentUtilities) =>
        syncProfileUtilitiesWithSettings(
          currentUtilities,
          settingsCustomSlots,
          settingsAppPaths,
          settingsAppNames
        ).profileUtilities
    )
  }, [settingsAppNames, settingsAppPaths, settingsCustomSlots])

  const currentProfileState = useMemo(
    () => ({
      profileName,
      // Normalise for value-equality dirty tracking (#438):
      // enabled utilities keep their user-defined launch order;
      // disabled utilities are sorted by id so that toggling a utility
      // off and back on (which changes its array position) doesn't leave
      // a spurious dirty=true when the enabled/disabled state is identical
      // to the last-saved snapshot.
      profileUtilities: [
        ...profileUtilities.filter((u) => u.enabled).map((u) => ({ id: u.id, enabled: true })),
        ...profileUtilities
          .filter((u) => !u.enabled)
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((u) => ({ id: u.id, enabled: false }))
      ],
      launchAutomatically,
      gamePosition,
      trackingEnabled,
      killControlsEnabled,
      relaunchControlsEnabled,
      trackedProcessPaths
    }),
    [
      profileName,
      profileUtilities,
      launchAutomatically,
      gamePosition,
      trackingEnabled,
      killControlsEnabled,
      relaunchControlsEnabled,
      trackedProcessPaths
    ]
  )

  const { isDirty, resetDirty } = useDirtyTracking(currentProfileState, loading)

  const handleCloseAttempt = useCallback(() => {
    if (isDirty) {
      setShowConfirm(true)
    } else {
      onClose()
    }
  }, [isDirty, onClose])

  // Invoked by the "+" (New Profile) button in ProfileNameSection.
  // If the editor has unsaved changes we show a dedicated confirm dialog first
  // (separate from the close-confirm) so the user can save or discard before
  // the active profile switches to the new one. Only fires if onCreateProfile
  // is provided by the parent (GameRow).
  const handleCreateProfileAttempt = useCallback(() => {
    if (!onCreateProfile) {
      return
    }
    if (isDirty) {
      setShowNewProfileConfirm(true)
    } else {
      onCreateProfile()
    }
  }, [isDirty, onCreateProfile])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === 'Escape' &&
        !showLaunchConfirm &&
        !profileDeleteConfirm &&
        !showNewProfileConfirm
      ) {
        handleCloseAttempt()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleCloseAttempt, showLaunchConfirm, profileDeleteConfirm, showNewProfileConfirm])

  const handleToggleUtility = (key: string) => {
    setProfileUtilities((currentUtilities) => {
      const currentEntry = currentUtilities.find((entry) => entry.id === key)

      if (!currentEntry) {
        return currentUtilities
      }

      const toggledEntry = { ...currentEntry, enabled: !currentEntry.enabled }
      const remainingEntries = currentUtilities.filter((entry) => entry.id !== key)

      if (toggledEntry.enabled) {
        // Insert newly-enabled utility after the last currently-enabled entry so
        // it appears at the bottom of the enabled section rather than at the
        // very end of the list (which would place it below disabled utilities).
        const lastEnabledIndex = remainingEntries.reduce(
          (latestIndex, entry, index) => (entry.enabled ? index : latestIndex),
          -1
        )

        return [
          ...remainingEntries.slice(0, lastEnabledIndex + 1),
          toggledEntry,
          ...remainingEntries.slice(lastEnabledIndex + 1)
        ]
      }

      // Disabled utilities are appended at the end so their relative order
      // doesn't matter for the dirty-tracking normalisation in currentProfileState.
      return [...remainingEntries, toggledEntry]
    })
  }

  const moveEnabledUtility = (
    draggedId: string,
    targetId: string,
    placement: 'before' | 'after'
  ) => {
    if (draggedId === targetId) {
      return
    }

    setProfileUtilities((currentUtilities) => {
      const enabledEntries = currentUtilities.filter((entry) => entry.enabled)
      const disabledEntries = currentUtilities.filter((entry) => !entry.enabled)
      const fromIndex = enabledEntries.findIndex((entry) => entry.id === draggedId)
      const toIndex = enabledEntries.findIndex((entry) => entry.id === targetId)

      if (fromIndex === -1 || toIndex === -1) {
        return currentUtilities
      }

      const nextEnabledEntries = [...enabledEntries]
      const [movedEntry] = nextEnabledEntries.splice(fromIndex, 1)
      const targetIndexAfterRemoval = nextEnabledEntries.findIndex((entry) => entry.id === targetId)

      if (targetIndexAfterRemoval === -1) {
        return currentUtilities
      }

      nextEnabledEntries.splice(
        placement === 'after' ? targetIndexAfterRemoval + 1 : targetIndexAfterRemoval,
        0,
        movedEntry
      )

      return [...nextEnabledEntries, ...disabledEntries]
    })
  }

  const startUtilityDrag = (event: DragEvent<HTMLDivElement>, utilityKey: string) => {
    const target = event.target instanceof HTMLElement ? event.target : null

    // Elements marked data-no-row-drag="true" (e.g. toggle switches, path
    // inputs) must not initiate a drag even though the drag handle wraps them.
    if (target?.closest('[data-no-row-drag="true"]')) {
      event.preventDefault()
      return
    }

    setDragUtilityId(utilityKey)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', utilityKey)
  }

  const handleAddTrackedProcess = () => {
    setTrackedProcessPaths((prev) => [...prev, ''])
  }

  const handleBrowseTrackedProcess = async (index: number) => {
    const result = await browsePath(`${gameKey}-tracked-${index}`)

    if (result.filePath) {
      setTrackedProcessPaths((prev) =>
        prev.map((current, currentIndex) =>
          currentIndex === index ? result.filePath || current : current
        )
      )
    }
  }

  const handleRemoveTrackedProcess = (index: number) => {
    setTrackedProcessPaths((prev) => prev.filter((_, currentIndex) => currentIndex !== index))
  }

  const executeLaunch = useCallback(async () => {
    setShowLaunchConfirm(false)
    onProfileCommitted?.()
    onClose()
    onLaunchStart?.()
    let cooldownMs = 0
    try {
      const result = await launchProfile(gameKey)
      cooldownMs = result.launchedCount === 0 ? 0 : 10000
      if (!result.success) {
        notify(result.error || 'Failed to launch profile', 'error')
      } else {
        notify(
          result.warning || result.message || 'Launching profile',
          result.warning ? 'warn' : 'success'
        )
      }
    } catch (err) {
      notify('Failed to launch profile', 'error')
      console.error(err)
    } finally {
      onLaunchEnd?.(cooldownMs)
    }
  }, [
    gameKey,
    notify,
    onClose,
    onLaunchEnd,
    onLaunchStart,
    onProfileCommitted,
    setShowLaunchConfirm
  ])

  const handleLaunch = useCallback(async () => {
    if (isDirty) {
      setShowLaunchConfirm(true)
    } else {
      await executeLaunch()
    }
  }, [isDirty, executeLaunch, setShowLaunchConfirm])

  const handleSave = async (shouldLaunch = false): Promise<boolean> => {
    if (shouldLaunch) setShowLaunchConfirm(false)
    try {
      // Re-read the store and surgically replace only the edited profile.
      // Sibling profiles are preserved exactly as stored — this prevents a
      // data-loss race where another GameRow's save would overwrite profiles
      // that this editor hasn't loaded.
      const allProfiles = await getProfiles()
      const profileSet = normalizeGameProfileSet(
        allProfiles[gameKey] as Profiles[string] | undefined
      )
      const activeProfile =
        profileSet.profiles.find((profile) => profile.id === activeProfileId) ||
        getActiveGameProfile(profileSet)
      const normalizedProfileName = profileName.trim() || activeProfile.name

      const updatedProfile = {
        ...activeProfile,
        name: normalizedProfileName,
        utilities: profileUtilities.map((utility) => ({
          id: utility.id,
          enabled: utility.enabled
        })),
        launchAutomatically,
        gamePosition,
        trackingEnabled,
        killControlsEnabled,
        relaunchControlsEnabled,
        trackedProcessPaths: trackedProcessPaths.filter(
          (processPath) => processPath.trim().length > 0
        )
      }

      await saveProfile(gameKey, {
        activeProfileId: updatedProfile.id,
        profiles: profileSet.profiles.map((profile) =>
          profile.id === updatedProfile.id ? updatedProfile : profile
        )
      })
      await onProfilesChanged()
      resetDirty()
      onProfileCommitted?.()

      notify('Profile saved!', 'success', 2500)

      if (shouldLaunch) {
        executeLaunch()
      } else {
        onClose()
      }
      return true
    } catch (err) {
      console.error('Failed to save profile', err)
      notify('Failed to save profile', 'error')
      return false
    }
  }

  // Saves the current profile without closing the editor. Used by the
  // "Save & Create New" path so the editor can stay open and reload onto
  // the newly created profile.
  const handleSaveOnly = async (): Promise<boolean> => {
    try {
      const allProfiles = await getProfiles()
      const profileSet = normalizeGameProfileSet(
        allProfiles[gameKey] as Profiles[string] | undefined
      )
      const activeProfile =
        profileSet.profiles.find((profile) => profile.id === activeProfileId) ||
        getActiveGameProfile(profileSet)
      const normalizedProfileName = profileName.trim() || activeProfile.name

      const updatedProfile = {
        ...activeProfile,
        name: normalizedProfileName,
        utilities: profileUtilities.map((utility) => ({
          id: utility.id,
          enabled: utility.enabled
        })),
        launchAutomatically,
        gamePosition,
        trackingEnabled,
        killControlsEnabled,
        relaunchControlsEnabled,
        trackedProcessPaths: trackedProcessPaths.filter(
          (processPath) => processPath.trim().length > 0
        )
      }

      await saveProfile(gameKey, {
        activeProfileId: updatedProfile.id,
        profiles: profileSet.profiles.map((profile) =>
          profile.id === updatedProfile.id ? updatedProfile : profile
        )
      })
      await onProfilesChanged()
      resetDirty()
      onProfileCommitted?.()
      notify('Profile saved!', 'success', 2500)
      return true
    } catch (err) {
      console.error('Failed to save profile', err)
      notify('Failed to save profile', 'error')
      return false
    }
  }

  const handleDiscardAndLaunch = () => {
    executeLaunch()
  }

  const handleDeleteProfile = async () => {
    const allProfiles = await getProfiles()
    const profileSet = normalizeGameProfileSet(allProfiles[gameKey] as Profiles[string] | undefined)
    const activeProfile =
      profileSet.profiles.find((profile) => profile.id === activeProfileId) ||
      getActiveGameProfile(profileSet)

    if (profileSet.profiles.length <= 1) {
      notify('At least one profile is required', 'warn')
      return
    }

    setProfileDeleteConfirm({ profileId: activeProfile.id, profileName: activeProfile.name })
  }

  const confirmDeleteProfile = async () => {
    if (!profileDeleteConfirm) {
      return
    }

    const allProfiles = await getProfiles()
    const profileSet = normalizeGameProfileSet(allProfiles[gameKey] as Profiles[string] | undefined)
    const activeProfile = profileSet.profiles.find(
      (profile) => profile.id === profileDeleteConfirm.profileId
    )

    if (!activeProfile || profileSet.profiles.length <= 1) {
      setProfileDeleteConfirm(null)
      return
    }

    const nextProfiles = profileSet.profiles.filter((profile) => profile.id !== activeProfile.id)

    await saveProfile(gameKey, {
      activeProfileId: nextProfiles[0].id,
      profiles: nextProfiles
    })
    setProfileDeleteConfirm(null)
    await onProfilesChanged()
    notify('Profile deleted', 'warn', 2500)
    onProfileCommitted?.()
    onClose()
  }

  useEffect(() => {
    // Register the launch handler with the parent each time handleLaunch is
    // recreated (i.e. when isDirty changes) so the parent's click handler always
    // invokes the up-to-date version that knows whether to show the confirm dialog.
    if (onLaunchRequest) {
      onLaunchRequest(handleLaunch)
    }
  }, [onLaunchRequest, handleLaunch])

  const utilityByKey = new Map(utilities.map((utility) => [utility.key, utility]))
  // A utility is "available" only when both a Utility definition exists AND an
  // app path has been configured. Utilities without a path are not shown in the
  // editor UI — they are excluded from both the enabled and disabled lists.
  const availableUtilityEntries = profileUtilities.filter(
    (entry) => utilityByKey.has(entry.id) && appPaths[entry.id]
  )
  const enabledUtilityEntries = availableUtilityEntries.filter((entry) => entry.enabled)
  const disabledUtilityEntries = availableUtilityEntries.filter((entry) => !entry.enabled)
  const availableUtilities = availableUtilityEntries.map((entry) => utilityByKey.get(entry.id)!)

  return {
    loading,
    appPaths,
    appNames,
    profileName,
    setProfileName,
    profileCount,
    dragUtilityId,
    dropTarget,
    launchAutomatically,
    setLaunchAutomatically,
    gamePosition,
    setGamePosition,
    trackingEnabled,
    setTrackingEnabled,
    killControlsEnabled,
    setKillControlsEnabled,
    relaunchControlsEnabled,
    setRelaunchControlsEnabled,
    trackedProcessPaths,
    appIconCache,
    failedIcons,
    setFailedIcons,
    fetchingIcons,
    showConfirm,
    setShowConfirm,
    showNewProfileConfirm,
    setShowNewProfileConfirm,
    showLaunchConfirm,
    setShowLaunchConfirm,
    profileDeleteConfirm,
    setProfileDeleteConfirm,
    setDragUtilityId,
    setDropTarget,
    isDirty,
    handleCloseAttempt,
    handleCreateProfileAttempt,
    handleToggleUtility,
    moveEnabledUtility,
    startUtilityDrag,
    handleAddTrackedProcess,
    handleBrowseTrackedProcess,
    handleRemoveTrackedProcess,
    handleIconFailed: (utilityKey: string) =>
      setFailedIcons((prev) => ({ ...prev, [utilityKey]: true })),
    handleLaunch,
    handleDiscardAndLaunch,
    handleSave,
    handleSaveOnly,
    handleDeleteProfile,
    confirmDeleteProfile,
    utilityByKey,
    availableUtilities,
    enabledUtilityEntries,
    disabledUtilityEntries
  }
}
