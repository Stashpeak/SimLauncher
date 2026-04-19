import { useEffect, useState } from 'react'
import { UTILITIES, type Profiles } from '../lib/config'
import { useNotify } from './Notify'
import { Toggle } from './Toggle'

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
      aria-checked={checked}
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onToggle()
        }
      }}
      className="group flex cursor-pointer items-center justify-between rounded-xl bg-(--glass-bg) p-3 transition-all duration-200 hover:bg-(--accent) hover:text-(--text-primary) focus:outline-none focus-visible:ring-2 focus-visible:ring-(--accent)"
    >
      <span className="text-sm font-medium text-(--text-secondary) group-hover:text-(--text-primary)">{label}</span>
      <span onClick={(event) => event.stopPropagation()}>
        <Toggle checked={checked} onChange={onChange} aria-label={label} />
      </span>
    </div>
  )
}

interface ProfileEditorProps {
  gameKey: string
  gameName: string
  onClose: () => void
}

export function ProfileEditor({ gameKey, gameName, onClose }: ProfileEditorProps) {
  const { notify } = useNotify()
  const [loading, setLoading] = useState(true)
  const [appPaths, setAppPaths] = useState<Record<string, string>>({})
  const [appNames, setAppNames] = useState<Record<string, string>>({})
  const [selection, setSelection] = useState<Record<string, boolean>>({})
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
      // Load configuration from electron-store via IPC
      const paths = (await window.electronAPI.storeGet('appPaths')) as Record<string, string> || {}
      const names = (await window.electronAPI.storeGet('appNames')) as Record<string, string> || {}
      const allProfiles = (await window.electronAPI.storeGet('profiles')) as Profiles || {}
      const profile = allProfiles[gameKey] || {}

      setAppPaths(paths)
      setAppNames(names)
      
      // Initialize selection state based on existing profile
      const initialSelection: Record<string, boolean> = {}
      UTILITIES.forEach((u) => {
        initialSelection[u.key] = profile[u.key] === true
      })
      
      setSelection(initialSelection)
      // Default auto-launch to true unless explicitly disabled
      setLaunchAutomatically(profile.launchAutomatically !== false)
      setTrackingEnabled(profile.trackingEnabled !== false)
      setKillControlsEnabled(profile.killControlsEnabled === true)
      setRelaunchControlsEnabled(profile.relaunchControlsEnabled === true)
      setTrackedProcessPaths(Array.isArray(profile.trackedProcessPaths) ? profile.trackedProcessPaths : [])
      setLoading(false)

      // Fetch icons for all configured app paths
      setFetchingIcons(true)
      const cache: Record<string, string> = {}
      try {
        await Promise.all(
          Object.values(paths).filter(Boolean).map(async (path) => {
            const icon = await window.electronAPI.getFileIcon(path)
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
  }, [gameKey])

  const handleToggleUtility = (key: string) => {
    setSelection((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const handleAddTrackedProcess = () => {
    setTrackedProcessPaths((prev) => [...prev, ''])
  }

  const handleBrowseTrackedProcess = async (index: number) => {
    const result = await window.electronAPI.browsePath(`${gameKey}-tracked-${index}`)

    if (result.filePath) {
      setTrackedProcessPaths((prev) => prev.map((current, currentIndex) => (
        currentIndex === index ? result.filePath || current : current
      )))
    }
  }

  const handleRemoveTrackedProcess = (index: number) => {
    setTrackedProcessPaths((prev) => prev.filter((_, currentIndex) => currentIndex !== index))
  }

  const handleSave = async () => {
    // Read-modify-write pattern for the 'profiles' object store
    const allProfiles = (await window.electronAPI.storeGet('profiles')) as Profiles || {}
    
    allProfiles[gameKey] = {
      ...selection,
      launchAutomatically,
      trackingEnabled,
      killControlsEnabled,
      relaunchControlsEnabled,
      trackedProcessPaths: trackedProcessPaths.filter((processPath) => processPath.trim().length > 0)
    }

    await window.electronAPI.storeSet('profiles', allProfiles)
    
    notify('Profile saved!', 'success', 2500)
    onClose()
  }

  if (loading) return null

  // Filter utilities to show only those that have a configured executable path
  const availableUtilities = UTILITIES.filter((u) => appPaths[u.key])

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
            Utilities to launch
          </p>
          
          {availableUtilities.length > 0 ? (
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {availableUtilities.map((u) => (
                <div
                  key={u.key}
                  role="switch"
                  aria-checked={!!selection[u.key]}
                  tabIndex={0}
                  onClick={() => handleToggleUtility(u.key)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      handleToggleUtility(u.key)
                    }
                  }}
                  className="flex cursor-pointer items-center justify-between rounded-xl bg-(--glass-bg) p-3 transition-all duration-200 hover:bg-(--accent) hover:text-(--text-primary) group"
                >
                  <div className="flex items-center gap-3">
                    <div className="relative flex h-6 w-6 shrink-0 items-center justify-center">
                      {appIconCache[appPaths[u.key]?.toLowerCase()] && !failedIcons[u.key] ? (
                        <img
                          src={appIconCache[appPaths[u.key].toLowerCase()]}
                          alt=""
                          className="h-full w-full object-contain animate-fade-slide"
                          onError={() => setFailedIcons((prev) => ({ ...prev, [u.key]: true }))}
                        />
                      ) : fetchingIcons && !failedIcons[u.key] ? (
                        <div className="h-full w-full skeleton-icon animate-pulse" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center rounded bg-(--accent)/20 text-[8px] font-black uppercase text-(--accent)">
                          {(appNames[u.key] || u.name).slice(0, 2)}
                        </div>
                      )}
                    </div>
                    <span className="text-sm font-medium opacity-80 group-hover:opacity-100 line-clamp-1">
                      {appNames[u.key] || u.name}
                    </span>
                  </div>
                  <span onClick={(event) => event.stopPropagation()}>
                    <Toggle checked={!!selection[u.key]} onChange={() => handleToggleUtility(u.key)} aria-label={appNames[u.key] || u.name} />
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex h-20 items-center justify-center rounded-xl border border-dashed border-(--glass-border) bg-(--glass-bg)">
              <p className="text-sm text-(--text-muted)">
                No utilities configured in Settings
              </p>
            </div>
          )}
        </div>

        <div className="border-t border-(--glass-border) pt-4">
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <ProfileToggleRow
              label="Launch game automatically after utilities"
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
            className="flex-1 cursor-pointer rounded-xl bg-(--accent) py-2.5 text-sm text-white transition-all duration-300 hover:opacity-90 neon-glow active:scale-[0.98]"
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
        </div>
      </div>
    </div>
  )
}
