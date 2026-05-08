import { useCallback, useEffect, useState, useMemo, type DragEvent } from 'react'
import { useDirtyTracking } from './useDirtyTracking'
import {
  getActiveGameProfile,
  getUtilities,
  normalizeGameProfileSet,
  normalizeProfileUtilities,
  type ProfileUtility,
  type Profiles,
  type Utility
} from '../lib/config'
import { useNotify } from '../components/Notify'
import { getSettings, getProfiles, saveProfile } from '../lib/store'
import { getFileIcon, browsePath } from '../lib/electron'
import { useAppsSettings } from '../components/settings/AppsContext'
import { syncProfileUtilitiesWithSettings } from '../lib/profileEditorSettingsSync'

export interface ProfileEditorProps {
  gameKey: string
  activeProfileId: string
  onProfilesChanged: () => Promise<unknown>
  onClose: () => void
  onLaunchRequest?: (handleLaunch: () => void) => void
  onLaunchStart?: () => void
  onLaunchEnd?: (cooldownMs: number) => void
}

export function useProfileEditor({
  gameKey,
  activeProfileId,
  onProfilesChanged,
  onClose,
  onLaunchRequest,
  onLaunchStart,
  onLaunchEnd
}: ProfileEditorProps) {
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
  const [trackingEnabled, setTrackingEnabled] = useState(true)
  const [killControlsEnabled, setKillControlsEnabled] = useState(false)
  const [relaunchControlsEnabled, setRelaunchControlsEnabled] = useState(false)
  const [trackedProcessPaths, setTrackedProcessPaths] = useState<string[]>([])
  const [appIconCache, setAppIconCache] = useState<Record<string, string>>({})
  const [failedIcons, setFailedIcons] = useState<Record<string, boolean>>({})
  const [fetchingIcons, setFetchingIcons] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [showLaunchConfirm, setShowLaunchConfirm] = useState(false)
  const [profileDeleteConfirm, setProfileDeleteConfirm] = useState<{
    profileId: string
    profileName: string
  } | null>(null)

  useEffect(() => {
    async function loadData() {
      setLoading(true)
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
      profileUtilities: profileUtilities.map((u) => ({ id: u.id, enabled: u.enabled })),
      launchAutomatically,
      trackingEnabled,
      killControlsEnabled,
      relaunchControlsEnabled,
      trackedProcessPaths
    }),
    [
      profileName,
      profileUtilities,
      launchAutomatically,
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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !showLaunchConfirm && !profileDeleteConfirm) {
        handleCloseAttempt()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleCloseAttempt, showLaunchConfirm, profileDeleteConfirm])

  const handleToggleUtility = (key: string) => {
    setProfileUtilities((currentUtilities) => {
      const currentEntry = currentUtilities.find((entry) => entry.id === key)

      if (!currentEntry) {
        return currentUtilities
      }

      const toggledEntry = { ...currentEntry, enabled: !currentEntry.enabled }
      const remainingEntries = currentUtilities.filter((entry) => entry.id !== key)

      if (toggledEntry.enabled) {
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
    onClose()
    onLaunchStart?.()
    let cooldownMs = 0
    try {
      const { launchProfile } = await import('../lib/electron')
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
  }, [gameKey, notify, onClose, onLaunchEnd, onLaunchStart, setShowLaunchConfirm])

  const handleLaunch = useCallback(async () => {
    if (isDirty) {
      setShowLaunchConfirm(true)
    } else {
      await executeLaunch()
    }
  }, [isDirty, executeLaunch, setShowLaunchConfirm])

  const handleSave = async (shouldLaunch = false) => {
    if (shouldLaunch) setShowLaunchConfirm(false)
    const allProfiles = await getProfiles()
    const profileSet = normalizeGameProfileSet(allProfiles[gameKey] as Profiles[string] | undefined)
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

    notify('Profile saved!', 'success', 2500)

    if (shouldLaunch) {
      executeLaunch()
    } else {
      onClose()
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
    onClose()
  }

  useEffect(() => {
    if (onLaunchRequest) {
      onLaunchRequest(handleLaunch)
    }
  }, [onLaunchRequest, handleLaunch])

  const utilityByKey = new Map(utilities.map((utility) => [utility.key, utility]))
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
    showLaunchConfirm,
    setShowLaunchConfirm,
    profileDeleteConfirm,
    setProfileDeleteConfirm,
    setDragUtilityId,
    setDropTarget,
    isDirty,
    handleCloseAttempt,
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
    handleDeleteProfile,
    confirmDeleteProfile,
    utilityByKey,
    availableUtilities,
    enabledUtilityEntries,
    disabledUtilityEntries
  }
}
