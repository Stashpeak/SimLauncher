import { Toggle } from '../Toggle'
import type { UpdateInfo, UpdateStatus } from './types'

interface AboutSectionProps {
  appVersion: string
  autoCheckUpdates: boolean
  updateInfo: UpdateInfo
  checkingUpdate: boolean
  installingUpdate: boolean
  updateProgress: number | null
  updateStatus: UpdateStatus
  onAutoCheckUpdatesChange: (checked: boolean) => void
  onManualCheck: () => void
  onInstallUpdate: () => void
}

export function AboutSection({
  appVersion,
  autoCheckUpdates,
  updateInfo,
  checkingUpdate,
  installingUpdate,
  updateProgress,
  updateStatus,
  onAutoCheckUpdatesChange,
  onManualCheck,
  onInstallUpdate
}: AboutSectionProps) {
  return (
    <section className="space-y-4">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-(--accent) px-1">About</h3>
      <div className="glass-surface rounded-2xl flex flex-col pt-1">
        <div className="settings-row">
          <span className="settings-label text-(--text-secondary)">Installed Version</span>
          <span className="text-xs font-mono text-(--text-muted)">v{appVersion}</span>
        </div>

        <div className="settings-row">
          <div className="settings-label-group">
            <span className="settings-label">Automatically check for updates</span>
            <span className="settings-sublabel">Check on startup when enabled</span>
          </div>
          <Toggle
            checked={autoCheckUpdates}
            onChange={onAutoCheckUpdatesChange}
            aria-label="Automatically check for updates"
          />
        </div>

        <div className="flex flex-col gap-2 p-5 border-t border-(--header-glass-border)">
          {updateInfo ? (
            <button
              onClick={onInstallUpdate}
              disabled={installingUpdate}
              className="accent-surface-action w-full cursor-pointer rounded-xl py-2.5 text-xs font-semibold"
            >
              {installingUpdate
                ? updateProgress !== null
                  ? `Downloading ${Math.round(updateProgress)}%`
                  : 'Preparing update...'
                : `Download & Install (v${updateInfo.version})`}
            </button>
          ) : (
            <button
              onClick={onManualCheck}
              disabled={checkingUpdate}
              className="accent-surface-action w-full cursor-pointer rounded-xl py-2.5 text-xs font-semibold"
            >
              {checkingUpdate ? 'Checking for updates...' : 'Check for Updates'}
            </button>
          )}

          {updateStatus === 'up-to-date' && (
            <p className="text-[10px] text-center text-(--status-success) animate-fade-slide">
              SimLauncher is up to date!
            </p>
          )}
          {updateStatus === 'error' && (
            <p className="text-[10px] text-center text-red-400 animate-fade-slide">
              Update failed. Try again later.
            </p>
          )}
        </div>
      </div>
    </section>
  )
}
