import { useEffect, useState } from 'react'
import { UTILITIES, type Profiles } from '../lib/config'
import { useNotify } from './Notify'

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
        initialSelection[u.key] = profile[u.key] || false
      })
      
      setSelection(initialSelection)
      // Default auto-launch to true unless explicitly disabled
      setLaunchAutomatically(profile.launchAutomatically !== false)
      setLoading(false)
    }

    loadData()
  }, [gameKey])

  const handleToggleUtility = (key: string) => {
    setSelection((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const handleSave = async () => {
    // Read-modify-write pattern for the 'profiles' object store
    const allProfiles = (await window.electronAPI.storeGet('profiles')) as Profiles || {}
    
    allProfiles[gameKey] = {
      ...selection,
      launchAutomatically
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
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">
          Edit Profile: <span className="text-[var(--accent)]">{gameName}</span>
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-2xl leading-none text-[var(--text-subtle)] transition-colors hover:bg-[var(--glass-bg)] hover:text-[var(--text-primary)]"
          title="Close"
        >
          ×
        </button>
      </div>

      <div className="space-y-5">
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
            Utilities to launch
          </p>
          
          {availableUtilities.length > 0 ? (
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {availableUtilities.map((u) => (
                <label
                  key={u.key}
                  className="flex cursor-pointer items-center gap-3 rounded-xl bg-[var(--glass-bg)] p-3 transition-all duration-200 hover:bg-[var(--accent)] hover:text-white"
                >
                  <input
                    type="checkbox"
                    checked={!!selection[u.key]}
                    onChange={() => handleToggleUtility(u.key)}
                    className="h-4 w-4 cursor-pointer rounded border-[var(--glass-border)] bg-transparent accent-[var(--accent)]"
                  />
                  <span className="text-sm text-[var(--text-secondary)]">{appNames[u.key] || u.name}</span>
                </label>
              ))}
            </div>
          ) : (
            <div className="flex h-20 items-center justify-center rounded-xl border border-dashed border-[var(--glass-border)] bg-[var(--glass-bg)]">
              <p className="text-sm text-[var(--text-muted)]">
                No utilities configured in Settings
              </p>
            </div>
          )}
        </div>

        <div className="border-t border-[var(--glass-border)] pt-4">
          <label className="flex cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              checked={launchAutomatically}
              onChange={(e) => setLaunchAutomatically(e.target.checked)}
              className="h-4 w-4 cursor-pointer rounded border-[var(--glass-border)] bg-transparent accent-[var(--accent)]"
            />
            <span className="text-[13px] font-medium text-[var(--text-primary)]">
              Launch game automatically after utilities
            </span>
          </label>
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={handleSave}
            className="flex-1 cursor-pointer rounded-xl bg-[var(--accent)] py-2.5 text-sm font-semibold text-white transition-all duration-300 hover:opacity-90 neon-glow active:scale-95"
          >
            Save Profile
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 cursor-pointer rounded-xl bg-[var(--glass-bg-elevated)] py-2.5 text-sm font-semibold text-[var(--text-primary)] transition-colors hover:bg-[var(--glass-border)] font-medium active:scale-95"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
