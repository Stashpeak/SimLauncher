import type { Dispatch, ReactNode, SetStateAction } from 'react'
import { ProfileToggleRow } from './ProfileToggleRow'

interface ProcessTrackingSectionProps {
  killControlsEnabled: boolean
  relaunchControlsEnabled: boolean
  trackedProcessPaths: string[]
  onKillControlsEnabledChange: Dispatch<SetStateAction<boolean>>
  onRelaunchControlsEnabledChange: Dispatch<SetStateAction<boolean>>
  onAddTrackedProcess: () => void
  onBrowseTrackedProcess: (index: number) => void
  onRemoveTrackedProcess: (index: number) => void
}

export function ProcessTrackingSection({
  killControlsEnabled,
  relaunchControlsEnabled,
  trackedProcessPaths,
  onKillControlsEnabledChange,
  onRelaunchControlsEnabledChange,
  onAddTrackedProcess,
  onBrowseTrackedProcess,
  onRemoveTrackedProcess
}: ProcessTrackingSectionProps): ReactNode {
  return (
    <div className="space-y-4 border-t border-(--glass-border) pt-4">
      <p className="text-xs font-medium uppercase tracking-wider text-(--text-muted)">
        Process tracking
      </p>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <ProfileToggleRow
          label="Allow close apps controls"
          checked={killControlsEnabled}
          onToggle={() => onKillControlsEnabledChange((value) => !value)}
          onChange={onKillControlsEnabledChange}
        />
        <ProfileToggleRow
          label="Allow relaunch controls"
          checked={relaunchControlsEnabled}
          onToggle={() => onRelaunchControlsEnabledChange((value) => !value)}
          onChange={onRelaunchControlsEnabledChange}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-medium text-(--text-primary)">
            Secondary executables to watch
          </span>
          <button
            type="button"
            onClick={onAddTrackedProcess}
            className="accent-surface-action action-hover-scale cursor-pointer rounded-lg px-3 py-1.5 text-xs font-semibold"
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
                  className="glass-recessed min-w-0 flex-1 truncate rounded-lg px-3 py-2 font-mono text-xs text-(--text-secondary) outline-none placeholder:text-(--text-subtle)"
                />
                <button
                  type="button"
                  onClick={() => onBrowseTrackedProcess(index)}
                  className="accent-surface-action action-hover-scale cursor-pointer rounded-lg px-3 py-2 text-xs font-semibold"
                >
                  Browse
                </button>
                <button
                  type="button"
                  onClick={() => onRemoveTrackedProcess(index)}
                  className="danger-action action-hover-scale cursor-pointer rounded-lg px-3 py-2 text-xs font-semibold"
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
  )
}
