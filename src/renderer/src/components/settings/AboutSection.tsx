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
      <div className="glass-surface p-5 rounded-2xl space-y-4">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-(--text-secondary)">Installed Version</span>
          <span className="text-xs font-mono text-(--text-muted)">v{appVersion}</span>
        </div>

        <div className="flex items-center justify-between border-t border-white/5 pt-4">
          <div className="flex flex-col">
            <span className="text-sm font-medium text-(--text-primary)">
              Automatically check for updates
            </span>
            <span className="text-[10px] text-(--text-muted)">Check on startup when enabled</span>
          </div>
          <Toggle
            checked={autoCheckUpdates}
            onChange={onAutoCheckUpdatesChange}
            aria-label="Automatically check for updates"
          />
        </div>

        <div className="flex flex-col gap-2">
          {updateInfo ? (
            <button
              onClick={onInstallUpdate}
              disabled={installingUpdate}
              className="accent-action w-full cursor-pointer rounded-xl py-2.5 text-xs font-bold transition-all active:scale-[0.98] disabled:cursor-wait disabled:opacity-60 disabled:active:scale-100"
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
              className="w-full cursor-pointer rounded-xl bg-(--glass-bg-elevated) py-2.5 text-xs font-bold text-(--text-primary) transition-all hover:bg-(--glass-border) active:scale-[0.98] disabled:opacity-50 disabled:cursor-wait"
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
