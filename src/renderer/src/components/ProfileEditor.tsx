import { useEffect, useState } from 'react'
import {
  getActiveGameProfile,
  getUtilities,
  normalizeGameProfileSet,
  normalizeProfileUtilities,
  resolveCustomSlots,
  type ProfileUtility,
  type Profiles,
  type Utility
} from '../lib/config'
import { useNotify } from './Notify'
import { Toggle } from './Toggle'
import { getSettings, getProfiles, saveProfile } from '../lib/store'
import { getFileIcon, browsePath } from '../lib/electron'

interface ProfileToggleRowProps {
  label: string
  checked: boolean
  onToggle: () => void
  onChange: (checked: boolean) => void
}

function ProfileToggleRow({ label, checked, onToggle, onChange }: ProfileToggleRowProps) {
  return (
    <div
      role="switch"
      aria-checked={checked ? 'true' : 'false'}
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onToggle()
        }
      }}
      className="group flex cursor-pointer items-center justify-between rounded-xl bg-(--glass-bg) p-3 transition-all duration-200 hover:bg-(--accent) hover:text-(--accent-foreground) focus:outline-none focus-visible:ring-2 focus-visible:ring-(--accent)"
    >
      <span className="text-sm font-medium text-(--text-secondary) group-hover:text-(--accent-foreground)">
        {label}
      </span>
      <span onClick={(event) => event.stopPropagation()}>
        <Toggle checked={checked} onChange={onChange} aria-label={label} />
      </span>
    </div>
  )
}

interface ProfileEditorProps {
  gameKey: string
  gameName: string
  activeProfileId: string
  onProfilesChanged: () => Promise<unknown>
  onClose: () => void
}

