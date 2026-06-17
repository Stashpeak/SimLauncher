import { useId, type ReactNode } from 'react'

import { openLogsFolder } from '../../lib/electron'
import { useNotify } from '../Notify'
import { Toggle } from '../Toggle'
import { useSettingsMeta } from './SettingsMetaContext'
import type { UpdateInfo, UpdateStatus } from './types'

interface AboutSectionProps {
  appVersion: string
  updateInfo: UpdateInfo
  checkingUpdate: boolean
  installingUpdate: boolean
  updateProgress: number | null
  updateStatus: UpdateStatus
  onManualCheck: () => void
  onInstallUpdate: () => void
}

export function AboutSection({
  appVersion,
  updateInfo,
  checkingUpdate,
  installingUpdate,
  updateProgress,
  updateStatus,
  onManualCheck,
  onInstallUpdate
}: AboutSectionProps): ReactNode {
  const autoCheckUpdatesId = useId()
  const { autoCheckUpdates, onAutoCheckUpdatesChange } = useSettingsMeta()
  const { notify } = useNotify()

  const handleOpenLogsFolder = async () => {
    // shell.openPath resolves to '' on success or a non-empty error string on
    // failure (e.g. no file-manager association). Surface that so the click
    // never looks like it silently did nothing.
    const error = await openLogsFolder()
    if (error) {
      notify('Could not open the logs folder.', 'error')
    }
  }

  return (
    <>
      <div className="settings-row">
        <span className="settings-label text-(--text-secondary)">Installed Version</span>
        <span className="select-text text-xs font-mono text-(--text-muted)">v{appVersion}</span>
      </div>

      <div className="settings-row">
        <div className="settings-label-group">
          <span className="settings-label">Diagnostics</span>
          <span className="settings-sublabel">
            Open the folder with the crash log and settings file
          </span>
        </div>
        <button
          type="button"
          onClick={() => {
            void handleOpenLogsFolder()
          }}
          className="action-hover-scale cursor-pointer rounded-lg border border-(--glass-border) px-3 py-1.5 text-xs font-medium text-(--text-secondary)"
        >
          Open logs folder
        </button>
      </div>

      <div className="settings-row">
        <div className="settings-label-group">
          <label htmlFor={autoCheckUpdatesId} className="settings-label">
            Automatically check for updates
          </label>
          <span className="settings-sublabel">Check on startup when enabled</span>
        </div>
        <Toggle
          id={autoCheckUpdatesId}
          checked={autoCheckUpdates}
          onChange={onAutoCheckUpdatesChange}
        />
      </div>

      <div
        role="status"
        aria-live="polite"
        className="flex flex-col gap-2 p-5 border-t border-(--header-glass-border)"
      >
        {updateInfo ? (
          <button
            onClick={onInstallUpdate}
            disabled={installingUpdate}
            aria-live="off"
            className="accent-surface-action action-hover-scale w-full cursor-pointer rounded-xl py-2.5 text-xs font-semibold"
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
            aria-live="off"
            className="accent-surface-action action-hover-scale w-full cursor-pointer rounded-xl py-2.5 text-xs font-semibold"
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
          <p className="text-[10px] text-center text-(--status-danger) animate-fade-slide">
            Update failed. Try again later.
          </p>
        )}
        {updateStatus === 'offline' && (
          <p className="text-[10px] text-center text-(--text-muted) animate-fade-slide">
            Can&apos;t reach the update server — check your connection.
          </p>
        )}
      </div>
    </>
  )
}