export function ProfileEditor({
  gameKey,
  gameName,
  activeProfileId,
  onProfilesChanged,
  onClose
}: ProfileEditorProps) {
  const { notify } = useNotify()
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
      const resolvedUtilities = getUtilities(
        resolveCustomSlots(savedCustomSlots, paths, names, profile)
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
            .filter(Boolean)
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

  const handleSave = async () => {
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

    notify('Profile saved!', 'success', 2500)
    onClose()
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

    if (!window.confirm(`Delete profile "${activeProfile.name}"?`)) {
      return
    }

    const nextProfiles = profileSet.profiles.filter((profile) => profile.id !== activeProfile.id)

    await saveProfile(gameKey, {
      activeProfileId: nextProfiles[0].id,
      profiles: nextProfiles
    })
    await onProfilesChanged()
    notify('Profile deleted', 'warn', 2500)
    onClose()
  }

  if (loading) return null

  // Filter utilities to show only those that have a configured executable path
  const utilityByKey = new Map(utilities.map((utility) => [utility.key, utility]))
  const availableUtilityEntries = profileUtilities.filter(
    (entry) => utilityByKey.has(entry.id) && appPaths[entry.id]
  )
  const enabledUtilityEntries = availableUtilityEntries.filter((entry) => entry.enabled)
  const disabledUtilityEntries = availableUtilityEntries.filter((entry) => !entry.enabled)
  const availableUtilities = availableUtilityEntries.map((entry) => utilityByKey.get(entry.id)!)

  const renderUtilityRow = (entry: ProfileUtility, isEnabled: boolean, orderIndex?: number) => {
    const utility = utilityByKey.get(entry.id)

    if (!utility) {
      return null
    }

    const label = appNames[utility.key] || utility.name
    const iconPath = appPaths[utility.key]?.toLowerCase()
    const icon = iconPath ? appIconCache[iconPath] : null
    const dropPlacement = dropTarget?.id === utility.key ? dropTarget.placement : null

    return (
      <div
        key={utility.key}
        role="switch"
        aria-checked={isEnabled ? 'true' : 'false'}
        tabIndex={0}
        onClick={() => handleToggleUtility(utility.key)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            handleToggleUtility(utility.key)
          }
        }}
        onDragOver={(event) => {
          if (isEnabled && dragUtilityId && dragUtilityId !== utility.key) {
            event.preventDefault()
            event.dataTransfer.dropEffect = 'move'
            const bounds = event.currentTarget.getBoundingClientRect()
            const placement = event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after'
            setDropTarget({ id: utility.key, placement })
          }
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setDropTarget((currentTarget) =>
              currentTarget?.id === utility.key ? null : currentTarget
            )
          }
        }}
        onDrop={(event) => {
          event.preventDefault()
          if (dragUtilityId && dropPlacement) {
            moveEnabledUtility(dragUtilityId, utility.key, dropPlacement)
            setDragUtilityId(null)
            setDropTarget(null)
          }
        }}
        className={`group relative flex cursor-pointer items-center justify-between rounded-xl bg-(--glass-bg) p-3 transition-all duration-200 hover:bg-(--accent) hover:text-(--accent-foreground) ${
          isEnabled ? '' : 'opacity-55 hover:opacity-100'
        }`}
      >
        {dropPlacement && (
          <span
            className={`pointer-events-none absolute left-3 right-3 h-0.5 rounded-full bg-(--accent) shadow-[0_0_10px_var(--accent-glow)] ${
              dropPlacement === 'before' ? '-top-1.5' : '-bottom-1.5'
            }`}
          />
        )}
        <div className="flex min-w-0 items-center gap-3">
          {isEnabled && typeof orderIndex === 'number' && (
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-(--accent)/15 text-[11px] font-black tabular-nums text-(--accent)">
              {orderIndex + 1}
            </span>
          )}
          <button
            type="button"
            draggable={isEnabled}
            disabled={!isEnabled}
            onClick={(event) => event.stopPropagation()}
            onDragStart={(event) => {
              event.stopPropagation()
              setDragUtilityId(utility.key)
              event.dataTransfer.effectAllowed = 'move'
              event.dataTransfer.setData('text/plain', utility.key)
              const dragImage = document.createElement('div')
              dragImage.style.width = '1px'
              dragImage.style.height = '1px'
              dragImage.style.opacity = '0'
              document.body.appendChild(dragImage)
              event.dataTransfer.setDragImage(dragImage, 0, 0)
              window.setTimeout(() => dragImage.remove(), 0)
            }}
            onDragEnd={() => {
              setDragUtilityId(null)
              setDropTarget(null)
            }}
            className="flex h-6 w-5 shrink-0 cursor-grab items-center justify-center rounded text-(--text-subtle) transition-colors hover:bg-white/10 hover:text-(--text-primary) active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-20"
            title="Drag to reorder"
            aria-label={`Reorder ${label}`}
          >
            <svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor" aria-hidden="true">
              <circle cx="3" cy="3" r="1.2" />
              <circle cx="9" cy="3" r="1.2" />
              <circle cx="3" cy="8" r="1.2" />
              <circle cx="9" cy="8" r="1.2" />
              <circle cx="3" cy="13" r="1.2" />
              <circle cx="9" cy="13" r="1.2" />
            </svg>
          </button>
          <div className="relative flex h-6 w-6 shrink-0 items-center justify-center">
            {icon && !failedIcons[utility.key] ? (
              <img
                src={icon}
                alt=""
                className="h-full w-full object-contain animate-fade-slide"
                onError={() => setFailedIcons((prev) => ({ ...prev, [utility.key]: true }))}
              />
            ) : fetchingIcons && !failedIcons[utility.key] ? (
              <div className="h-full w-full skeleton-icon animate-pulse" />
            ) : (
              <div className="flex h-full w-full items-center justify-center rounded bg-(--accent)/20 text-[8px] font-black uppercase text-(--accent)">
                {label.slice(0, 2)}
              </div>
            )}
          </div>
          <span className="min-w-0 line-clamp-1 text-sm font-medium opacity-80 group-hover:opacity-100">
            {label}
          </span>
        </div>
        <span onClick={(event) => event.stopPropagation()}>
          <Toggle
            checked={isEnabled}
            onChange={() => handleToggleUtility(utility.key)}
            aria-label={label}
          />
        </span>
      </div>
    )
  }

  return (
    <div className="glass-surface-elevated animate-fade-slide rounded-[20px] p-5 shadow-2xl">
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-(--text-primary)">
          Edit Profile: <span className="text-(--accent)">{gameName}</span>
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-2xl leading-none text-(--text-subtle) transition-all duration-200 hover:bg-(--glass-bg) hover:text-(--text-primary) active:scale-[0.98]"
          title="Close"
        >
          ×
        </button>
      </div>

      <div className="space-y-5">
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wider text-(--text-muted)">
            Profile name
          </p>
          <input
            type="text"
            value={profileName}
            onChange={(event) => setProfileName(event.target.value)}
            className="w-full glass-recessed rounded-lg px-3 py-2 text-sm text-(--text-primary) outline-none transition-colors focus:ring-2 focus:ring-(--accent)"
            aria-label="Profile name"
          />
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wider text-(--text-muted)">
            Utilities to launch
          </p>

          {availableUtilities.length > 0 ? (
            <div className="space-y-3">
              {enabledUtilityEntries.length > 0 && (
                <div className="grid grid-cols-1 gap-2.5">
                  {enabledUtilityEntries.map((entry, index) =>
                    renderUtilityRow(entry, true, index)
                  )}
                </div>
              )}
              {disabledUtilityEntries.length > 0 && (
                <div className="grid grid-cols-1 gap-2.5 border-t border-(--glass-border) pt-3 sm:grid-cols-2">
                  {disabledUtilityEntries.map((entry) => renderUtilityRow(entry, false))}
                </div>
              )}
            </div>
          ) : (
            <div className="flex h-20 items-center justify-center rounded-xl border border-dashed border-(--glass-border) bg-(--glass-bg)">
              <p className="text-sm text-(--text-muted)">No utilities configured in Settings</p>
            </div>
          )}
        </div>

        <div className="border-t border-(--glass-border) pt-4">
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <ProfileToggleRow
              label="Launch game with profile"
              checked={launchAutomatically}
              onToggle={() => setLaunchAutomatically((value) => !value)}
              onChange={setLaunchAutomatically}
            />
            <ProfileToggleRow
              label="Track running indicator for this game"
              checked={trackingEnabled}
              onToggle={() => setTrackingEnabled((value) => !value)}
              onChange={setTrackingEnabled}
            />
          </div>
        </div>

        <div className="space-y-4 border-t border-(--glass-border) pt-4">
          <p className="text-xs font-medium uppercase tracking-wider text-(--text-muted)">
            Process tracking
          </p>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <ProfileToggleRow
              label="Allow close apps controls"
              checked={killControlsEnabled}
              onToggle={() => setKillControlsEnabled((value) => !value)}
              onChange={setKillControlsEnabled}
            />
            <ProfileToggleRow
              label="Allow relaunch controls"
              checked={relaunchControlsEnabled}
              onToggle={() => setRelaunchControlsEnabled((value) => !value)}
              onChange={setRelaunchControlsEnabled}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-medium text-(--text-primary)">
                Secondary executables to watch
              </span>
              <button
                type="button"
                onClick={handleAddTrackedProcess}
                className="cursor-pointer rounded-lg bg-(--glass-bg-elevated) px-3 py-1.5 text-xs font-semibold text-(--text-primary) transition-all duration-200 hover:bg-(--glass-border) active:scale-[0.98]"
              >
                Add
              </button>
            </div>

            {trackedProcessPaths.length > 0 ? (
              <div className="space-y-2">
                {trackedProcessPaths.map((processPath, index) => (
                  <div key={`${index}-${processPath}`} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={processPath}
                      readOnly
                      placeholder="No secondary executable selected"
                      className="min-w-0 flex-1 glass-recessed rounded-lg px-3 py-2 text-xs text-(--text-secondary) outline-none font-mono truncate"
                    />
                    <button
                      type="button"
                      onClick={() => handleBrowseTrackedProcess(index)}
                      className="cursor-pointer rounded-lg bg-(--glass-bg-elevated) px-3 py-2 text-xs font-semibold text-(--text-primary) transition-all duration-200 hover:bg-(--glass-border) active:scale-[0.98]"
                    >
                      Browse
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemoveTrackedProcess(index)}
                      className="cursor-pointer rounded-lg bg-(--danger-surface) px-3 py-2 text-xs font-semibold text-(--danger-text) transition-all duration-200 hover:bg-(--danger-border) active:scale-[0.98]"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex h-14 items-center justify-center rounded-xl border border-dashed border-(--glass-border) bg-(--glass-bg)">
                <p className="text-sm text-(--text-muted)">No secondary executables configured</p>
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={handleSave}
            className="flex-1 cursor-pointer rounded-xl bg-(--accent) py-2.5 text-sm text-(--accent-foreground) transition-all duration-300 hover:opacity-90 neon-glow active:scale-[0.98]"
          >
            Save Profile
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 cursor-pointer rounded-xl bg-(--glass-bg-elevated) py-2.5 text-sm font-semibold text-(--text-primary) transition-all duration-300 hover:bg-(--glass-border) active:scale-[0.98]"
          >
            Cancel
          </button>
          {profileCount > 1 && (
            <button
              type="button"
              onClick={handleDeleteProfile}
              className="flex h-11 w-11 cursor-pointer shrink-0 items-center justify-center rounded-xl bg-(--danger-surface) text-(--danger-text) transition-all duration-300 hover:bg-(--danger-border) active:scale-[0.98]"
              title="Delete profile"
              aria-label="Delete profile"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 6h18" />
                <path d="M8 6V4h8v2" />
                <path d="M19 6l-1 14H6L5 6" />
                <path d="M10 11v5" />
                <path d="M14 11v5" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
